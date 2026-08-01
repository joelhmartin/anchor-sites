/**
 * Shared date/time formatting for the admin surfaces.
 *
 * D433 — several list tables (Pages, Blog) rendered their "Updated" column with
 * `toLocaleDateString()`, which collapses today's 9am and 5pm edits into the
 * same string, so an operator who just saved can't tell their change landed.
 * `formatDateTime` keeps the date AND the time so same-day edits stay
 * distinguishable, matching EventsTab's existing `toLocaleString()` usage.
 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
