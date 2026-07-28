import type { Pool } from "pg";
import type Anthropic from "@anthropic-ai/sdk";
import { runMessage } from "../client.js";
import { resolveAiMode } from "../config.js";
import { buildBlockCatalog } from "../catalog.js";
import {
  getConversation, appendMessage, listMessages, setConversationStatus, addTokenUsage, getTodayUsage,
  type AiMessage,
} from "./repo.js";
import { buildAgentToolDefs, executeAgentTool } from "./tools/index.js";
import type { AgentChangeEvent, AgentToolCtx } from "./tools/types.js";
// Side-effect: register the static block types so the catalog + create_page's
// validateBlocks call see every registered block (mirrors catalog.ts:6 and
// tools/pages.ts:10).
import "../../../blocks/index.js";

/**
 * Multi-turn agent loop (Task 8 — see
 * docs/superpowers/specs/2026-07-27-ai-site-agent-design.md). Drives one
 * "turn" of the conversation: repeatedly calls the model, executes any tools
 * it asks for, and persists everything through the Task 1 repo, until the
 * model stops asking for tools or a cap (tool count / wall-clock deadline /
 * daily token budget / repeated tool failure) cuts the turn short.
 *
 * The caller persists the triggering user message BEFORE calling this — the
 * loop only ever reads that history back out via `listMessages` and appends
 * assistant/tool messages as it goes.
 */

export type TurnDoneReason = "end_turn" | "max_tools" | "budget" | "error" | "promoted";

export type AgentTurnEvent =
  | { type: "assistant_text"; text: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; name: string; ok: boolean; summary?: string; change?: AgentChangeEvent }
  | { type: "turn_done"; reason: TurnDoneReason; message?: string };

const AGENT_SYSTEM_INTRO = `You are the site agent for the AnchorCorps site builder. You work on exactly ONE site per conversation, using only the provided tools. Pages are ordered arrays of typed "blocks"; the catalog below lists the ONLY block types you may use and the JSON Schema each block's props must satisfy.

Rules:
- TEMPLATE-FIRST: for a new or empty site, call get_site_overview first, then prefer apply_site_template with a fitting site template and adapt the result, over building page-by-page from scratch.
- All work lands on DRAFT pages. You cannot publish, change domains, or configure plugins — the operator does that.
- Batch related edits: one update_page call with several ops beats several calls.
- When you import an image you MUST supply descriptive alt text, then place it with the image block using the returned asset_id and the same alt.
- Write real, specific copy for the business described — no lorem ipsum.
- If a tool result reports a validation failure, correct the input and retry; after repeated failures, stop and explain.
- Reference pages and blocks by their exact ids from tool results. Never invent ids or block types.
- When the work is done, summarize what you changed in one short paragraph.`;

/** Number of consecutive failures of the SAME tool that stops the turn. */
const FAILURE_STREAK_LIMIT = 3;

/**
 * Bot-review fix wave, item 4 (CodeRabbit ×2 — env parsing). `Number(env.X)`
 * on a raw env var turns `""` into `0` (not `NaN` — `Number("")` is `0`) and
 * turns `"thirty"` into `NaN`; both then flowed straight into the turn's
 * caps unchecked, silently making `maxToolCalls`/`tokenBudget` either 0
 * (the turn couldn't do anything) or `NaN` (every `>=`/`<=` comparison
 * against it is false, so the cap never trips). Exported for direct
 * unit-testing. Falls back to `fallback` unless the raw string parses to a
 * finite, whole, strictly-positive number.
 */
export function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

type ToolResultContent = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

function mapRowsToApiMessages(rows: AiMessage[]): Anthropic.MessageParam[] {
  const mapped = rows.map((m) => ({
    role: m.role === "tool" ? "user" : m.role,
    content: m.content,
  }));
  return mapped as unknown as Anthropic.MessageParam[];
}

