// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { setAdminToken, clearAdminToken } from "../../lib/adminToken.js";

/**
 * FINAL whole-branch review, FIX-NOW item 1 — inter-round busy flicker.
 *
 * The auto-continue loop releases the conversation lock (status → 'active')
 * BEFORE enqueueing the next round, and pg-boss polls on a ~2s interval, so
 * between rounds the tail reports a settled status for 1-3s even though the
 * build is still going. That downgrade used to be applied instantly:
 * `busy`/`sending` both dropped, the typing pulse stopped, the composer
 * flipped Stop→Send, and WorkspacePage re-enabled Publish mid-build — up to
 * 3× per build.
 *
 * These tests pin the debounce: a non-'running', non-'error' status is held
 * for 4s before it's accepted; a 'running' that re-arrives inside that window
 * cancels it entirely; 'error' is never delayed (a labeled error must show
 * immediately); and the per-turn usage delta is fetched once, after the FINAL
 * settle, not the first one.
 */

type TailEvent = Record<string, unknown>;
let emitters: Record<string, (e: TailEvent) => void>;

const streamAgentEvents = vi.fn(
  (path: string, opts: { onEvent: (e: TailEvent) => void; signal?: AbortSignal }) => {
    emitters[path] = opts.onEvent;
    // A live tail never resolves on its own — it ends by abort.
    return new Promise<void>((resolve) => {
      opts.signal?.addEventListener("abort", () => resolve());
    });
  },
);

vi.mock("../../lib/agent-api.js", () => ({
  streamAgentEvents: (...args: Parameters<typeof streamAgentEvents>) => streamAgentEvents(...args),
}));

const { useAgentConversation } = await import("./useAgentConversation.js");

const TAIL_PATH = "/api/sites/s1/agent/conversations/c1/events?after=m-user-1";
const DETAIL_PATH = "/api/sites/s1/agent/conversations/c1";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Token usage the conversation-detail GET reports (the usage-delta source). */
let detailUsage: Record<string, { input: number; output: number }>;

function mockFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/sites/s1/agent/conversations/c1/stop" && method === "POST") {
      return json({ stopping: true }, 202);
    }
    if (url === "/api/sites/s1/agent/conversations" && method === "GET") return json({ conversations: [] });
    if (url === "/api/sites/s1/agent/conversations" && method === "POST") {
      return json(
        { conversation: { id: "c1", site_id: "s1", title: "New", status: "active", token_usage: {} } },
        201,
      );
    }
    if (url === "/api/sites/s1/agent/conversations/c1/messages" && method === "POST") {
      return json({ queued: true, conversation_id: "c1", user_message_id: "m-user-1" }, 202);
    }
    if (url === DETAIL_PATH && method === "GET") {
      return json({
        conversation: { id: "c1", site_id: "s1", title: "New", status: "active", token_usage: detailUsage },
        messages: [],
      });
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** Flush pending microtasks (fetch mocks resolve immediately) inside act(). */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function emit(e: TailEvent) {
  act(() => {
    emitters[TAIL_PATH]?.(e);
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function renderConversation() {
  const onStatusChange = vi.fn();
  const view = renderHook(() =>
    useAgentConversation({
      siteId: "s1",
      active: true,
      onSiteChanged: () => undefined,
      onStatusChange,
    }),
  );
  return { ...view, onStatusChange };
}

describe("useAgentConversation — inter-round settle debounce (final review, item 1)", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    setAdminToken("tok");
    emitters = {};
    detailUsage = { [new Date().toISOString().slice(0, 10)]: { input: 100, output: 50 } };
    streamAgentEvents.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    clearAdminToken();
    global.fetch = realFetch;
  });

  it("holds busy/sending across an inter-round 'active' when 'running' re-arrives inside the 4s window", async () => {
    mockFetch();
    const { result, onStatusChange } = renderConversation();
    await flush();

    await act(async () => {
      void result.current.send("build me a site");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(streamAgentEvents).toHaveBeenCalledTimes(1);
    expect(result.current.sending).toBe(true);

    // Round 0 starts. From here on, every `onStatusChange` report must say
    // busy — the pre-send reports (mount, status null) are not in scope.
    emit({ type: "status", status: "running" });
    expect(result.current.busy).toBe(true);
    onStatusChange.mockClear();

    // Inter-round release: the row reads 'active' for a couple of seconds.
    emit({ type: "status", status: "active" });
    advance(1000);
    expect(result.current.busy).toBe(true);
    expect(result.current.sending).toBe(true);
    advance(2000); // still inside the 4s hold
    expect(result.current.busy).toBe(true);

    // Round 1 is picked up — the pending downgrade must be cancelled outright.
    emit({ type: "status", status: "running" });
    advance(10_000);
    expect(result.current.busy).toBe(true);
    expect(result.current.sending).toBe(true);
    // Nothing ever reported not-busy in between.
    expect(onStatusChange.mock.calls.every(([, busy]) => busy === true)).toBe(true);

    // Final settle: held for 4s, then accepted.
    emit({ type: "status", status: "active" });
    advance(3999);
    expect(result.current.busy).toBe(true);
    expect(result.current.sending).toBe(true);
    advance(2);
    expect(result.current.busy).toBe(false);
    expect(result.current.sending).toBe(false);
  });

  it("applies an 'error' status immediately — a labeled error is never delayed", async () => {
    mockFetch();
    const { result } = renderConversation();
    await flush();

    await act(async () => {
      void result.current.send("build me a site");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    emit({ type: "status", status: "running" });
    expect(result.current.busy).toBe(true);

    emit({ type: "status", status: "error" });
    // No timer advance at all.
    expect(result.current.conversation?.status).toBe("error");
    expect(result.current.busy).toBe(false);
    expect(result.current.sending).toBe(false);
  });

  it("W1.4 Stop: stop() calls the cancel endpoint, keeps the tail alive, and settles on the tailed 'stopped' status", async () => {
    const fetchMock = mockFetch();
    const { result } = renderConversation();
    await flush();

    await act(async () => {
      void result.current.send("build me a site");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    emit({ type: "status", status: "running" });
    expect(result.current.busy).toBe(true);

    expect(streamAgentEvents).toHaveBeenCalledTimes(1);
    const tailSignal = streamAgentEvents.mock.calls[0][1].signal;

    await act(async () => {
      void result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The cancel endpoint was hit…
    const stopCalls = fetchMock.mock.calls.filter(
      ([input, init]) => String(input) === "/api/sites/s1/agent/conversations/c1/stop" && init?.method === "POST",
    );
    expect(stopCalls).toHaveLength(1);
    // …the tail was NOT aborted (busy state must settle from the server,
    // never be stranded by a client-side detach)…
    expect(tailSignal?.aborted).toBe(false);
    // …and until the terminal status lands, the turn still reads in-flight.
    expect(result.current.sending).toBe(true);
    // Immediate local feedback while the halt propagates.
    expect(result.current.items.some((i) => i.kind === "system" && /stopping/i.test(i.text))).toBe(true);

    // The server's honest note + terminal status stream out over the tail.
    emit({
      type: "message",
      message: {
        id: "m-sys-1", conversation_id: "c1", role: "system",
        content: [{ type: "text", text: "Stopped by you — the site keeps whatever was already written." }],
        created_at: "2026-07-30T00:00:00.000Z",
      },
    });
    emit({ type: "status", status: "stopped" });

    // 'stopped' is terminal: applied immediately (no 4s debounce), busy off.
    expect(result.current.sending).toBe(false);
    expect(result.current.busy).toBe(false);
    expect(result.current.conversation?.status).toBe("stopped");
    expect(
      result.current.items.some((i) => i.kind === "system" && /stopped by you/i.test(i.text)),
    ).toBe(true);
  });

  it("refreshes the usage delta ONCE, after the final settle (not the first inter-round one)", async () => {
    const fetchMock = mockFetch();
    const { result } = renderConversation();
    await flush();

    await act(async () => {
      void result.current.send("build me a site");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const detailCalls = () =>
      fetchMock.mock.calls.filter(([input, init]) => String(input) === DETAIL_PATH && (init?.method ?? "GET") === "GET")
        .length;

    emit({ type: "status", status: "running" });
    emit({ type: "status", status: "active" });
    advance(1000);
    emit({ type: "status", status: "running" });
    advance(10_000);
    expect(detailCalls()).toBe(0);

    emit({ type: "status", status: "active" });
    advance(4001);
    await flush();
    expect(detailCalls()).toBe(1);
    expect(result.current.usageText).toBe("150 tokens today · +150 this turn");
  });
});
