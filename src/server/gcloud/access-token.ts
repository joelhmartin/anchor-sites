import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/**
 * Get a GCP access token in either runtime.
 *
 * - **Cloud Run / GCE / any GCP compute**: reads the runtime SA's token
 *   from the metadata server. Detected by `K_SERVICE` (set by Cloud Run)
 *   or `GCE_METADATA_HOST`. No external binaries required.
 *
 * - **Local dev**: shells out to `gcloud auth print-access-token`. The
 *   operator's `gcloud auth login` session is the source of credentials.
 *   This is the path that "saves API tokens in general" — local dev uses
 *   the operator's own session, not a service account key.
 *
 * Cached in-memory for `CACHE_TTL_MS` minus a safety margin so callers
 * can hit this in tight loops without burning quota.
 */

const METADATA_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

const CACHE_TTL_MS = 50 * 60 * 1000; // GCP tokens live ~1h; refresh slightly early.

type CachedToken = { token: string; expiresAt: number };
let cache: CachedToken | null = null;

export function __clearTokenCacheForTests(): void {
  cache = null;
}

function isOnGcpCompute(): boolean {
  return Boolean(process.env.K_SERVICE || process.env.GCE_METADATA_HOST);
}

async function fromMetadataServer(): Promise<string> {
  const res = await fetch(METADATA_URL, {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!res.ok) {
    throw new Error(`metadata server returned ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("metadata server returned no access_token");
  return data.access_token;
}

async function fromGcloudCli(): Promise<string> {
  try {
    const { stdout } = await execFileP("gcloud", ["auth", "print-access-token"], {
      timeout: 10_000,
    });
    const token = stdout.trim();
    if (!token) throw new Error("gcloud returned an empty token");
    return token;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `failed to fetch local GCP access token via gcloud (run \`gcloud auth login\` if you haven't): ${msg}`,
    );
  }
}

export async function getGcpAccessToken(): Promise<string> {
  if (cache && cache.expiresAt > Date.now()) return cache.token;
  const token = isOnGcpCompute() ? await fromMetadataServer() : await fromGcloudCli();
  cache = { token, expiresAt: Date.now() + CACHE_TTL_MS };
  return token;
}
