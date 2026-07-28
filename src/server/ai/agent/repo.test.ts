import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAgentDb } from "../../../../tests/helpers/agent-db.js";
import {
  createConversation, getConversation, listConversations, appendMessage,
  listMessages, setConversationStatus, addTokenUsage, getTodayUsage,
  claimConversationTurn, releaseConversationTurn,
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
});
