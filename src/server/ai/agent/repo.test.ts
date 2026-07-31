import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAgentDb } from "../../../../tests/helpers/agent-db.js";
import {
  createConversation, getConversation, listConversations, appendMessage,
  listMessages, setConversationStatus, addTokenUsage, getTodayUsage,
  claimConversationTurn, releaseConversationTurn, sweepStalledConversation,
} from "./repo.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();

d("ai agent repo", () => {
  let siteId: string;
  let otherSiteId: string;

  beforeAll(async () => {
    await db.runMigrations();
    siteId = (await db.seedSite("agent-repo-a")).id;
    otherSiteId = (await db.seedSite("agent-repo-b")).id;
  });
  afterAll(() => db.teardown());

  it("creates and fetches a conversation, scoped by site", async () => {
    const conv = await createConversation(db.getPool(), siteId, "Build my site");
    expect(conv.status).toBe("active");
    expect(await getConversation(db.getPool(), conv.id, siteId)).toMatchObject({ id: conv.id });
    expect(await getConversation(db.getPool(), conv.id, otherSiteId)).toBeNull();
  });

  it("appends and lists messages in order, honoring limit + afterId", async () => {
    const conv = await createConversation(db.getPool(), siteId, "t");
    const m1 = await appendMessage(db.getPool(), conv.id, "user", [{ type: "text", text: "one" }]);
    await appendMessage(db.getPool(), conv.id, "assistant", [{ type: "text", text: "two" }]);
    await appendMessage(db.getPool(), conv.id, "tool", [{ type: "tool_result", tool_use_id: "x", content: "ok" }]);
    const all = await listMessages(db.getPool(), conv.id);
    expect(all.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect((await listMessages(db.getPool(), conv.id, { limit: 2 })).map((m) => m.role))
      .toEqual(["assistant", "tool"]);
    expect((await listMessages(db.getPool(), conv.id, { afterId: m1.id })).length).toBe(2);
  });

  it("accumulates token usage per day and reads today's total", async () => {
    const conv = await createConversation(db.getPool(), siteId, "t");
    await addTokenUsage(db.getPool(), conv.id, { input: 100, output: 50 }, "2026-07-27");
    await addTokenUsage(db.getPool(), conv.id, { input: 10, output: 5 }, "2026-07-27");
    const fresh = await getConversation(db.getPool(), conv.id, siteId);
    expect(getTodayUsage(fresh!, "2026-07-27")).toEqual({ input: 110, output: 55 });
    expect(getTodayUsage(fresh!, "2026-07-28")).toEqual({ input: 0, output: 0 });
  });

  it("sets status and lists newest-first", async () => {
    const c1 = await createConversation(db.getPool(), siteId, "one");
    const c2 = await createConversation(db.getPool(), siteId, "two");
    await setConversationStatus(db.getPool(), c1.id, "error");
    const list = await listConversations(db.getPool(), siteId);
    expect(list.findIndex((c) => c.id === c2.id)).toBeLessThan(list.findIndex((c) => c.id === c1.id));
    expect(list.find((c) => c.id === c1.id)!.status).toBe("error");
  });

  describe("claimConversationTurn / releaseConversationTurn (bot-review fix wave, item 1)", () => {
    it("claims from 'active', a second claim while running fails, and release returns it to 'active'", async () => {
      const conv = await createConversation(db.getPool(), siteId, "t");
      expect(await claimConversationTurn(db.getPool(), conv.id)).toBe(true);
      expect((await getConversation(db.getPool(), conv.id, siteId))!.status).toBe("running");

      // A second claim attempt while genuinely running (fresh updated_at) fails.
      expect(await claimConversationTurn(db.getPool(), conv.id)).toBe(false);

      await releaseConversationTurn(db.getPool(), conv.id, "active");
      expect((await getConversation(db.getPool(), conv.id, siteId))!.status).toBe("active");
    });

    it("claims from 'error' too (resume semantics)", async () => {
      const conv = await createConversation(db.getPool(), siteId, "t");
      await setConversationStatus(db.getPool(), conv.id, "error");
      expect(await claimConversationTurn(db.getPool(), conv.id)).toBe(true);
      expect((await getConversation(db.getPool(), conv.id, siteId))!.status).toBe("running");
    });

    it("releasing to 'active' is a no-op once something else already set 'error' (error wins)", async () => {
      const conv = await createConversation(db.getPool(), siteId, "t");
      await claimConversationTurn(db.getPool(), conv.id);
      await setConversationStatus(db.getPool(), conv.id, "error");
      await releaseConversationTurn(db.getPool(), conv.id, "active");
      expect((await getConversation(db.getPool(), conv.id, siteId))!.status).toBe("error");
    });

    it("a stale 'running' row (updated_at > 10 minutes old) is claimable again — crashed-turn takeover", async () => {
      const conv = await createConversation(db.getPool(), siteId, "t");
      await claimConversationTurn(db.getPool(), conv.id);
      await db.getPool().query(
        `UPDATE ai_conversations SET updated_at = now() - interval '11 minutes' WHERE id = $1`,
        [conv.id],
      );
      expect(await claimConversationTurn(db.getPool(), conv.id)).toBe(true);
    });

    it("a fresh 'running' row (updated_at < 10 minutes old) is NOT claimable", async () => {
      const conv = await createConversation(db.getPool(), siteId, "t");
      await claimConversationTurn(db.getPool(), conv.id);
      expect(await claimConversationTurn(db.getPool(), conv.id)).toBe(false);
    });
  });

  // ── W1.4 / D601+D303+D1103: system transcript rows + stall sweeper ──

  it("appendMessage accepts role 'system' (UI-only transcript annotations)", async () => {
    const conv = await createConversation(db.getPool(), siteId, "t");
    const m = await appendMessage(db.getPool(), conv.id, "system", [
      { type: "text", text: "Build was interrupted — press Resume to continue." },
    ]);
    expect(m.role).toBe("system");
    const all = await listMessages(db.getPool(), conv.id);
    expect(all.map((x) => x.role)).toEqual(["system"]);
  });

  describe("sweepStalledConversation (D601/D309 stale-running, D1103 queued-never-started)", () => {
    it("flips a stale 'running' conversation (>10 min) to 'error' and appends an interrupted system row", async () => {
      const conv = await createConversation(db.getPool(), siteId, "t");
      await claimConversationTurn(db.getPool(), conv.id);
      await db.getPool().query(
        `UPDATE ai_conversations SET updated_at = now() - interval '11 minutes' WHERE id = $1`,
        [conv.id],
      );

      expect(await sweepStalledConversation(db.getPool(), conv.id)).toBe("interrupted");
      expect((await getConversation(db.getPool(), conv.id, siteId))!.status).toBe("error");
      const all = await listMessages(db.getPool(), conv.id);
      const last = all[all.length - 1];
      expect(last.role).toBe("system");
      expect(JSON.stringify(last.content)).toMatch(/interrupted/i);
      expect(JSON.stringify(last.content)).toMatch(/resume/i);
    });

    it("leaves a fresh 'running' conversation alone", async () => {
      const conv = await createConversation(db.getPool(), siteId, "t");
      await claimConversationTurn(db.getPool(), conv.id);

      expect(await sweepStalledConversation(db.getPool(), conv.id)).toBeNull();
      expect((await getConversation(db.getPool(), conv.id, siteId))!.status).toBe("running");
      expect(await listMessages(db.getPool(), conv.id)).toHaveLength(0);
    });

    it("flips a stale 'active' conversation whose newest message is an unanswered user message (queued job never ran)", async () => {
      const conv = await createConversation(db.getPool(), siteId, "t");
      await appendMessage(db.getPool(), conv.id, "user", [{ type: "text", text: "build it" }]);
      await db.getPool().query(
        `UPDATE ai_conversations SET updated_at = now() - interval '6 minutes' WHERE id = $1`,
        [conv.id],
      );

      expect(await sweepStalledConversation(db.getPool(), conv.id)).toBe("never_started");
      expect((await getConversation(db.getPool(), conv.id, siteId))!.status).toBe("error");
      const all = await listMessages(db.getPool(), conv.id);
      const last = all[all.length - 1];
      expect(last.role).toBe("system");
      expect(JSON.stringify(last.content)).toMatch(/never started/i);
      expect(JSON.stringify(last.content)).toMatch(/resume/i);
    });

    it("leaves a stale 'active' conversation alone when the newest message is NOT a user message (turn genuinely finished)", async () => {
      const conv = await createConversation(db.getPool(), siteId, "t");
      await appendMessage(db.getPool(), conv.id, "user", [{ type: "text", text: "build it" }]);
      await appendMessage(db.getPool(), conv.id, "assistant", [{ type: "text", text: "done" }]);
      await db.getPool().query(
        `UPDATE ai_conversations SET updated_at = now() - interval '6 minutes' WHERE id = $1`,
        [conv.id],
      );

      expect(await sweepStalledConversation(db.getPool(), conv.id)).toBeNull();
      expect((await getConversation(db.getPool(), conv.id, siteId))!.status).toBe("active");
    });

    it("leaves a fresh 'active' conversation with an unanswered user message alone (job just queued)", async () => {
      const conv = await createConversation(db.getPool(), siteId, "t");
      await appendMessage(db.getPool(), conv.id, "user", [{ type: "text", text: "build it" }]);

      expect(await sweepStalledConversation(db.getPool(), conv.id)).toBeNull();
      expect((await getConversation(db.getPool(), conv.id, siteId))!.status).toBe("active");
    });
  });
});
