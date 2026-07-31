import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { setupAgentDb } from "../../../../tests/helpers/agent-db.js";
import {
  createConversation, appendMessage, listMessages, addTokenUsage, getConversation, getTodayUsage,
  requestConversationStop,
} from "./repo.js";
import {
  runAgentTurn, parsePositiveIntEnv, describeAnthropicError, AGENT_SYSTEM_INTRO,
  type AgentTurnEvent, type AgentTurnResult,
} from "./loop.js";

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

// W1.5 / D1100 — structural invariants of the design-playbook system prompt.
// Deliberately NOT full-string matching: the prompt is prose that will be
// tuned; these assert only the load-bearing directives survive a rewording.
// Ungated (no DB needed).
describe("AGENT_SYSTEM_INTRO design playbook (D1100)", () => {
  it("orders brand tokens BEFORE page creation in the from-scratch flow", () => {
    const tokensIdx = AGENT_SYSTEM_INTRO.indexOf("set_brand_tokens BEFORE creating any page");
    expect(tokensIdx).toBeGreaterThan(-1);
  });

  it("names the token pairs the palette must cover", () => {
    for (const token of ["--theme-main", "--theme-accent", "--theme-surface", "--theme-muted"]) {
      expect(AGENT_SYSTEM_INTRO).toContain(token);
    }
  });

  it("mandates per-page nav-bar + rich-footer chrome", () => {
    expect(AGENT_SYSTEM_INTRO).toMatch(/nav-bar/);
    expect(AGENT_SYSTEM_INTRO).toMatch(/rich-footer/);
    expect(AGENT_SYSTEM_INTRO).toMatch(/identical across all pages/i);
  });

  it("mandates the image strategy: search + import for every image slot, never empty", () => {
    expect(AGENT_SYSTEM_INTRO).toContain("search_stock_images");
    expect(AGENT_SYSTEM_INTRO).toContain("import_image");
    expect(AGENT_SYSTEM_INTRO).toMatch(/never leave an image slot empty/i);
  });

  it("sets a copy-depth bar (no lorem, no generic filler) and section-count guidance", () => {
    expect(AGENT_SYSTEM_INTRO).toMatch(/no lorem ipsum/i);
    expect(AGENT_SYSTEM_INTRO).toMatch(/filler/i);
    expect(AGENT_SYSTEM_INTRO).toMatch(/4-7/);
  });

  it("requires a first-turn site-spec enrichment step and an SEO pass at the end", () => {
    expect(AGENT_SYSTEM_INTRO).toMatch(/site spec/i);
    expect(AGENT_SYSTEM_INTRO).toContain("set_seo_defaults");
    expect(AGENT_SYSTEM_INTRO).toContain("set_page_seo");
  });

  it("keeps adapt-don't-rebuild for pre-applied templates", () => {
    expect(AGENT_SYSTEM_INTRO).toMatch(/adapt/i);
    expect(AGENT_SYSTEM_INTRO).toMatch(/never delete-and-rebuild/i);
  });
});

// Bot-review fix wave, item 4 (CodeRabbit ×2 — env parsing). Ungated (no DB
// needed) — pure-function coverage, mirrors ai-agent-routes.test.ts's
// ungated sseSend describe block.
describe("parsePositiveIntEnv (item 4)", () => {
  it("falls back on undefined and on an empty/whitespace string", () => {
    expect(parsePositiveIntEnv(undefined, 30)).toBe(30);
    expect(parsePositiveIntEnv("", 30)).toBe(30);
    expect(parsePositiveIntEnv("   ", 30)).toBe(30);
  });

  it("falls back on a non-numeric string instead of NaN", () => {
    expect(parsePositiveIntEnv("thirty", 30)).toBe(30);
  });

  it("falls back on zero, negative, and non-integer values", () => {
    expect(parsePositiveIntEnv("0", 30)).toBe(30);
    expect(parsePositiveIntEnv("-5", 30)).toBe(30);
    expect(parsePositiveIntEnv("3.5", 30)).toBe(30);
    expect(parsePositiveIntEnv("Infinity", 30)).toBe(30);
  });

  it("accepts a valid positive integer string", () => {
    expect(parsePositiveIntEnv("15", 30)).toBe(15);
    expect(parsePositiveIntEnv("1000000", 30)).toBe(1_000_000);
  });
});

