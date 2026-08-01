import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { setupAgentDb } from "../helpers/agent-db.js";
import { adminSitesRouter } from "../../src/server/routes/admin-sites.js";
import { adminPagesRouter } from "../../src/server/routes/admin-pages.js";
import { adminAiAgentRouter } from "../../src/server/routes/admin-ai-agent.js";
import { runAgentTurn } from "../../src/server/ai/agent/loop.js";
import { appendMessage } from "../../src/server/ai/agent/repo.js";

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
  // Sites created via POST /api/sites (not db.seedSite()) aren't tracked by
  // setupAgentDb()'s teardown — clean them up ourselves so they don't
  // accumulate in the shared test DB across runs (sibling precedent:
  // tests/integration/admin-sites.test.ts's createdSlugs / afterAll).
  const createdSiteIds: string[] = [];

  // vi.stubEnv, not a raw `process.env` write — vitest's `unstubEnvs` hygiene
  // then guarantees both of these reset before the next test anywhere in the
  // suite, regardless of how long this file's own `afterAll` (real Postgres
  // teardown) takes (root cause of the cross-file requireAdmin flake — see
  // .superpowers/sdd/2026-07-30-lovable-workspace/test-pollution-debug.md).
  beforeEach(() => {
    vi.stubEnv("ADMIN_API_TOKEN", ADMIN_TOKEN);
    // ANTHROPIC_API_KEY explicitly absent for this suite (stub mode) —
    // stubbed to "" in case a local shell has it exported (CI never will).
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });

  beforeAll(async () => {
    await db.runMigrations();

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
    expect(process.env.ANTHROPIC_API_KEY).toBeFalsy();
  });

  afterAll(async () => {
    if (createdSiteIds.length > 0) {
      // CASCADE cleans up the site's conversations/messages/pages/revisions.
      await db.getPool().query(`DELETE FROM sites WHERE id = ANY($1)`, [createdSiteIds]);
    }
    await db.teardown();
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

    // 2. Conversation via the API (empty), then persist the user message
    // directly. D1115 — the seed-message route now enqueues an AGENT_TURN
    // (no dead-letter), which would 503 here without a running boss; this
    // test drives the turn directly in stub mode below, so it just needs the
    // message persisted, not queued.
    const convRes = await auth(request(app).post(`/api/sites/${siteId}/agent/conversations`)).send({});
    expect(convRes.status).toBe(201);
    const conversationId = convRes.body.conversation.id as string;
    await appendMessage(db.getPool(), conversationId, "user", [
      { type: "text", text: "Build a dental site" },
    ]);

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

    // 5. A second create POST on the SAME site converges on THE site's
    // conversation (D302 get-or-create: 200 + same id, never a twin), and a
    // second runAgentTurn on the now non-empty site makes no changes.
    // (Create empty to observe the get-or-create status; D1115 means a
    // seed-message create would instead return runJobTurn's 202/503.)
    const convRes2 = await auth(request(app).post(`/api/sites/${siteId}/agent/conversations`)).send({});
    expect(convRes2.status).toBe(200);
    const conversationId2 = convRes2.body.conversation.id as string;
    expect(conversationId2).toBe(conversationId);
    await appendMessage(db.getPool(), conversationId2, "user", [
      { type: "text", text: "Add another page" },
    ]);

    const turnResult2 = await runAgentTurn({ pool: db.getPool(), conversationId: conversationId2, siteId });
    expect(turnResult2.endReason).toBe("completed");
    expect(turnResult2.toolCalls).toBe(0);

    const detail2 = await auth(
      request(app).get(`/api/sites/${siteId}/agent/conversations/${conversationId2}`),
    );
    expect(detail2.status).toBe(200);
    // Same conversation as turn 1, so the seed message + this turn's reply
    // land at the END of the existing transcript.
    expect(detail2.body.messages.slice(-2).map((m: { role: string }) => m.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(JSON.stringify(detail2.body.messages.at(-1).content)).toContain(
      "Stub mode: no changes made — site already has pages.",
    );

    // Page count is unchanged.
    const pagesRes2 = await auth(request(app).get(`/api/sites/${siteId}/pages`));
    expect(pagesRes2.status).toBe(200);
    expect(pagesRes2.body.pages).toHaveLength(1);
  });
});
