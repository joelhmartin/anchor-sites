import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetClientForTests, runMessage, type RunMessageOptions } from "./client.js";
import { AI_MAX_TOKENS, AI_MODEL, resolveAiMode } from "./config.js";

// Build a fake SDK client without importing the heavy SDK into the test.
function fakeClient(create: ReturnType<typeof vi.fn>): RunMessageOptions["client"] {
  return { messages: { create } } as unknown as RunMessageOptions["client"];
}

// A minimal object that satisfies the parts of Anthropic.Message we assert on.
const fakeApiMessage = {
  id: "msg_real_1",
  type: "message",
  role: "assistant",
  model: AI_MODEL,
  content: [{ type: "text", text: "ok", citations: null }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 },
};

const origKey = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = origKey;
  __resetClientForTests();
  vi.restoreAllMocks();
});

describe("resolveAiMode", () => {
  it("stub when no key", () => {
    expect(resolveAiMode({})).toBe("stub");
  });
  it("dry-run when key is the literal 'dry-run'", () => {
    expect(resolveAiMode({ ANTHROPIC_API_KEY: "dry-run" })).toBe("dry-run");
  });
  it("api for any other key value", () => {
    expect(resolveAiMode({ ANTHROPIC_API_KEY: "sk-ant-abc123" })).toBe("api");
  });
});

describe("runMessage modes", () => {
  it("stub: no key → canned message, client never touched (no spend)", async () => {
    const create = vi.fn();
    const res = await runMessage(
      { messages: [{ role: "user", content: "make the hero punchier" }] },
      { client: fakeClient(create), env: {} },
    );
    expect(res.mode).toBe("stub");
    expect(create).not.toHaveBeenCalled();
    expect(res.message.role).toBe("assistant");
    expect(res.message.content[0]).toMatchObject({ type: "text" });
  });

  it("dry-run: returns a deterministic canned proposal, no client call", async () => {
    const create = vi.fn();
    const res = await runMessage(
      { messages: [{ role: "user", content: "hi" }] },
      { client: fakeClient(create), env: { ANTHROPIC_API_KEY: "dry-run" } },
    );
    expect(res.mode).toBe("dry-run");
    expect(create).not.toHaveBeenCalled();
    expect(res.message.id).toBe("msg_canned_stub");
  });

  it("dry-run: honors an injected cannedMessage", async () => {
    const create = vi.fn();
    const canned = { ...fakeApiMessage, id: "msg_injected" } as never;
    const res = await runMessage(
      { messages: [{ role: "user", content: "hi" }] },
      { client: fakeClient(create), env: { ANTHROPIC_API_KEY: "dry-run" }, cannedMessage: canned },
    );
    expect(res.message.id).toBe("msg_injected");
  });

  it("api: builds the request with the pinned model + default max_tokens", async () => {
    const create = vi.fn().mockResolvedValue(fakeApiMessage);
    const res = await runMessage(
      { system: "you edit blocks", messages: [{ role: "user", content: "hi" }] },
      { client: fakeClient(create), env: { ANTHROPIC_API_KEY: "sk-ant-real" } },
    );
    expect(res.mode).toBe("api");
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: AI_MODEL,
        max_tokens: AI_MAX_TOKENS,
        system: "you edit blocks",
      }),
    );
    expect(res.message).toBe(fakeApiMessage);
  });

  it("api: callers cannot override the pinned model but can raise max_tokens", async () => {
    const create = vi.fn().mockResolvedValue(fakeApiMessage);
    await runMessage(
      // @ts-expect-error — `model` is intentionally omitted from RunMessageParams
      { model: "claude-opus-4-7", max_tokens: 8000, messages: [{ role: "user", content: "hi" }] },
      { client: fakeClient(create), env: { ANTHROPIC_API_KEY: "sk-ant-real" } },
    );
    const arg = create.mock.calls[0][0] as { model: string; max_tokens: number };
    expect(arg.model).toBe(AI_MODEL);
    expect(arg.max_tokens).toBe(8000);
  });
});
