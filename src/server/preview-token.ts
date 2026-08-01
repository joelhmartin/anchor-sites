import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { StudioUser } from "../middleware/requireAdmin.js";
import { tokenFromQuery } from "./routes/admin-ai-agent.js";

/**
 * Short-lived, site-scoped preview tokens (2026-07-30 lovable-workspace SDD —
 * operator-reported production break).
 *
 * THE BUG THIS EXISTS FOR. `SitePreviewPanel` renders the draft preview in an
 * `<iframe sandbox="allow-scripts">` (no `allow-same-origin` — see that
 * component's Critical 2 note). A sandboxed frame with an opaque origin sends
 * NO cookies, so the Studio Better-auth session cannot authenticate the
 * preview request; and an <iframe> cannot set headers, so `X-Admin-Token`
 * cannot either. The old client filled the gap with `getAdminToken()` — the
 * LEGACY paste-token from localStorage, which is only ever populated by the
 * deprecated /login flow. Prod operators sign in with Google, so that read
 * returned null, the iframe URL degraded to `?v=0`, and the preview route
 * 401'd every time. The query string is the ONLY channel that reaches this
 * frame, which is exactly why the credential put there must not be the
 * long-lived admin token (its "known deferred item" note lived in
 * admin-pages.ts's Referrer-Policy comment until this file).
 *
 * THE TOKEN. A stateless HMAC — no DB table, nothing to clean up:
 *
 *     pv1.<siteId>.<expEpochSeconds>.<base64url(HMAC-SHA256)>
 *
 * The MAC covers `pv1.<siteId>.<exp>` verbatim, so the version prefix, the
 * site scope AND the expiry are all authenticated: swapping the siteId or
 * extending the exp invalidates the signature. Verification is constant-time
 * (`timingSafeEqual` over equal-length buffers, length-guarded first — the
 * same shape as `verifyGithubSignature` in routes/git-webhook.ts, which
 * throws on a length mismatch if you skip the guard).
 *
 * KEY. HMAC'd once out of the deployment secret with a fixed label, so this
 * token family shares no key with Better-auth's own session signing even
 * though it derives from the same secret material.
 *
 * WHAT A LEAKED TOKEN BUYS. Read access to ONE site's draft previews for at
 * most 15 minutes. Not the admin API, not another site (`verifyPreviewToken`
 * takes the route's `:siteId` and compares), not anything after expiry. That
 * is the entire point of preferring it to `ADMIN_API_TOKEN` in a URL.
 */

const PREFIX = "pv1";
/**
 * Template-scoped variant (W1.1, 2026-07-30 product-audit remediation): the
 * template-preview iframe has the exact same constraints as the site-preview
 * one (sandboxed, opaque origin, query-string-only credential channel), so it
 * gets the same token family under a DISTINCT prefix. The prefix is part of
 * the MAC'd payload, so a template token can never authorize a site preview
 * or vice versa — even for an id collision.
 */
const TEMPLATE_PREFIX = "ptv1";
const KEY_LABEL = "anchor-sites/preview-token/v1";

/** 15 minutes. Long enough for an editing session's page loads, short enough that a leaked URL rots fast. */
export const PREVIEW_TOKEN_TTL_MS = 15 * 60 * 1000;

/** The `studioUser` a preview-token-authenticated request runs as. */
export const PREVIEW_TOKEN_USER: StudioUser = {
  id: "preview-token",
  email: "preview@anchorcorps.com",
  name: "Preview Token",
};

/**
 * Secret material for the derived signing key.
 *
 * `BETTER_AUTH_SECRET` first (the deployment's real session secret).
 * `ADMIN_API_TOKEN` as a fallback so a deployment that predates the Google
 * cutover — and the integration suite, which sets only that — still gets
 * working preview tokens instead of a silently dead endpoint. Using it as
 * HMAC *key material* never discloses it: the token carries a MAC, not the
 * key. `null` means neither is set, and both mint and verify fail closed.
 */
export function previewTokenSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.BETTER_AUTH_SECRET || env.ADMIN_API_TOKEN || null;
}

function signingKey(secret: string): Buffer {
  return createHmac("sha256", secret).update(KEY_LABEL).digest();
}

function sign(secret: string, payload: string): Buffer {
  return createHmac("sha256", signingKey(secret)).update(payload).digest();
}

