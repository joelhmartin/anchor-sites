// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { setAdminToken, clearAdminToken } from "../lib/adminToken.js";

/**
 * Task A2 (2026-07-30 lovable-workspace SDD) deleted the inline turn's HTTP
 * path: `send()` now POSTs `{message}` as a plain enqueue-only request
 * (mocked via `global.fetch` below, alongside the conversation create/list
 * routes) and gets back `202 {queued, job_id, conversation_id}` — never an
 * SSE stream. `streamAgentEvents` is exercised ONLY by the `/events` tail,
 * which `send()` starts (with a null cursor — see AgentChatDrawer.tsx's
 * `send()` doc comment) right after every successful POST. These tests
 * script that tail's `AgentTailEvent`s instead of a live `AgentTurnEvent`
 * stream.
 */

// A tail snapshot's messages fixture reused across several tests: an
// assistant reply plus a tool-result that resolves to a `page_updated`
// change card — delivered as individual `message` tail events, the way a
// job-run turn's progress actually lands.
const ASSISTANT_AND_CHANGE_EVENTS = [
  {
    type: "message",
    message: {
      id: "m2",
      conversation_id: "c1",
      role: "assistant",
      content: [{ type: "text", text: "Working…" }],
      created_at: "t2",
    },
  },
  {
    type: "message",
    message: {
      id: "m3",
      conversation_id: "c1",
      role: "tool",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: JSON.stringify({ page_id: "p1", revision_id: "r1", diff: { summary: "1 updated" } }),
          is_error: false,
        },
      ],
      created_at: "t3",
    },
  },
];

// `eventScripts` maps a `streamAgentEvents` path to the tail events it
// should synchronously replay.
let eventScripts: Record<string, unknown[]>;

const streamAgentEvents = vi.fn(
  async (path: string, opts: { onEvent: (e: Record<string, unknown>) => void }) => {
    for (const e of eventScripts[path] ?? []) opts.onEvent(e as Record<string, unknown>);
  },
);

vi.mock("../lib/agent-api.js", () => ({
  streamAgentEvents: (...args: Parameters<typeof streamAgentEvents>) => streamAgentEvents(...args),
}));

// Import AFTER the mock so the component picks up the mocked module.
const { AgentChatDrawer } = await import("./AgentChatDrawer.js");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderDrawer(props: Partial<ComponentProps<typeof AgentChatDrawer>> = {}) {
  const onClose = vi.fn();
  const onSiteChanged = vi.fn();
  const utils = render(
    <MemoryRouter>
      <AgentChatDrawer
        siteId="s1"
        slug="acme"
        open
        onClose={onClose}
        onSiteChanged={onSiteChanged}
        {...props}
      />
    </MemoryRouter>,
  );
  return { ...utils, onClose, onSiteChanged };
}

const NEW_CONVERSATION = {
  conversation: { id: "c1", site_id: "s1", title: "New conversation", status: "active", token_usage: {} },
};

/** The messages route's Task A2 success body: `202 {queued, job_id, conversation_id}`. */
function queuedMessagesResponse(conversationId: string) {
  return json({ queued: true, job_id: "job-1", conversation_id: conversationId }, 202);
}

