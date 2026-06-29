/**
 * P11-T11.6 (D-053) — Mode-switch for the CRM client.
 *
 * Resolution order (same pattern as send.ts, client.ts, resolve.ts, studio-auth.ts):
 *   1. CRM_DISABLED=true → NullCrmClient (silent no-op; prod installs without CRM)
 *   2. CRM_BASE_URL + CRM_API_KEY present → HttpCrmClient (real calls)
 *   3. Else (missing creds, non-prod) → StubCrmClient (log-only, returns empty data)
 */
import { HttpCrmClient, NullCrmClient, StubCrmClient, type CrmClient } from "./client.js";

export type CrmEnv = {
  CRM_DISABLED?: string;
  CRM_BASE_URL?: string;
  CRM_API_KEY?: string;
  NODE_ENV?: string;
};

export function resolveCrmClient(
  env: CrmEnv = process.env,
  fetchFn?: typeof globalThis.fetch,
): CrmClient {
  if (env.CRM_DISABLED === "true") {
    return new NullCrmClient();
  }
  if (env.CRM_BASE_URL && env.CRM_API_KEY) {
    return new HttpCrmClient({
      baseUrl: env.CRM_BASE_URL,
      apiKey: env.CRM_API_KEY,
      fetch: fetchFn,
    });
  }
  return new StubCrmClient();
}