/**
 * Rebuild the model-facing message list from persisted DB rows. DB roles map
 * 1:1 onto API roles except `tool`, whose `tool_result` blocks ride inside an
 * API `user`-role message (the Anthropic messages convention — there is no
 * `tool` role). Content is the raw stored content-block array, unmodified.
 * If the trailing `limit` window starts mid-conversation, the API requires
 * the first message to be `user`-role — drop whatever leads until it is.
 *
 * Trim on the DB role, BEFORE mapping tool -> user: a window that starts on a
 * `tool` row would otherwise map to "user" and survive the trim, handing the
 * API a user turn of bare tool_result blocks whose tool_use_id has no
 * matching tool_use in this truncated window (the assistant message that
 * issued it fell off the front) — a guaranteed 400 from the API.
 *
 * A single turn can persist up to `1 + 2*maxToolCalls` rows (one user row,
 * then an assistant+tool pair per tool call — up to 61 rows at the job path's
 * default maxToolCalls of 30), which can push the triggering user row out of
 * a fixed 40-row tail entirely. When that trailing window has no DB `user`
 * row at all, widen to the full (turn-bounded, not unbounded — conversations
 * don't run forever) history and slice from the LAST user row onward: that
 * row is what started the current turn, and only its own assistant/tool
 * exchange has accumulated since. Returns `null` if the conversation
 * genuinely has no user row anywhere (caller reports this as a turn error
 * instead of sending the API an empty/invalid `messages` array).
 */
