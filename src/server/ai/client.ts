import Anthropic from "@anthropic-ai/sdk";
import { AI_MAX_TOKENS, AI_MODEL, resolveAiMode, type AiMode } from "./config.js";

/**
 * Thin wrapper around the Anthropic SDK (Phase 6, P6-T6.1).
 *
 * It owns the model pin (callers cannot override `model`) and the three modes
 * from `config.ts`. In stub / dry-run it returns a deterministic canned
 * message and never constructs or calls a client — so dev + tests never spend.
 * In api mode it calls the real SDK. The client is injectable so tests run
 * with it mocked (no network, no key needed). No endpoint here — 6.4 builds on
 * top of this; 6.3 parses the returned message into edit ops.
 */

let cachedClient: Anthropic | null = null;

/** Lazily construct (and memoize) the real SDK client. Reads `ANTHROPIC_API_KEY`. */
export function getAnthropicClient(): Anthropic {
  if (!cachedClient) cachedClient = new Anthropic();
  return cachedClient;
}

/** Test-only: drop the memoized client so env changes take effect between tests. */
export function __resetClientForTests(): void {
  cachedClient = null;
}

/**
 * Caller-controlled request params. `model` is fixed by the pin and omitted;
 * `max_tokens` defaults to {@link AI_MAX_TOKENS} but may be raised per-request.
 */
export type RunMessageParams = Omit<
  Anthropic.MessageCreateParamsNonStreaming,
  "model" | "max_tokens"
> & { max_tokens?: number };

export type RunMessageResult = {
  mode: AiMode;
  message: Anthropic.Message;
};

export type RunMessageOptions = {
  /** Inject a client (tests). Defaults to the memoized real client. */
  client?: Anthropic;
  /** Canned message returned in stub/dry-run. Defaults to {@link cannedMessage}. */
  cannedMessage?: Anthropic.Message;
  /** Override the env used for mode resolution (tests). */
  env?: NodeJS.ProcessEnv;
};

/**
 * Run one non-streaming message request through the active mode.
 * - stub / dry-run → deterministic canned message, no client touched.
 * - api → `client.messages.create` with the pinned model + max_tokens.
 */
export async function runMessage(
  params: RunMessageParams,
  opts: RunMessageOptions = {},
): Promise<RunMessageResult> {
  const mode = resolveAiMode(opts.env);
  if (mode !== "api") {
    return { mode, message: opts.cannedMessage ?? cannedMessage() };
  }

  const { max_tokens, ...rest } = params;
  const client = opts.client ?? getAnthropicClient();
  // `...rest` first so the pinned model + resolved max_tokens always win, even
  // if a caller force-passes `model` past the type (the pin is the contract).
  const message = await client.messages.create({
    ...rest,
    model: AI_MODEL,
    max_tokens: max_tokens ?? AI_MAX_TOKENS,
  });
  return { mode, message };
}

/**
 * Deterministic placeholder returned when no key is configured. 6.4 replaces
 * this with a real canned *proposal* once the edit-op contract (6.3) exists;
 * for now it's a minimal valid assistant message so callers have a stable shape.
 */
function cannedMessage(): Anthropic.Message {
  return {
    id: "msg_canned_stub",
    type: "message",
    role: "assistant",
    model: AI_MODEL,
    content: [
      {
        type: "text",
        text: "[ai stub] no live proposal — ANTHROPIC_API_KEY not configured",
        citations: null,
      },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: null,
      service_tier: null,
    },
  } as Anthropic.Message;
}
