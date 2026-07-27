import net from "node:net";
import type { Pool } from "pg";
import { getStorage, MEDIA_BUCKET, extForContentType } from "./storage.js";
import { MEDIA_PROCESS_UPLOAD } from "../jobs/index.js";

/**
 * Server-side ingest for the AI agent: fetch an image URL and land it in the
 * standard media pipeline (asset row → GCS original → variants job) — the
 * same shape the browser signed-URL flow produces (src/server/routes/media.ts
 * :106-123), so hydration Just Works.
 *
 * Download happens BEFORE the insert so a failed fetch leaves no orphan row.
 *
 * Important 4 (SSRF guard): `input.url` is operator/AI-supplied (the agent
 * can pass ANY url to `import_image`, not just one it got back from
 * `search_stock_images`) and this function fetches it server-side — without
 * a guard, an instruction like "import the image at
 * https://metadata.google.internal/..." would have the server itself make a
 * request to internal/cloud-metadata infrastructure and hand the response
 * back as a "downloaded image". `assertSafeImageUrl` below is checked before
 * any network call. It lives here (not in tools/assets.ts) so every caller
 * of `ingestImageFromUrl` is safe-by-default, not just the one agent tool.
 */

/** Strips a bracketed IPv6 literal's `[` / `]` (URL#hostname keeps them). */
function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "");
}

function isDisallowedIpv4(h: string): boolean {
  const [a, b] = h.split(".").map(Number);
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata IP)
  if (a === 0) return true; // "this network"
  return false;
}

/**
 * Round 2 fix (Important 3b): an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`,
 * or the hex-group form `::ffff:XXXX:XXXX` — Node's URL parser normalizes
 * `new URL("https://[::ffff:127.0.0.1]/").hostname` to
 * `"[::ffff:7f00:1]"`, the hex form, so BOTH shapes need handling) is just
 * an IPv4 address wearing a v6 costume — without unwrapping it first, e.g.
 * `https://[::ffff:169.254.169.254]/` sails past the v6 branch's checks
 * (none of which know about v4 ranges) even though it resolves to the exact
 * same cloud-metadata address `169.254.169.254` would.
 */
function ipv4MappedToDotted(h: string): string | null {
  const dotted = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (dotted) return dotted[1];
  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function isDisallowedIngestHost(hostname: string): boolean {
  const h = stripBrackets(hostname).toLowerCase();

  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local")) return true;
  if (h.endsWith(".internal")) return true; // e.g. metadata.google.internal

  const ipVersion = net.isIP(h);
  if (ipVersion === 4) {
    return isDisallowedIpv4(h);
  }
  if (ipVersion === 6) {
    if (h === "::1") return true; // loopback
    if (h === "::") return true; // unspecified address
    if (h.startsWith("fe80:")) return true; // link-local
    if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique local (fc00::/7)

    const mapped = ipv4MappedToDotted(h);
    if (mapped) return isDisallowedIpv4(mapped);

    return false;
  }
  // Not a literal IP at all — an ordinary DNS hostname, allowed.
  return false;
}

/** Throws if `rawUrl` isn't a safe target for a server-side image fetch. */
export function assertSafeImageUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("invalid image url");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("image url must use https");
  }
  if (isDisallowedIngestHost(parsed.hostname)) {
    throw new Error("image url host is not allowed");
  }
}

export type IngestDeps = {
  fetchFn?: typeof fetch;
  storage?: ReturnType<typeof getStorage>;
  enqueue?: (jobName: string, data: unknown) => Promise<string | null>;
};

export async function ingestImageFromUrl(
  pool: Pool,
  input: { siteId: string; url: string; alt: string; contentType?: string },
  deps: IngestDeps = {},
): Promise<{ asset_id: string; gcs_key: string }> {
  assertSafeImageUrl(input.url);

  const fetchFn = deps.fetchFn ?? fetch;
  // Round 2 fix (Important 3a): `assertSafeImageUrl` above only validates
  // the URL the caller supplied — a plain `fetch` follows redirects
  // automatically, so a URL that passes the guard (a normal public https
  // host) could still 30x the request somewhere internal (e.g. its own
  // `169.254.169.254`) and this function would happily hand back THAT
  // response as the "downloaded image", with no further guard in the way.
  // `redirect: "manual"` stops fetch from following it; any 3xx then comes
  // back as an ordinary (non-ok) response we reject explicitly below,
  // rather than silently chasing it.
  const res = await fetchFn(input.url, { redirect: "manual" });
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`image download failed: redirect not allowed for ${input.url}`);
  }
  if (!res.ok) {
    throw new Error(`image download failed: ${res.status} for ${input.url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType =
    input.contentType ?? res.headers?.get?.("content-type") ?? "application/octet-stream";
  const ext = extForContentType(contentType);
  if (!ext) {
    throw new Error(`unsupported image content-type: ${contentType}`);
  }

  // Mirrors the media.ts route insert (site_id, gcs_key placeholder,
  // content_type, alt, focal_point) — alt is NOT NULL in the schema, and
  // focal_point is nullable jsonb (the agent never picks one).
  const ins = await pool.query<{ id: string }>(
    `INSERT INTO media_assets (site_id, gcs_key, content_type, alt, focal_point)
     VALUES ($1, 'pending', $2, $3, NULL)
     RETURNING id`,
    [input.siteId, contentType, input.alt],
  );
  const assetId = ins.rows[0].id;
  const gcsKey = `originals/${input.siteId}/${assetId}.${ext}`;

  // Replace the placeholder gcs_key now that we know the asset id (same
  // two-step pattern as the route: insert, then fill in the id-derived key).
  await pool.query(`UPDATE media_assets SET gcs_key = $1 WHERE id = $2`, [gcsKey, assetId]);

  const storage = deps.storage ?? getStorage();
  await storage
    .bucket(MEDIA_BUCKET)
    .file(gcsKey)
    .save(buf, {
      metadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
      resumable: false,
    });

  const enqueue =
    deps.enqueue ??
    (async (name: string, data: unknown) => {
      // Lazy import + try/catch: getBoss() throws when bootJobs hasn't run
      // (tests, JOBS_ENABLED=false) — mirror routes/media.ts + create-site.ts.
      try {
        const { getBoss } = await import("../jobs/index.js");
        return await getBoss().send(name, data as Record<string, unknown>);
      } catch {
        return null;
      }
    });
  await enqueue(MEDIA_PROCESS_UPLOAD, { asset_id: assetId });

  return { asset_id: assetId, gcs_key: gcsKey };
}