describe("AgentChatDrawer (P-T11)", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    setAdminToken("tok");
    eventScripts = {};
    streamAgentEvents.mockClear();
  });

  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("sends a message, renders the assistant bubble + change card, and clears the textarea", async () => {
    eventScripts["/api/sites/s1/agent/conversations/c1/events"] = ASSISTANT_AND_CHANGE_EVENTS;
    let capturedBody: unknown;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/agent/conversations" && method === "GET") {
        return json({ conversations: [] });
      }
      if (url === "/api/sites/s1/agent/conversations" && method === "POST") {
        return json(NEW_CONVERSATION, 201);
      }
      if (url === "/api/sites/s1/agent/conversations/c1/messages" && method === "POST") {
        capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
        return queuedMessagesResponse("c1");
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderDrawer();

    await waitFor(() => expect(screen.getByLabelText("Message")).toBeTruthy());

    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Build a homepage" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Lazily creates the conversation, POSTs (enqueue-only) the message,
    // then tails `/events` for the background job's progress.
    await waitFor(() => expect(streamAgentEvents).toHaveBeenCalledTimes(1));
    expect(streamAgentEvents.mock.calls[0][0]).toBe("/api/sites/s1/agent/conversations/c1/events");
    expect(capturedBody).toEqual({ message: "Build a homepage" });

    await waitFor(() => expect(screen.getByText("Working…")).toBeTruthy());
    expect(screen.getByText("1 updated")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open page" })).toBeTruthy();
    expect(textarea.value).toBe("");
  });

  it("Revert calls the restore route and fires onSiteChanged", async () => {
    eventScripts["/api/sites/s1/agent/conversations/c1/events"] = ASSISTANT_AND_CHANGE_EVENTS;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/agent/conversations" && method === "GET") {
        return json({ conversations: [] });
      }
      if (url === "/api/sites/s1/agent/conversations" && method === "POST") {
        return json(NEW_CONVERSATION, 201);
      }
      if (url === "/api/sites/s1/agent/conversations/c1/messages" && method === "POST") {
        return queuedMessagesResponse("c1");
      }
      if (url === "/api/sites/s1/pages/p1/revisions/r1/restore" && method === "POST") {
        return json({ restored_from: "r1", revision: { id: "r2", created_at: "2026-07-27T00:00:00Z" } });
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { onSiteChanged } = renderDrawer();

    await waitFor(() => expect(screen.getByLabelText("Message")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Build a homepage" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Revert" })).toBeTruthy());
    // onSiteChanged already fired once for the tailed change.
    expect(onSiteChanged).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Revert" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === "/api/sites/s1/pages/p1/revisions/r1/restore")).toBe(
        true,
      ),
    );
    await waitFor(() => expect(onSiteChanged).toHaveBeenCalledTimes(2));
  });

  it("hydrates the transcript from persisted history when reopening on an existing conversation (fix round 1, finding 2)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/agent/conversations" && method === "GET") {
        return json({
          conversations: [{ id: "c9", site_id: "s1", title: "Old", status: "active", token_usage: {} }],
        });
      }
      if (url === "/api/sites/s1/agent/conversations/c9" && method === "GET") {
        return json({
          conversation: { id: "c9", site_id: "s1", title: "Old", status: "active", token_usage: {} },
          messages: [
            { id: "m1", conversation_id: "c9", role: "user", content: [{ type: "text", text: "Hello" }], created_at: "t1" },
            {
              id: "m2",
              conversation_id: "c9",
              role: "assistant",
              content: [{ type: "text", text: "Hi there" }],
              created_at: "t2",
            },
            {
              id: "m3",
              conversation_id: "c9",
              role: "tool",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "t1",
                  content: JSON.stringify({ page_id: "p9", revision_id: "r9", diff: { summary: "9 updated" } }),
                  is_error: false,
                },
              ],
              created_at: "t3",
            },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { onSiteChanged } = renderDrawer();

    await waitFor(() => expect(screen.getByText("Hi there")).toBeTruthy());
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText("9 updated")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revert" })).toBeTruthy();

    // History hydration must not itself trigger a site-changed refresh or
    // start a live tail (no autoTail was requested).
    expect(onSiteChanged).not.toHaveBeenCalled();
    expect(streamAgentEvents).not.toHaveBeenCalled();
  });

  it("merges a tail snapshot into hydrated history on reopen+autoTail, without wiping it (fix round 2)", async () => {
    // The tail is started with a cursor (the last hydrated message id), so
    // per the server contract its snapshot contains ONLY messages newer
    // than that cursor — here, one new tool-result change.
    eventScripts["/api/sites/s1/agent/conversations/c9/events?after=m2"] = [
      {
        type: "snapshot",
        conversation: { id: "c9", site_id: "s1", title: "Old", status: "active", token_usage: {} },
        messages: [
          {
            id: "m3",
            conversation_id: "c9",
            role: "tool",
            content: [
              {
                type: "tool_result",
                tool_use_id: "t2",
                content: JSON.stringify({ page_id: "p9", revision_id: "r10", diff: { summary: "10 updated" } }),
                is_error: false,
              },
            ],
            created_at: "t4",
          },
        ],
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/agent/conversations" && method === "GET") {
        return json({
          conversations: [{ id: "c9", site_id: "s1", title: "Old", status: "active", token_usage: {} }],
        });
      }
      if (url === "/api/sites/s1/agent/conversations/c9" && method === "GET") {
        return json({
          conversation: { id: "c9", site_id: "s1", title: "Old", status: "active", token_usage: {} },
          messages: [
            { id: "m1", conversation_id: "c9", role: "user", content: [{ type: "text", text: "Hello" }], created_at: "t1" },
            {
              id: "m2",
              conversation_id: "c9",
              role: "assistant",
              content: [{ type: "text", text: "Hi there" }],
              created_at: "t2",
            },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { onSiteChanged } = renderDrawer({ autoTail: true });

    // Hydrated history renders first.
    await waitFor(() => expect(screen.getByText("Hi there")).toBeTruthy());
    expect(screen.getByText("Hello")).toBeTruthy();

    // The autoTail'd snapshot's newer message merges in — the hydrated
    // history must still be there (no wipe) and must not be duplicated.
    await waitFor(() => expect(screen.getByText("10 updated")).toBeTruthy());
    expect(screen.getAllByText("Hello")).toHaveLength(1);
    expect(screen.getAllByText("Hi there")).toHaveLength(1);

    // Only the newly-tailed change should notify — hydration itself is silent.
    expect(onSiteChanged).toHaveBeenCalledTimes(1);
  });

  // ── Chat-UI upgrade (ported patterns from anchor-operations' copilot) ──

  /** GET .../conversations → none yet; POST .../conversations → NEW_CONVERSATION;
   * POST .../c1/messages → Task A2's `202 {queued, job_id, conversation_id}`. */
  function mockFreshConversationFetch() {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/agent/conversations" && method === "GET") {
        return json({ conversations: [] });
      }
      if (url === "/api/sites/s1/agent/conversations" && method === "POST") {
        return json(NEW_CONVERSATION, 201);
      }
      if (url === "/api/sites/s1/agent/conversations/c1" && method === "GET") {
        // Best-effort per-turn token-delta refetch (fires once the tail
        // reports a settled status) — not under test here, just needs to
        // resolve so it doesn't reject as "unexpected fetch".
        return json({ conversation: NEW_CONVERSATION.conversation });
      }
      if (url === "/api/sites/s1/agent/conversations/c1/messages" && method === "POST") {
        return queuedMessagesResponse("c1");
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it("Enter sends the message and clears the textarea; Shift+Enter does not send (item 5)", async () => {
    mockFreshConversationFetch();

    renderDrawer();
    const textarea = (await screen.findByLabelText("Message")) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(streamAgentEvents).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(streamAgentEvents).toHaveBeenCalledTimes(1));
    expect(textarea.value).toBe("");
  });

  it("shows preset chips in the empty state that call send() when clicked (item 9)", async () => {
    const fetchMock = mockFreshConversationFetch();

    renderDrawer();
    await waitFor(() => expect(screen.getByText("Add a services page")).toBeTruthy());

    fireEvent.click(screen.getByText("Add a services page"));
    await waitFor(() => expect(streamAgentEvents).toHaveBeenCalledTimes(1));
    expect(streamAgentEvents.mock.calls[0][0]).toBe("/api/sites/s1/agent/conversations/c1/events");
    expect(
      fetchMock.mock.calls.some((c) => {
        const [input, init] = c as [RequestInfo | URL, RequestInit | undefined];
        return (
          String(input) === "/api/sites/s1/agent/conversations/c1/messages" &&
          init?.body != null &&
          JSON.parse(init.body as string).message === "Add a services page"
        );
      }),
    ).toBe(true);
    // The empty-state CHIP is gone once the conversation has content (the
    // same text now legitimately appears once more, as the user bubble).
    expect(screen.queryByRole("button", { name: "Add a services page" })).toBeNull();
    expect(screen.getAllByText("Add a services page")).toHaveLength(1);
  });

  it("Stop aborts the in-flight turn and renders a centered 'Stopped.' line (item 4)", async () => {
    let capturedSignal: AbortSignal | undefined;
    streamAgentEvents.mockImplementationOnce(
      (_path: string, opts: { signal?: AbortSignal; onEvent: (e: Record<string, unknown>) => void }) =>
        new Promise<void>(() => {
          // Never resolves — like a real tail connection that's still open.
          capturedSignal = opts.signal;
        }),
    );
    mockFreshConversationFetch();

    renderDrawer();
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Build a homepage" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Wait for the tail to actually start before stopping it.
    await waitFor(() => expect(streamAgentEvents).toHaveBeenCalledTimes(1));
    const stopButton = screen.getByRole("button", { name: "Stop" });
    fireEvent.click(stopButton);

    expect(capturedSignal?.aborted).toBe(true);
    expect(screen.getByText("Stopped.")).toBeTruthy();
    // Send is available again — the turn is no longer "in flight".
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  // ── Bot-review fix wave ──

  it("has dialog semantics, focuses the composer on open, closes on Escape, and restores focus on close (item B)", async () => {
    mockFreshConversationFetch();
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { onClose, rerender } = renderDrawer();

    const dialog = screen.getByRole("dialog", { name: "Studio chat" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");

    const textarea = await screen.findByLabelText("Message");
    await waitFor(() => expect(document.activeElement).toBe(textarea));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Simulate the parent actually closing the drawer in response.
    rerender(
      <MemoryRouter>
        <AgentChatDrawer
          siteId="s1"
          slug="acme"
          open={false}
          onClose={onClose}
          onSiteChanged={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("renders a system line and re-enables the composer on a 409 (turn already running) (item 1)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/agent/conversations" && method === "GET") {
        return json({ conversations: [] });
      }
      if (url === "/api/sites/s1/agent/conversations" && method === "POST") {
        return json(NEW_CONVERSATION, 201);
      }
      if (url === "/api/sites/s1/agent/conversations/c1/messages" && method === "POST") {
        return json({ error: "turn already running" }, 409);
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderDrawer();
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Build a homepage" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(screen.getByText("A build is already running — wait for it to finish.")).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    // A 409 never gets far enough to start a tail.
    expect(streamAgentEvents).not.toHaveBeenCalled();
  });

  // ── Task 11: onStatusChange (site-detail agent-busy guard) ──

  it("reports busy via onStatusChange while a turn is in flight, and settles once the tail reports a non-running status", async () => {
    let onEventCb: ((e: Record<string, unknown>) => void) | undefined;
    streamAgentEvents.mockImplementationOnce(
      (_path: string, opts: { onEvent: (e: Record<string, unknown>) => void }) => {
        onEventCb = opts.onEvent;
        return new Promise<void>(() => {});
      },
    );
    mockFreshConversationFetch();
    const onStatusChange = vi.fn();

    renderDrawer({ onStatusChange });
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeTruthy());

    // Idle: not busy.
    expect(onStatusChange).toHaveBeenCalledWith(null, false);

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Build a homepage" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onEventCb).toBeTruthy());
    await waitFor(() =>
      expect(onStatusChange.mock.calls.some(([status, busy]) => status === "active" && busy === true)).toBe(true),
    );

    // No more in-request `turn_done` to watch for (Task A2) — a tailed
    // `status` event settling back to "active" is what clears busy now.
    act(() => onEventCb!({ type: "status", status: "active" }));

    await waitFor(() =>
      expect(onStatusChange.mock.calls[onStatusChange.mock.calls.length - 1]).toEqual(["active", false]),
    );
  });

  it("reports busy when a tailed status event marks the conversation as running", async () => {
    eventScripts["/api/sites/s1/agent/conversations/c9/events?after=m2"] = [
      { type: "status", status: "running" },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/agent/conversations" && method === "GET") {
        return json({
          conversations: [{ id: "c9", site_id: "s1", title: "Old", status: "active", token_usage: {} }],
        });
      }
      if (url === "/api/sites/s1/agent/conversations/c9" && method === "GET") {
        return json({
          conversation: { id: "c9", site_id: "s1", title: "Old", status: "active", token_usage: {} },
          messages: [
            { id: "m1", conversation_id: "c9", role: "user", content: [{ type: "text", text: "Hello" }], created_at: "t1" },
            {
              id: "m2",
              conversation_id: "c9",
              role: "assistant",
              content: [{ type: "text", text: "Hi there" }],
              created_at: "t2",
            },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const onStatusChange = vi.fn();

    renderDrawer({ autoTail: true, onStatusChange });

    await waitFor(() => expect(screen.getByText("Hi there")).toBeTruthy());
    await waitFor(() =>
      expect(onStatusChange.mock.calls.some(([status, busy]) => status === "running" && busy === true)).toBe(true),
    );
  });
});
