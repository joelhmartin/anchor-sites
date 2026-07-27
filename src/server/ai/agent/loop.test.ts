import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { setupAgentDb } from "../../../../tests/helpers/agent-db.js";
import {
  createConversation, appendMessage, listMessages, addTokenUsage, getConversation, getTodayUsage,
} from "./repo.js";
import { runAgentTurn, type AgentTurnEvent } from "./loop.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();
// Unique per test-process run: see read.test.ts for why (shared test DB,
// suite data isn't cleaned up afterward).
const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const API_ENV = { ANTHROPIC_API_KEY: "test-key" } as NodeJS.ProcessEnv;

function textBlock(text: string): Anthropic.TextBlock {
  return { type: "text", text, citations: null } as Anthropic.TextBlock;
}

function toolUseBlock(id: string, name: string, input: unknown): Anthropic.ToolUseBlock {
  return { type: "tool_use", id, name, input } as Anthropic.ToolUseBlock;
}

function usage(input_tokens: number, output_tokens: number): Anthropic.Usage {
  return {
    input_tokens, output_tokens,
    cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
    server_tool_use: null, service_tier: null,
  } as Anthropic.Usage;
}

let msgCounter = 0;
function cannedMessage(opts: {
  content: Anthropic.ContentBlock[]; stop_reason: Anthropic.StopReason; usage: Anthropic.Usage;
}): Anthropic.Message {
  return {
    id: `msg_${++msgCounter}`,
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content: opts.content,
    stop_reason: opts.stop_reason,
    stop_sequence: null,
    usage: opts.usage,
  } as Anthropic.Message;
}

