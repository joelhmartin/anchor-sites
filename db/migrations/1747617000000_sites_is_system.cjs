/* eslint-disable camelcase */

// D502 (W2-TERM, 2026-07-30 product-audit remediation) — stop overloading
// `sites.status = 'archived'` as a TYPE marker.
//
// The reserved system site that owns template-gallery cover images
// (src/server/templates/system-site.ts) was created with `status='archived'`
// for two unrelated reasons: (a) resolveSite gates on status='active', so an
// archived row is never publicly served, and (b) it needed to be hidden from
// the operator's site list — done with a slug-string exclusion hack in
// admin-sites.ts's GET /api/sites query.
//
// That squats on 'archived', which W2-TERM now needs as a REAL, operator-
// reachable lifecycle state for user sites (D500 site archive). Once an
// operator can archive their own site, "archived" must mean "the operator
// retired this site", not "this is the internal covers bucket". `is_system`
// makes the type distinction explicit and independent of lifecycle status:
// the covers site is `is_system = true` (whatever its status), user sites are
// `is_system = false`, and the admin list filters on `is_system` instead of a
// magic slug string.

exports.up = (pgm) => {
  pgm.addColumns("sites", {
    is_system: { type: "boolean", notNull: true, default: false },
  });
  // Backfill: the one existing system row (created by ensureSystemTemplatesSite
  // on a prior boot/seed) becomes is_system=true. Idempotent — a fresh DB has
  // no such row yet and system-site.ts sets the flag on first insert.
  pgm.sql(`UPDATE sites SET is_system = true WHERE slug = '__system-templates'`);
};

exports.down = (pgm) => {
  pgm.dropColumns("sites", ["is_system"]);
};
