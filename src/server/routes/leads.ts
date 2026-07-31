import express, { Router, type Request, type Response, type NextFunction } from "express";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { resolveSite } from "../../middleware/resolveSite.js";
import { flagAdminHost } from "../../middleware/flagAdminHost.js";
import { rateLimit, type RateLimitOptions } from "../../middleware/rateLimit.js";
import { renderLeadThanks } from "../render-page.js";
import { HTML_CACHE_CONTROL } from "../http-cache.js";

/**
 * D700 (W1.6) — the ONE real platform lead endpoint.
 *
 * Every template's `crm_form` is a plain HTML `<form method="post">` inside an
 * operator-editable embed string, submitted from the TENANT origin — so the
 * endpoint is host-resolved exactly like page rendering (`resolveSite` on the
 * Host header), not admin-prefixed or admin-gated. Templates target
 * `action="/api/leads"`; the mount in app.ts sits under `/api` ahead of the
 * D101 JSON terminator.
 *
 * Abuse controls:
 *   - per-IP token-bucket rate limit (shared middleware, default 5/min);
 *   - honeypot: a visually-hidden `website` field every template form
 *     carries — bots that fill it get the same thank-you page, but nothing
 *     is stored;
 *   - payload caps: ≤ MAX_FIELDS fields, key/value length caps, 32kb body.
 *
 * Success is a full branded confirmation page (renderLeadThanks): the forms
 * are plain HTML posts (no client JS on published sites), so the response IS
 * the navigation target.
 *
 * Storage: `leads` (migration 1747609000000) — site_id, page_hint (hidden
 * `_page` input, else Referer path), submitted fields as JSONB. The manage
 * surface that lists these is W2 scope.
 */

const HONEYPOT_FIELD = "website";
const MAX_FIELDS = 40;
const MAX_KEY_LENGTH = 100;
const MAX_VALUE_LENGTH = 5000;
const MAX_PAGE_HINT_LENGTH = 200;

export type LeadsRouterOptions = {
  pool?: Pool;
  rateLimitOpts?: RateLimitOptions;
};

export function leadsRouter(opts: LeadsRouterOptions = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const router = Router();
  const limiter = rateLimit(opts.rateLimitOpts ?? { max: 5, windowMs: 60_000 });

  router.post(
    "/leads",
    limiter,
    // Template forms post application/x-www-form-urlencoded; the app-level
    // parser is JSON-only. `extended: false` keeps values flat strings.
    express.urlencoded({ extended: false, limit: "32kb" }),
    flagAdminHost,
    resolveSite({ pool, passThroughOnMiss: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      // The studio is never a tenant; an unknown host has no site to
      // attribute the lead to. Mirror the D101 terminator's shape.
      if (req.isAdminHost || !req.site) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const site = req.site;

      try {
        const body: Record<string, unknown> =
          req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};

        const pageHint = derivePageHint(body, req.get("referer"));
        const backHref = pageHint ?? "/";

        // Honeypot tripped → pretend success, store nothing. The page is
        // indistinguishable from the real one so bots learn nothing.
        const honeypot = body[HONEYPOT_FIELD];
        if (typeof honeypot === "string" && honeypot.trim() !== "") {
          const { html, status } = renderLeadThanks(site, { backHref });
          res.status(status).set("Cache-Control", HTML_CACHE_CONTROL).type("text/html").send(html); // D908
          return;
        }

        const fields = extractFields(body);
        if (fields === null) {
          res.status(400).json({ error: "invalid_submission" });
          return;
        }

        await pool.query(
          `INSERT INTO leads (site_id, page_hint, fields) VALUES ($1, $2, $3::jsonb)`,
          [site.id, pageHint, JSON.stringify(fields)],
        );

        const { html, status } = renderLeadThanks(site, { backHref });
        res.status(status).set("Cache-Control", HTML_CACHE_CONTROL).type("text/html").send(html); // D908
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

/**
 * The submitted fields, minus meta keys (`_`-prefixed) and the honeypot.
 * `null` when the submission is empty or exceeds the abuse caps.
 */
function extractFields(body: Record<string, unknown>): Record<string, string> | null {
  const fields: Record<string, string> = {};
  let count = 0;
  for (const [key, raw] of Object.entries(body)) {
    if (key.startsWith("_") || key === HONEYPOT_FIELD) continue;
    if (key.length > MAX_KEY_LENGTH) return null;
    // extended:false yields strings (or arrays for repeated keys).
    const value = Array.isArray(raw) ? raw.map(String).join(", ") : String(raw ?? "");
    if (value.length > MAX_VALUE_LENGTH) return null;
    count++;
    if (count > MAX_FIELDS) return null;
    fields[key] = value;
  }
  if (count === 0) return null;
  return fields;
}

function derivePageHint(body: Record<string, unknown>, referer: string | undefined): string | null {
  const explicit = body._page;
  if (typeof explicit === "string" && explicit.trim() !== "") {
    return clampHint(explicit.trim());
  }
  if (referer) {
    try {
      return clampHint(new URL(referer).pathname);
    } catch {
      // Malformed Referer — no hint.
    }
  }
  return null;
}

function clampHint(hint: string): string {
  const withSlash = hint.startsWith("/") ? hint : `/${hint}`;
  return withSlash.slice(0, MAX_PAGE_HINT_LENGTH);
}
