import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { rateLimit, type RateLimitOptions } from "../../middleware/rateLimit.js";
import { provisionSiteHostname, siteIdFromSlug } from "../provisioning/orchestrator.js";
import { brandTokensSchema } from "../../blocks/brand-tokens.js";
// Shared block validator (P6-T6.3) — the AI editor uses the same one, so the
// save path and AI path can never disagree about what's a valid block.
import { blockShape, validateBlocks, type BlockShape } from "../../blocks/validate.js";
// Side-effect: register the static block types so saves validate.
import "../../blocks/index.js";
import { proposeEdit } from "../ai/propose.js";
import type { Block } from "../../blocks/types.js";
import { seoFieldsSchema } from "../seo/schema.js";
import { renderPage, type PageRecord } from "../render-page.js";
import type { ResolvedSite } from "../../middleware/resolveSite.js";
import { loadAssetsForBlocks } from "../render-hydration.js";
import { mintPreviewToken, previewQueryAuth } from "../preview-token.js";
import { getOverlayJs, makeNonce } from "../preview-overlay.js";
import { CAROUSEL_ISLAND_CSP_HASH } from "../csp.js";
// Item 6 (final review) — preview-only site-relative link rewriting.
import { buildPreviewHrefResolver } from "../preview-links.js";
import { buildEditableFieldMap, buildUrlValues } from "../../blocks/editable-fields.js";
// Publish trigger (T4, GitHub sync).
import { resolveGitMode } from "../git/client.js";
import { getGitState } from "../git/state-repo.js";
import { GIT_EXPORT } from "../jobs/index.js";
import type { GitExportInput } from "../jobs/git-export.js";
// D301 snapshot-on-publish — shared SQL + full design rationale.
import { PAGE_HAS_UNPUBLISHED_CHANGES_SQL, PAGE_SNAPSHOT_SQL } from "../publish-snapshot.js";

// Inline Editing Task 4 — Studio mints this token (`crypto.randomUUID()`) and
// passes it in as `?bridge=`; the server never generates or stores it (keeps
// this route stateless). Only shape-validated here, then echoed verbatim into
// bootData so Studio's postMessage bridge can correlate replies back to it.
const BRIDGE_TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

const savePayload = z.object({
  blocks: z.array(blockShape),
  // P9-T9.1 (D-049): page SEO is now the shared, validated `seoFieldsSchema`
  // (was an opaque `z.record(z.unknown())`). Unknown keys are stripped, so a
  // legacy `{title, description}` blob still passes unchanged.
  seo: seoFieldsSchema.optional(),
  source: z.string().max(64).optional(),
  // P3-T3.5: per-page brand-token override. `null` clears any existing
  // override; omitting the key leaves the column unchanged.
  brand_tokens_override: brandTokensSchema.nullable().optional(),
  // P5-T5.10: publish/draft toggle. Omitting leaves status unchanged.
  status: z.enum(["draft", "published"]).optional(),
  // W2-CONC / D308 — optimistic-concurrency base marker. The inline editor
  // snapshots blocks once at edit start and every save POSTs the WHOLE
  // array, so an agent change (or a second tab's edit) landing after that
  // snapshot would be silently clobbered by the next save. Callers that
  // send the page's `updated_at` (as fetched at load, echoed from each save
  // response thereafter) get a 409 instead of a lost-update when the row
  // changed underneath them. Omitting keeps the legacy last-write-wins
  // behavior for callers that re-read before writing.
  base_updated_at: z.string().datetime({ offset: true }).optional(),
});

type SavePayload = z.infer<typeof savePayload>;

const aiEditPayload = z.object({
  instruction: z.string().trim().min(1).max(2000),
  /** Optional: id of the block the operator currently has selected. */
  target_id: z.string().optional(),
});

export type AdminPagesOptions = {
  pool?: Pool;
  /** Override the save rate limit for tests. Default 10/min. */
  saveRateLimit?: RateLimitOptions;
  /** Override the AI-edit rate limit for tests. Default 30/min — AI calls cost money. */
  aiEditRateLimit?: RateLimitOptions;
  /**
   * Publish trigger (T4, GitHub sync): called fire-and-forget after a save
   * whose resulting page status is "published", when git sync is enabled
   * for the site. Defaults to the lazy-`getBoss().send(GIT_EXPORT, input,
   * { singletonKey: siteId })`-in-try/catch idiom (routes/media.ts
   * precedent) so this router can be constructed before bootJobs()
   * completes. Tests inject a spy.
   */
  enqueueGitExport?: (input: GitExportInput) => Promise<string | null>;
};

