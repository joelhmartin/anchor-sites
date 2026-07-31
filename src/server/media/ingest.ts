import net from "node:net";
import { randomUUID } from "node:crypto";
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
  // Bot-review fix wave, item 11 (CodeRabbit — SSRF encodings): CGNAT space
  // (RFC 6598) — routed by ISPs/cloud NAT layers, not publicly reachable,
  // and (like the RFC1918 ranges above) not somewhere an image download
  // should ever legitimately need to go.
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (100.64.0.0/10)
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
function hexGroupsToDotted(hi: number, lo: number): string {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function ipv4MappedToDotted(h: string): string | null {
  const dotted = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (dotted) return dotted[1];
  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) return hexGroupsToDotted(parseInt(hex[1], 16), parseInt(hex[2], 16));
  return null;
}

/**
 * Bot-review fix wave, item 11 (CodeRabbit — SSRF encodings). Two more IPv6
 * forms that are really an IPv4 address in disguise, same threat as the
 * `::ffff:` mapped form above:
 *
 *  - IPv4-COMPATIBLE (deprecated RFC 4291, but still parses): `::a.b.c.d`,
 *    which Node's URL parser normalizes to the hex-group shape `::XXXX:YYYY`
 *    (e.g. `new URL("https://[::169.254.169.254]/").hostname` is
 *    `"[::a9fe:a9fe]"`) — no `ffff` group, just the bare address after `::`.
 *  - NAT64 (RFC 6052, `64:ff9b::/96`): `64:ff9b::a.b.c.d`, used by NAT64/
 *    DNS64 gateways to embed an IPv4 destination in a v6 address — same
 *    normalized hex-group tail.
 *
 * Both unwrap to the plain IPv4 address for the same `isDisallowedIpv4`
 * range check the mapped form uses.
 */
function ipv4EmbeddedToDotted(h: string): string | null {
  const compatible = h.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (compatible) return hexGroupsToDotted(parseInt(compatible[1], 16), parseInt(compatible[2], 16));
  const nat64 = h.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (nat64) return hexGroupsToDotted(parseInt(nat64[1], 16), parseInt(nat64[2], 16));
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

    const embedded = ipv4EmbeddedToDotted(h);
    if (embedded) return isDisallowedIpv4(embedded);

    return false;
  }
  // Not a literal IP at all — an ordinary DNS hostname, allowed.
  return false;
}

// Bot-review fix wave, item 3 (Codex P1 + CodeRabbit — bounded download):
// an unbounded `res.arrayBuffer()` on an operator/AI-supplied URL lets a
// malicious or misconfigured host hang the request indefinitely, or hand
// back a response large enough to exhaust memory. `MAX_DOWNLOAD_BYTES` caps
// the actual body size (checked against `Content-Length` up front when the
// server sends one, AND against a running total while streaming — a host
// can lie about or omit `Content-Length` for a chunked response);
// `DOWNLOAD_TIMEOUT_MS` bounds the whole fetch (connect + body drain) via
// the signal passed to `fetch` — Node 22's fetch/undici ties body-stream
// reads to the same AbortSignal, so a slow/stalled download aborts too, not
// just a slow initial response.
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024; // 20MB
const DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * Reads `res`'s body into a Buffer, enforcing `MAX_DOWNLOAD_BYTES` against a
 * running total as chunks arrive (so an unbounded/chunked response is caught
 * without ever buffering past the limit). Falls back to a single
 * `res.arrayBuffer()` call (still limit-checked, just after the fact) when
 * `res.body` isn't a stream — real `fetch` always provides one, but this
 * keeps the function usable with simpler test doubles that only implement
 * `arrayBuffer()`.
 */
async function readBodyWithLimit(res: Response): Promise<Buffer> {
  const body = (res as { body?: ReadableStream<Uint8Array> | null }).body;
  if (!body || typeof body.getReader !== "function") {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(`image download failed: exceeds ${MAX_DOWNLOAD_BYTES}-byte size limit`);
    }
    return buf;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_DOWNLOAD_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`image download failed: exceeds ${MAX_DOWNLOAD_BYTES}-byte size limit`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
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
  input: { siteId: string; url: string; alt: string; contentType?: string; credit?: string },
  deps: IngestDeps = {},
): Promise<{ asset_id: string; gcs_key: string; deduped?: boolean }> {
  assertSafeImageUrl(input.url);

  // W1.5 / D1117 — dedupe by (site_id, source_url) BEFORE any network work:
  // a resumed/re-run build asking for the same Pixabay hit gets the
  // already-imported asset back instead of a duplicate download + row +
  // GCS object + variants job. Archived assets don't count (an operator who
  // archived the image shouldn't have it silently resurrected by id — a
  // fresh import row is the honest behavior there).
  const existing = await pool.query<{ id: string; gcs_key: string }>(
    `SELECT id, gcs_key FROM media_assets
      WHERE site_id = $1 AND source_url = $2 AND archived_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [input.siteId, input.url],
  );
  if ((existing.rowCount ?? 0) > 0) {
    return { asset_id: existing.rows[0].id, gcs_key: existing.rows[0].gcs_key, deduped: true };
  }

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
  const res = await fetchFn(input.url, {
    redirect: "manual",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`image download failed: redirect not allowed for ${input.url}`);
  }
  if (!res.ok) {
    throw new Error(`image download failed: ${res.status} for ${input.url}`);
  }
  const contentLengthHeader = res.headers?.get?.("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(
        `image download failed: content-length ${contentLength} exceeds ${MAX_DOWNLOAD_BYTES}-byte size limit`,
      );
    }
  }
  const buf = await readBodyWithLimit(res);
  const contentType =
    input.contentType ?? res.headers?.get?.("content-type") ?? "application/octet-stream";
  const ext = extForContentType(contentType);
  if (!ext) {
    throw new Error(`unsupported image content-type: ${contentType}`);
  }

  // Mirrors the media.ts route insert — alt is NOT NULL in the schema, and
  // focal_point is nullable jsonb (the agent never picks one). D1117 adds
  // source_url + credit so attribution/provenance survive the import and
  // the dedupe lookup above has something to match on.
  //
  // D509 (W2-CONC): ONE INSERT with an app-side uuid and the id-derived
  // gcs_key, same as the route — the old INSERT-'pending'-then-UPDATE pair
  // collided on the UNIQUE gcs_key under concurrency and could strand a
  // 'pending'-keyed row that blocked every later upload platform-wide.
  const assetId = randomUUID();
  const gcsKey = `originals/${input.siteId}/${assetId}.${ext}`;
  await pool.query(
    `INSERT INTO media_assets (id, site_id, gcs_key, content_type, alt, focal_point, source_url, credit)
     VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)`,
    [assetId, input.siteId, gcsKey, contentType, input.alt, input.url, input.credit ?? null],
  );

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