function makeFakeClient(messages: Anthropic.Message[]) {
  const create = vi.fn();
  for (const m of messages) create.mockResolvedValueOnce(m);
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

d("runAgentTurn", () => {
  beforeAll(() => db.runMigrations());
  afterAll(() => db.teardown());

  async function seedConvo(slug: string, blocks: unknown[] = [{ id: "b1", type: "rich-text", props: { html: "<p>Before</p>" } }]) {
    const site = await db.seedSite(slug);
    const page = await db.seedPage(site.id, "home", blocks);
    const conv = await createConversation(db.getPool(), site.id, "t");
    await appendMessage(db.getPool(), conv.id, "user", [{ type: "text", text: "Update the homepage copy" }]);
    return { site, page, conv };
  }

  it("happy path: get_site_overview -> update_page -> end_turn", async () => {
    const { site, page, conv } = await seedConvo(`loop-happy-${runId}`);

    const { client, create } = makeFakeClient([
      cannedMessage({
        content: [toolUseBlock("t1", "get_site_overview", {})],
        stop_reason: "tool_use",
        usage: usage(100, 20),
      }),
      cannedMessage({
        content: [toolUseBlock("t2", "update_page", {
          page_id: page.id,
          ops: [{ op: "update_block", id: "b1", props: { html: "<p>After</p>" } }],
        })],
        stop_reason: "tool_use",
        usage: usage(120, 30),
      }),
      cannedMessage({
        content: [textBlock("Updated the homepage copy.")],
        stop_reason: "end_turn",
        usage: usage(50, 10),
      }),
    ]);

    const events: AgentTurnEvent[] = [];
    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id,
      env: API_ENV, client, onEvent: (e) => events.push(e),
    });

    expect(create).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ reason: "end_turn", toolCalls: 2 });

    const msgs = await listMessages(db.getPool(), conv.id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "tool", "assistant"]);

    const pageRow = await db.getPool().query(`SELECT blocks FROM pages WHERE id = $1`, [page.id]);
    const blocks = pageRow.rows[0].blocks as { id: string; props: { html: string } }[];
    expect(blocks[0].props.html).toBe("<p>After</p>");

    const revRows = await db.getPool().query(`SELECT source FROM page_revisions WHERE page_id = $1`, [page.id]);
    expect(revRows.rowCount).toBeGreaterThan(0);
    expect(revRows.rows.every((r) => r.source === "ai")).toBe(true);

    expect(events.map((e) => e.type)).toEqual([
      "tool_call", "tool_result", "tool_call", "tool_result", "assistant_text", "turn_done",
    ]);
    expect(events[5]).toEqual({ type: "turn_done", reason: "end_turn" });

    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(getTodayUsage(convAfter!)).toEqual({ input: 270, output: 60 });

    // Request payload shape (first call): system carries the intro + block
    // catalog with prompt caching on, tools/tool_choice/max_tokens are wired
    // through, and the only message is the pre-persisted user turn.
    type CreateParams = {
      system: { type: string; text: string; cache_control?: { type: string } }[];
      messages: { role: string; content: unknown }[];
      max_tokens: number;
      tool_choice: { type: string };
      tools: unknown[];
    };
    const firstCall = create.mock.calls[0][0] as CreateParams;
    expect(firstCall.system).toHaveLength(1);
    expect(firstCall.system[0].text).toContain("You are the site agent for the AnchorCorps site builder");
    expect(firstCall.system[0].text).toContain("--- BLOCK CATALOG ---");
    expect(firstCall.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(firstCall.max_tokens).toBe(8192);
    expect(firstCall.tool_choice).toEqual({ type: "auto" });
    expect(firstCall.tools.length).toBeGreaterThan(0);
    expect(firstCall.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Update the homepage copy" }] },
    ]);

    // Second call's history must include the persisted tool-result row
    // remapped to API role "user" (there is no "tool" role in the Messages
    // API — tool_result blocks ride in a user turn).
    const secondCall = create.mock.calls[1][0] as CreateParams;
    expect(secondCall.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const toolResultTurn = secondCall.messages[2].content as { type: string; tool_use_id: string }[];
    expect(toolResultTurn[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
  });

  it("self-correction: a rejected proposal doesn't touch the page; the model retries and succeeds", async () => {
    const { site, page, conv } = await seedConvo(`loop-selfcorrect-${runId}`);

    const badOp = { op: "insert_block", block: { type: "not-a-real-block", props: {} }, place: "end" };
    const goodOp = { op: "update_block", id: "b1", props: { html: "<p>After</p>" } };

    const { client } = makeFakeClient([
      cannedMessage({
        content: [toolUseBlock("t1", "update_page", { page_id: page.id, ops: [badOp] })],
        stop_reason: "tool_use",
        usage: usage(100, 20),
      }),
      cannedMessage({
        content: [toolUseBlock("t2", "update_page", { page_id: page.id, ops: [goodOp] })],
        stop_reason: "tool_use",
        usage: usage(100, 20),
      }),
      cannedMessage({
        content: [textBlock("Fixed it.")],
        stop_reason: "end_turn",
        usage: usage(50, 10),
      }),
    ]);

    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id, env: API_ENV, client,
    });

    expect(result).toEqual({ reason: "end_turn", toolCalls: 2 });

    const msgs = await listMessages(db.getPool(), conv.id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "tool", "assistant"]);
    const firstToolMsg = msgs[2].content as { is_error?: boolean }[];
    expect(firstToolMsg[0].is_error).toBe(true);
    const secondToolMsg = msgs[4].content as { is_error?: boolean }[];
    expect(secondToolMsg[0].is_error).toBeFalsy();

    const pageRow = await db.getPool().query(`SELECT blocks FROM pages WHERE id = $1`, [page.id]);
    const blocks = pageRow.rows[0].blocks as { props: { html: string } }[];
    expect(blocks[0].props.html).toBe("<p>After</p>");

    // The rejected proposal (badOp) never reaches the transaction, so it
    // produced no revision at all. The successful attempt produces TWO:
    // since this page (seeded directly via db.seedPage) had no revision yet,
    // update_page's Critical 1 fix (tools/pages.ts) synthesizes a pre-write
    // snapshot of the page's original blocks before writing the after-state
    // revision — so `change.revision_id` is a genuine "before" to restore
    // to, not the after-state update_page just created.
    const revRows = await db.getPool().query<{ blocks: { props: { html: string } }[] }>(
      `SELECT blocks FROM page_revisions WHERE page_id = $1 ORDER BY created_at ASC`,
      [page.id],
    );
    expect(revRows.rowCount).toBe(2);
    expect(revRows.rows[0].blocks[0].props.html).toBe("<p>Before</p>");
    expect(revRows.rows[1].blocks[0].props.html).toBe("<p>After</p>");
  });

  it("failure streak: the same tool failing 3x in a row stops the turn with status error", async () => {
    const { site, page, conv } = await seedConvo(`loop-streak-${runId}`);
    const badOp = { op: "insert_block", block: { type: "not-a-real-block", props: {} }, place: "end" };

    const { client, create } = makeFakeClient([
      cannedMessage({
        content: [toolUseBlock("a1", "update_page", { page_id: page.id, ops: [badOp] })],
        stop_reason: "tool_use", usage: usage(10, 5),
      }),
      cannedMessage({
        content: [toolUseBlock("a2", "update_page", { page_id: page.id, ops: [badOp] })],
        stop_reason: "tool_use", usage: usage(10, 5),
      }),
      cannedMessage({
        content: [toolUseBlock("a3", "update_page", { page_id: page.id, ops: [badOp] })],
        stop_reason: "tool_use", usage: usage(10, 5),
      }),
    ]);

    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id, env: API_ENV, client,
    });

    expect(create).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ reason: "error", toolCalls: 3 });

    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("error");

    const msgs = await listMessages(db.getPool(), conv.id);
    // user, then 3x(assistant tool_use + tool result), then a final assistant explanation.
    expect(msgs.map((m) => m.role)).toEqual([
      "user", "assistant", "tool", "assistant", "tool", "assistant", "tool", "assistant",
    ]);
  });

  it("promotion: an already-expired deadline stops mid-turn without persisting anything extra", async () => {
    const { site, page, conv } = await seedConvo(`loop-promote-${runId}`);

    const { client, create } = makeFakeClient([
      cannedMessage({
        content: [toolUseBlock("p1", "update_page", {
          page_id: page.id,
          ops: [{ op: "update_block", id: "b1", props: { html: "<p>After</p>" } }],
        })],
        stop_reason: "tool_use", usage: usage(10, 5),
      }),
    ]);

    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id, env: API_ENV, client,
      limits: { deadlineMs: 0 },
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ reason: "promoted", toolCalls: 1 });

    const msgs = await listMessages(db.getPool(), conv.id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
  });

  it("budget: usage already at the daily cap short-circuits before any model call", async () => {
    const { site, conv } = await seedConvo(`loop-budget-${runId}`);
    await addTokenUsage(db.getPool(), conv.id, { input: 900_000, output: 200_000 });

    const { client, create } = makeFakeClient([]);
    const events: AgentTurnEvent[] = [];
    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id, env: API_ENV, client,
      onEvent: (e) => events.push(e),
    });

    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({ reason: "budget", toolCalls: 0 });
    expect(events.map((e) => e.type)).toEqual(["assistant_text", "turn_done"]);
    expect(events[1]).toEqual({
      type: "turn_done",
      reason: "budget",
      message: "Daily token budget for this conversation is exhausted — try again tomorrow or raise AI_AGENT_TOKEN_BUDGET.",
    });

    const msgs = await listMessages(db.getPool(), conv.id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("stub: with no ANTHROPIC_API_KEY, an empty site gets a real starter home page", async () => {
    const site = await db.seedSite(`loop-stub-empty-${runId}`);
    const conv = await createConversation(db.getPool(), site.id, "t");
    await appendMessage(db.getPool(), conv.id, "user", [{ type: "text", text: "Build my site" }]);

    const events: AgentTurnEvent[] = [];
    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id, env: {} as NodeJS.ProcessEnv,
      onEvent: (e) => events.push(e),
    });

    expect(result).toEqual({ reason: "end_turn", toolCalls: 1 });

    const pages = await db.getPool().query(`SELECT slug, blocks FROM pages WHERE site_id = $1`, [site.id]);
    expect(pages.rowCount).toBe(1);
    expect(pages.rows[0].slug).toBe("home");
    const blocks = pages.rows[0].blocks as { type: string }[];
    expect(blocks.map((b) => b.type)).toEqual(["hero", "rich-text"]);

    const msgs = await listMessages(db.getPool(), conv.id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    const toolUseMsg = msgs[1].content as { type: string; id: string; name: string }[];
    expect(toolUseMsg[0]).toMatchObject({ type: "tool_use", id: "toolu_stub_1", name: "create_page" });
    const toolResultMsg = msgs[2].content as { type: string; tool_use_id: string }[];
    expect(toolResultMsg[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_stub_1" });

    expect(events.map((e) => e.type)).toEqual(["tool_call", "tool_result", "assistant_text", "turn_done"]);
  });

  it("stub: a site that already has pages makes no changes", async () => {
    const site = await db.seedSite(`loop-stub-nonempty-${runId}`);
    await db.seedPage(site.id, "home", [{ id: "b1", type: "rich-text", props: { html: "<p>Hi</p>" } }]);
    const conv = await createConversation(db.getPool(), site.id, "t");
    await appendMessage(db.getPool(), conv.id, "user", [{ type: "text", text: "Build my site" }]);

    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id, env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toEqual({ reason: "end_turn", toolCalls: 0 });
    const pages = await db.getPool().query(`SELECT COUNT(*)::int AS count FROM pages WHERE site_id = $1`, [site.id]);
    expect(pages.rows[0].count).toBe(1);
  });

  it("rebuilds the model context by trimming on the DB role, not the mapped API role, once history exceeds the 40-message window", async () => {
    const site = await db.seedSite(`loop-trim-${runId}`);
    await db.seedPage(site.id, "home", [{ id: "b1", type: "rich-text", props: { html: "<p>Hi</p>" } }]);
    const conv = await createConversation(db.getPool(), site.id, "t");

    // An old, now-irrelevant user turn, followed by 45 role-'tool' rows (junk
    // — never a real assistant/tool_use pairing), then the real, current user
    // turn. Total = 47 rows; the last-40 window starts inside the junk `tool`
    // block. A buggy trim that maps tool -> user BEFORE finding the first
    // "user" row would stop at the junk block's first row (now mis-mapped to
    // "user") and hand the model 40 messages starting on bare tool_result
    // content with no matching tool_use — this asserts the fix instead finds
    // the one genuine `user` row and starts there.
    await appendMessage(db.getPool(), conv.id, "user", [{ type: "text", text: "old request" }]);
    for (let i = 0; i < 45; i++) {
      await appendMessage(db.getPool(), conv.id, "tool", [
        { type: "tool_result", tool_use_id: `junk-${i}`, content: "junk" },
      ]);
    }
    await appendMessage(db.getPool(), conv.id, "user", [{ type: "text", text: "real request" }]);

    const { client, create } = makeFakeClient([
      cannedMessage({ content: [textBlock("ok")], stop_reason: "end_turn", usage: usage(10, 5) }),
    ]);

    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id, env: API_ENV, client,
    });

    expect(result).toEqual({ reason: "end_turn", toolCalls: 0 });
    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0][0] as { messages: { role: string; content: unknown }[] };
    expect(payload.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "real request" }] },
    ]);
  });

  it("widens past the 40-row window to the last user row when a long (job-path-shaped) turn pushes it out", async () => {
    const site = await db.seedSite(`loop-widen-${runId}`);
    await db.seedPage(site.id, "home", [{ id: "b1", type: "rich-text", props: { html: "<p>Hi</p>" } }]);
    const conv = await createConversation(db.getPool(), site.id, "t");

    // Shaped like the job path mid-turn: one user row, then 25 assistant/tool
    // pairs (50 rows) already accumulated by earlier iterations of THIS turn
    // (maxToolCalls=30 can persist up to 1 + 2*30 = 61 rows in one turn). The
    // trailing 40-row window (rows 11-60 here) contains zero DB `user` rows,
    // so the naive/round-1-fixed trim would return `[]` -> an empty/invalid
    // `messages` array -> the API 400s. This asserts the widen path instead
    // finds the sole user row and sends the full history starting there.
    await appendMessage(db.getPool(), conv.id, "user", [{ type: "text", text: "build the whole site" }]);
    for (let i = 0; i < 25; i++) {
      await appendMessage(db.getPool(), conv.id, "assistant", [
        { type: "tool_use", id: `w${i}`, name: "get_site_overview", input: {} },
      ]);
      await appendMessage(db.getPool(), conv.id, "tool", [
        { type: "tool_result", tool_use_id: `w${i}`, content: "ok" },
      ]);
    }

    const { client, create } = makeFakeClient([
      cannedMessage({ content: [textBlock("done")], stop_reason: "end_turn", usage: usage(10, 5) }),
    ]);

    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id, env: API_ENV, client,
    });

    expect(result).toEqual({ reason: "end_turn", toolCalls: 0 });
    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0][0] as { messages: { role: string; content: unknown }[] };
    expect(payload.messages.length).toBeGreaterThan(0);
    expect(payload.messages[0]).toEqual({
      role: "user", content: [{ type: "text", text: "build the whole site" }],
    });
    expect(payload.messages).toHaveLength(51); // 1 user + 25*(assistant, tool)
  });

  it("reports a turn error instead of calling the API when a conversation has no user row at all", async () => {
    const site = await db.seedSite(`loop-nouser-${runId}`);
    const conv = await createConversation(db.getPool(), site.id, "t");
    // Deliberately malformed: no user row has ever been persisted.
    await appendMessage(db.getPool(), conv.id, "assistant", [{ type: "text", text: "orphaned" }]);

    const { client, create } = makeFakeClient([]);
    const events: AgentTurnEvent[] = [];
    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id, env: API_ENV, client,
      onEvent: (e) => events.push(e),
    });

    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({ reason: "error", toolCalls: 0 });
    expect(events).toEqual([
      { type: "turn_done", reason: "error", message: "conversation has no user message" },
    ]);
  });
});
