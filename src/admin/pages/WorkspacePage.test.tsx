// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { setAdminToken, clearAdminToken } from "../lib/adminToken.js";

/**
 * Task B2 (2026-07-30 lovable-workspace SDD). Mirrors
 * `AgentChatDrawer.test.tsx`'s tail-mocking pattern: `streamAgentEvents` is
 * mocked to synchronously replay scripted `AgentTailEvent`s for a given
 * `/events` path, so a send→202→tail round-trip can be asserted without a
 * real SSE connection.
 */
let eventScripts: Record<string, unknown[]>;

const streamAgentEvents = vi.fn(
  async (path: string, opts: { onEvent: (e: Record<string, unknown>) => void }) => {
    for (const e of eventScripts[path] ?? []) opts.onEvent(e as Record<string, unknown>);
  },
);

vi.mock("../lib/agent-api.js", () => ({
  streamAgentEvents: (...args: Parameters<typeof streamAgentEvents>) => streamAgentEvents(...args),
}));

const { WorkspacePage } = await import("./WorkspacePage.js");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const SITE = {
  id: "s1",
  slug: "acme",
  display_name: "Acme Dental",
  status: "active",
  default_brand_tokens: {},
  created_at: "2026-05-18T00:00:00Z",
  pages_count: 2,
  media_count: 0,
};
const HOME_PAGE = { id: "pg-home", slug: "home", title: "Home", status: "published", updated_at: "2026-06-01T00:00:00Z" };
const ABOUT_PAGE = { id: "pg-about", slug: "about", title: "About", status: "draft", updated_at: "2026-06-01T00:00:00Z" };

type FetchOverrides = {
  pages?: unknown[];
  git?: unknown;
  conversations?: unknown[];
};

function mockWorkspaceFetch(overrides: FetchOverrides = {}) {
  const pages = overrides.pages ?? [HOME_PAGE, ABOUT_PAGE];
  const git = overrides.git ?? { configured: false, repo: null, state: null };
  const conversations = overrides.conversations ?? [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/sites") return json({ sites: [SITE] });
    if (url === "/api/sites/s1") return json({ site: SITE });
    if (url === "/api/sites/s1/pages") return json({ pages });
    if (url === "/api/sites/s1/git") return json(git);
    if (url === "/api/sites/s1/agent/conversations" && method === "GET") {
      return json({ conversations });
    }
    if (url === "/api/sites/s1/agent/conversations" && method === "POST") {
      return json(
        { conversation: { id: "c1", site_id: "s1", title: "New conversation", status: "active", token_usage: {} } },
        201,
      );
    }
    if (url === "/api/sites/s1/agent/conversations/c1/messages" && method === "POST") {
      return json({ queued: true, job_id: "job-1", conversation_id: "c1", user_message_id: "m-user-1" }, 202);
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sites/:slug" element={<WorkspacePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("WorkspacePage (Task B2)", () => {
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

  it("defaults the page switcher to home and drives SitePreviewPanel's previewPageId prop", async () => {
    mockWorkspaceFetch();
    renderAt("/sites/acme");

    const iframe = (await screen.findByTitle("Draft preview")) as HTMLIFrameElement;
    await waitFor(() => expect(iframe.src).toContain("/api/sites/s1/pages/pg-home/preview"));

    const select = screen.getByLabelText("Page") as HTMLSelectElement;
    expect(select.value).toBe("pg-home");
    fireEvent.change(select, { target: { value: "pg-about" } });

    await waitFor(() => {
      const frame = screen.getByTitle("Draft preview") as HTMLIFrameElement;
      expect(frame.src).toContain("/api/sites/s1/pages/pg-about/preview");
    });
  });

  it("toggles the preview frame width between desktop (full) and mobile (390px)", async () => {
    mockWorkspaceFetch();
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    const frame = screen.getByTestId("workspace-preview-frame");
    expect(frame.className).toContain("w-full");

    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));
    expect(frame.className).toContain("w-[390px]");
    expect(screen.getByRole("button", { name: "Mobile" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Desktop" }));
    expect(frame.className).toContain("w-full");
  });

  it("auto-focuses the composer on ?ai=1", async () => {
    mockWorkspaceFetch();
    renderAt("/sites/acme?ai=1");

    const textarea = await screen.findByLabelText("Message");
    await waitFor(() => expect(document.activeElement).toBe(textarea));
  });

  it("does not auto-focus the composer without ?ai=1", async () => {
    mockWorkspaceFetch();
    renderAt("/sites/acme");

    const textarea = await screen.findByLabelText("Message");
    expect(document.activeElement).not.toBe(textarea);
  });

  it("shows the ai_error banner on ?ai=1&ai_error=1", async () => {
    mockWorkspaceFetch();
    renderAt("/sites/acme?ai=1&ai_error=1");
    await waitFor(() =>
      expect(screen.getByText(/initial AI build couldn.t be started automatically/)).toBeTruthy(),
    );
  });

  it("renders a GitHub deep link only when git sync is configured AND enabled", async () => {
    mockWorkspaceFetch({ git: { configured: true, repo: "acme-corp/content", state: { enabled: true } } });
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");
    const link = await screen.findByRole("link", { name: /GitHub/ });
    expect(link.getAttribute("href")).toBe("https://github.com/acme-corp/content/tree/main/sites/acme");
  });

  it("hides the GitHub link when git sync is configured but not enabled", async () => {
    mockWorkspaceFetch({ git: { configured: true, repo: "acme-corp/content", state: { enabled: false } } });
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");
    expect(screen.queryByRole("link", { name: /GitHub/ })).toBeNull();
  });

  it("hides the GitHub link when git sync isn't configured at all", async () => {
    mockWorkspaceFetch({ git: { configured: false, repo: null, state: null } });
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");
    expect(screen.queryByRole("link", { name: /GitHub/ })).toBeNull();
  });

  it("renders a disabled Publish button (wiring lands in B3)", async () => {
    mockWorkspaceFetch();
    renderAt("/sites/acme");
    const publish = (await screen.findByRole("button", { name: "Publish" })) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    expect(publish.title).toBe("coming in B3");
  });

  it("links Manage to the tab-based shell", async () => {
    mockWorkspaceFetch();
    renderAt("/sites/acme");
    const link = await screen.findByRole("link", { name: "Manage" });
    expect(link.getAttribute("href")).toBe("/sites/acme/manage");
  });

  it("sends a chat message and renders the assistant reply via the tail (happy path)", async () => {
    eventScripts["/api/sites/s1/agent/conversations/c1/events?after=m-user-1"] = [
      {
        type: "message",
        message: {
          id: "m2",
          conversation_id: "c1",
          role: "assistant",
          content: [{ type: "text", text: "Building it now…" }],
          created_at: "t2",
        },
      },
    ];
    mockWorkspaceFetch();
    renderAt("/sites/acme");

    const textarea = (await screen.findByLabelText("Message")) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Add a services page" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(streamAgentEvents).toHaveBeenCalledTimes(1));
    expect(streamAgentEvents.mock.calls[0][0]).toBe(
      "/api/sites/s1/agent/conversations/c1/events?after=m-user-1",
    );
    await waitFor(() => expect(screen.getByText("Building it now…")).toBeTruthy());
    expect(textarea.value).toBe("");
  });
});