// Task A4 (Lovable-workspace plan). Ungated (no DB needed) — pure-function
// coverage, mirrors parsePositiveIntEnv's describe block above.
describe("describeAnthropicError (Task A4)", () => {
  it("maps 401/403 to an API-key-rejected label", () => {
    expect(describeAnthropicError({ status: 401, message: "invalid x-api-key" })).toBe(
      "Anthropic API key rejected",
    );
    expect(describeAnthropicError({ status: 403, message: "forbidden" })).toBe("Anthropic API key rejected");
  });

  it("maps a 400 whose message mentions billing/credit to a top-up label", () => {
    expect(
      describeAnthropicError({
        status: 400,
        message: "Your credit balance is too low to access the Anthropic API",
      }),
    ).toBe("Anthropic credit balance too low — top up at console.anthropic.com");
    expect(describeAnthropicError({ status: 400, message: "billing issue on this account" })).toBe(
      "Anthropic credit balance too low — top up at console.anthropic.com",
    );
  });

  it("leaves an unrelated 400 as the generic fallback message", () => {
    expect(describeAnthropicError({ status: 400, message: "max_tokens is too large for this model" })).toBe(
      "The site agent hit an unexpected error and stopped.",
    );
  });

  it("maps 429 to a rate-limit label", () => {
    expect(describeAnthropicError({ status: 429, message: "rate limited" })).toBe(
      "Anthropic is rate-limiting — retry shortly",
    );
  });

  it("maps 529 (or any status with an 'overloaded' message) to an overload label", () => {
    expect(describeAnthropicError({ status: 529, message: "overloaded_error" })).toBe(
      "Anthropic is overloaded — retry shortly",
    );
    expect(describeAnthropicError({ status: 500, message: "Overloaded" })).toBe(
      "Anthropic is overloaded — retry shortly",
    );
  });

  it("falls back to a generic message for anything else, including non-SDK errors", () => {
    expect(describeAnthropicError(new Error("boom"))).toBe("The site agent hit an unexpected error and stopped.");
    expect(describeAnthropicError("not an error object")).toBe(
      "The site agent hit an unexpected error and stopped.",
    );
    expect(describeAnthropicError(undefined)).toBe("The site agent hit an unexpected error and stopped.");
  });
});

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

  // ── W1.4 / D1101: transient Anthropic errors retry before going terminal ──

  it("D1101: a 429 blip is retried with backoff and the turn completes — no human Resume needed", async () => {
    const { site, conv } = await seedConvo(`loop-retry-429-${runId}`);

    const create = vi.fn()
      .mockRejectedValueOnce({ status: 429, message: "rate limited" })
      .mockRejectedValueOnce({ status: 529, message: "overloaded_error" })
      .mockResolvedValueOnce(cannedMessage({
        content: [textBlock("Done.")], stop_reason: "end_turn", usage: usage(10, 5),
      }));
    const client = { messages: { create } } as unknown as Anthropic;

    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id,
      env: { ...API_ENV, AI_AGENT_RETRY_BASE_MS: "1" } as NodeJS.ProcessEnv, client,
    });

    expect(result.endReason).toBe("completed");
    expect(create).toHaveBeenCalledTimes(3);

    // The retries were silent — no error text persisted, no error status.
    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("active"); // untouched by the loop
    const msgs = await listMessages(db.getPool(), conv.id);
    expect(JSON.stringify(msgs.map((m) => m.content))).not.toMatch(/rate-limiting|overloaded/i);
  });

  it("D1101: a persistent overload goes terminal AFTER the bounded attempts, with the existing label persisted", async () => {
    const { site, conv } = await seedConvo(`loop-retry-exhausted-${runId}`);

    const create = vi.fn().mockRejectedValue({ status: 529, message: "overloaded_error" });
    const client = { messages: { create } } as unknown as Anthropic;

    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id,
      env: { ...API_ENV, AI_AGENT_RETRY_BASE_MS: "1" } as NodeJS.ProcessEnv, client,
    });

    expect(result.endReason).toBe("error");
    expect(create).toHaveBeenCalledTimes(3);

    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("error");
    const msgs = await listMessages(db.getPool(), conv.id);
    expect(JSON.stringify(msgs[msgs.length - 1].content)).toMatch(/overloaded — retry shortly/i);
  });

  it("D1101: a non-retryable error (401) is terminal immediately — exactly one attempt", async () => {
    const { site, conv } = await seedConvo(`loop-retry-nonretryable-${runId}`);

    const create = vi.fn().mockRejectedValue({ status: 401, message: "invalid x-api-key" });
    const client = { messages: { create } } as unknown as Anthropic;

    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id,
      env: { ...API_ENV, AI_AGENT_RETRY_BASE_MS: "1" } as NodeJS.ProcessEnv, client,
    });

    expect(result.endReason).toBe("error");
    expect(create).toHaveBeenCalledTimes(1);
    const msgs = await listMessages(db.getPool(), conv.id);
    expect(JSON.stringify(msgs[msgs.length - 1].content)).toMatch(/API key rejected/i);
  });

  // ── W1.4 / D1102: stop_reason 'max_tokens' must not masquerade as completed ──

  it("D1102: a text response truncated by max_tokens ends 'tool_limit' (auto-continue) with an honest cut-short note, never 'completed'", async () => {
    const { site, conv } = await seedConvo(`loop-maxtokens-text-${runId}`);

    const { client } = makeFakeClient([
      cannedMessage({
        content: [textBlock("Here is the plan, which gets chopped mid-sen")],
        stop_reason: "max_tokens",
        usage: usage(100, 8192),
      }),
    ]);

    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id, env: API_ENV, client,
    });

    expect(result.endReason).toBe("tool_limit"); // handleAgentTurn auto-continues this
    const msgs = await listMessages(db.getPool(), conv.id);
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe("system");
    expect(JSON.stringify(last.content)).toMatch(/cut short/i);
    expect(JSON.stringify(last.content)).toMatch(/continuing/i);
  });

  it("D1102: max_tokens WITH complete tool_use blocks executes them and keeps looping (truncation hit after the calls)", async () => {
    const { site, conv } = await seedConvo(`loop-maxtokens-tools-${runId}`);

    const { client, create } = makeFakeClient([
      cannedMessage({
        content: [toolUseBlock("t1", "get_site_overview", {})],
        stop_reason: "max_tokens",
        usage: usage(100, 8192),
      }),
      cannedMessage({
        content: [textBlock("All done.")], stop_reason: "end_turn", usage: usage(50, 10),
      }),
    ]);

    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id, env: API_ENV, client,
    });

    expect(result).toEqual({ endReason: "completed", toolCalls: 1 });
    expect(create).toHaveBeenCalledTimes(2);
    const msgs = await listMessages(db.getPool(), conv.id);
    // user, assistant(tool_use), tool(result), assistant(done) — the
    // tool_use got its matching result, so history stayed API-valid.
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
  });

  // ── W1.4 / D300+D1105+D612: real Stop — the loop honors cancel_requested ──

  it("W1.4 Stop: a cancel requested before the first model call ends the turn 'stopped' without calling the API", async () => {
    const { site, conv } = await seedConvo(`loop-stop-pre-${runId}`);
    await db.getPool().query(
      `UPDATE ai_conversations SET status = 'running', cancel_requested = true WHERE id = $1`,
      [conv.id],
    );

    const { client, create } = makeFakeClient([]);
    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id, env: API_ENV, client,
    });

    expect(result.endReason).toBe("stopped");
    expect(create).not.toHaveBeenCalled();

    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("stopped");
    const msgs = await listMessages(db.getPool(), conv.id);
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe("system");
    expect(JSON.stringify(last.content)).toMatch(/stopped by you/i);
  });

  it("W1.4 Stop: a cancel arriving mid-turn halts before the next tool executes; pending tool_use blocks get error results so history stays API-valid", async () => {
    const { site, page, conv } = await seedConvo(`loop-stop-mid-${runId}`);
    await db.getPool().query(`UPDATE ai_conversations SET status = 'running' WHERE id = $1`, [conv.id]);

    // The Stop click lands WHILE the model call is in flight: the fake
    // client sets the flag as a side effect of answering, then asks for a
    // 2-tool batch — neither tool may run.
    const create = vi.fn(async () => {
      await requestConversationStop(db.getPool(), conv.id);
      return cannedMessage({
        content: [
          toolUseBlock("t1", "update_page", {
            page_id: page.id,
            ops: [{ op: "update_block", id: "b1", props: { html: "<p>Should never land</p>" } }],
          }),
          toolUseBlock("t2", "get_site_overview", {}),
        ],
        stop_reason: "tool_use",
        usage: usage(100, 20),
      });
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id, env: API_ENV, client,
    });

    expect(result).toEqual({ endReason: "stopped", toolCalls: 0 });
    expect(create).toHaveBeenCalledTimes(1);

    // The page was NOT mutated — the cancel beat the tool execution.
    const pageRow = await db.getPool().query(`SELECT blocks FROM pages WHERE id = $1`, [page.id]);
    expect(JSON.stringify(pageRow.rows[0].blocks)).not.toContain("Should never land");

    // Every pending tool_use got a matching is_error tool_result (the API
    // requires one per tool_use), then the honest stopped note landed.
    const msgs = await listMessages(db.getPool(), conv.id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "tool", "system"]);
    const toolMsg = msgs[2].content as { tool_use_id: string; is_error?: boolean }[];
    expect(toolMsg.map((b) => b.tool_use_id)).toEqual(["t1", "t2"]);
    expect(toolMsg.every((b) => b.is_error === true)).toBe(true);
    expect(JSON.stringify(msgs[3].content)).toMatch(/stopped by you/i);

    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("stopped");
  });

  it("W1.4/D601: role-'system' transcript rows are never replayed into the model context", async () => {
    const { site, conv } = await seedConvo(`loop-system-filter-${runId}`);
    // A reconciler note lands between two user turns — the model must never
    // see it (the API has no 'system' message role; it's a UI-only row).
    await appendMessage(db.getPool(), conv.id, "system", [
      { type: "text", text: "Build was interrupted — press Resume to continue." },
    ]);
    await appendMessage(db.getPool(), conv.id, "user", [{ type: "text", text: "resume please" }]);

    const { client, create } = makeFakeClient([
      cannedMessage({ content: [textBlock("ok")], stop_reason: "end_turn", usage: usage(10, 5) }),
    ]);

    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id, env: API_ENV, client,
    });
    expect(result.endReason).toBe("completed");

    const params = create.mock.calls[0][0] as { messages: { role: string }[] };
    expect(params.messages.length).toBeGreaterThan(0);
    expect(params.messages.every((m) => m.role === "user" || m.role === "assistant")).toBe(true);
    expect(JSON.stringify(params.messages)).not.toMatch(/interrupted/i);
  });

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
    // Type-level check (Task A1): the resolved value is the exported
    // `AgentTurnResult`, not an untyped/void return.
    const result: AgentTurnResult = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id,
      env: API_ENV, client, onEvent: (e) => events.push(e),
    });

    expect(create).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ endReason: "completed", toolCalls: 2 });

    const msgs = await listMessages(db.getPool(), conv.id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "tool", "assistant"]);

    const pageRow = await db.getPool().query(`SELECT blocks FROM pages WHERE id = $1`, [page.id]);
    const blocks = pageRow.rows[0].blocks as { id: string; props: { html: string } }[];
    expect(blocks[0].props.html).toBe("<p>After</p>");

    const revRows = await db.getPool().query(`SELECT source FROM page_revisions WHERE page_id = $1`, [page.id]);
    expect(revRows.rowCount).toBeGreaterThan(0);
    // Round 2 fix (Important 2b): this page (seeded directly, no prior
    // revision) gets a synthesized 'ai-snapshot' pre-write row in addition
    // to the real 'ai' after-write row (Critical 1's snapshot branch) — both
    // are AI-sourced, just distinguished for the revisions panel.
    expect(revRows.rows.every((r) => r.source === "ai" || r.source === "ai-snapshot")).toBe(true);

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

    expect(result).toEqual({ endReason: "completed", toolCalls: 2 });

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
    //
    // Round 2 fix (Important 2a): `ORDER BY created_at ASC` is now
    // genuinely deterministic — both inserts use `clock_timestamp()`
    // (strictly increasing per statement) instead of the transaction-constant
    // `now()`, so the snapshot row is guaranteed to sort before the
    // after-write row.
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
    expect(result).toEqual({ endReason: "error", toolCalls: 3 });

    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("error");

    const msgs = await listMessages(db.getPool(), conv.id);
    // user, then 3x(assistant tool_use + tool result), then a final assistant explanation.
    expect(msgs.map((m) => m.role)).toEqual([
      "user", "assistant", "tool", "assistant", "tool", "assistant", "tool", "assistant",
    ]);
  });

  it("batched tool cap (item 5): 3 tool_use blocks in one message against a remaining allowance of 1 — only the first runs, the rest are skipped with is_error tool_results, turn ends max_tools", async () => {
    const { site, page, conv } = await seedConvo(`loop-batchcap-${runId}`);

    const { client, create } = makeFakeClient([
      cannedMessage({
        content: [
          toolUseBlock("b1", "update_page", {
            page_id: page.id,
            ops: [{ op: "update_block", id: "b1", props: { html: "<p>After</p>" } }],
          }),
          toolUseBlock("b2", "get_site_overview", {}),
          toolUseBlock("b3", "get_site_overview", {}),
        ],
        stop_reason: "tool_use",
        usage: usage(50, 20),
      }),
    ]);

    const events: AgentTurnEvent[] = [];
    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id, env: API_ENV, client,
      limits: { maxToolCalls: 1 }, onEvent: (e) => events.push(e),
    });

    // Only ONE tool actually ran — the model was only called once (no
    // follow-up round-trip needed to discover the cap; it's enforced
    // within this single batch), and only b1's write landed.
    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ endReason: "tool_limit", toolCalls: 1 });

    const pageRow = await db.getPool().query(`SELECT blocks FROM pages WHERE id = $1`, [page.id]);
    const blocks = pageRow.rows[0].blocks as { props: { html: string } }[];
    expect(blocks[0].props.html).toBe("<p>After</p>");

    // All three tool_use blocks got a matching tool_result in the SAME
    // persisted tool message (API requires one per tool_use), but only the
    // first is a real result — b2/b3 are is_error:true "limit reached".
    const msgs = await listMessages(db.getPool(), conv.id);
    const toolMsg = msgs.find((m) => m.role === "tool")!;
    const results = toolMsg.content as { tool_use_id: string; is_error?: boolean; content: string }[];
    expect(results.map((r) => r.tool_use_id)).toEqual(["b1", "b2", "b3"]);
    expect(results[0].is_error).toBeFalsy();
    expect(results[1]).toMatchObject({ is_error: true });
    expect(results[2]).toMatchObject({ is_error: true });
    expect(JSON.parse(results[1].content)).toEqual({ error: "tool call limit reached" });

    expect(events.map((e) => e.type)).toEqual([
      "tool_call", "tool_result", "tool_call", "tool_result", "tool_call", "tool_result",
      "assistant_text", "turn_done",
    ]);
    const skippedResultEvents = events.filter(
      (e): e is Extract<AgentTurnEvent, { type: "tool_result" }> => e.type === "tool_result",
    );
    expect(skippedResultEvents[1]).toMatchObject({ ok: false, summary: "tool call limit reached" });
    expect(skippedResultEvents[2]).toMatchObject({ ok: false, summary: "tool call limit reached" });
    expect(events[events.length - 1]).toMatchObject({ type: "turn_done", reason: "max_tools" });
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
    expect(result).toEqual({ endReason: "deadline", toolCalls: 1 });

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
    expect(result).toEqual({ endReason: "token_budget", toolCalls: 0 });
    expect(events.map((e) => e.type)).toEqual(["assistant_text", "turn_done"]);
    expect(events[1]).toEqual({
      type: "turn_done",
      reason: "budget",
      message: "Daily token budget for this conversation is exhausted — try again tomorrow or raise AI_AGENT_TOKEN_BUDGET.",
    });

    const msgs = await listMessages(db.getPool(), conv.id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("budget: a malformed AI_AGENT_TOKEN_BUDGET falls back to the real default instead of NaN (never trips) or 0 (always trips)", async () => {
    const { site, conv } = await seedConvo(`loop-budget-badenv-${runId}`);
    // Usage sits exactly at the DEFAULT budget (1_000_000) — a NaN budget
    // (from `Number("not-a-number")`) would never compare `>=` true here and
    // the turn would proceed to call the model; a 0 budget (from
    // `Number("")`) would already have tripped on any usage at all. Only
    // the correct 1_000_000 fallback makes this exact boundary trip.
    await addTokenUsage(db.getPool(), conv.id, { input: 900_000, output: 100_000 });

    const { client, create } = makeFakeClient([]);
    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id,
      env: { ANTHROPIC_API_KEY: "test-key", AI_AGENT_TOKEN_BUDGET: "not-a-number" } as NodeJS.ProcessEnv,
      client,
    });

    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({ endReason: "token_budget", toolCalls: 0 });
  });

  it("max tool calls: an empty AI_AGENT_MAX_TOOL_CALLS falls back to the real default (30), not 0", async () => {
    const { site, page, conv } = await seedConvo(`loop-maxtools-badenv-${runId}`);
    // A 0 cap (from `Number("")`) would trip on the FIRST tool call — assert
    // the turn instead runs through to end_turn on a single tool call,
    // proving the effective cap is >= 1 (i.e. the real default, 30).
    const { client, create } = makeFakeClient([
      cannedMessage({
        content: [toolUseBlock("e1", "update_page", {
          page_id: page.id,
          ops: [{ op: "update_block", id: "b1", props: { html: "<p>After</p>" } }],
        })],
        stop_reason: "tool_use", usage: usage(10, 5),
      }),
      cannedMessage({ content: [textBlock("done")], stop_reason: "end_turn", usage: usage(10, 5) }),
    ]);

    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id,
      env: { ANTHROPIC_API_KEY: "test-key", AI_AGENT_MAX_TOOL_CALLS: "" } as NodeJS.ProcessEnv,
      client,
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ endReason: "completed", toolCalls: 1 });
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

    expect(result).toEqual({ endReason: "completed", toolCalls: 1 });

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

    expect(result).toEqual({ endReason: "completed", toolCalls: 0 });
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

    expect(result).toEqual({ endReason: "completed", toolCalls: 0 });
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

    expect(result).toEqual({ endReason: "completed", toolCalls: 0 });
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
    expect(result).toEqual({ endReason: "error", toolCalls: 0 });
    expect(events).toEqual([
      { type: "turn_done", reason: "error", message: "conversation has no user message" },
    ]);
  });

  // ── Task A4: Anthropic SDK errors surface a clear label, not a bare
  // status flip — see describeAnthropicError's own unit tests above for the
  // full mapping matrix; these confirm the loop actually wires it through
  // persistAssistantText + setConversationStatus + turn_done.

  it("Anthropic auth error (401): persists the API-key-rejected label, sets status error, ends the turn (Task A4)", async () => {
    const { site, conv } = await seedConvo(`loop-anthropic-401-${runId}`);
    const err = Object.assign(new Error("invalid x-api-key"), { status: 401 });
    const create = vi.fn().mockRejectedValueOnce(err);
    const client = { messages: { create } } as unknown as Anthropic;

    const events: AgentTurnEvent[] = [];
    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id, env: API_ENV, client,
      onEvent: (e) => events.push(e),
    });

    expect(result).toEqual({ endReason: "error", toolCalls: 0 });

    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("error");

    const msgs = await listMessages(db.getPool(), conv.id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect((msgs[1].content as { type: string; text: string }[])[0].text).toBe("Anthropic API key rejected");

    expect(events).toEqual([
      { type: "assistant_text", text: "Anthropic API key rejected" },
      { type: "turn_done", reason: "error", message: "Anthropic API key rejected" },
    ]);
  });

  it("Anthropic billing error (400 mentioning credit): persists the top-up label (Task A4)", async () => {
    const { site, conv } = await seedConvo(`loop-anthropic-billing-${runId}`);
    const err = Object.assign(new Error("Your credit balance is too low to access the Anthropic API"), {
      status: 400,
    });
    const create = vi.fn().mockRejectedValueOnce(err);
    const client = { messages: { create } } as unknown as Anthropic;

    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id, env: API_ENV, client,
    });

    expect(result).toEqual({ endReason: "error", toolCalls: 0 });
    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("error");

    const msgs = await listMessages(db.getPool(), conv.id);
    expect((msgs[1].content as { type: string; text: string }[])[0].text).toBe(
      "Anthropic credit balance too low — top up at console.anthropic.com",
    );
  });

  it("Anthropic rate-limit error (429): retried (D1101), then persists the retry-shortly label once attempts are exhausted (Task A4)", async () => {
    const { site, conv } = await seedConvo(`loop-anthropic-429-${runId}`);
    const err = Object.assign(new Error("rate limited"), { status: 429 });
    const create = vi.fn().mockRejectedValue(err); // persistent — every attempt fails
    const client = { messages: { create } } as unknown as Anthropic;

    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id,
      env: { ...API_ENV, AI_AGENT_RETRY_BASE_MS: "1" } as NodeJS.ProcessEnv, client,
    });

    expect(result).toEqual({ endReason: "error", toolCalls: 0 });
    expect(create).toHaveBeenCalledTimes(3); // D1101 — bounded in-loop retries first
    const msgs = await listMessages(db.getPool(), conv.id);
    expect((msgs[1].content as { type: string; text: string }[])[0].text).toBe(
      "Anthropic is rate-limiting — retry shortly",
    );
  });

  it("Anthropic overload error (529): retried (D1101), then persists the overloaded/retry label once attempts are exhausted (Task A4)", async () => {
    const { site, conv } = await seedConvo(`loop-anthropic-529-${runId}`);
    const err = Object.assign(new Error("Overloaded"), { status: 529 });
    const create = vi.fn().mockRejectedValue(err); // persistent — every attempt fails
    const client = { messages: { create } } as unknown as Anthropic;

    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id,
      env: { ...API_ENV, AI_AGENT_RETRY_BASE_MS: "1" } as NodeJS.ProcessEnv, client,
    });

    expect(result).toEqual({ endReason: "error", toolCalls: 0 });
    expect(create).toHaveBeenCalledTimes(3); // D1101 — bounded in-loop retries first
    const msgs = await listMessages(db.getPool(), conv.id);
    expect((msgs[1].content as { type: string; text: string }[])[0].text).toBe(
      "Anthropic is overloaded — retry shortly",
    );
  });

  it("other Anthropic errors: persists the generic fallback label rather than crashing the turn (Task A4)", async () => {
    const { site, conv } = await seedConvo(`loop-anthropic-other-${runId}`);
    const err = Object.assign(new Error("something else broke"), { status: 500 });
    const create = vi.fn().mockRejectedValueOnce(err);
    const client = { messages: { create } } as unknown as Anthropic;

    const result = await runAgentTurn({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id, env: API_ENV, client,
    });

    expect(result).toEqual({ endReason: "error", toolCalls: 0 });
    const msgs = await listMessages(db.getPool(), conv.id);
    expect((msgs[1].content as { type: string; text: string }[])[0].text).toBe(
      "The site agent hit an unexpected error and stopped.",
    );
  });
});
