import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { setupAgentDb } from "../helpers/agent-db.js";
import { adminSitesRouter } from "../../src/server/routes/admin-sites.js";
import { adminPagesRouter } from "../../src/server/routes/admin-pages.js";
import { adminAiAgentRouter } from "../../src/server/routes/admin-ai-agent.js";
import { runAgentTurn } from "../../src/server/ai/agent/loop.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const ADMIN_TOKEN = "test-admin-token-build";
const auth = (r: request.Test) => r.set("X-Admin-Token", ADMIN_TOKEN);

/**
 * Task 13 — the Definition-of-Done rehearsal: a full, zero-spend, no-mocks
 * pass through the site + conversation HTTP API, the real `runAgentTurn`
 * stub path (Task 8, loop.ts), and back out through the HTTP API for
 * assertions (conversation detail, pages list, revisions, preview HTML).
 * This is an integration GATE, not TDD — it exercises the already-built
 * Tasks 1-10 stack end to end and should pass unmodified if they're correct.
 *
 * ANTHROPIC_API_KEY is explicitly absent for this suite (stub mode) — deleted
 * + restored around the suite in case a local shell has it exported (CI never
 * will).
 */
d("agent build (integration, end-to-end stub-mode, Task 13)", () => {
  const db = setupAgentDb();
  let app: express.Express;
  let savedApiKey: string | undefined;
  // Sites created via POST /api/sites (not db.seedSite()) aren't tracked by
  // setupAgentDb()'s teardown — clean them up ourselves so they don't
  // accumulate in the shared test DB across runs (sibling precedent:
  // tests/integration/admin-sites.test.ts's createdSlugs / afterAll).
  const createdSiteIds: string[] = [];

  beforeAll(async () => {
    savedApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    await db.runMigrations();
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;

    const a = express();
    a.use(express.json());
    a.use("/api", adminSitesRouter({ pool: db.getPool(), createRateLimit: { max: 1000, windowMs: 60_000 } }));
    a.use("/api", adminPagesRouter({ pool: db.getPool(), saveRateLimit: { max: 1000, windowMs: 60_000 } }));
    a.use(
      "/api",
      adminAiAgentRouter({
        pool: db.getPool(),
        messageRateLimit: { max: 1000, windowMs: 60_000 },
      }),
    );
    app = a;
  }, 60_000);

  afterEach(() => {
    // Guard against a real key sneaking in mid-suite from some other module's
    // side effect — every test in this suite must run stub-mode.
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  afterAll(async () => {
    if (createdSiteIds.length > 0) {
      // CASCADE cleans up the site's conversations/messages/pages/revisions.
      await db.getPool().query(`DELETE FROM sites WHERE id = ANY($1)`, [createdSiteIds]);
    }
    await db.teardown();
    delete process.env.ADMIN_API_TOKEN;
    if (savedApiKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = savedApiKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("builds a starter Home page via the stub loop, then reports no changes on the next turn", async () => {
    // 1. Site via the API.
    const siteRes = await auth(request(app).post("/api/sites")).send({
      slug: `agent-build-${Date.now()}`,
      display_name: "Agent Build Co",
    });
    expect(siteRes.status).toBe(201);
    const siteId = siteRes.body.site.id as string;
    createdSiteIds.push(siteId);

    // 2. Conversation via the API — no run, message persisted only.
    const convRes = await auth(request(app).post(`/api/sites/${siteId}/agent/conversations`)).send({
      message: "Build a dental site",
    });
    expect(convRes.status).toBe(201);
    const conversationId = convRes.body.conversation.id as string;

    // 3. Run the turn directly (stub mode — no ANTHROPIC_API_KEY).
    const turnResult = await runAgentTurn({ pool: db.getPool(), conversationId, siteId });
    expect(turnResult.endReason).toBe("completed");
    expect(turnResult.toolCalls).toBe(1);

    // 4a. Conversation detail via the API: role sequence.
    const detail = await auth(
      request(app).get(`/api/sites/${siteId}/agent/conversations/${conversationId}`),
    );
    expect(detail.status).toBe(200);
    expect(detail.body.messages.map((m: { role: string }) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    const finalText = detail.body.messages.at(-1).content;
    expect(JSON.stringify(finalText)).toContain("Stub mode: created a starter Home page.");

    // 4b. Pages list via the API: a draft `home` page.
    const pagesRes = await auth(request(app).get(`/api/sites/${siteId}/pages`));
    expect(pagesRes.status).toBe(200);
    expect(pagesRes.body.pages).toHaveLength(1);
    const homePage = pagesRes.body.pages[0];
    expect(homePage).toMatchObject({ slug: "home", status: "draft" });

    // 4c. Revisions via the API: source 'ai'.
    const revsRes = await auth(
      request(app).get(`/api/sites/${siteId}/pages/${homePage.id}/revisions`),
    );
    expect(revsRes.status).toBe(200);
    expect(revsRes.body.revisions.length).toBeGreaterThanOrEqual(1);
    expect(revsRes.body.revisions.some((r: { source: string }) => r.source === "ai")).toBe(true);

    // 4d. Preview via the API: HTML contains the stub hero + rich-text copy.
    const previewRes = await auth(
      request(app).get(`/api/sites/${siteId}/pages/${homePage.id}/preview`),
    );
    expect(previewRes.status).toBe(200);
    expect(previewRes.headers["content-type"]).toContain("text/html");
    expect(previewRes.text).toContain("Your new site, drafted by AI");
    expect(previewRes.text).toContain("[AI agent stub] Set ANTHROPIC_API_KEY for live builds.");

    // Also exercise the token-in-query shim for preview, as the brief calls out.
    const previewViaToken = await request(app).get(
      `/api/sites/${siteId}/pages/${homePage.id}/preview?token=${ADMIN_TOKEN}`,
    );
    expect(previewViaToken.status).toBe(200);
    expect(previewViaToken.text).toContain("Your new site, drafted by AI");

    // 5. A second conversation + runAgentTurn on the SAME (now non-empty) site
    // makes no changes.
    const convRes2 = await auth(request(app).post(`/api/sites/${siteId}/agent/conversations`)).send({
      message: "Add another page",
    });
    expect(convRes2.status).toBe(201);
    const conversationId2 = convRes2.body.conversation.id as string;

    const turnResult2 = await runAgentTurn({ pool: db.getPool(), conversationId: conversationId2, siteId });
    expect(turnResult2.endReason).toBe("completed");
    expect(turnResult2.toolCalls).toBe(0);

    const detail2 = await auth(
      request(app).get(`/api/sites/${siteId}/agent/conversations/${conversationId2}`),
    );
    expect(detail2.status).toBe(200);
    expect(detail2.body.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(detail2.body.messages.at(-1).content)).toContain(
      "Stub mode: no changes made — site already has pages.",
    );

    // Page count is unchanged.
    const pagesRes2 = await auth(request(app).get(`/api/sites/${siteId}/pages`));
    expect(pagesRes2.status).toBe(200);
    expect(pagesRes2.body.pages).toHaveLength(1);
  });
});