async function buildApiMessages(
  pool: Pool, conversationId: string,
): Promise<Anthropic.MessageParam[] | null> {
  const rows = await listMessages(pool, conversationId, { limit: 40 });
  const windowUserIdx = rows.findIndex((m) => m.role === "user");
  if (windowUserIdx !== -1) {
    return mapRowsToApiMessages(rows.slice(windowUserIdx));
  }

  const allRows = await listMessages(pool, conversationId);
  let lastUserIdx = -1;
  for (let i = allRows.length - 1; i >= 0; i--) {
    if (allRows[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return null;
  return mapRowsToApiMessages(allRows.slice(lastUserIdx));
}

async function persistAssistantText(
  pool: Pool, conversationId: string, text: string, onEvent: (e: AgentTurnEvent) => void,
): Promise<void> {
  await appendMessage(pool, conversationId, "assistant", [{ type: "text", text }]);
  onEvent({ type: "assistant_text", text });
}

/**
 * Deterministic, zero-spend script for stub/dry-run mode. Exercises the REAL
 * tool path (create_page goes through the same validation + revision +
 * transaction guardrails as a live model call would) so the mode is a
 * faithful smoke test, not a mock.
 */
async function runStubTurn(params: {
  pool: Pool;
  siteId: string;
  conversationId: string;
  toolCtx: AgentToolCtx;
  onEvent: (e: AgentTurnEvent) => void;
}): Promise<{ reason: TurnDoneReason; toolCalls: number }> {
  const { pool, siteId, conversationId, toolCtx, onEvent } = params;

  const pageCount = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM pages WHERE site_id = $1`, [siteId],
  );
  const hasPages = pageCount.rows[0].count > 0;

  if (!hasPages) {
    const createInput = {
      slug: "home",
      title: "Home",
      blocks: [
        {
          type: "hero",
          props: {
            eyebrow: "Welcome",
            title: "Your new site, drafted by AI",
            subtitle: "This starter page was generated automatically — ask the agent to customize it.",
            cta_label: "Get Started",
            cta_href: "#",
            align: "center",
          },
        },
        {
          type: "rich-text",
          props: { html: "<p>[AI agent stub] Set ANTHROPIC_API_KEY for live builds.</p>" },
        },
      ],
    };

    const result = await executeAgentTool(toolCtx, "create_page", createInput);

    await appendMessage(pool, conversationId, "assistant", [
      { type: "tool_use", id: "toolu_stub_1", name: "create_page", input: createInput },
    ]);
    await appendMessage(pool, conversationId, "tool", [
      {
        type: "tool_result",
        tool_use_id: "toolu_stub_1",
        content: JSON.stringify(result.ok ? result.data : { error: result.error, details: result.details }),
        is_error: !result.ok,
      },
    ]);
    onEvent({ type: "tool_call", name: "create_page", input: createInput });
    onEvent({
      type: "tool_result",
      name: "create_page",
      ok: result.ok,
      summary: result.ok ? result.summary : undefined,
      change: result.ok ? result.change : undefined,
    });

    if (!result.ok) {
      // Don't claim success on a failed stub write — this can only really
      // happen if the fixed starter blocks somehow fail validation, but if it
      // does, the turn should report the failure, not a cheerful lie.
      const text = `Stub mode: failed to create the starter Home page (${result.error}).`;
      await persistAssistantText(pool, conversationId, text, onEvent);
      await setConversationStatus(pool, conversationId, "error");
      onEvent({ type: "turn_done", reason: "error", message: text });
      return { reason: "error", toolCalls: 1 };
    }

    await persistAssistantText(pool, conversationId, "Stub mode: created a starter Home page.", onEvent);
    onEvent({ type: "turn_done", reason: "end_turn" });
    return { reason: "end_turn", toolCalls: 1 };
  }

  await persistAssistantText(
    pool, conversationId, "Stub mode: no changes made — site already has pages.", onEvent,
  );
  onEvent({ type: "turn_done", reason: "end_turn" });
  return { reason: "end_turn", toolCalls: 0 };
}

export async function runAgentTurn(input: {
  pool: Pool;
  conversationId: string;
  siteId: string;
  env?: NodeJS.ProcessEnv;
  client?: Anthropic; // injected mock in tests
  onEvent?: (e: AgentTurnEvent) => void;
  limits?: { maxToolCalls?: number; deadlineMs?: number }; // route passes {15, 45_000}; job passes {}
  genId?: () => string;
}): Promise<{ reason: TurnDoneReason; toolCalls: number }> {
  const { pool, conversationId, siteId } = input;
  const env = input.env ?? process.env;
  const onEvent = input.onEvent ?? (() => undefined);
  const maxToolCalls =
    input.limits?.maxToolCalls ?? parsePositiveIntEnv(env.AI_AGENT_MAX_TOOL_CALLS, 30);
  // `deadlineMs` may legitimately be 0 (route/tests forcing immediate
  // promotion) — a truthy check would treat 0 the same as "no deadline",
  // which is wrong, so this checks presence, not truthiness.
  const deadline = input.limits?.deadlineMs != null ? Date.now() + input.limits.deadlineMs : null;
  const tokenBudget = parsePositiveIntEnv(env.AI_AGENT_TOKEN_BUDGET, 1_000_000);

  const toolCtx: AgentToolCtx = { pool, siteId, conversationId, env, genId: input.genId };

  if (resolveAiMode(env) !== "api") {
    return runStubTurn({ pool, siteId, conversationId, toolCtx, onEvent });
  }

  const system = [
    {
      type: "text" as const,
      text: `${AGENT_SYSTEM_INTRO}\n\n--- BLOCK CATALOG ---\n${JSON.stringify(buildBlockCatalog())}`,
      cache_control: { type: "ephemeral" as const },
    },
  ];
  const tools = buildAgentToolDefs();

  let toolCalls = 0;
  // Consecutive ok:false count per tool name; a success resets that tool's
  // own counter (a different tool succeeding shouldn't excuse one that's
  // genuinely stuck retrying the same mistake).
  const failureStreak = new Map<string, number>();

  for (;;) {
    // Budget gate — runs before EVERY model call, including the first.
    const conv = await getConversation(pool, conversationId, siteId);
    if (!conv) {
      // Nothing to persist against — the conversation/site pairing this call
      // was given doesn't exist (or was scoped to the wrong site). Don't
      // force-unwrap into a TypeError; report it as a normal turn failure.
      onEvent({ type: "turn_done", reason: "error", message: "conversation not found for this site" });
      return { reason: "error", toolCalls };
    }
    const usage = getTodayUsage(conv);
    if (usage.input + usage.output >= tokenBudget) {
      const text =
        "Daily token budget for this conversation is exhausted — try again tomorrow or raise AI_AGENT_TOKEN_BUDGET.";
      await persistAssistantText(pool, conversationId, text, onEvent);
      onEvent({ type: "turn_done", reason: "budget", message: text });
      return { reason: "budget", toolCalls };
    }

    const messages = await buildApiMessages(pool, conversationId);
    if (messages === null) {
      // Shouldn't happen in practice — the caller always persists a
      // triggering user message before calling runAgentTurn — but a
      // conversation with no user row anywhere has nothing valid to send.
      const text = "conversation has no user message";
      onEvent({ type: "turn_done", reason: "error", message: text });
      return { reason: "error", toolCalls };
    }
    const { message } = await runMessage(
      { system, messages, tools, tool_choice: { type: "auto" }, max_tokens: 8192 },
      { client: input.client, env },
    );

    await addTokenUsage(pool, conversationId, {
      input: message.usage.input_tokens ?? 0,
      output: message.usage.output_tokens ?? 0,
    });

    await appendMessage(pool, conversationId, "assistant", message.content);
    for (const block of message.content) {
      if (block.type === "text") onEvent({ type: "assistant_text", text: block.text });
    }

    if (message.stop_reason !== "tool_use") {
      onEvent({ type: "turn_done", reason: "end_turn" });
      return { reason: "end_turn", toolCalls };
    }

    const toolUseBlocks = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) {
      // stop_reason said "tool_use" but the model didn't actually include a
      // tool_use block (a malformed/edge-case response) — there's nothing to
      // execute and no result to persist. Treat it as done rather than
      // looping forever on an empty tool message.
      onEvent({ type: "turn_done", reason: "end_turn" });
      return { reason: "end_turn", toolCalls };
    }

    const resultBlocks: ToolResultContent[] = [];
    for (const block of toolUseBlocks) {
      // Item 5 (Codex P2 — batched tool cap): the model can request several
      // tool_use blocks in ONE assistant message, so the cap has to be
      // checked BEFORE each block, not just once at the bottom of the outer
      // loop after the whole batch already ran — otherwise a single big
      // batch blows straight past maxToolCalls before that check ever
      // fires. Once the cap is reached mid-batch, every remaining block in
      // THIS batch is skipped rather than executed, but still needs a
      // matching tool_result (the API requires exactly one per tool_use
      // in the same follow-up message) — persisted as `is_error:true` so
      // the model sees it didn't run. These skips deliberately do NOT touch
      // `failureStreak`: hitting the cap isn't the same failure mode as a
      // tool genuinely erroring, and the bottom-of-loop `toolCalls >=
      // maxToolCalls` check below already ends the turn with reason
      // "max_tools" once this batch is persisted.
      if (toolCalls >= maxToolCalls) {
        onEvent({ type: "tool_call", name: block.name, input: block.input });
        resultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ error: "tool call limit reached" }),
          is_error: true,
        });
        onEvent({ type: "tool_result", name: block.name, ok: false, summary: "tool call limit reached" });
        continue;
      }

      onEvent({ type: "tool_call", name: block.name, input: block.input });
      const result = await executeAgentTool(toolCtx, block.name, block.input);
      toolCalls += 1;

      resultBlocks.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(
          result.ok ? result.data : { error: result.error, details: result.details },
        ),
        is_error: !result.ok,
      });
      onEvent({
        type: "tool_result",
        name: block.name,
        ok: result.ok,
        summary: result.ok ? result.summary : undefined,
        change: result.ok ? result.change : undefined,
      });

      if (result.ok) {
        failureStreak.delete(block.name);
      } else {
        failureStreak.set(block.name, (failureStreak.get(block.name) ?? 0) + 1);
      }
    }

    // Persist every tool_result from this assistant turn as ONE role-'tool'
    // message — the model always emits one tool_result per tool_use it asked
    // for, in a single follow-up turn, and history rebuild expects that shape.
    await appendMessage(pool, conversationId, "tool", resultBlocks);

    const stuckTool = [...failureStreak.entries()].find(([, count]) => count >= FAILURE_STREAK_LIMIT);
    if (stuckTool) {
      const [toolName, count] = stuckTool;
      const text =
        `The "${toolName}" tool failed ${count} times in a row; stopping here rather than repeating the same mistake.`;
      await persistAssistantText(pool, conversationId, text, onEvent);
      await setConversationStatus(pool, conversationId, "error");
      onEvent({ type: "turn_done", reason: "error", message: text });
      return { reason: "error", toolCalls };
    }

    if (toolCalls >= maxToolCalls) {
      const text = `Reached the limit of ${maxToolCalls} tool calls for this turn; stopping here.`;
      await persistAssistantText(pool, conversationId, text, onEvent);
      onEvent({ type: "turn_done", reason: "max_tools", message: text });
      return { reason: "max_tools", toolCalls };
    }

    if (deadline !== null && Date.now() >= deadline) {
      // No extra persistence: the last persisted message is the role-'tool'
      // message above, so a continuation call rebuilds context ending in
      // tool_results and the model resumes mid-task naturally.
      onEvent({ type: "turn_done", reason: "promoted" });
      return { reason: "promoted", toolCalls };
    }
  }
}
