import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { setupAgentDb } from "../helpers/agent-db.js";
import { adminPagesRouter } from "../../src/server/routes/admin-pages.js";
import { mediaRouter } from "../../src/server/routes/media.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const ADMIN_TOKEN = "test-admin-token-inline-e2e";
const auth = (r: request.Test) => r.set("X-Admin-Token", ADMIN_TOKEN);

/**
 * Inline Editing Task 12 — end-to-end gate.
 *
 * Exercises the whole inline-editing server surface built across Tasks 1-11
 * in one flow, against a real DB: edit-mode preview markers/bootData/CSP
 * (T2-T4/T7), the save engine's server-side contract — a plain POST save
 * carrying `source:"inline"` is indistinguishable server-side from the
 * overlay's own debounced save engine (T9), so this simulates it directly —
 * revision-list ordering + a restore round-trip (T9), the stock-image
 * endpoints (T8), and a re-assert that plain (non-edit) preview stays
 * byte-behavior unchanged (T4/T12 guard).
 *
 * Two per-router apps — adminPagesRouter and mediaRouter each mounted at
 * "/api" in their own express() instance — mirrors the idiom in
 * inline-preview.test.ts (Task 4) and media-stock.test.ts (Task 8) rather
 * than one combined app, matching every other route-level integration
 * suite in this repo.
 */
