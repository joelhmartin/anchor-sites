import type { Pool } from "pg";

/**
 * Reserved system site that owns template gallery cover images (Task C4,
 * fix round 1). Templates aren't real sites and have no natural `site_id`
 * to hang a `media_assets` row off of (that table's `site_id` is `NOT NULL
 * REFERENCES sites`) — this row exists purely so cover ingestion can go
 * through the normal media pipeline instead of a bespoke one.
 *
 * D502 (W2-TERM): this row is flagged `is_system = true`. Historically it
 * relied on `status = 'archived'` for two things — never being served
 * (`resolveSite` gates on `status = 'active'`) and being hidden from the
 * operator site list (a magic-slug exclusion in admin-sites.ts). W2-TERM now
 * needs 'archived' as a real, operator-reachable lifecycle for USER sites
 * (D500), so the type marker moves to `is_system`:
 *   - `src/middleware/resolveSite.ts` still gates on `status = 'active'`, so
 *     this row (created 'archived') stays unroutable regardless — good, but
 *     that's now incidental, not the mechanism.
 *   - `src/server/routes/admin-sites.ts`'s `GET /api/sites` filters
 *     `WHERE NOT is_system`, so this row is excluded structurally — a real
 *     archived USER site (also `status='archived'`) is NOT excluded and
 *     shows up badged "archived" as it should.
 *
 * Gets no `site_domains` rows — it's never meant to serve anything.
 */
export const SYSTEM_TEMPLATES_SITE_SLUG = "__system-templates";

const SYSTEM_TEMPLATES_SITE_DISPLAY_NAME = "System — Template Covers";

/**
 * Idempotent find-or-create: returns the system site's id, creating it (as
 * `archived`, `is_system = true`, no domains) on first call. Safe to call from
 * a seed script or a test; a second call is a plain SELECT. D502: the
 * `is_system` flag (not the status) is what marks this as the reserved covers
 * site — see the module doc above.
 */
export async function ensureSystemTemplatesSite(pool: Pool): Promise<string> {
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM sites WHERE slug = $1`,
    [SYSTEM_TEMPLATES_SITE_SLUG],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO sites (slug, display_name, status, is_system)
     VALUES ($1, $2, 'archived', true)
     ON CONFLICT (slug) DO UPDATE SET is_system = true
     RETURNING id`,
    [SYSTEM_TEMPLATES_SITE_SLUG, SYSTEM_TEMPLATES_SITE_DISPLAY_NAME],
  );
  return inserted.rows[0].id;
}
