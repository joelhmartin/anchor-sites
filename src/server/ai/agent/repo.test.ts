import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupAgentDb } from "../../../../tests/helpers/agent-db.js";
import {
  createConversation, getOrCreateConversation, getConversation, listConversations, appendMessage,
  listMessages, setConversationStatus, addTokenUsage, getTodayUsage,
  claimConversationTurn, releaseConversationTurn, sweepStalledConversation,
  requestConversationStop, consumeCancelRequest, markConversationStopped,
} from "./repo.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();

d("ai agent repo", () => {
  let siteId: string;
  let otherSiteId: string;

  /** D302: at most one non-archived conversation per site — free the slot. */
  async function archiveLive(...siteIds: string[]): Promise<void> {
    await db.getPool().query(
      `UPDATE ai_conversations SET status = 'archived' WHERE site_id = ANY($1)`,
      [siteIds],
    );
  }

  beforeAll(async () => {
    await db.runMigrations();
    siteId = (await db.seedSite("agent-repo-a")).id;
    otherSiteId = (await db.seedSite("agent-repo-b")).id;
  });
  // D302's one-live-conversation-per-site index: each test starts with the
  // shared sites' conversation slots free.
  beforeEach(() => archiveLive(siteId, otherSiteId));
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
    // D302: archive c1 to free the site's live-conversation slot before
    // creating c2 (the index allows any number of archived rows).
    await setConversationStatus(db.getPool(), c1.id, "archived");
    const c2 = await createConversation(db.getPool(), siteId, "two");
    const list = await listConversations(db.getPool(), siteId);
    expect(list.findIndex((c) => c.id === c2.id)).toBeLessThan(list.findIndex((c) => c.id === c1.id));
    expect(list.find((c) => c.id === c1.id)!.status).toBe("archived");
  });

  // ── W2-CONC / D302: one live conversation per site ──

  describe("getOrCreateConversation (D302)", () => {
    it("creates when the site has no live conversation, then returns THAT one on every later call", async () => {
      const first = await getOrCreateConversation(db.getPool(), siteId, "first");
      expect(first.created).toBe(true);
      const second = await getOrCreateConversation(db.getPool(), siteId, "ignored title");
      expect(second.created).toBe(false);
      expect(second.conversation.id).toBe(first.conversation.id);
    });

    it("returns the existing conversation whatever its live status (error/running/stopped)", async () => {
      const { conversation } = await getOrCreateConversation(db.getPool(), siteId, "t");
      for (const status of ["error", "running", "stopped"] as const) {
        await setConversationStatus(db.getPool(), conversation.id, status);
        const again = await getOrCreateConversation(db.getPool(), siteId, "t");
        expect(again.created).toBe(false);
        expect(again.conversation.id).toBe(conversation.id);
        expect(again.conversation.status).toBe(status);
      }
    });

    it("an archived conversation frees the slot — the next call creates a fresh one", async () => {
      const { conversation } = await getOrCreateConversation(db.getPool(), siteId, "t");
      await setConversationStatus(db.getPool(), conversation.id, "archived");
      const next = await getOrCreateConversation(db.getPool(), siteId, "t");
      expect(next.created).toBe(true);
      expect(next.conversation.id).not.toBe(conversation.id);
    });

    it("is per-site: another site still gets its own conversation", async () => {
      const a = await getOrCreateConversation(db.getPool(), siteId, "t");
      const b = await getOrCreateConversation(db.getPool(), otherSiteId, "t");
      expect(b.created).toBe(true);
      expect(b.conversation.id).not.toBe(a.conversation.id);
    });

    it("the DB index itself rejects a raw twin INSERT (the invariant is structural, not route-side)", async () => {
      await createConversation(db.getPool(), siteId, "one");
      await expect(createConversation(db.getPool(), siteId, "twin")).rejects.toMatchObject({
        code: "23505",
      });
    });
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

  // ── W1.4 / D300+D1105+D612: real Stop (cancel_requested + 'stopped') ──

  describe("requestConversationStop / consumeCancelRequest / markConversationStopped", () => {
    async function cancelFlag(id: string): Promise<boolean> {
      const r = await db.getPool().query<{ cancel_requested: boolean }>(
        `SELECT cancel_requested FROM ai_conversations WHERE id = $1`, [id],
      );
      return r.rows[0].cancel_requested;
    }

    it("sets cancel_requested on a 'running' conversation and on an 'active' one (queued job), but not on settled ones", async () => {
      const running = await createConversation(db.getPool(), siteId, "t");
      await claimConversationTurn(db.getPool(), running.id);
      expect(await requestConversationStop(db.getPool(), running.id)).toBe(true);
      expect(await cancelFlag(running.id)).toBe(true);
      await archiveLive(siteId); // D302: free the slot for the next conversation

      const active = await createConversation(db.getPool(), siteId, "t");
      expect(await requestConversationStop(db.getPool(), active.id)).toBe(true);
      await archiveLive(siteId);

      const errored = await createConversation(db.getPool(), siteId, "t");
      await setConversationStatus(db.getPool(), errored.id, "error");
      expect(await requestConversationStop(db.getPool(), errored.id)).toBe(false);
      expect(await cancelFlag(errored.id)).toBe(false);
    });

    it("consumeCancelRequest reports-and-clears atomically — true once, then false", async () => {
      const conv = await createConversation(db.getPool(), siteId, "t");
      await claimConversationTurn(db.getPool(), conv.id);
      await requestConversationStop(db.getPool(), conv.id);

      expect(await consumeCancelRequest(db.getPool(), conv.id)).toBe(true);
      expect(await cancelFlag(conv.id)).toBe(false);
      expect(await consumeCancelRequest(db.getPool(), conv.id)).toBe(false);
    });

    it("markConversationStopped appends the honest note and lands status 'stopped' with the flag cleared", async () => {
      const conv = await createConversation(db.getPool(), siteId, "t");
      await claimConversationTurn(db.getPool(), conv.id);
      await requestConversationStop(db.getPool(), conv.id);

      await markConversationStopped(db.getPool(), conv.id);

      const after = await getConversation(db.getPool(), conv.id, siteId);
      expect(after!.status).toBe("stopped");
      expect(await cancelFlag(conv.id)).toBe(false);
      const all = await listMessages(db.getPool(), conv.id);
      const last = all[all.length - 1];
      expect(last.role).toBe("system");
      expect(JSON.stringify(last.content)).toMatch(/stopped by you/i);
      expect(JSON.stringify(last.content)).toMatch(/already written/i);
    });

    it("a 'stopped' conversation is claimable again (a follow-up message resumes)", async () => {
      const conv = await createConversation(db.getPool(), siteId, "t");
      await setConversationStatus(db.getPool(), conv.id, "stopped");
      expect(await claimConversationTurn(db.getPool(), conv.id)).toBe(true);
      expect((await getConversation(db.getPool(), conv.id, siteId))!.status).toBe("running");
    });

    it("releaseConversationTurn clears a still-set cancel flag in both branches (a settled turn starts the next one clean)", async () => {
      const conv = await createConversation(db.getPool(), siteId, "t");
      await claimConversationTurn(db.getPool(), conv.id);
      await requestConversationStop(db.getPool(), conv.id);
      await releaseConversationTurn(db.getPool(), conv.id, "active");
      expect(await cancelFlag(conv.id)).toBe(false);
      await archiveLive(siteId); // D302: free the slot for the next conversation

      const conv2 = await createConversation(db.getPool(), siteId, "t");
      await claimConversationTurn(db.getPool(), conv2.id);
      await requestConversationStop(db.getPool(), conv2.id);
      await releaseConversationTurn(db.getPool(), conv2.id, "error");
      expect(await cancelFlag(conv2.id)).toBe(false);
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
