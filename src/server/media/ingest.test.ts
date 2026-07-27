import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
