// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { setAdminToken, clearAdminToken } from "../lib/adminToken.js";
import type { AgentTurnEvent } from "../lib/agent-api.js";

// Fixed event sequence Task 11's brief scripts for the "send" path: an
// assistant text block, a tool_result carrying a page_updated change, then
// turn_done end_turn. `streamAgentEvents` is mocked to synchronously replay
// it — no real SSE parsing under test here (that's `agent-api.ts`'s job).
const SCRIPTED_EVENTS: AgentTurnEvent[] = [
  { type: "assistant_text", text: "Working…" },
  {
    type: "tool_result",
    name: "update_page",
    ok: true,
    change: { kind: "page_updated", page_id: "p1", revision_id: "r1", summary: "1 updated" },
  },
  { type: "turn_done", reason: "end_turn" },
];

// Same turn, but promoted to a background job mid-turn (deadline hit after
// the first tool call) — the client must then tail `/events` to keep
// filling in, WITHOUT re-rendering what it already showed live.
const PROMOTED_EVENTS: AgentTurnEvent[] = [
  { type: "assistant_text", text: "Working…" },
  {
    type: "tool_result",
    name: "update_page",
    ok: true,
    change: { kind: "page_updated", page_id: "p1", revision_id: "r1", summary: "1 updated" },
  },
  { type: "turn_done", reason: "promoted" },
];

// The tail's initial `snapshot` on a fresh (never-hydrated) conversation
// necessarily replays the WHOLE persisted history, including everything
// this turn already rendered live above — this is exactly what the
// "hydrate = replace" fix must dedupe against.
const PROMOTED_SNAPSHOT = {
  type: "snapshot",
  conversation: { id: "c1", site_id: "s1", title: "New conversation", status: "active", token_usage: {} },
  messages: [
    { id: "m1", conversation_id: "c1", role: "user", content: [{ type: "text", text: "Build a homepage" }], created_at: "t1" },
    { id: "m2", conversation_id: "c1", role: "assistant", content: [{ type: "text", text: "Working…" }], created_at: "t2" },
    {
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
  ],
};

// `eventScripts` maps a `streamAgentEvents` path to the events it should
// synchronously replay — lets each test drive both the inline "messages"
// stream and, when relevant, the tailed "events" stream distinctly.
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
    eventScripts["/api/sites/s1/agent/conversations/c1/messages"] = SCRIPTED_EVENTS;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/agent/conversations" && method === "GET") {
        return json({ conversations: [] });
      }
      if (url === "/api/sites/s1/agent/conversations" && method === "POST") {
        return json(NEW_CONVERSATION, 201);
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderDrawer();

    await waitFor(() => expect(screen.getByLabelText("Message")).toBeTruthy());

    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Build a homepage" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Lazily creates the conversation, then streams the scripted turn.
    await waitFor(() => expect(streamAgentEvents).toHaveBeenCalledTimes(1));
    expect(streamAgentEvents.mock.calls[0][0]).toBe("/api/sites/s1/agent/conversations/c1/messages");
    expect((streamAgentEvents.mock.calls[0][1] as { body?: unknown }).body).toEqual({ message: "Build a homepage" });

    await waitFor(() => expect(screen.getByText("Working…")).toBeTruthy());
    expect(screen.getByText("1 updated")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open page" })).toBeTruthy();
    expect(textarea.value).toBe("");
  });

  it("Revert calls the restore route and fires onSiteChanged", async () => {
    eventScripts["/api/sites/s1/agent/conversations/c1/messages"] = SCRIPTED_EVENTS;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/agent/conversations" && method === "GET") {
        return json({ conversations: [] });
      }
      if (url === "/api/sites/s1/agent/conversations" && method === "POST") {
        return json(NEW_CONVERSATION, 201);
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
    // onSiteChanged already fired once for the streamed change event.
    expect(onSiteChanged).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Revert" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === "/api/sites/s1/pages/p1/revisions/r1/restore")).toBe(
        true,
      ),
    );
    await waitFor(() => expect(onSiteChanged).toHaveBeenCalledTimes(2));
  });

  it("does not duplicate bubbles/cards when a turn is promoted mid-turn and the tail replays history (fix round 1, finding 1)", async () => {
    eventScripts["/api/sites/s1/agent/conversations/c1/messages"] = PROMOTED_EVENTS;
    eventScripts["/api/sites/s1/agent/conversations/c1/events"] = [PROMOTED_SNAPSHOT];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/agent/conversations" && method === "GET") {
        return json({ conversations: [] });
      }
      if (url === "/api/sites/s1/agent/conversations" && method === "POST") {
        return json(NEW_CONVERSATION, 201);
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { onSiteChanged } = renderDrawer();

    await waitFor(() => expect(screen.getByLabelText("Message")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Build a homepage" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // The promotion triggers a second streamAgentEvents call (the tail).
    await waitFor(() => expect(streamAgentEvents).toHaveBeenCalledTimes(2));
    expect(streamAgentEvents.mock.calls[1][0]).toBe("/api/sites/s1/agent/conversations/c1/events");

    // The tail's snapshot replays the SAME turn already shown live — must
    // render exactly once, not twice.
    await waitFor(() => expect(screen.getAllByText("Working…")).toHaveLength(1));
    expect(screen.getAllByText("1 updated")).toHaveLength(1);
    expect(screen.getAllByText("Build a homepage")).toHaveLength(1);

    // The live tool_result already fired onSiteChanged once; the replayed
    // history must not fire it again.
    expect(onSiteChanged).toHaveBeenCalledTimes(1);
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
});
