import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupAgentDb } from "../../../tests/helpers/agent-db.js";
import {
  createConversation, getConversation, listMessages, setConversationStatus,
  requestConversationStop,
} from "../ai/agent/repo.js";
import { buildContinuationSingletonKey, handleAgentTurn } from "./agent-turn.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();
const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

d("handleAgentTurn (P-T9 / ai.agent-turn)", () => {
  beforeAll(() => db.runMigrations());
  afterAll(() => db.teardown());

  it("relies on stub mode when ANTHROPIC_API_KEY is absent under vitest", () => {
    // Documents the assumption the happy-path test below depends on: no live
    // Anthropic call happens because the test env has no key configured.
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("happy path: runs a real stub turn against a seeded empty site and creates the starter page", async () => {
    const site = await db.seedSite(`agent-turn-happy-${runId}`);
    const conv = await createConversation(db.getPool(), site.id, "t");

    await handleAgentTurn(
      { conversationId: conv.id, siteId: site.id },
      { pool: db.getPool() },
    );

    const pages = await db.getPool().query(
      `SELECT slug FROM pages WHERE site_id = $1`, [site.id],
    );
    expect(pages.rows.map((r) => r.slug)).toEqual(["home"]);

    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("active");
  });

  it("on runTurn failure: marks the conversation errored, persists a terminal system note (D303), and rethrows", async () => {
    const site = await db.seedSite(`agent-turn-error-${runId}`);
    const conv = await createConversation(db.getPool(), site.id, "t");

    const runTurn = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(
      handleAgentTurn(
        { conversationId: conv.id, siteId: site.id },
        { pool: db.getPool(), runTurn },
      ),
    ).rejects.toThrow("boom");

    expect(runTurn).toHaveBeenCalledWith({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id,
    });

    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("error");

    // D303 — a reload must not show a transcript that trails off with a
    // bare Resume button: the failure leaves an explanatory system row.
    const messages = await listMessages(db.getPool(), conv.id);
    const last = messages[messages.length - 1];
    expect(last.role).toBe("system");
    expect(JSON.stringify(last.content)).toMatch(/failed/i);
    expect(JSON.stringify(last.content)).toMatch(/resume/i);
  });

  // ── Bot-review fix wave, items 1+2 (turn serialization / job dedup) ──

  it("job re-delivery: a conversation already 'running' (fresh) is claimed by nobody — no-op, runTurn never called", async () => {
    const site = await db.seedSite(`agent-turn-redelivery-${runId}`);
    const conv = await createConversation(db.getPool(), site.id, "t");
    await setConversationStatus(db.getPool(), conv.id, "running");

    const runTurn = vi.fn();
    await handleAgentTurn({ conversationId: conv.id, siteId: site.id }, { pool: db.getPool(), runTurn });

    expect(runTurn).not.toHaveBeenCalled();
    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    // Still 'running' — this delivery didn't own the lock, so it must not
    // touch status at all (neither release nor error it).
    expect(convAfter!.status).toBe("running");
  });

  it("stale takeover: a 'running' conversation whose updated_at is >10 minutes old is claimable and runs normally", async () => {
    const site = await db.seedSite(`agent-turn-stale-${runId}`);
    const conv = await createConversation(db.getPool(), site.id, "t");
    await setConversationStatus(db.getPool(), conv.id, "running");
    await db.getPool().query(
      `UPDATE ai_conversations SET updated_at = now() - interval '11 minutes' WHERE id = $1`,
      [conv.id],
    );

    await handleAgentTurn({ conversationId: conv.id, siteId: site.id }, { pool: db.getPool() });

    const pages = await db.getPool().query(`SELECT slug FROM pages WHERE site_id = $1`, [site.id]);
    expect(pages.rows.map((r) => r.slug)).toEqual(["home"]);
    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("active");
  });

  // ── Task A3: auto-continue batching ──

  it("buildContinuationSingletonKey varies per round and never collides with round 0's bare-conversationId key", () => {
    const conversationId = "11111111-1111-1111-1111-111111111111";
    const siteId = "22222222-2222-2222-2222-222222222222";
    expect(buildContinuationSingletonKey({ conversationId, siteId, continuation: 1 }))
      .toBe(`${conversationId}:c1`);
    expect(buildContinuationSingletonKey({ conversationId, siteId, continuation: 2 }))
      .not.toBe(buildContinuationSingletonKey({ conversationId, siteId, continuation: 1 }));
    // Round 0's actual enqueue key (admin-ai-agent.ts) is the bare
    // conversationId — confirm the continuation format can never collide.
    expect(buildContinuationSingletonKey({ conversationId, siteId, continuation: 1 }))
      .not.toBe(conversationId);
  });

  it("tool_limit at continuation:0 releases the lock, then re-enqueues {continuation:1} under the round-1 key", async () => {
    const site = await db.seedSite(`agent-turn-continue-${runId}`);
    const conv = await createConversation(db.getPool(), site.id, "t");

    const runTurn = vi.fn().mockResolvedValue({ endReason: "tool_limit", toolCalls: 30 });
    const enqueueContinuation = vi.fn(async () => {
      // Verify release-before-enqueue ordering directly: by the time the
      // continuation is being sent, the lock must already be released.
      const convDuring = await getConversation(db.getPool(), conv.id, site.id);
      expect(convDuring!.status).toBe("active");
      return "job-1";
    });

    await handleAgentTurn(
      { conversationId: conv.id, siteId: site.id, continuation: 0 },
      { pool: db.getPool(), runTurn, enqueueContinuation },
    );

    expect(enqueueContinuation).toHaveBeenCalledTimes(1);
    expect(enqueueContinuation).toHaveBeenCalledWith({
      conversationId: conv.id, siteId: site.id, continuation: 1,
    });

    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("active");
  });

  it("continuation:3 (cap reached) does not re-enqueue, appends a visible paused note, and releases the lock", async () => {
    const site = await db.seedSite(`agent-turn-cap-${runId}`);
    const conv = await createConversation(db.getPool(), site.id, "t");

    const runTurn = vi.fn().mockResolvedValue({ endReason: "tool_limit", toolCalls: 30 });
    const enqueueContinuation = vi.fn();

    await handleAgentTurn(
      { conversationId: conv.id, siteId: site.id, continuation: 3 },
      { pool: db.getPool(), runTurn, enqueueContinuation },
    );

    expect(enqueueContinuation).not.toHaveBeenCalled();

    const messages = await listMessages(db.getPool(), conv.id);
    const last = messages[messages.length - 1];
    expect(last.role).toBe("assistant");
    const text = JSON.stringify(last.content);
    expect(text).toMatch(/paused/i);
    expect(text).toMatch(/continue/i);

    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("active");
  });

  it("completed never re-enqueues, regardless of continuation round", async () => {
    const site = await db.seedSite(`agent-turn-completed-${runId}`);
    const conv = await createConversation(db.getPool(), site.id, "t");

    const runTurn = vi.fn().mockResolvedValue({ endReason: "completed", toolCalls: 5 });
    const enqueueContinuation = vi.fn();

    await handleAgentTurn(
      { conversationId: conv.id, siteId: site.id, continuation: 1 },
      { pool: db.getPool(), runTurn, enqueueContinuation },
    );

    expect(enqueueContinuation).not.toHaveBeenCalled();
    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("active");
  });

  it("continuation vs fresh-turn race: a continuation job delivered after a fresh user turn already claimed the lock claim-fails cleanly", async () => {
    // Reviewer fix round 1 (Important): release-before-enqueue opens a
    // window where a fresh user message can arrive between "release" and
    // "the continuation job actually gets delivered", claim the turn-lock
    // itself (status='running', fresh updated_at), and enqueue its own
    // round-0 job under a DIFFERENT singletonKey (bare conversationId vs.
    // this continuation's `${conversationId}:c1`) — so both jobs are real,
    // queued/active work, not deduped against each other. When the
    // continuation job is then delivered, it must claim-fail exactly like
    // any other re-delivery (see "job re-delivery" above): no turn run, no
    // message appended, no status change, no further re-enqueue — it must
    // NOT clobber the fresh turn that already owns the conversation.
    const site = await db.seedSite(`agent-turn-race-${runId}`);
    const conv = await createConversation(db.getPool(), site.id, "t");

    // Simulate: the fresh user turn won the race and is holding the lock.
    await setConversationStatus(db.getPool(), conv.id, "running");

    const runTurn = vi.fn();
    const enqueueContinuation = vi.fn();

    await handleAgentTurn(
      { conversationId: conv.id, siteId: site.id, continuation: 1 },
      { pool: db.getPool(), runTurn, enqueueContinuation },
    );

    expect(runTurn).not.toHaveBeenCalled();
    expect(enqueueContinuation).not.toHaveBeenCalled();

    const messages = await listMessages(db.getPool(), conv.id);
    expect(messages).toHaveLength(0);

    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    // Still 'running' — untouched, still owned by the fresh turn.
    expect(convAfter!.status).toBe("running");
  });

  // ── W1.4 / D300+D1105+D612: Stop is honored by the job handler too ──

  it("W1.4 Stop: a cancel requested while the job was still queued stops it before runTurn ever runs", async () => {
    const site = await db.seedSite(`agent-turn-stop-queued-${runId}`);
    const conv = await createConversation(db.getPool(), site.id, "t");
    // Stop clicked while the conversation sat 'active' with the job queued.
    await requestConversationStop(db.getPool(), conv.id);

    const runTurn = vi.fn();
    await handleAgentTurn({ conversationId: conv.id, siteId: site.id }, { pool: db.getPool(), runTurn });

    expect(runTurn).not.toHaveBeenCalled();
    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("stopped");
    const messages = await listMessages(db.getPool(), conv.id);
    const last = messages[messages.length - 1];
    expect(last.role).toBe("system");
    expect(JSON.stringify(last.content)).toMatch(/stopped by you/i);
  });

  it("W1.4 Stop: endReason 'stopped' from the loop is terminal — no release, no continuation", async () => {
    const site = await db.seedSite(`agent-turn-stop-result-${runId}`);
    const conv = await createConversation(db.getPool(), site.id, "t");

    // The real loop lands status 'stopped' itself before resolving; mimic that.
    const runTurn = vi.fn(async () => {
      await setConversationStatus(db.getPool(), conv.id, "stopped");
      return { endReason: "stopped" as const, toolCalls: 3 };
    });
    const enqueueContinuation = vi.fn();

    await handleAgentTurn(
      { conversationId: conv.id, siteId: site.id, continuation: 0 },
      { pool: db.getPool(), runTurn, enqueueContinuation },
    );

    expect(enqueueContinuation).not.toHaveBeenCalled();
    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("stopped"); // not clobbered back to 'active'
  });

  it("W1.4 Stop: a cancel arriving at a continuation boundary stops instead of enqueueing the next round", async () => {
    const site = await db.seedSite(`agent-turn-stop-cont-${runId}`);
    const conv = await createConversation(db.getPool(), site.id, "t");

    const runTurn = vi.fn(async () => {
      // Stop clicked during the round — after the loop's last own check.
      await requestConversationStop(db.getPool(), conv.id);
      return { endReason: "tool_limit" as const, toolCalls: 30 };
    });
    const enqueueContinuation = vi.fn();

    await handleAgentTurn(
      { conversationId: conv.id, siteId: site.id, continuation: 0 },
      { pool: db.getPool(), runTurn, enqueueContinuation },
    );

    expect(enqueueContinuation).not.toHaveBeenCalled();
    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("stopped");
    const messages = await listMessages(db.getPool(), conv.id);
    expect(JSON.stringify(messages[messages.length - 1].content)).toMatch(/stopped by you/i);
  });

  it("re-claims the lock for each continuation round and releases fully once a later round completes", async () => {
    const site = await db.seedSite(`agent-turn-multi-${runId}`);
    const conv = await createConversation(db.getPool(), site.id, "t");

    const runTurn = vi.fn()
      .mockResolvedValueOnce({ endReason: "tool_limit", toolCalls: 30 })
      .mockResolvedValueOnce({ endReason: "completed", toolCalls: 10 });
    const enqueueContinuation = vi.fn().mockResolvedValue("job-2");

    // Round 0 — as pg-boss would deliver the initial job.
    await handleAgentTurn(
      { conversationId: conv.id, siteId: site.id, continuation: 0 },
      { pool: db.getPool(), runTurn, enqueueContinuation },
    );
    expect(enqueueContinuation).toHaveBeenCalledWith({
      conversationId: conv.id, siteId: site.id, continuation: 1,
    });
    let convMid = await getConversation(db.getPool(), conv.id, site.id);
    expect(convMid!.status).toBe("active"); // released, not stranded 'running'

    // Round 1 — as pg-boss would deliver the re-enqueued continuation job.
    // The lock must be re-claimable (status was released to 'active' above).
    await handleAgentTurn(
      { conversationId: conv.id, siteId: site.id, continuation: 1 },
      { pool: db.getPool(), runTurn, enqueueContinuation },
    );

    expect(runTurn).toHaveBeenCalledTimes(2);
    expect(enqueueContinuation).toHaveBeenCalledTimes(1); // no second re-enqueue after "completed"
    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("active");
  });
});
