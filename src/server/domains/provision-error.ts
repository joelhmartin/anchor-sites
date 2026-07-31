/**
 * D609 (W2-DOM): when provisioning fails on the KNOWN one-time operator
 * precondition — the Cloud Run runtime service account not yet being a
 * verified owner of the apex domain in Google Search Console (Webmaster
 * Central, see docs/deploy.md §9) — the failure must carry the instruction,
 * not just the word "failed". Cloud Run rejects the domain-mapping create
 * with 403/PermissionDenied ("Caller is not authorized to administer the
 * domain …") until the operator completes that setup, so TODAY this is the
 * common provisioning failure, and a bare error string gives the operator
 * no forward path.
 *
 * `explainProvisionError` appends the fix instruction to any error detail
 * that looks like that precondition. It is applied where the error is
 * CAUGHT (orchestrator + manual provision route) so the annotated detail
 * flows everywhere the error goes: the step result the UI renders, the
 * `last_error` column the row persists, and the job log.
 */

export const SEARCH_CONSOLE_SETTINGS_URL = "https://search.google.com/search-console/settings";

export const WEBMASTER_CENTRAL_INSTRUCTION =
  "This usually means the app's runtime service account is not yet a verified owner " +
  "of the domain in Google Search Console (Webmaster Central). One-time fix: open " +
  `${SEARCH_CONSOLE_SETTINGS_URL} → Users and permissions → add the Cloud Run runtime ` +
  "service account as a verified OWNER of the apex domain, then provision again.";

/** True when an error detail looks like the Search-Console ownership 403. */
export function isSearchConsolePermissionError(detail: string): boolean {
  return (
    /permission\s*denied|not authorized to administer|verified owner|caller is not authorized/i.test(
      detail,
    ) || /\b403\b/.test(detail)
  );
}

/** Annotate a provisioning error detail with the known-precondition fix. */
export function explainProvisionError(detail: string): string {
  if (isSearchConsolePermissionError(detail) && !detail.includes(SEARCH_CONSOLE_SETTINGS_URL)) {
    return `${detail} — ${WEBMASTER_CENTRAL_INSTRUCTION}`;
  }
  return detail;
}
