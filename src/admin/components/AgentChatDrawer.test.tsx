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

const streamAgentEvents = vi.fn(
  async (_path: string, opts: { onEvent: (e: Record<string, unknown>) => void }) => {
    for (const e of SCRIPTED_EVENTS) opts.onEvent(e as unknown as Record<string, unknown>);
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

describe("AgentChatDrawer (P-T11)", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    setAdminToken("tok");
    streamAgentEvents.mockClear();
  });

  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("sends a message, renders the assistant bubble + change card, and clears the textarea", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/agent/conversations" && method === "GET") {
        return json({ conversations: [] });
      }
      if (url === "/api/sites/s1/agent/conversations" && method === "POST") {
        return json(
          { conversation: { id: "c1", site_id: "s1", title: "New conversation", status: "active", token_usage: {} } },
          201,
        );
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/agent/conversations" && method === "GET") {
        return json({ conversations: [] });
      }
      if (url === "/api/sites/s1/agent/conversations" && method === "POST") {
        return json(
          { conversation: { id: "c1", site_id: "s1", title: "New conversation", status: "active", token_usage: {} } },
          201,
        );
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
});