export function adminPagesRouter(opts: AdminPagesOptions = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const router = Router();

  const enqueueGitExport =
    opts.enqueueGitExport ??
    (async (input: GitExportInput) => {
      const { getBoss, GIT_EXPORT_RETRY_OPTIONS } = await import("../jobs/index.js");
      // D618: per-send retry-with-backoff for branch-ref contention (queue-
      // level options never reach an existing deployment's queue row).
      return getBoss().send(GIT_EXPORT, input, {
        singletonKey: input.siteId,
        ...GIT_EXPORT_RETRY_OPTIONS,
      });
    });

  const saveLimiter = rateLimit(
    opts.saveRateLimit ?? { max: 10, windowMs: 60_000 },
  );
  // P12-T12.6: tighter limit for AI calls (each call costs money).
  const aiLimiter = rateLimit(
    opts.aiEditRateLimit ?? { max: 5, windowMs: 60_000 },
  );

  // requireAdmin is applied per-route (not router-level) so unmatched /api/*
  // paths fall through to Express's default 404 instead of returning 401.
  const admin = requireAdmin();

  // -------------------------------------------------------------------------
  // POST /api/sites/:siteId/pages/:pageId — save blocks + seo, write revision
  // -------------------------------------------------------------------------
  router.post(
    "/sites/:siteId/pages/:pageId",
    admin,
    saveLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId, pageId } = req.params;

      const parsed = savePayload.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "invalid payload",
          details: parsed.error.errors.map((e) => ({
            path: e.path.join(".") || "(root)",
            message: e.message,
          })),
        });
        return;
      }

      const payload: SavePayload = parsed.data;
      const failures = validateBlocks(payload.blocks);
      if (failures.length > 0) {
        res.status(400).json({ error: "block validation failed", failures });
        return;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // brand_tokens_override semantics: undefined → leave column,
        // null → clear column, object → set column. We pass a sentinel to
        // the SQL CASE so all three branches stay in one round-trip.
        const btoMode =
          payload.brand_tokens_override === undefined
            ? "unchanged"
            : payload.brand_tokens_override === null
              ? "clear"
              : "set";
        const btoValue =
          payload.brand_tokens_override && typeof payload.brand_tokens_override === "object"
            ? JSON.stringify(payload.brand_tokens_override)
            : null;

        // Critical 1 (final review): `RETURNING seo` gives us the RESOLVED
        // seo value from the same UPDATE statement/transaction — thanks to
        // `COALESCE($2::jsonb, seo)` above, that's payload.seo when the
        // caller sent one, or the page's PRE-EXISTING seo unchanged when it
        // didn't. The inline-editing engine's save calls (`src/admin/lib/
        // inline-editor.ts`) never send `seo` at all — before this fix, the
        // revision insert below used `payload.seo ?? {}` directly, so every
        // inline save wrote an SEO-EMPTY revision snapshot even though the
        // page's actual seo column was untouched. Restoring that revision
        // (the restore route applies `revision.seo` unconditionally, not
        // COALESCE) then wiped the page's seo to `{}`. Using the UPDATE's
        // own RETURNING value instead of the raw payload closes that gap
        // without a second SELECT (mirrors the "read current state inside
        // the same transaction" approach `pages.ts`'s update_page tool uses
        // for its before/after revision snapshots, but atomically — no
        // separate SELECT ... FOR UPDATE needed since this UPDATE already
        // touches the row).
        // D301: when THIS save publishes (payload.status === 'published'),
        // freeze the render payload the tenant route serves — built from
        // the NEW values this same UPDATE writes (SET expressions read the
        // OLD row, so the snapshot must repeat the new-value expressions,
        // not reference the columns). A save that doesn't touch status
        // leaves the snapshot alone — that's the whole point: post-publish
        // edits stay off the live site until the next publish. D504:
        // published_at stamps on publish, clears on unpublish (mirrors
        // blog/repo.ts).
        // D308: `$8` (base_updated_at) fences the whole-document write. Both
        // sides are truncated to millisecond precision — node-postgres
        // parses timestamptz into a JS Date (ms), so the ISO string the
        // client holds is the row's µs value floored to ms; comparing the
        // raw column would never match.
        const pageRes = await client.query<{ id: string; status: string; seo: Record<string, unknown>; updated_at: Date }>(
          `UPDATE pages
              SET blocks = $1::jsonb,
                  seo = COALESCE($2::jsonb, seo),
                  brand_tokens_override = CASE $5
                    WHEN 'unchanged' THEN brand_tokens_override
                    WHEN 'clear'     THEN NULL
                    WHEN 'set'       THEN $6::jsonb
                  END,
                  status = COALESCE($7, status),
                  published_snapshot = CASE
                    WHEN $7::text = 'published' THEN jsonb_build_object(
                      'title', title,
                      'blocks', $1::jsonb,
                      'seo', COALESCE($2::jsonb, seo),
                      'brand_tokens_override', CASE $5
                        WHEN 'unchanged' THEN brand_tokens_override
                        WHEN 'clear'     THEN NULL::jsonb
                        WHEN 'set'       THEN $6::jsonb
                      END
                    )
                    ELSE published_snapshot
                  END,
                  published_at = CASE
                    WHEN $7::text = 'published' THEN now()
                    WHEN $7::text = 'draft'     THEN NULL
                    ELSE published_at
                  END
            WHERE id = $3 AND site_id = $4
              AND ($8::timestamptz IS NULL
                   OR date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $8::timestamptz))
            RETURNING id, status, seo, updated_at`,
          [
            JSON.stringify(payload.blocks),
            payload.seo ? JSON.stringify(payload.seo) : null,
            pageId,
            siteId,
            btoMode,
            btoValue,
            payload.status ?? null,
            payload.base_updated_at ?? null,
          ],
        );

        if (pageRes.rowCount === 0) {
          await client.query("ROLLBACK");
          // D308: zero rows now has two meanings — missing page (404, as
          // ever) vs. a base-marker mismatch on a page that exists (409:
          // someone else's save landed after this caller's snapshot).
          if (payload.base_updated_at) {
            const exists = await pool.query(
              `SELECT 1 FROM pages WHERE id = $1 AND site_id = $2`,
              [pageId, siteId],
            );
            if ((exists.rowCount ?? 0) > 0) {
              res.status(409).json({ error: "page changed underneath you — reload" });
              return;
            }
          }
          res.status(404).json({ error: "page not found for this site" });
          return;
        }

        const resolvedSeo = pageRes.rows[0].seo ?? {};

        const revRes = await client.query<{ id: string; created_at: Date }>(
          `INSERT INTO page_revisions (page_id, blocks, seo, source)
           VALUES ($1, $2::jsonb, $3::jsonb, $4)
           RETURNING id, created_at`,
          [
            pageId,
            JSON.stringify(payload.blocks),
            JSON.stringify(resolvedSeo),
            payload.source ?? "manual",
          ],
        );

        await client.query("COMMIT");

        // Publish trigger (T4, GitHub sync): fire-and-forget git.export
        // enqueue when this save's resulting status is "published". Checks
        // run cheapest-first so an unconfigured/disabled deployment never
        // pays for the extra SELECT: the status check and resolveGitMode()
        // are both free (no I/O); getGitState (one SELECT) only runs once
        // both already say "maybe". A failure anywhere in this chain is
        // swallowed — it must never affect the save response the operator
        // is waiting on.
        if (pageRes.rows[0].status === "published" && resolveGitMode() === "api") {
          try {
            const gitState = await getGitState(pool, siteId);
            if (gitState?.enabled) {
              enqueueGitExport({ siteId, trigger: "publish" }).catch(() => undefined);
            }
          } catch {
            // best-effort — never affects the save response
          }
        }

        res.status(200).json({
          page: {
            id: pageId,
            site_id: siteId,
            blocks: payload.blocks,
            seo: resolvedSeo,
            status: pageRes.rows[0].status,
            // D308: the row's NEW updated_at (the touch trigger bumped it in
            // this same UPDATE) — concurrency-token clients rebase on it so
            // their next save's base marker matches.
            updated_at: pageRes.rows[0].updated_at,
          },
          revision: { id: revRes.rows[0].id, created_at: revRes.rows[0].created_at },
        });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        next(err);
      } finally {
        client.release();
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/sites/:siteId/pages/:pageId — single page with blocks + seo.
  // The visual editor (P5-T5.5) loads a page's current blocks from here; the
  // pages-list endpoint (admin-sites) deliberately omits blocks for size.
  // -------------------------------------------------------------------------
  router.get(
    "/sites/:siteId/pages/:pageId",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { siteId, pageId } = req.params;
        const result = await pool.query(
          `SELECT id, site_id, slug, title, status, blocks, seo,
                  brand_tokens_override, updated_at
             FROM pages
            WHERE id = $1 AND site_id = $2`,
          [pageId, siteId],
        );
        if (result.rowCount === 0) {
          res.status(404).json({ error: "page not found for this site" });
          return;
        }
        res.json({ page: result.rows[0] });
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/sites/:siteId/preview-token — mint the short-lived, site-scoped
  // credential the preview <iframe> carries in its query string.
  //
  // Authed by the ordinary dual-mode `requireAdmin` (Studio session OR
  // X-Admin-Token), because THIS request is a normal `apiFetch` from the SPA
  // — cookies and headers both reach it. The iframe it mints for is the one
  // that can use neither (sandbox + no `allow-same-origin` ⇒ no cookies; an
  // <iframe> can't set headers). See src/server/preview-token.ts.
  // -------------------------------------------------------------------------
  router.post(
    "/sites/:siteId/preview-token",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId } = req.params;
      try {
        // Don't hand out a token for a scope that doesn't exist — a 404 here
        // is a clearer client error than a token that 404s one request later.
        const siteRes = await pool.query<{ id: string }>(`SELECT id FROM sites WHERE id = $1`, [
          siteId,
        ]);
        if (siteRes.rowCount === 0) {
          res.status(404).json({ error: "site not found" });
          return;
        }

        const minted = mintPreviewToken(siteId);
        if (!minted) {
          // No BETTER_AUTH_SECRET and no ADMIN_API_TOKEN — nothing to sign
          // with. Fail loudly rather than returning an unverifiable token.
          res.status(503).json({ error: "preview tokens not configured" });
          return;
        }
        res.json({ token: minted.token, expires_at: new Date(minted.expiresAt).toISOString() });
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/sites/:siteId/pages/:pageId/preview — render a page's CURRENT
  // blocks (any status — this is the point: it's how the operator/AI-agent
  // preview a draft before publishing).
  //
  // `previewQueryAuth` is the whole auth story: an <iframe> can set no
  // headers, and this one is sandboxed without `allow-same-origin` so it
  // sends no cookies either — the query string is its ONLY credential
  // channel. It accepts EITHER a short-lived site-scoped preview token
  // (`?token=pv1.…`, minted by the route above — the path prod's Google-OAuth
  // operators take) OR, unchanged, the static ADMIN_API_TOKEN lifted into the
  // header requireAdmin reads (curl/dev/the legacy paste-token login). This
  // is the one route that needs the query-token shim at all — the SSE tail
  // (admin-ai-agent.ts's /events route) dropped it (Important 3, round 1
  // review): the drawer's tail is a `fetch()` call with an X-Admin-Token
  // header, never a native EventSource.
  // Mirrors the tenant page route's (`src/server/routes/page.ts`) media
  // hydration so images/hero-slider resolve identically in preview.
  // -------------------------------------------------------------------------
  router.get(
    "/sites/:siteId/pages/:pageId/preview",
    previewQueryAuth(admin),
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId, pageId } = req.params;
      try {
        const siteRes = await pool.query<{
          id: string;
          slug: string;
          display_name: string;
          default_brand_tokens: Record<string, unknown> | null;
          seo_defaults: Record<string, unknown> | null;
          ctm_account_id: string | null;
          analytics_disabled: boolean;
        }>(
          `SELECT id, slug, display_name, default_brand_tokens, seo_defaults,
                  ctm_account_id, analytics_disabled
             FROM sites WHERE id = $1`,
          [siteId],
        );
        if (siteRes.rowCount === 0) {
          res.status(404).json({ error: "site not found" });
          return;
        }
        const siteRow = siteRes.rows[0];

        const pageRes = await pool.query<PageRecord & { slug: string }>(
          `SELECT title, blocks, seo, brand_tokens_override, slug
             FROM pages WHERE id = $1 AND site_id = $2`,
          [pageId, siteId],
        );
        if (pageRes.rowCount === 0) {
          res.status(404).json({ error: "page not found for this site" });
          return;
        }
        const page = pageRes.rows[0];

        const assets = await loadAssetsForBlocks(pool, siteId, page.blocks);

        const site: ResolvedSite = {
          id: siteRow.id,
          slug: siteRow.slug,
          display_name: siteRow.display_name,
          default_brand_tokens: siteRow.default_brand_tokens ?? {},
          seo_defaults: siteRow.seo_defaults ?? {},
          // Previews never load third-party tracking: the sandboxed iframe
          // (no allow-same-origin) makes CTM/analytics scripts throw on every
          // cookie write, and a draft view is not real traffic anyway.
          ctm_account_id: null,
          analytics_disabled: true,
          matched_via: "domain",
          plugins: [],
        };

        // Fix round 1 (reviewer extra #4): the tenant page route (page.ts)
        // maps the URL path "/" <-> slug "home" (its `normalizeSlug`) — a
        // literal `/${slug}` would give the home page the wrong canonical
        // path ("/home" instead of "/"). Mirror that same mapping here so
        // preview's canonical/og:url tags match what the page would get once
        // published, instead of only matching every NON-home slug.
        const previewPath = page.slug === "home" ? "/" : `/${page.slug}`;

        // Inline Editing Task 4 — `?edit=1&bridge=<token>` opts this preview
        // into edit mode. The bridge token is Studio-minted
        // (`crypto.randomUUID()`) and passed in via the query string (the
        // iframe consumer can't set/read headers); the server only shape-
        // validates it, then echoes it into bootData so Studio's
        // postMessage listener can match replies to the session that
        // requested them. A malformed token 400s before any CSP/render work.
        const editMode = req.query.edit === "1";
        let editable: { overlayJs: string; nonce: string; bootData: object } | undefined;
        if (editMode) {
          const bridgeToken = req.query.bridge;
          if (typeof bridgeToken !== "string" || !BRIDGE_TOKEN_RE.test(bridgeToken)) {
            res.status(400).json({ error: "invalid bridge token" });
            return;
          }
          const nonce = makeNonce();
          const fields = buildEditableFieldMap();
          editable = {
            overlayJs: getOverlayJs(),
            nonce,
            bootData: {
              token: bridgeToken,
              siteId,
              pageId,
              fields,
              // Task 7 — current values of every url-classified field, so the
              // overlay's link chip can hand Studio's popover a starting
              // value without the overlay having to infer it from markup.
              urls: buildUrlValues(page.blocks, fields),
              readonly: false,
            },
          };
        }

        // Critical 2 (defense in depth alongside the iframe's `sandbox`
        // attribute): this response is served same-origin at /api/... and
        // renders operator/AI-authored blocks. `res.setHeader` REPLACES
        // app.ts's global helmet CSP (buildCsp) for this one response
        // rather than fighting it — that global policy is tuned for the
        // admin SPA shell, not for rendered-page HTML, so a minimal,
        // self-contained policy is clearer than trying to merge with it.
        //
        // Round 2 fix: the FIRST version of this header
        // (`default-src 'self' https: data:`) was broken two ways —
        // (a) render-page.tsx's `shell()` ALWAYS emits an inline
        // `<style>${styles}</style>` tag (block CSS is inlined at
        // module-load, there's no client-side hydration to pick up a
        // linked stylesheet — see that file's own header comment), which
        // `default-src` alone does not permit; a missing `style-src`
        // falls back to `default-src`, which has no `'unsafe-inline'`, so
        // the browser drops every rule in that tag. (b) `'self'` is
        // meaningless once `sandbox` (no `allow-same-origin`) forces the
        // frame onto an opaque origin — nothing can ever count as
        // '`self`' there.
        //
        // `script-src 'none'`: verified render-page.tsx/BlockRenderer emit
        // no client bundle required for basic blocks to render correctly
        // (no hydration step at all, per render-page.tsx:26-29) — the only
        // `<script>` tags `shell()` can add are the CTM call-tracking
        // loader, the analytics snippet, and the web-vitals reporter, none
        // of which affect how a block LOOKS in preview, and all of which
        // we'd rather not fire from a draft preview anyway (no reason to
        // swap phone numbers or emit analytics/vitals events for a page
        // that isn't published). `style-src`/`img-src` allow `https:`/
        // `data:` so the package block CSS + any real image URLs still
        // render; `frame-ancestors 'self'` (not `*`) since only this app
        // embeds its own preview.
        // Inline Editing Task 4: edit mode needs the overlay's inline
        // `<script nonce="...">` to execute, so its CSP swaps `script-src
        // 'none'` for a nonce allowlist scoped to that one script tag —
        // everything else about the policy (sandbox, style-src, img-src,
        // frame-ancestors) is identical to the plain-preview policy above.
        // D1200 — both variants additionally allow the carousel enhancement
        // island (the ONE inline script @anchorcorps/components blocks embed
        // in their own SSR output) by sha256 hash, so sliders behave in the
        // preview iframe exactly as on live pages (which permit it via the
        // global CSP's 'unsafe-inline'). A hash allows exactly those bytes —
        // this is NOT 'unsafe-inline'; every other script stays blocked.
        if (editable) {
          res.setHeader(
            "Content-Security-Policy",
            "sandbox allow-scripts; default-src 'self' https: data:; " +
              "style-src 'unsafe-inline' https: data:; img-src https: data:; " +
              `script-src 'nonce-${editable.nonce}' ${CAROUSEL_ISLAND_CSP_HASH}; frame-ancestors 'self'`,
          );
        } else {
          res.setHeader(
            "Content-Security-Policy",
            "sandbox allow-scripts; default-src 'self' https: data:; " +
              "style-src 'unsafe-inline' https: data:; img-src https: data:; " +
              `script-src ${CAROUSEL_ISLAND_CSP_HASH}; frame-ancestors 'self'`,
          );
        }
        // Item 9 (CodeRabbit — preview refresh): the client now busts the
        // URL itself with a `v=<nonce>` query param on every change
        // (SiteDetailPage.tsx), but `no-store` closes the same gap
        // server-side too — a draft preview must never be served from any
        // cache (browser or intermediary), stale or otherwise.
        res.setHeader("Cache-Control", "no-store");
        // Item 13 (CodeRabbit, cheap adjunct to the SSRF/token work above):
        // the URL this response is served at carries `?token=…` (the query
        // string is the iframe's only credential channel) — without this,
        // any same-origin/https subresource the rendered page's own blocks
        // load (an image, a linked resource) would send that whole URL,
        // token included, as its Referer. `no-referrer` means this document
        // never sends a Referer header at all. Still worth keeping now that
        // the deferred follow-up landed: the token in that URL is normally
        // the 15-minute site-scoped preview token (preview-token.ts), but a
        // curl/dev caller can still be passing the long-lived
        // ADMIN_API_TOKEN, and even the short-lived one is a credential.
        res.setHeader("Referrer-Policy", "no-referrer");
        // FINAL whole-branch review, FIX-NOW item 6 — preview iframe nav
        // escape. Template/agent-authored `<a href="/about">` resolves
        // against THIS document's URL, which is on the admin origin, so a
        // click inside the sandboxed preview navigated the frame to the
        // admin SPA. One extra SELECT gives the slug→pageId map needed to
        // point those links at the sibling pages' own previews instead.
        // Preview-only: `rewriteHref` is never passed by the published
        // tenant route. See src/server/preview-links.ts.
        const previewPages = await pool.query<{ id: string; slug: string }>(
          `SELECT id, slug FROM pages WHERE site_id = $1`,
          [siteId],
        );
        const rewriteHref = buildPreviewHrefResolver({
          siteId,
          pages: previewPages.rows,
          query: req.query as Record<string, unknown>,
        });
        const { html } = renderPage(site, page, { assets, path: previewPath, editable, rewriteHref });
        res.status(200).type("html").send(html);
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/sites/:siteId/pages/:pageId/ai-edit — AI proposes a change.
  // Returns a schema-validated PREVIEW { proposed_blocks, diff } — does NOT
  // save (apply is a separate operator action, 6.5). Dry-run/stub return a
  // deterministic sample proposal (no spend). The AI can never persist an
  // invalid block: the proposal is re-validated against the registry, and this
  // handler only SELECTs — there is no write path here at all (P6-T6.4).
  // -------------------------------------------------------------------------
  router.post(
    "/sites/:siteId/pages/:pageId/ai-edit",
    admin,
    aiLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId, pageId } = req.params;
      const parsed = aiEditPayload.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "invalid payload",
          details: parsed.error.errors.map((e) => ({
            path: e.path.join(".") || "(root)",
            message: e.message,
          })),
        });
        return;
      }

      try {
        const pageRes = await pool.query<{ blocks: Block[] }>(
          `SELECT blocks FROM pages WHERE id = $1 AND site_id = $2`,
          [pageId, siteId],
        );
        if (pageRes.rowCount === 0) {
          res.status(404).json({ error: "page not found for this site" });
          return;
        }

        const currentBlocks = pageRes.rows[0].blocks ?? [];
        const { instruction, target_id } = parsed.data;
        const result = await proposeEdit({
          blocks: currentBlocks,
          instruction: target_id
            ? `${instruction}\n\n(The operator currently has block id "${target_id}" selected.)`
            : instruction,
        });

        if (!result.ok) {
          // 422: the request was well-formed but no valid proposal could be
          // produced (unknown type / invalid props / bad tool input). Nothing
          // was persisted.
          res.status(422).json({
            error: "ai proposal rejected",
            mode: result.mode,
            reason: result.reason,
            message: result.message,
            failures: result.failures,
          });
          return;
        }

        res.status(200).json({
          mode: result.mode,
          message: result.message,
          proposed_blocks: result.proposed_blocks,
          diff: result.diff,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/sites/:siteId/pages/:pageId/revisions — reverse-chrono list
  // -------------------------------------------------------------------------
  router.get(
    "/sites/:siteId/pages/:pageId/revisions",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId, pageId } = req.params;
      try {
        const pageOk = await pool.query(
          `SELECT 1 FROM pages WHERE id = $1 AND site_id = $2`,
          [pageId, siteId],
        );
        if (pageOk.rowCount === 0) {
          res.status(404).json({ error: "page not found for this site" });
          return;
        }

        const revs = await pool.query(
          `SELECT id, created_at, source, author_id
             FROM page_revisions
            WHERE page_id = $1
         ORDER BY created_at DESC, id DESC`,
          [pageId],
        );
        res.status(200).json({ revisions: revs.rows });
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/sites/:siteId/pages/:pageId/revisions/:revisionId/restore
  // Non-destructive: copies the revision into pages.blocks/seo AND inserts a
  // new page_revisions row (so revision history is append-only).
  // -------------------------------------------------------------------------
  router.post(
    "/sites/:siteId/pages/:pageId/revisions/:revisionId/restore",
    admin,
    saveLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId, pageId, revisionId } = req.params;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const revRes = await client.query<{ blocks: BlockShape[]; seo: Record<string, unknown> }>(
          `SELECT blocks, seo
             FROM page_revisions
            WHERE id = $1 AND page_id = $2`,
          [revisionId, pageId],
        );
        if (revRes.rowCount === 0) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: "revision not found for this page" });
          return;
        }

        const ownerOk = await client.query(
          `SELECT 1 FROM pages WHERE id = $1 AND site_id = $2`,
          [pageId, siteId],
        );
        if (ownerOk.rowCount === 0) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: "page not found for this site" });
          return;
        }

        const { blocks, seo } = revRes.rows[0];

        await client.query(
          `UPDATE pages SET blocks = $1::jsonb, seo = $2::jsonb WHERE id = $3`,
          [JSON.stringify(blocks), JSON.stringify(seo ?? {}), pageId],
        );

        const newRev = await client.query<{ id: string; created_at: Date }>(
          `INSERT INTO page_revisions (page_id, blocks, seo, source)
           VALUES ($1, $2::jsonb, $3::jsonb, $4)
           RETURNING id, created_at`,
          [pageId, JSON.stringify(blocks), JSON.stringify(seo ?? {}), `restore:${revisionId}`],
        );

        await client.query("COMMIT");
        res.status(200).json({
          restored_from: revisionId,
          revision: { id: newRev.rows[0].id, created_at: newRev.rows[0].created_at },
        });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        next(err);
      } finally {
        client.release();
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/sites/:siteId/publish — one-click publish (Task B3, Lovable
  // workspace). Flips every non-published page on the site to 'published'
  // in one transaction, appending a `source:'manual'` revision per page —
  // same save+revision pattern as the single-page route above, just batched
  // and status-only: blocks/seo are read back from the row being updated
  // (not touched by this UPDATE at all) so the revision snapshot mirrors
  // the current-seo-preservation behavior of the single-page save exactly
  // (no COALESCE needed here since we never write blocks/seo, unlike that
  // route). Idempotent — a page already 'published' is excluded by the
  // WHERE clause, so a second call publishes nothing further.
  // -------------------------------------------------------------------------
  router.post(
    "/sites/:siteId/publish",
    admin,
    saveLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId } = req.params;
      const client = await pool.connect();
      try {
        const siteOk = await client.query(`SELECT 1 FROM sites WHERE id = $1`, [siteId]);
        if (siteOk.rowCount === 0) {
          res.status(404).json({ error: "site not found" });
          return;
        }

        // D610: the publish-during-build guard used to be client-side only
        // (a disabled button) — anything hitting the API mid-turn flipped
        // half-written pages live and immortalized them as 'manual'
        // revisions. One indexed SELECT (ai_conversations_site_idx prefix)
        // enforces the mutual exclusion server-side; the workspace surfaces
        // this 409's message through its existing publishError slot.
        const running = await client.query(
          `SELECT 1 FROM ai_conversations WHERE site_id = $1 AND status = 'running' LIMIT 1`,
          [siteId],
        );
        if ((running.rowCount ?? 0) > 0) {
          res.status(409).json({
            error: "Agent is running — publish is disabled until the build finishes.",
          });
          return;
        }

        await client.query("BEGIN");
        // D301: publish = freeze the working copy as the live payload. The
        // WHERE picks up drafts AND published pages whose working copy
        // diverged from the snapshot (post-publish agent/inline/SEO edits),
        // so re-publishing an edited page actually ships the edit — and an
        // untouched site publishes 0, keeping the route idempotent. SET
        // expressions read the OLD row, which here IS the working copy
        // (this UPDATE never writes content columns). D504: published_at
        // stamps whenever content goes live.
        const publishedRes = await client.query<{ id: string; blocks: Block[]; seo: Record<string, unknown> }>(
          `UPDATE pages
              SET status = 'published',
                  published_snapshot = ${PAGE_SNAPSHOT_SQL},
                  published_at = now()
            WHERE site_id = $1 AND ${PAGE_HAS_UNPUBLISHED_CHANGES_SQL}
            RETURNING id, blocks, seo`,
          [siteId],
        );

        for (const page of publishedRes.rows) {
          await client.query(
            `INSERT INTO page_revisions (page_id, blocks, seo, source)
             VALUES ($1, $2::jsonb, $3::jsonb, 'manual')`,
            [page.id, JSON.stringify(page.blocks ?? []), JSON.stringify(page.seo ?? {})],
          );
        }

        await client.query("COMMIT");

        const published = publishedRes.rowCount ?? 0;

        // Publish trigger (T4, GitHub sync): ONE enqueue for the whole
        // batch — git.export's handler exports the entire site's current
        // state from a single siteId. D611: this used to be
        // `.catch(() => undefined)` gated on `published > 0` — a one-shot
        // with no second chance (a failed enqueue was invisible, and the
        // idempotent second publish never re-fired it, so the workspace had
        // no export-retry path at all). Now EVERY publish on a sync-enabled
        // site fires the export — the export job itself no-ops via blob-sha
        // comparison when the repo already matches, so a redundant enqueue
        // costs one skipped job — and the outcome is reported in the
        // response (`git_export`), so the workspace can say "sync didn't
        // queue, retry from Manage" instead of narrating success. Enqueue
        // failure still never fails the publish: the pages ARE live.
        let gitExport: { queued: boolean; error?: string } | null = null;
        if (resolveGitMode() === "api") {
          try {
            const gitState = await getGitState(pool, siteId);
            if (gitState?.enabled) {
              try {
                await enqueueGitExport({ siteId, trigger: "publish" });
                gitExport = { queued: true };
              } catch (e) {
                gitExport = {
                  queued: false,
                  error: e instanceof Error ? e.message : String(e),
                };
              }
            }
          } catch {
            // getGitState failed — treat as sync-not-enabled (best-effort;
            // never affects the publish response's success).
          }
        }

        // FINAL whole-branch review, FIX-NOW item 2b: this used to return a
        // bare `live_url` with no provisioning state, and the workspace
        // rendered it as a success-styled external link the moment publish
        // resolved. But the canonical hostname's Cloud Run mapping and cert
        // are provisioned ASYNCHRONOUSLY (the `site.provision` job), so for
        // the first minutes of a brand-new site that link goes nowhere —
        // the single most confidence-destroying thing this flow could do.
        // The two status columns ride along so the client can say "still
        // provisioning" instead of lying.
        const domainRes = await pool.query<{
          hostname: string;
          verification_status: string;
          ssl_status: string;
        }>(
          `SELECT hostname, verification_status, ssl_status
             FROM site_domains WHERE site_id = $1 AND is_primary = true LIMIT 1`,
          [siteId],
        );
        const domain = domainRes.rows[0];
        const live_url = domain?.hostname ? `https://${domain.hostname}` : null;
        const live_url_ready =
          domain?.verification_status === "verified" && domain?.ssl_status === "active";

        res.status(200).json({
          published,
          // D611: null = sync not configured/enabled; {queued:true} = export
          // job accepted; {queued:false, error} = enqueue failed (publish
          // still succeeded — the workspace surfaces the retry path).
          git_export: gitExport,
          live_url,
          live_url_ready,
          live_url_status: domain
            ? {
                verification_status: domain.verification_status,
                ssl_status: domain.ssl_status,
              }
            : null,
        });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        next(err);
      } finally {
        client.release();
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/sites/:siteId/provision — add DNS records + Cloud Run mapping
  // POST /api/sites/provision         — same, but take slug in body
  // -------------------------------------------------------------------------
  // Long-running (cert wait can take 20+ min) → not behind the save limiter.
  // Caller controls `wait` via the body.
  const provisionHandler = async (req: Request, res: Response, next: NextFunction) => {
    const body = (req.body ?? {}) as { slug?: string; wait?: boolean };
    const wait = Boolean(body.wait);
    try {
      let siteId = req.params.siteId;
      if (!siteId) {
        if (!body.slug) {
          res.status(400).json({ error: "must supply siteId in path or slug in body" });
          return;
        }
        siteId = await siteIdFromSlug(body.slug, pool);
      }
      const result = await provisionSiteHostname(siteId, { pool, wait });
      const httpStatus = result.steps.some((s) => s.status === "error") ? 500 : 200;
      res.status(httpStatus).json(result);
    } catch (err) {
      next(err);
    }
  };
  router.post("/sites/:siteId/provision", admin, provisionHandler);
  router.post("/sites/provision", admin, provisionHandler);

  return router;
}
