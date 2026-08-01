import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Storage } from "@google-cloud/storage";
import { setupAgentDb } from "../../../tests/helpers/agent-db.js";
import { MEDIA_PROCESS_UPLOAD } from "../jobs/index.js";
import { ingestImageFromUrl } from "./ingest.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();

const PNG_BUF = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function fakeFetch(status: number, contentType: string, body: Buffer) {
  return async (_url: string | URL | Request) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    }) as unknown as Response;
}

function fakeStorage() {
  const calls: Array<{ key: string; opts: unknown }> = [];
  const storage = {
    bucket: () => ({
      file: (key: string) => ({
        save: async (_buf: Buffer, opts: unknown) => {
          calls.push({ key, opts });
        },
      }),
    }),
  } as unknown as Storage;
  return { calls, storage };
}

d("ingestImageFromUrl", () => {
  let siteId: string;

  beforeAll(async () => {
    await db.runMigrations();
    siteId = (await db.seedSite("agent-ingest-a")).id;
  });
  afterAll(() => db.teardown());

  it("downloads, inserts the media_assets row, saves to GCS, and enqueues variant processing", async () => {
    const { storage, calls } = fakeStorage();
    const enqueued: Array<{ name: string; data: unknown }> = [];

    const result = await ingestImageFromUrl(
      db.getPool(),
      { siteId, url: "https://example.invalid/photo.png", alt: "a photo" },
      {
        fetchFn: fakeFetch(200, "image/png", PNG_BUF),
        storage,
        enqueue: async (name, data) => {
          enqueued.push({ name, data });
          return "job-1";
        },
      },
    );

    expect(result.asset_id).toBeTruthy();
    expect(result.gcs_key).toBe(`originals/${siteId}/${result.asset_id}.png`);

    const row = await db.getPool().query(
      `SELECT site_id, alt, content_type, gcs_key, variants_status FROM media_assets WHERE id = $1`,
      [result.asset_id],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0]).toMatchObject({
      site_id: siteId,
      alt: "a photo",
      content_type: "image/png",
      gcs_key: `originals/${siteId}/${result.asset_id}.png`,
      variants_status: "pending",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe(`originals/${siteId}/${result.asset_id}.png`);
    expect(calls[0].opts).toMatchObject({
      metadata: { contentType: "image/png" },
      resumable: false,
    });

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].name).toBe(MEDIA_PROCESS_UPLOAD);
    expect(enqueued[0].data).toEqual({ asset_id: result.asset_id });
  });

  it("rejects on non-OK download and leaves no media_assets row", async () => {
    const { storage } = fakeStorage();
    const before = await db.getPool().query(`SELECT count(*)::int AS n FROM media_assets`);

    await expect(
      ingestImageFromUrl(
        db.getPool(),
        { siteId, url: "https://example.invalid/missing.png", alt: "x" },
        { fetchFn: fakeFetch(404, "image/png", PNG_BUF), storage, enqueue: async () => null },
      ),
    ).rejects.toThrow(/download failed.*404/i);

    const after = await db.getPool().query(`SELECT count(*)::int AS n FROM media_assets`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("rejects unsupported content-type with a clear message", async () => {
    const { storage } = fakeStorage();
    await expect(
      ingestImageFromUrl(
        db.getPool(),
        { siteId, url: "https://example.invalid/page.html", alt: "x" },
        { fetchFn: fakeFetch(200, "text/html", Buffer.from("<html>")), storage, enqueue: async () => null },
      ),
    ).rejects.toThrow(/unsupported.*content-type/i);
  });
});

// Important 4 (SSRF guard): `import_image` fetches an operator/AI-supplied
// URL server-side — these prove the guard blocks the classic SSRF targets
// BEFORE any network call happens (the fetch spy asserts that), while a
// normal https host still goes through untouched.
d("ingestImageFromUrl SSRF guard (Important 4)", () => {
  let siteId: string;

  beforeAll(async () => {
    await db.runMigrations();
    siteId = (await db.seedSite("agent-ingest-ssrf")).id;
  });
  afterAll(() => db.teardown());

  it("rejects a plain http:// url", async () => {
    const { storage } = fakeStorage();
    const fetchSpy = vi.fn(fakeFetch(200, "image/png", PNG_BUF));
    await expect(
      ingestImageFromUrl(
        db.getPool(),
        { siteId, url: "http://example.com/photo.png", alt: "x" },
        { fetchFn: fetchSpy, storage, enqueue: async () => null },
      ),
    ).rejects.toThrow(/https/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an RFC-1918 private IP literal", async () => {
    const { storage } = fakeStorage();
    const fetchSpy = vi.fn(fakeFetch(200, "image/png", PNG_BUF));
    await expect(
      ingestImageFromUrl(
        db.getPool(),
        { siteId, url: "https://10.0.0.5/x.png", alt: "x" },
        { fetchFn: fetchSpy, storage, enqueue: async () => null },
      ),
    ).rejects.toThrow(/not allowed/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a link-local IP literal (covers the GCP metadata address)", async () => {
    const { storage } = fakeStorage();
    const fetchSpy = vi.fn(fakeFetch(200, "image/png", PNG_BUF));
    await expect(
      ingestImageFromUrl(
        db.getPool(),
        { siteId, url: "https://169.254.169.254/computeMetadata/v1/", alt: "x" },
        { fetchFn: fetchSpy, storage, enqueue: async () => null },
      ),
    ).rejects.toThrow(/not allowed/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects the GCP metadata hostname", async () => {
    const { storage } = fakeStorage();
    const fetchSpy = vi.fn(fakeFetch(200, "image/png", PNG_BUF));
    await expect(
      ingestImageFromUrl(
        db.getPool(),
        { siteId, url: "https://metadata.google.internal/computeMetadata/v1/", alt: "x" },
        { fetchFn: fetchSpy, storage, enqueue: async () => null },
      ),
    ).rejects.toThrow(/not allowed/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects localhost", async () => {
    const { storage } = fakeStorage();
    const fetchSpy = vi.fn(fakeFetch(200, "image/png", PNG_BUF));
    await expect(
      ingestImageFromUrl(
        db.getPool(),
        { siteId, url: "https://localhost/x.png", alt: "x" },
        { fetchFn: fetchSpy, storage, enqueue: async () => null },
      ),
    ).rejects.toThrow(/not allowed/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows a normal https host through to the fetch", async () => {
    const { storage, calls } = fakeStorage();
    const result = await ingestImageFromUrl(
      db.getPool(),
      { siteId, url: "https://images.example.com/photo.png", alt: "a photo" },
      { fetchFn: fakeFetch(200, "image/png", PNG_BUF), storage, enqueue: async () => "job-1" },
    );
    expect(result.asset_id).toBeTruthy();
    expect(calls).toHaveLength(1);
  });

  // Round 2 (Important 3b): IPv4-mapped IPv6 literals are the SAME address
  // as their IPv4 form — Node's URL parser normalizes the bracketed literal
  // to the hex-group shape (`new URL("https://[::ffff:127.0.0.1]/").hostname`
  // is `"[::ffff:7f00:1]"`, not the dotted form), so these prove the guard
  // unwraps that hex form back to IPv4 before applying the range checks.
  it("rejects an IPv4-mapped IPv6 loopback literal", async () => {
    const { storage } = fakeStorage();
    const fetchSpy = vi.fn(fakeFetch(200, "image/png", PNG_BUF));
    await expect(
      ingestImageFromUrl(
        db.getPool(),
        { siteId, url: "https://[::ffff:127.0.0.1]/x.png", alt: "x" },
        { fetchFn: fetchSpy, storage, enqueue: async () => null },
      ),
    ).rejects.toThrow(/not allowed/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an IPv4-mapped IPv6 form of the GCP metadata address", async () => {
    const { storage } = fakeStorage();
    const fetchSpy = vi.fn(fakeFetch(200, "image/png", PNG_BUF));
    await expect(
      ingestImageFromUrl(
        db.getPool(),
        { siteId, url: "https://[::ffff:169.254.169.254]/computeMetadata/v1/", alt: "x" },
        { fetchFn: fetchSpy, storage, enqueue: async () => null },
      ),
    ).rejects.toThrow(/not allowed/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Bot-review fix wave, item 11 (CodeRabbit — more SSRF encodings): the
  // IPv4-compatible (no `ffff`) and NAT64 v6 forms are also just an IPv4
  // address in disguise — Node's URL parser normalizes both to a bare
  // hex-group tail (see ingest.ts's `ipv4EmbeddedToDotted` comment).
  it("rejects the IPv4-compatible IPv6 form of the GCP metadata address ([::169.254.169.254])", async () => {
    const { storage } = fakeStorage();
    const fetchSpy = vi.fn(fakeFetch(200, "image/png", PNG_BUF));
    await expect(
      ingestImageFromUrl(
        db.getPool(),
        { siteId, url: "https://[::169.254.169.254]/x.png", alt: "x" },
        { fetchFn: fetchSpy, storage, enqueue: async () => null },
      ),
    ).rejects.toThrow(/not allowed/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects the NAT64 form of the GCP metadata address ([64:ff9b::169.254.169.254])", async () => {
    const { storage } = fakeStorage();
    const fetchSpy = vi.fn(fakeFetch(200, "image/png", PNG_BUF));
    await expect(
      ingestImageFromUrl(
        db.getPool(),
        { siteId, url: "https://[64:ff9b::169.254.169.254]/x.png", alt: "x" },
        { fetchFn: fetchSpy, storage, enqueue: async () => null },
      ),
    ).rejects.toThrow(/not allowed/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects CGNAT space (100.64.0.0/10)", async () => {
    const { storage } = fakeStorage();
    const fetchSpy = vi.fn(fakeFetch(200, "image/png", PNG_BUF));
    await expect(
      ingestImageFromUrl(
        db.getPool(),
        { siteId, url: "https://100.64.0.1/x.png", alt: "x" },
        { fetchFn: fetchSpy, storage, enqueue: async () => null },
      ),
    ).rejects.toThrow(/not allowed/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects the IPv6 unspecified address ::", async () => {
    const { storage } = fakeStorage();
    const fetchSpy = vi.fn(fakeFetch(200, "image/png", PNG_BUF));
    await expect(
      ingestImageFromUrl(
        db.getPool(),
        { siteId, url: "https://[::]/x.png", alt: "x" },
        { fetchFn: fetchSpy, storage, enqueue: async () => null },
      ),
    ).rejects.toThrow(/not allowed/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Round 2 (Important 3a): even a URL that passes every host check can
  // still 30x to an internal target once fetched — `redirect: "manual"`
  // must stop that instead of silently following it.
  it("rejects a redirect response instead of following it", async () => {
    const { storage } = fakeStorage();
    const redirectFetch = vi.fn(async () =>
      ({
        ok: false,
        status: 302,
        headers: new Headers({ location: "https://169.254.169.254/computeMetadata/v1/" }),
        arrayBuffer: async () => new ArrayBuffer(0),
      }) as unknown as Response,
    );
    await expect(
      ingestImageFromUrl(
        db.getPool(),
        { siteId, url: "https://images.example.com/redirects-somewhere", alt: "x" },
        { fetchFn: redirectFetch, storage, enqueue: async () => null },
      ),
    ).rejects.toThrow(/redirect not allowed/i);
    expect(redirectFetch).toHaveBeenCalledWith(
      "https://images.example.com/redirects-somewhere",
      expect.objectContaining({ redirect: "manual" }),
    );
  });
});

// Bot-review fix wave, item 3 (Codex P1 + CodeRabbit): an unbounded download
// of an operator/AI-supplied URL could hang forever or exhaust memory —
// these prove the 20MB cap (both the Content-Length fast-path and the
// streamed running-total path) and the 30s timeout signal.
d("ingestImageFromUrl bounded download (item 3)", () => {
  let siteId: string;

  beforeAll(async () => {
    await db.runMigrations();
    siteId = (await db.seedSite("agent-ingest-bounded")).id;
  });
  afterAll(() => db.teardown());

  it("rejects up front via Content-Length, without reading the body", async () => {
    const { storage } = fakeStorage();
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === "content-length" ? "31457280" : null) }, // 30MB
      arrayBuffer,
    }) as unknown as Response);

    await expect(
      ingestImageFromUrl(
        db.getPool(),
        { siteId, url: "https://images.example.com/huge.png", alt: "x" },
        { fetchFn: fetchSpy, storage, enqueue: async () => null },
      ),
    ).rejects.toThrow(/exceeds.*size limit/i);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("aborts a streamed download once the running total exceeds the cap, even with no Content-Length", async () => {
    const { storage } = fakeStorage();
    // Three ~8MB chunks (24MB total) — crosses the 20MB cap on the 3rd read
    // without ever declaring Content-Length (simulates a chunked response).
    const chunk = new Uint8Array(8 * 1024 * 1024);
    let reads = 0;
    const cancel = vi.fn(async () => undefined);
    const reader = {
      read: async () => {
        reads += 1;
        if (reads > 3) return { done: true, value: undefined };
        return { done: false, value: chunk };
      },
      cancel,
    };
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: { getReader: () => reader },
      arrayBuffer: async () => {
        throw new Error("should stream, not buffer whole-body");
      },
    }) as unknown as Response);

    await expect(
      ingestImageFromUrl(
        db.getPool(),
        { siteId, url: "https://images.example.com/chunked.png", alt: "x" },
        { fetchFn: fetchSpy, storage, enqueue: async () => null },
      ),
    ).rejects.toThrow(/exceeds.*size limit/i);
    expect(cancel).toHaveBeenCalled();
  });

  it("passes a 30s AbortSignal.timeout to the fetch call", async () => {
    const { storage } = fakeStorage();
    const fetchSpy = vi.fn(fakeFetch(200, "image/png", PNG_BUF));
    // URL unique to this test — a repeat of photo.png (imported above) would
    // dedupe (D1117) and never reach the fetch this test inspects.
    await ingestImageFromUrl(
      db.getPool(),
      { siteId, url: "https://images.example.com/photo-signal.png", alt: "x" },
      { fetchFn: fetchSpy, storage, enqueue: async () => "job-1" },
    );
    const call = fetchSpy.mock.calls[0] as unknown as [string, { signal?: AbortSignal }];
    expect(call[1].signal).toBeInstanceOf(AbortSignal);
  });

  it("still accepts a normal small download under the cap", async () => {
    const { storage, calls } = fakeStorage();
    const result = await ingestImageFromUrl(
      db.getPool(),
      { siteId, url: "https://images.example.com/small.png", alt: "a small photo" },
      { fetchFn: fakeFetch(200, "image/png", PNG_BUF), storage, enqueue: async () => "job-1" },
    );
    expect(result.asset_id).toBeTruthy();
    expect(calls).toHaveLength(1);
  });

  // ── W1.5 / D1117: provenance + dedupe ──

  it("D1117: persists the source URL and photographer credit on the asset row", async () => {
    const { storage } = fakeStorage();
    const url = `https://images.example.com/provenance-${Date.now()}.png`;
    const result = await ingestImageFromUrl(
      db.getPool(),
      { siteId, url, alt: "a credited photo", credit: "Jane Photographer" },
      { fetchFn: fakeFetch(200, "image/png", PNG_BUF), storage, enqueue: async () => "job-1" },
    );

    const row = await db.getPool().query(
      `SELECT source_url, credit FROM media_assets WHERE id = $1`,
      [result.asset_id],
    );
    expect(row.rows[0]).toEqual({ source_url: url, credit: "Jane Photographer" });
    expect(result.deduped).toBeUndefined();
  });

  it("D1117: re-importing the same URL for the same site returns the existing asset — no download, no duplicate row", async () => {
    const { storage, calls } = fakeStorage();
    const url = `https://images.example.com/dedupe-${Date.now()}.png`;
    const first = await ingestImageFromUrl(
      db.getPool(),
      { siteId, url, alt: "first import" },
      { fetchFn: fakeFetch(200, "image/png", PNG_BUF), storage, enqueue: async () => "job-1" },
    );

    const fetchSpy = vi.fn(fakeFetch(200, "image/png", PNG_BUF));
    const second = await ingestImageFromUrl(
      db.getPool(),
      { siteId, url, alt: "second import attempt" },
      { fetchFn: fetchSpy, storage, enqueue: async () => "job-1" },
    );

    expect(second).toEqual({ asset_id: first.asset_id, gcs_key: first.gcs_key, deduped: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1); // only the first import touched storage

    const rows = await db.getPool().query(
      `SELECT COUNT(*)::int AS n FROM media_assets WHERE site_id = $1 AND source_url = $2`,
      [siteId, url],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it("D1117: the dedupe is site-scoped — another site importing the same URL gets its own asset", async () => {
    const { storage } = fakeStorage();
    const otherSite = await db.seedSite(`agent-ingest-other-${Date.now()}`);
    const url = `https://images.example.com/cross-site-${Date.now()}.png`;

    const first = await ingestImageFromUrl(
      db.getPool(),
      { siteId, url, alt: "site A copy" },
      { fetchFn: fakeFetch(200, "image/png", PNG_BUF), storage, enqueue: async () => "job-1" },
    );
    const second = await ingestImageFromUrl(
      db.getPool(),
      { siteId: otherSite.id, url, alt: "site B copy" },
      { fetchFn: fakeFetch(200, "image/png", PNG_BUF), storage, enqueue: async () => "job-1" },
    );

    expect(second.deduped).toBeUndefined();
    expect(second.asset_id).not.toBe(first.asset_id);
  });

  it("D1117: an archived asset does not satisfy the dedupe — the re-import creates a fresh row", async () => {
    const { storage } = fakeStorage();
    const url = `https://images.example.com/archived-${Date.now()}.png`;
    const first = await ingestImageFromUrl(
      db.getPool(),
      { siteId, url, alt: "soon archived" },
      { fetchFn: fakeFetch(200, "image/png", PNG_BUF), storage, enqueue: async () => "job-1" },
    );
    await db.getPool().query(
      `UPDATE media_assets SET archived_at = now() WHERE id = $1`,
      [first.asset_id],
    );

    const second = await ingestImageFromUrl(
      db.getPool(),
      { siteId, url, alt: "fresh import" },
      { fetchFn: fakeFetch(200, "image/png", PNG_BUF), storage, enqueue: async () => "job-1" },
    );
    expect(second.deduped).toBeUndefined();
    expect(second.asset_id).not.toBe(first.asset_id);
  });

  it("D1015: a failed storage.save marks the row 'failed', not stuck 'pending'", async () => {
    const url = `https://images.example.com/save-fail-${Date.now()}.png`;
    const storage = {
      bucket: () => ({
        file: () => ({
          save: async () => {
            throw new Error("GCS 503 backend error");
          },
        }),
      }),
    } as unknown as Storage;

    await expect(
      ingestImageFromUrl(
        db.getPool(),
        { siteId, url, alt: "will fail to save" },
        { fetchFn: fakeFetch(200, "image/png", PNG_BUF), storage, enqueue: async () => "job-1" },
      ),
    ).rejects.toThrow(/GCS 503/);

    const row = await db.getPool().query<{ variants_status: string; last_error: string | null }>(
      `SELECT variants_status, last_error FROM media_assets WHERE site_id = $1 AND source_url = $2`,
      [siteId, url],
    );
    expect(row.rows[0].variants_status).toBe("failed");
    expect(row.rows[0].last_error).toMatch(/GCS 503/);
  });
});