d("inline editing end-to-end gate (Inline Editing Task 12)", () => {
  const db = setupAgentDb();
  let pagesApp: express.Express;
  let mediaApp: express.Express;

  // vi.stubEnv, not a raw `process.env` write — vitest's `unstubEnvs` hygiene
  // then guarantees this resets before the next test anywhere in the suite,
  // regardless of how long this file's own `afterAll` takes (root cause of
  // the cross-file requireAdmin flake — see
  // .superpowers/sdd/2026-07-30-lovable-workspace/test-pollution-debug.md).
  beforeEach(() => {
    vi.stubEnv("ADMIN_API_TOKEN", ADMIN_TOKEN);
  });

  beforeAll(async () => {
    await db.runMigrations();

    const pages = express();
    pages.use(express.json({ limit: "1mb" }));
    pages.use("/api", adminPagesRouter({ pool: db.getPool() }));
    pagesApp = pages;

    const media = express();
    media.use(express.json({ limit: "1mb" }));
    media.use(
      "/api",
      mediaRouter({ pool: db.getPool(), uploadRateLimit: { max: 100, windowMs: 60_000 } }),
    );
    mediaApp = media;
  }, 60_000);

  afterAll(async () => {
    await db.teardown();
  });

  it("edit-mode preview -> inline save + revision round-trip -> stock search/import -> plain preview unchanged", async () => {
    const site = await db.seedSite("inline-e2e");

    // Ready media asset (mirrors page-render.test.ts's "media hydration"
    // fixture — the only existing suite that seeds media_assets with a
    // 'ready' variants row; there's no shared helper for it).
    const variants = [
      { name: "sm", format: "webp", width: 480, height: 270, url: "https://x/sm.webp" },
      { name: "md", format: "webp", width: 768, height: 432, url: "https://x/md.webp" },
      { name: "sm", format: "jpg", width: 480, height: 270, url: "https://x/sm.jpg" },
      { name: "md", format: "jpg", width: 768, height: 432, url: "https://x/md.jpg" },
    ];
    const assetIns = await db.getPool().query<{ id: string }>(
      `INSERT INTO media_assets (site_id, gcs_key, content_type, alt, variants_status, variants, width, height)
       VALUES ($1, $2, 'image/png', 'Fixture image', 'ready', $3::jsonb, 1280, 720) RETURNING id`,
      [site.id, `originals/${site.id}/inline-e2e-fixture.png`, JSON.stringify(variants)],
    );
    const assetId = assetIns.rows[0].id;

    const originalTitle = "Welcome to Acme";
    const blocksV0 = [
      {
        id: "h1",
        type: "hero",
        props: {
          title: originalTitle,
          subtitle: "", // empty — asserts the data-empty marker below
          align: "center",
          cta_href: "https://example.com/contact",
        },
      },
      { id: "r1", type: "rich-text", props: { html: "<p>Body copy</p>" } },
      { id: "img1", type: "image", props: { asset_id: assetId, alt: "Hero image" } },
    ];
    const page = await db.seedPage(site.id, "home", blocksV0);

    // -----------------------------------------------------------------
    // Step 1: GET preview?edit=1&bridge=<token> — markers, bootData,
    // nonce CSP, overlay marker (T2-T4, T7).
    // -----------------------------------------------------------------
    const editRes = await auth(
      request(pagesApp).get(`/api/sites/${site.id}/pages/${page.id}/preview?edit=1&bridge=tok_e2e_gate1`),
    );
    expect(editRes.status).toBe(200);
    expect(editRes.text).toContain("data-block-id");
    expect(editRes.text).toContain('data-field="title"');
    // Empty subtitle renders the placeholder with data-empty (Editable, edit mode).
    expect(editRes.text).toContain('data-field="subtitle" data-empty="true"');
    // Image block always carries its data-field marker; the seeded 'ready'
    // asset hydrates real srcset/img tags (not the missing-asset placeholder).
    expect(editRes.text).toContain('data-field="asset_id"');
    expect(editRes.text).toContain("ac-image");
    expect(editRes.text).toMatch(/srcSet="https:\/\/x\/sm\.webp 480w, https:\/\/x\/md\.webp 768w"/);
    expect(editRes.text).toContain("window.__AC_EDIT_BOOT__");
    expect(editRes.text).toContain('"token":"tok_e2e_gate1"');
    // bootData.fields is schema-derived (T3): rich-text's only editable
    // top-level field is `html` (`max_width` is an enum, excluded).
    expect(editRes.text).toContain('"rich-text":{"html":"text"}');
    // bootData.urls carries the current value of hero's url-classified field.
    expect(editRes.text).toContain('"urls":{"h1":{"cta_href":"https://example.com/contact"}}');
    expect(editRes.text).toContain("__AC_EDIT_OVERLAY__");

    const editCsp = editRes.headers["content-security-policy"];
    expect(editCsp).toContain("script-src 'nonce-");
    expect(editCsp).not.toContain("'none'");

    // -----------------------------------------------------------------
    // Step 2: simulate the save engine's server-side contract (T9) — a
    // POST carrying `source:"inline"` is exactly what the overlay's
    // debounced single-flight save engine sends; the server can't tell
    // the difference, so this exercises the same code path directly.
    // First, a baseline "manual" save establishes revision R1 (the one
    // we'll restore back to), then the inline edit establishes R2.
    // -----------------------------------------------------------------
    const baselineSave = await auth(
      request(pagesApp)
        .post(`/api/sites/${site.id}/pages/${page.id}`)
        .send({ blocks: blocksV0, source: "manual" }),
    );
    expect(baselineSave.status).toBe(200);
    const r1Id: string = baselineSave.body.revision.id;

    const editedTitle = "Welcome to Acme (edited inline)";
    const blocksV1 = [
      { ...blocksV0[0], props: { ...blocksV0[0].props, title: editedTitle } },
      blocksV0[1],
      blocksV0[2],
    ];
    const inlineSave = await auth(
      request(pagesApp)
        .post(`/api/sites/${site.id}/pages/${page.id}`)
        .send({ blocks: blocksV1, source: "inline" }),
    );
    expect(inlineSave.status).toBe(200);
    expect(inlineSave.body.page.blocks[0].props.title).toBe(editedTitle);
    const r2Id: string = inlineSave.body.revision.id;
    expect(r2Id).not.toBe(r1Id);

    const revisionsList = await auth(
      request(pagesApp).get(`/api/sites/${site.id}/pages/${page.id}/revisions`),
    );
    expect(revisionsList.status).toBe(200);
    expect(revisionsList.body.revisions[0]).toMatchObject({ id: r2Id, source: "inline" });

    // Restore R1 -> title reverts to the pre-edit value (round-trip proof).
    const restoreRes = await auth(
      request(pagesApp).post(
        `/api/sites/${site.id}/pages/${page.id}/revisions/${r1Id}/restore`,
      ),
    );
    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.restored_from).toBe(r1Id);

    const afterRestore = await auth(
      request(pagesApp).get(`/api/sites/${site.id}/pages/${page.id}`),
    );
    expect(afterRestore.status).toBe(200);
    expect(afterRestore.body.page.blocks[0].props.title).toBe(originalTitle);

    // Restore appended a 3rd revision (append-only history) whose source
    // records what it restored from, and it's now on top.
    const revisionsAfterRestore = await auth(
      request(pagesApp).get(`/api/sites/${site.id}/pages/${page.id}/revisions`),
    );
    expect(revisionsAfterRestore.body.revisions).toHaveLength(3);
    expect(revisionsAfterRestore.body.revisions[0].source).toBe(`restore:${r1Id}`);

    // -----------------------------------------------------------------
    // Step 3: stock endpoints (T8) — stub-mode search + import via an
    // injected ingest spy (mirrors media-stock.test.ts exactly).
    // -----------------------------------------------------------------
    const searchRes = await auth(
      request(mediaApp)
        .post(`/api/sites/${site.id}/media/stock-search`)
        .send({ query: "dentist office", per_page: 5 }),
    );
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.mode).toBe("stub");
    expect(searchRes.body.hits).toHaveLength(3);

    const ingestFn = vi.fn(async () => ({
      asset_id: "22222222-2222-2222-2222-222222222222",
      gcs_key: `originals/${site.id}/22222222-2222-2222-2222-222222222222.jpg`,
    }));
    const mediaAppWithSpy = express();
    mediaAppWithSpy.use(express.json({ limit: "1mb" }));
    mediaAppWithSpy.use(
      "/api",
      mediaRouter({
        pool: db.getPool(),
        uploadRateLimit: { max: 100, windowMs: 60_000 },
        ingestFn,
      }),
    );
    const importRes = await auth(
      request(mediaAppWithSpy)
        .post(`/api/sites/${site.id}/media/stock-import`)
        .send({ url: "https://example.com/stock.jpg", alt: "A stock photo" }),
    );
    expect(importRes.status).toBe(202);
    expect(importRes.body).toEqual({ asset_id: "22222222-2222-2222-2222-222222222222" });
    expect(ingestFn).toHaveBeenCalledWith(db.getPool(), {
      siteId: site.id,
      url: "https://example.com/stock.jpg",
      alt: "A stock photo",
    });

    // -----------------------------------------------------------------
    // Step 4: plain preview (no ?edit=1) stays byte-behavior unchanged —
    // script-src 'none', no block/boot markers (T4/T12 guard).
    // -----------------------------------------------------------------
    const plainRes = await auth(
      request(pagesApp).get(`/api/sites/${site.id}/pages/${page.id}/preview`),
    );
    expect(plainRes.status).toBe(200);
    expect(plainRes.headers["content-security-policy"]).toContain("script-src 'none'");
    expect(plainRes.text).not.toContain("data-block-id");
    expect(plainRes.text).not.toContain("window.__AC_EDIT_BOOT__");
    expect(plainRes.text).not.toContain("__AC_EDIT_OVERLAY__");
  });
});