export type PreviewTokenOptions = {
  env?: NodeJS.ProcessEnv;
  /** Override the TTL (tests). Default `PREVIEW_TOKEN_TTL_MS`. */
  ttlMs?: number;
  /** Override "now" in epoch ms (tests). */
  now?: number;
};

export type MintedPreviewToken = {
  token: string;
  /** Absolute expiry, epoch ms (second-resolution — the token's `exp` is in seconds). */
  expiresAt: number;
};

/**
 * Mint a token scoped to one site. `null` when no secret is configured, or
 * when `siteId` is empty / contains the `.` separator (which would make the
 * compact payload ambiguous — every real site id is a uuid, so this is a
 * guard, not a limitation).
 */
export function mintPreviewToken(
  siteId: string,
  opts: PreviewTokenOptions = {},
): MintedPreviewToken | null {
  return mintScoped(PREFIX, siteId, opts);
}

/** Template-scoped mint — identical shape under the `ptv1` prefix. */
export function mintTemplatePreviewToken(
  templateId: string,
  opts: PreviewTokenOptions = {},
): MintedPreviewToken | null {
  return mintScoped(TEMPLATE_PREFIX, templateId, opts);
}

function mintScoped(
  prefix: string,
  id: string,
  opts: PreviewTokenOptions = {},
): MintedPreviewToken | null {
  const secret = previewTokenSecret(opts.env);
  if (!secret) return null;
  if (typeof id !== "string" || id.length === 0 || id.includes(".")) return null;

  const now = opts.now ?? Date.now();
  const ttlMs = opts.ttlMs ?? PREVIEW_TOKEN_TTL_MS;
  const expSeconds = Math.floor((now + ttlMs) / 1000);
  const payload = `${prefix}.${id}.${expSeconds}`;
  const token = `${payload}.${sign(secret, payload).toString("base64url")}`;
  return { token, expiresAt: expSeconds * 1000 };
}

/**
 * Constant-time verify + scope check + expiry check. Never throws — every
 * malformed input is just `false`.
 *
 * ORDER MATTERS ONLY FOR SAFETY, NOT FOR RESULT: the signature is checked
 * before the scope/expiry values are trusted, since those values come out of
 * the very string being authenticated.
 */
export function verifyPreviewToken(
  token: unknown,
  siteId: string,
  opts: { env?: NodeJS.ProcessEnv; now?: number } = {},
): boolean {
  return verifyScoped(PREFIX, token, siteId, opts);
}

/** Template-scoped verify — only accepts `ptv1` tokens for THIS template id. */
export function verifyTemplatePreviewToken(
  token: unknown,
  templateId: string,
  opts: { env?: NodeJS.ProcessEnv; now?: number } = {},
): boolean {
  return verifyScoped(TEMPLATE_PREFIX, token, templateId, opts);
}

function verifyScoped(
  prefix: string,
  token: unknown,
  id: string,
  opts: { env?: NodeJS.ProcessEnv; now?: number } = {},
): boolean {
  if (typeof token !== "string" || !token.startsWith(`${prefix}.`)) return false;
  const secret = previewTokenSecret(opts.env);
  if (!secret) return false;

  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [, tokenId, expRaw, sigRaw] = parts;
  if (!tokenId || !sigRaw) return false;
  if (!/^\d+$/.test(expRaw)) return false;

  const provided = Buffer.from(sigRaw, "base64url");
  const expected = sign(secret, `${prefix}.${tokenId}.${expRaw}`);
  // timingSafeEqual THROWS on a length mismatch — guard first (buffers of
  // different lengths can never be a match anyway). Same shape as
  // `verifyGithubSignature` (routes/git-webhook.ts).
  if (provided.length !== expected.length) return false;
  if (!timingSafeEqual(provided, expected)) return false;

  const now = opts.now ?? Date.now();
  if (Number(expRaw) * 1000 <= now) return false;

  // Scope. Only reached once the payload is authenticated, so this is a
  // comparison of a value we signed against the route's own scope id — not
  // secret material, so a plain compare is correct here.
  return tokenId === id;
}

