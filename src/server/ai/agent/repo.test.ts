import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAgentDb } from "../../../../tests/helpers/agent-db.js";
import {
  createConversation, getConversation, listConversations, appendMessage,
  listMessages, setConversationStatus, addTokenUsage, getTodayUsage,
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
});
