import type { Pool } from "pg";
import type Anthropic from "@anthropic-ai/sdk";
import { runMessage } from "../client.js";
import { resolveAiMode } from "../config.js";
import { buildBlockCatalog } from "../catalog.js";
import {
  getConversation, appendMessage, listMessages, setConversationStatus, addTokenUsage, getTodayUsage,
  consumeCancelRequest, markConversationStopped, getFoundingUserMessage,
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

export type TurnDoneReason = "end_turn" | "max_tools" | "budget" | "error" | "promoted" | "stopped";

/**
 * Task A1 (Lovable-workspace plan). The resolved value of `runAgentTurn` —
 * distinct from `AgentTurnEvent`'s streamed `turn_done.reason` (still a
 * `TurnDoneReason`, unchanged): this is what the CALLER gets back once the
 * awaited promise settles, so job/route code can react to how a turn ended
 * without re-deriving it from the event stream. Maps 1:1 from the internal
 * `TurnDoneReason` values at every return site: end_turn->completed,
 * max_tools->tool_limit, budget->token_budget, promoted->deadline (a
 * mid-turn deadline is what triggers "promoted" hand-off to a background
 * job), error->error.
 */
export type AgentTurnResult = {
  /** `stopped` (W1.4 / D300+D1105+D612): the operator's Stop was honored —
   * the loop itself already persisted the note + landed status 'stopped',
   * so the caller (handleAgentTurn) must neither release nor continue. */
  endReason: "completed" | "tool_limit" | "deadline" | "token_budget" | "error" | "stopped";
  toolCalls: number;
};

export type AgentTurnEvent =
  | { type: "assistant_text"; text: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; name: string; ok: boolean; summary?: string; change?: AgentChangeEvent }
  | { type: "turn_done"; reason: TurnDoneReason; message?: string };

/**
 * W1.5 / D1100 — the design playbook. This used to be ~10 lines of tool
 * mechanics; visual quality of agent builds is the operator's #1 recurring
 * complaint, and the system prompt is the smallest lever. The playbook
 * encodes what the db/templates/*.ts templates already demonstrate: per-page
 * nav-bar/rich-footer chrome, varied section composition, real copy depth,
 * an image in every image slot, brand tokens set BEFORE pages exist, and an
 * SEO pass at the end. Kept directive and dense — this text is paid for on
 * every model call (it IS prompt-cached, but cache writes/misses still
 * cost). Exported for the structural-invariant tests in loop.test.ts.
 */
export const AGENT_SYSTEM_INTRO = `You are the site agent for the AnchorCorps site builder. You work on exactly ONE site per conversation, using only the provided tools. Pages are ordered arrays of typed "blocks"; the catalog below lists the ONLY block types you may use and the JSON Schema each block's props must satisfy. All work lands on DRAFT pages — you cannot publish, change domains, or configure plugins; the operator does that.

FIRST TURN ON A NEW OR EMPTY SITE
1. Call get_site_overview first.
2. Enrich the request into a short site spec BEFORE building — even from a one-line prompt: what the business does, who it serves, the tone, and the page set (Home plus 2-4 supporting pages such as Services/About/Contact). State the spec in one short paragraph, then build it; infer sensible specifics rather than asking questions.
3. If an active site template fits the business, apply_site_template and ADAPT the result: rewrite every page's copy for THIS business, replace the imagery, re-tune the brand tokens. When the site already has template-made pages, same rule — adapt what exists, never delete-and-rebuild.
4. Building from scratch: call set_brand_tokens BEFORE creating any page. Choose a palette that fits the business — set --theme-main/--theme-on-main (site chrome), --theme-accent/--theme-on-accent (CTAs), --theme-surface/--theme-on-surface, and --theme-muted/--theme-on-muted (alternating section backgrounds). Then create the Home page first, then the rest of the page set.

DESIGN PLAYBOOK — every page is judged against the built-in templates:
- Chrome: every page STARTS with a nav-bar block and ENDS with a rich-footer block, identical across all pages (same links, same footer columns), so the site reads as one product.
- Composition: Home gets 4-7 varied sections between the chrome — a hero or split-hero on top, then a mix of feature-grid, stats-band, testimonial-carousel, faq-accordion, cta. Supporting pages get at least 3 real sections — never a lone hero. Do not place the same block type twice in a row.
- Images: never leave an image slot empty (split-hero image_asset_id, image asset_id, hero-slider slides). For each slot: search_stock_images with a specific query (the trade, setting, or service — not "business"), import_image the best hit with descriptive alt text and the hit's photographer credit, then place the returned asset_id with that same alt.
- Copy: written for THIS business — name its services, its place, its outcomes. No lorem ipsum, no generic filler ("Welcome to our website"). Headlines under ~8 words; section bodies 1-3 specific sentences; every CTA gets a real label and a real destination.
- Batch related edits: one update_page call with several ops beats several calls.

FINISH WITH SEO
Before summarizing a build: call set_seo_defaults once (title template + description), then set_page_seo for each page with a unique title and meta description.

RULES
- Reference pages and blocks by their exact ids from tool results. Never invent ids or block types.
- If a tool result reports a validation failure, correct the input and retry; after repeated failures, stop and explain.
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

/**
 * Task A4 (Lovable-workspace plan). Maps an error thrown by the Anthropic
 * SDK's `messages.create` call to a short, human-readable label — instead of
 * the bare amber "internal" the operator once saw when a build died on an
 * out-of-credits account. Duck-types on `status`/`message` (rather than
 * `instanceof Anthropic.APIError`) so a plain injected test error
 * (`{status, message}`) is handled identically to a real SDK exception,
 * which also carries those two fields (see
 * node_modules/@anthropic-ai/sdk/error.d.ts — every `APIError` subclass has
 * a `status` and inherits `message` from `Error`). Exported so loop.test.ts
 * can cover each mapping directly, without spinning up a rejecting fake
 * client for every case.
 */
export function describeAnthropicError(err: unknown): string {
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? (err as { status?: unknown }).status
      : undefined;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string"
        ? ((err as { message: string }).message)
        : "";

  if (status === 401 || status === 403) return "Anthropic API key rejected";
  if (status === 400 && /billing|credit/i.test(message)) {
    return "Anthropic credit balance too low — top up at console.anthropic.com";
  }
  if (status === 429) return "Anthropic is rate-limiting — retry shortly";
  if (status === 529 || /overloaded/i.test(message)) return "Anthropic is overloaded — retry shortly";

  return "The site agent hit an unexpected error and stopped.";
}

/**
 * W1.4 / D1101 — errors whose own label says "retry shortly" must actually
 * be retried before becoming terminal. 429 (rate limit), 529 / "overloaded"
 * (capacity blips) routinely clear within seconds; without this, a
 * 60-second Anthropic overload killed a 4-batch build (`retryLimit: 0` on
 * the job means nothing else retries) and waited for a human to click
 * Resume. Same duck-typing rationale as `describeAnthropicError` above.
 */
export function isRetryableAnthropicError(err: unknown): boolean {
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? (err as { status?: unknown }).status
      : undefined;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : "";
  return status === 429 || status === 529 || /overloaded/i.test(message);
}

/** Total model-call attempts (initial + retries) before a retryable error
 * goes terminal. Bounded — this is an in-loop courtesy, not a queue. */
const ANTHROPIC_MAX_ATTEMPTS = 3;

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
 * W1.5 / D1106 — the bracketed preface that marks a re-injected founding
 * brief so the model can tell it apart from a message the operator just
 * sent. Exported for the structural-invariant tests in loop.test.ts.
 */
export const FOUNDING_BRIEF_PREFACE =
  "[Founding brief — the original request this conversation was started with, repeated for context. The newer messages below take precedence.]";

/**
 * W1.5 / D1106 — build the leading user message that pins the conversation's
 * founding brief into the model context. Extracts the text blocks of the
 * first user row (user rows are always text-block arrays — see
 * admin-ai-agent.ts's appendMessage calls) and prefixes them with a clearly
 * bracketed marker. Returns null when the founding row has no usable text
 * (nothing meaningful to pin). Consecutive user-role messages are valid on
 * the Anthropic Messages API (combined into one turn), so prepending this
 * ahead of a window that already starts with a user row is safe.
 */
function buildFoundingBriefMessage(founding: AiMessage): Anthropic.MessageParam | null {
  const blocks = Array.isArray(founding.content)
    ? (founding.content as { type?: unknown; text?: unknown }[])
    : [];
  const texts = blocks
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string);
  if (texts.length === 0) return null;
  return {
    role: "user",
    content: [{ type: "text", text: `${FOUNDING_BRIEF_PREFACE}\n\n${texts.join("\n\n")}` }],
  };
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
 *
 * W1.5 / D1106 — the FOUNDING user message (the business brief that started
 * the conversation) is ALWAYS part of the context: one build turn can
 * persist up to 61 rows, so after the first build the founding brief is
 * permanently outside every 40-row window and a later "make the hero
 * warmer" turn would otherwise run with no memory of what the site is for.
 * When the founding row isn't already inside the window, a clearly-marked
 * copy (see `buildFoundingBriefMessage`) is prepended ahead of the tail.
 */
async function buildApiMessages(
  pool: Pool, conversationId: string,
): Promise<Anthropic.MessageParam[] | null> {
  // W1.4 / D601: role-'system' rows are UI-only transcript annotations (the
  // stall reconciler's "Build was interrupted" notes, Stop confirmations,
  // continuation-failure notes — see repo.ts). The Anthropic API has no
  // 'system' message role and the model must not see infrastructure notes
  // as conversation content, so they're dropped BEFORE any windowing/
  // trimming below.
  const rows = (await listMessages(pool, conversationId, { limit: 40 }))
    .filter((m) => m.role !== "system");

  const windowUserIdx = rows.findIndex((m) => m.role === "user");
  let windowRows: AiMessage[];
  if (windowUserIdx !== -1) {
    windowRows = rows.slice(windowUserIdx);
  } else {
    const allRows = (await listMessages(pool, conversationId)).filter((m) => m.role !== "system");
    let lastUserIdx = -1;
    for (let i = allRows.length - 1; i >= 0; i--) {
      if (allRows[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx === -1) return null;
    windowRows = allRows.slice(lastUserIdx);
  }

  const messages = mapRowsToApiMessages(windowRows);

  // D1106: prepend the founding brief unless the founding row itself is
  // already inside the window (id match — content equality would be fooled
  // by a user re-sending the same text).
  const founding = await getFoundingUserMessage(pool, conversationId);
  if (founding && !windowRows.some((r) => r.id === founding.id)) {
    const briefMessage = buildFoundingBriefMessage(founding);
    if (briefMessage) return [briefMessage, ...messages];
  }
  return messages;
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
}): Promise<AgentTurnResult> {
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
      return { endReason: "error", toolCalls: 1 };
    }

    await persistAssistantText(pool, conversationId, "Stub mode: created a starter Home page.", onEvent);
    onEvent({ type: "turn_done", reason: "end_turn" });
    return { endReason: "completed", toolCalls: 1 };
  }

  await persistAssistantText(
    pool, conversationId, "Stub mode: no changes made — site already has pages.", onEvent,
  );
  onEvent({ type: "turn_done", reason: "end_turn" });
  return { endReason: "completed", toolCalls: 0 };
}

export async function runAgentTurn(input: {
  pool: Pool;
  conversationId: string;
  siteId: string;
  env?: NodeJS.ProcessEnv;
  client?: Anthropic; // injected mock in tests
  onEvent?: (e: AgentTurnEvent) => void;
  // Task A2 (2026-07-30 lovable-workspace SDD) deleted the last production
  // caller that passed a `deadlineMs` (the inline HTTP turn route used to
  // pass `{maxToolCalls: 15, deadlineMs: 45_000}` so a slow turn could
  // "promote" itself to a background job mid-request). Every turn now runs
  // as an AGENT_TURN job (src/server/jobs/agent-turn.ts's `handleAgentTurn`),
  // which calls `runAgentTurn` with no `limits` at all — full `maxToolCalls`
  // from `AI_AGENT_MAX_TOOL_CALLS` (default 30), no deadline, ever. `limits`
  // (and the `deadline`/"promoted" branch below) stay only for direct unit
  // coverage in loop.test.ts; nothing production reaches them anymore.
  limits?: { maxToolCalls?: number; deadlineMs?: number };
  genId?: () => string;
}): Promise<AgentTurnResult> {
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
    // W1.4 Stop — batch-boundary cancellation check, before EVERY model
    // call (including the first: a Stop can land while the job is queued).
    // `consumeCancelRequest` is an atomic report-and-clear, so exactly one
    // checker acts per Stop click. History is API-valid here: the previous
    // batch's tool_results (if any) are already persisted.
    if (await consumeCancelRequest(pool, conversationId)) {
      await markConversationStopped(pool, conversationId);
      onEvent({ type: "turn_done", reason: "stopped" });
      return { endReason: "stopped", toolCalls };
    }

    // Budget gate — runs before EVERY model call, including the first.
    const conv = await getConversation(pool, conversationId, siteId);
    if (!conv) {
      // Nothing to persist against — the conversation/site pairing this call
      // was given doesn't exist (or was scoped to the wrong site). Don't
      // force-unwrap into a TypeError; report it as a normal turn failure.
      onEvent({ type: "turn_done", reason: "error", message: "conversation not found for this site" });
      return { endReason: "error", toolCalls };
    }
    const usage = getTodayUsage(conv);
    if (usage.input + usage.output >= tokenBudget) {
      const text =
        "Daily token budget for this conversation is exhausted — try again tomorrow or raise AI_AGENT_TOKEN_BUDGET.";
      await persistAssistantText(pool, conversationId, text, onEvent);
      onEvent({ type: "turn_done", reason: "budget", message: text });
      return { endReason: "token_budget", toolCalls };
    }

    const messages = await buildApiMessages(pool, conversationId);
    if (messages === null) {
      // Shouldn't happen in practice — the caller always persists a
      // triggering user message before calling runAgentTurn — but a
      // conversation with no user row anywhere has nothing valid to send.
      const text = "conversation has no user message";
      onEvent({ type: "turn_done", reason: "error", message: text });
      return { endReason: "error", toolCalls };
    }
    let message: Anthropic.Message;
    try {
      // W1.4 / D1101 — bounded in-loop retry for transient errors (429/529/
      // overloaded) with exponential backoff before anything goes terminal.
      // Base delay is env-tunable (tests pass 1ms); production default 2s →
      // 2s, 4s between the three attempts. Retries are silent: nothing is
      // persisted unless the LAST attempt still fails, in which case the
      // existing `describeAnthropicError` terminal path below runs as ever.
      const retryBaseMs = parsePositiveIntEnv(env.AI_AGENT_RETRY_BASE_MS, 2000);
      let attempt = 0;
      for (;;) {
        try {
          ({ message } = await runMessage(
            { system, messages, tools, tool_choice: { type: "auto" }, max_tokens: 8192 },
            { client: input.client, env },
          ));
          break;
        } catch (err) {
          attempt += 1;
          if (attempt >= ANTHROPIC_MAX_ATTEMPTS || !isRetryableAnthropicError(err)) throw err;
          await new Promise((resolve) => setTimeout(resolve, retryBaseMs * 2 ** (attempt - 1)));
        }
      }
    } catch (err) {
      // Task A4: a thrown Anthropic SDK error (auth/billing/rate-limit/
      // overload) previously propagated straight past this loop to
      // agent-turn.ts's outer catch, which sets status='error' but persists
      // NO explanatory text — the bare amber "internal" the operator saw.
      // Persist a clear, human-readable label through the SAME channel
      // every other turn-ending error in this loop already uses
      // (persistAssistantText + setConversationStatus), so it renders in
      // the transcript and flips on the Resume affordance exactly like the
      // failure-streak/budget cases above.
      const text = describeAnthropicError(err);
      await persistAssistantText(pool, conversationId, text, onEvent);
      await setConversationStatus(pool, conversationId, "error");
      onEvent({ type: "turn_done", reason: "error", message: text });
      return { endReason: "error", toolCalls };
    }

    await addTokenUsage(pool, conversationId, {
      input: message.usage.input_tokens ?? 0,
      output: message.usage.output_tokens ?? 0,
    });

    await appendMessage(pool, conversationId, "assistant", message.content);
    for (const block of message.content) {
      if (block.type === "text") onEvent({ type: "assistant_text", text: block.text });
    }

    // W1.4 / D1102 — `stop_reason: "max_tokens"` must never masquerade as a
    // completed turn (the transcript used to end on a chopped sentence with
    // the conversation flipped to 'active' and the UI reading "done").
    //  - Truncated mid-TEXT (no tool_use blocks): persist an honest system
    //    note and end the round as `tool_limit`, which `handleAgentTurn`
    //    auto-continues exactly like a tool-cap round; the persisted history
    //    ends on the truncated assistant message, so the next round's
    //    context is a trailing-assistant prefill the model continues from.
    //  - Truncated AFTER complete tool_use blocks: the API only includes
    //    finished blocks, so fall through and execute them — the loop then
    //    continues naturally (and history stays API-valid: every persisted
    //    tool_use gets its tool_result below).
    if (message.stop_reason === "max_tokens") {
      const truncatedToolUses = message.content.filter((b) => b.type === "tool_use");
      if (truncatedToolUses.length === 0) {
        const text = "The response hit the output limit and was cut short — continuing in a new round.";
        await appendMessage(pool, conversationId, "system", [{ type: "text", text }]);
        onEvent({ type: "turn_done", reason: "max_tools", message: text });
        return { endReason: "tool_limit", toolCalls };
      }
    } else if (message.stop_reason !== "tool_use") {
      onEvent({ type: "turn_done", reason: "end_turn" });
      return { endReason: "completed", toolCalls };
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
      return { endReason: "completed", toolCalls };
    }

    const resultBlocks: ToolResultContent[] = [];
    // W1.4 Stop — between-tool-calls cancellation. Once a Stop is consumed
    // mid-batch, THIS and every remaining tool_use in the batch is skipped;
    // each still gets a matching `is_error` tool_result (the API requires
    // exactly one per tool_use in the follow-up message), the batch message
    // is persisted so history stays valid, then the turn lands 'stopped'.
    let cancelled = false;
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

      if (!cancelled && (await consumeCancelRequest(pool, conversationId))) {
        cancelled = true;
      }
      if (cancelled) {
        resultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ error: "stopped by operator" }),
          is_error: true,
        });
        onEvent({ type: "tool_result", name: block.name, ok: false, summary: "stopped by operator" });
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

    if (cancelled) {
      await markConversationStopped(pool, conversationId);
      onEvent({ type: "turn_done", reason: "stopped" });
      return { endReason: "stopped", toolCalls };
    }

    const stuckTool = [...failureStreak.entries()].find(([, count]) => count >= FAILURE_STREAK_LIMIT);
    if (stuckTool) {
      const [toolName, count] = stuckTool;
      const text =
        `The "${toolName}" tool failed ${count} times in a row; stopping here rather than repeating the same mistake.`;
      await persistAssistantText(pool, conversationId, text, onEvent);
      await setConversationStatus(pool, conversationId, "error");
      onEvent({ type: "turn_done", reason: "error", message: text });
      return { endReason: "error", toolCalls };
    }

    if (toolCalls >= maxToolCalls) {
      const text = `Reached the limit of ${maxToolCalls} tool calls for this turn; stopping here.`;
      await persistAssistantText(pool, conversationId, text, onEvent);
      onEvent({ type: "turn_done", reason: "max_tools", message: text });
      return { endReason: "tool_limit", toolCalls };
    }

    if (deadline !== null && Date.now() >= deadline) {
      // No extra persistence: the last persisted message is the role-'tool'
      // message above, so a continuation call rebuilds context ending in
      // tool_results and the model resumes mid-task naturally.
      onEvent({ type: "turn_done", reason: "promoted" });
      return { endReason: "deadline", toolCalls };
    }
  }
}