/**
 * D808 — the human recovery page an EXPIRED (or otherwise invalid) preview
 * token gets instead of raw JSON.
 *
 * Why: after the 15-min TTL, a click on a rewritten sibling link inside the
 * preview iframe (which still carries the ORIGINAL `?token=` — preview-links
 * propagates the query it was rendered with) used to 401 with
 * `{"error":"unauthorized"}` filling the frame, no way back. The parent
 * can't detect it either: the sandboxed frame has an opaque origin, so
 * `onLoad` looks identical for 401 and 200. So the recovery has to live IN
 * the response body, as something a human can act on.
 *
 * Served only when (a) the presented token is preview-shaped for this route
 * (so curl/static-admin-token flows keep their JSON 401 via the admin gate)
 * and (b) the request prefers HTML (iframe navigations do; API clients
 * default to JSON). No scripts — the sandboxed frame couldn't do anything
 * useful with them anyway (a reload would resend the same expired token);
 * the fix is the parent minting a fresh token, which happens on the next
 * change/refresh in the workspace.
 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

/**
 * D304/D808 — a styled, human error document for the preview iframe. The
 * frame is sandboxed onto an opaque origin, so the parent can't read the
 * status or body: a raw `{"error":…}` JSON 404/500/401 just sat naked inside
 * the polished browser-window chrome with no way back. Every preview-route
 * failure that an iframe can hit renders one of these instead.
 */
function previewErrorHtml(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #fafafa; color: #18181b; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 26rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.05rem; margin: 0 0 .5rem; }
  p { margin: 0; color: #52525b; font-size: .9rem; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
</main>
</body>
</html>
`;
}

function sendPreviewExpired(res: Response): void {
  res
    .status(401)
    .set("Cache-Control", "no-store")
    .type("html")
    .send(
      previewErrorHtml(
        "Preview expired",
        "This draft preview link has expired. Reload the workspace (or make any change) and the preview will come back with a fresh link — nothing was lost.",
      ),
    );
}

/**
 * D304 — send a styled HTML error into the preview frame (404 deleted page,
 * 500 render failure, …). Callers gate on `prefersHtml(req)` so API/curl
 * clients keep their JSON error shape.
 */
export function sendPreviewHtmlError(res: Response, status: number, title: string, message: string): void {
  res.status(status).set("Cache-Control", "no-store").type("html").send(previewErrorHtml(title, message));
}

/** True when the request's Accept header prefers HTML over JSON (iframe navigation). */
export function prefersHtml(req: Request): boolean {
  return req.accepts(["json", "html"]) === "html";
}

/**
 * Auth gate for the preview route: a valid preview token for THIS route's
 * `:siteId`, or the normal admin gate.
 *
 * Composed (rather than chained as sibling middleware) because a middleware
 * cannot skip a later one in the same route without `next("route")`, which
 * would fall through to a 404. So: preview token → authorize directly;
 * a preview-SHAPED token that fails verification on an HTML-accepting
 * request → the D808 recovery page (that request came from the iframe;
 * nothing else could re-auth it); anything else → `tokenFromQuery` (lifts a
 * static `?token=` into the header requireAdmin reads, preserving the
 * curl/dev/legacy-paste-token path) → the injected `admin` handler, which is
 * free to 401.
 */
export function previewQueryAuth(
  admin: RequestHandler,
  opts: { env?: NodeJS.ProcessEnv } = {},
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.query.token;
    if (typeof token === "string" && verifyPreviewToken(token, req.params.siteId, { env: opts.env })) {
      req.studioUser = PREVIEW_TOKEN_USER;
      next();
      return;
    }
    if (typeof token === "string" && token.startsWith(`${PREFIX}.`) && prefersHtml(req)) {
      sendPreviewExpired(res);
      return;
    }
    tokenFromQuery(req, res, () => {
      void admin(req, res, next);
    });
  };
}

/**
 * Auth gate for the TEMPLATE preview route: a valid template preview token
 * for this route's `:id`, or the normal admin gate (same composition as
 * `previewQueryAuth` above — see its comment for why it's composed).
 */
export function templatePreviewQueryAuth(
  admin: RequestHandler,
  opts: { env?: NodeJS.ProcessEnv } = {},
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.query.token;
    if (
      typeof token === "string" &&
      verifyTemplatePreviewToken(token, req.params.id, { env: opts.env })
    ) {
      req.studioUser = PREVIEW_TOKEN_USER;
      next();
      return;
    }
    // D808 — same human recovery page as the site preview (same iframe
    // constraints, same expiry story).
    if (typeof token === "string" && token.startsWith(`${TEMPLATE_PREFIX}.`) && prefersHtml(req)) {
      sendPreviewExpired(res);
      return;
    }
    tokenFromQuery(req, res, () => {
      void admin(req, res, next);
    });
  };
}
