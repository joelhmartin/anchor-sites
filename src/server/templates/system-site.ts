import type { Pool } from "pg";

/**
 * Reserved system site that owns template gallery cover images (Task C4,
 * fix round 1). Templates aren't real sites and have no natural `site_id`
 * to hang a `media_assets` row off of (that table's `site_id` is `NOT NULL
 * REFERENCES sites`) — this row exists purely so cover ingestion can go
 * through the normal media pipeline instead of a bespoke one.
 *
 * Verified against the actual routing/list code (not assumed) before
 * picking `status = 'archived'`:
 *   - `src/middleware/resolveSite.ts` requires `s.status = 'active'` for
 *     BOTH the domain lookup and the `<slug>.<base>` subdomain lookup — an
 *     `archived` site is unroutable, i.e. never publicly servable. Good.
 *   - `src/server/routes/admin-sites.ts`'s `GET /api/sites` (backing
 *     `SitesListPage`) has NO status filter — it lists every row in
 *     `sites` regardless of status, so `archived` alone does NOT hide this
 *     row from the operator's site list (it would show up badged
 *     "archived"). That route's query below was given an explicit slug
 *     exclusion for this one reserved site so the design's "hidden from
 *     the operator's site list" goal is actually met, rather than resting
 *     on an assumption that turned out false on inspection.
 *
 * Gets no `site_domains` rows — it's never meant to serve anything.
 */
export const SYSTEM_TEMPLATES_SITE_SLUG = "__system-templates";

const SYSTEM_TEMPLATES_SITE_DISPLAY_NAME = "System — Template Covers";

/**
 * Idempotent find-or-create: returns the system site's id, creating it (as
 * `archived`, no domains) on first call. Safe to call from a seed script or
 * a test; a second call is a plain SELECT.
 */
export async function ensureSystemTemplatesSite(pool: Pool): Promise<string> {
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM sites WHERE slug = $1`,
    [SYSTEM_TEMPLATES_SITE_SLUG],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO sites (slug, display_name, status)
     VALUES ($1, $2, 'archived')
     ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
     RETURNING id`,
    [SYSTEM_TEMPLATES_SITE_SLUG, SYSTEM_TEMPLATES_SITE_DISPLAY_NAME],
  );
  return inserted.rows[0].id;
}
