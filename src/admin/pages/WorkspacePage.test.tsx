// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
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
  /** GET /api/sites/s1/agent/conversations/:id → { conversation, messages } —
   * only needed when `conversations` seeds an existing one to reconnect to. */
  conversationDetail?: { conversation: unknown; messages: unknown[] };
  /** POST /api/sites/s1/publish response (Task B3). Defaults to matching
   * REAL server semantics against the default [HOME_PAGE, ABOUT_PAGE]
   * fixture: HOME is already 'published', only ABOUT is a draft, so a
   * real /publish call would report `published: 1`, not 2 — Fix round 1
   * (Critical finding 1) caught the earlier version of this mock hardcoding
   * `published: 2`, which masked a client bug that counted ALL pages
   * instead of only non-published ones. */
  publish?: { status: number; body: unknown };
};

function mockWorkspaceFetch(overrides: FetchOverrides = {}) {
  const pages = overrides.pages ?? [HOME_PAGE, ABOUT_PAGE];
  const git = overrides.git ?? { configured: false, repo: null, state: null };
  const conversations = overrides.conversations ?? [];
  const publish =
    overrides.publish ?? {
      status: 200,
      // Final review item 2b: the real route now reports whether the primary
      // domain has actually finished provisioning. The default fixture is the
      // finished case; the not-ready case has its own test below.
      body: { published: 1, live_url: "https://acme.example.com", live_url_ready: true },
    };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/sites") return json({ sites: [SITE] });
    if (url === "/api/sites/s1") return json({ site: SITE });
    if (url === "/api/sites/s1/pages") return json({ pages });
    if (url === "/api/sites/s1/git") return json(git);
    if (url === "/api/sites/s1/publish" && method === "POST") {
      return json(publish.body, publish.status);
    }
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
    // D318 — dedicated resume endpoint (no synthetic "continue" message).
    if (/\/agent\/conversations\/[^/]+\/resume$/.test(url) && method === "POST") {
      return json({ queued: true, job_id: "job-resume" }, 202);
    }
    if (overrides.conversationDetail && url.startsWith("/api/sites/s1/agent/conversations/") && method === "GET") {
      return json(overrides.conversationDetail);
    }
    // Task B6 — the top-bar `UserMenu`'s "Sign out" calls the same
    // `signOut()` helper AdminLayout's sidebar used to (session.ts).
    if (url === "/api/auth/sign-out" && method === "POST") {
      return json({});
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
        {/* Task B6 — UserMenu's "Sign out" navigates here; a stub route
            keeps that navigation from logging a router "no match" warning. */}
        <Route path="/login" element={<div>login</div>} />
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
    window.localStorage.removeItem("ac.workspace.chatWidth");
  });

  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    window.localStorage.removeItem("ac.workspace.chatWidth");
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

  // D323 — the banner is dismissable and clears on the first send.
  it("D323: the ai_error banner can be dismissed", async () => {
    mockWorkspaceFetch();
    renderAt("/sites/acme?ai_error=1");
    await waitFor(() =>
      expect(screen.getByText(/initial AI build couldn.t be started automatically/)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() =>
      expect(screen.queryByText(/initial AI build couldn.t be started automatically/)).toBeNull(),
    );
  });

  it("D323: sending a message clears the ai_error banner (and it stays gone)", async () => {
    mockWorkspaceFetch();
    renderAt("/sites/acme?ai_error=1");
    const textarea = (await screen.findByLabelText("Message")) as HTMLTextAreaElement;
    await screen.findByText(/initial AI build couldn.t be started automatically/);

    fireEvent.change(textarea, { target: { value: "Build me a homepage" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(screen.queryByText(/initial AI build couldn.t be started automatically/)).toBeNull(),
    );
  });

  it("renders a GitHub deep link only when git sync is configured AND enabled (D317: uses the server's canonical url)", async () => {
    mockWorkspaceFetch({
      git: {
        configured: true,
        repo: "acme-corp/content",
        state: { enabled: true },
        // D317 — the server now returns the canonical link (HEAD resolves the
        // real default branch; export path derived server-side).
        url: "https://github.com/acme-corp/content/tree/HEAD/sites/acme",
      },
    });
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");
    const link = await screen.findByRole("link", { name: /GitHub/ });
    expect(link.getAttribute("href")).toBe("https://github.com/acme-corp/content/tree/HEAD/sites/acme");
  });

  it("D317: falls back to the local derivation when an older server omits url", async () => {
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

  // ── Task B3 — one-click publish ──

  it("publishes only the draft pages: click opens a confirmation with the DRAFT count (not every page), confirm posts, and the live URL renders", async () => {
    // Fixture is [HOME_PAGE (published), ABOUT_PAGE (draft)] — the count
    // must come from the draft, not both pages (Fix round 1, Critical
    // finding 1: this test previously mocked `published: 2` against this
    // same fixture, which would have passed even with the bug it exists to
    // catch).
    const fetchMock = mockWorkspaceFetch();
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    const publish = (await screen.findByRole("button", { name: "Publish" })) as HTMLButtonElement;
    expect(publish.disabled).toBe(false);
    fireEvent.click(publish);

    const dialog = await screen.findByRole("dialog", { name: "Publish site" });
    expect(dialog.textContent).toContain("Publish 1 page?");

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input, init]) => String(input) === "/api/sites/s1/publish" && init?.method === "POST")).toBe(
        true,
      ),
    );

    const link = await screen.findByRole("link", { name: /https:\/\/acme\.example\.com/ });
    expect(link.getAttribute("href")).toBe("https://acme.example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("Published 1 page.")).toBeTruthy();
  });

  // FINAL whole-branch review, FIX-NOW items 2c + 3 — a live_url whose
  // domain is still provisioning must NOT read as a finished, clickable
  // site.
  it("renders the live URL as plain text plus a provisioning note when live_url_ready is false", async () => {
    mockWorkspaceFetch({
      publish: {
        status: 200,
        body: { published: 1, live_url: "https://acme.example.com", live_url_ready: false },
      },
    });
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
    await screen.findByRole("dialog", { name: "Publish site" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await screen.findByText("Published 1 page.");
    // The URL is shown (the operator still wants to know it) but is inert.
    expect(screen.queryByRole("link", { name: /acme\.example\.com/ })).toBeNull();
    expect(screen.getByText("https://acme.example.com")).toBeTruthy();
    expect(screen.getByText(/domain still provisioning/i)).toBeTruthy();
  });

  // Final-review item 3 follow-up: a FAILED provision must not hide behind the
  // reassuring "will go live shortly" note — that was exactly the state
  // (Cloud Run PermissionDenied → verification_status 'failed') that motivated
  // the finding.
  it("renders a failure note pointing at Manage → Domains when provisioning failed", async () => {
    mockWorkspaceFetch({
      publish: {
        status: 200,
        body: {
          published: 1,
          live_url: "https://acme.example.com",
          live_url_ready: false,
          live_url_status: { verification_status: "failed", ssl_status: "pending" },
        },
      },
    });
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
    await screen.findByRole("dialog", { name: "Publish site" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await screen.findByText("Published 1 page.");
    expect(screen.queryByRole("link", { name: /acme\.example\.com/ })).toBeNull();
    expect(screen.getByText(/provisioning failed/i)).toBeTruthy();
    expect(screen.queryByText(/will go live shortly/i)).toBeNull();
  });

  it("D312 — with nothing to publish, the button stays focusable and the popover explains (no dead disabled button)", async () => {
    mockWorkspaceFetch({ pages: [HOME_PAGE] }); // HOME_PAGE.status === "published"
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    const publish = (await screen.findByRole("button", { name: "Publish" })) as HTMLButtonElement;
    // Focusable — not a disabled button keyboard/SR users can't reach.
    expect(publish.disabled).toBe(false);
    fireEvent.click(publish);
    const dialog = await screen.findByRole("dialog", { name: "Publish site" });
    expect(dialog.textContent).toContain("Everything is published.");
    // No Confirm to accidentally publish nothing.
    expect(within(dialog).queryByRole("button", { name: "Confirm" })).toBeNull();
  });

  // ── W1.3 — publish means something ──

  it("D301: a PUBLISHED page with unpublished changes counts toward the pill — no more 'Nothing to publish' over unshipped edits", async () => {
    mockWorkspaceFetch({
      pages: [
        // Published, but edited since its last publish (server-computed flag).
        { ...HOME_PAGE, has_unpublished_changes: true },
        { ...ABOUT_PAGE, has_unpublished_changes: true },
      ],
    });
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    const publish = (await screen.findByRole("button", { name: "Publish" })) as HTMLButtonElement;
    expect(publish.disabled).toBe(false);
    fireEvent.click(publish);
    const dialog = await screen.findByRole("dialog", { name: "Publish site" });
    expect(dialog.textContent).toContain("Publish 2 pages?");
  });

  it("D301/D312: a clean published page (has_unpublished_changes:false) leaves the button focusable and the popover says everything is published", async () => {
    mockWorkspaceFetch({ pages: [{ ...HOME_PAGE, has_unpublished_changes: false }] });
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    const publish = (await screen.findByRole("button", { name: "Publish" })) as HTMLButtonElement;
    expect(publish.disabled).toBe(false);
    fireEvent.click(publish);
    const dialog = await screen.findByRole("dialog", { name: "Publish site" });
    expect(dialog.textContent).toContain("Everything is published.");
  });

  it("D610: a 409 (build running) surfaces the server's message in the confirmation popover", async () => {
    mockWorkspaceFetch({
      publish: {
        status: 409,
        body: { error: "Agent is running — publish is disabled until the build finishes." },
      },
    });
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
    await screen.findByRole("dialog", { name: "Publish site" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await screen.findByText(/Agent is running — publish is disabled/);
  });

  it("D321: with no domain connected (live_url null) the success state links to Manage → Domains instead of rendering nothing", async () => {
    mockWorkspaceFetch({
      publish: { status: 200, body: { published: 1, live_url: null } },
    });
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
    await screen.findByRole("dialog", { name: "Publish site" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await screen.findByText("Published 1 page.");
    const link = screen.getByRole("link", { name: /connect a domain/i });
    expect(link.getAttribute("href")).toBe("/sites/acme/manage?tab=domains");
    expect(screen.getByText(/no domain is connected yet/i)).toBeTruthy();
  });

  it("D611: a failed git-export enqueue is reported in the success popover (publish itself succeeded)", async () => {
    mockWorkspaceFetch({
      publish: {
        status: 200,
        body: {
          published: 1,
          live_url: "https://acme.example.com",
          live_url_ready: true,
          git_export: { queued: false, error: "boss not started" },
        },
      },
    });
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
    await screen.findByRole("dialog", { name: "Publish site" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await screen.findByText("Published 1 page.");
    expect(screen.getByText(/GitHub sync couldn’t be queued/)).toBeTruthy();
    expect(screen.getByText(/boss not started/)).toBeTruthy();
  });

  it("Cancel closes the confirmation without posting", async () => {
    const fetchMock = mockWorkspaceFetch();
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
    await screen.findByRole("dialog", { name: "Publish site" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Publish site" })).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/sites/s1/publish")).toBe(false);
  });

  it("renders the publish error inline (red treatment) when the POST fails", async () => {
    mockWorkspaceFetch({ publish: { status: 500, body: { error: "boom" } } });
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
    await screen.findByRole("dialog", { name: "Publish site" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    const errorEl = await screen.findByText("boom");
    expect(errorEl.className).toContain("text-red-600");
  });

  it("D312: while the agent is busy the Publish button stays focusable and the popover explains why publishing is blocked", async () => {
    mockWorkspaceFetch({
      conversations: [{ id: "c9", site_id: "s1", title: "Old", status: "running", token_usage: {} }],
      conversationDetail: {
        conversation: { id: "c9", site_id: "s1", title: "Old", status: "running", token_usage: {} },
        messages: [
          { id: "m1", conversation_id: "c9", role: "user", content: [{ type: "text", text: "Build me a homepage" }], created_at: "t1" },
        ],
      },
    });
    renderAt("/sites/acme");

    const publish = (await screen.findByRole("button", { name: "Publish" })) as HTMLButtonElement;
    expect(publish.disabled).toBe(false);
    fireEvent.click(publish);
    const dialog = await screen.findByRole("dialog", { name: "Publish site" });
    expect(dialog.textContent).toMatch(/agent is still building/i);
    expect(within(dialog).queryByRole("button", { name: "Confirm" })).toBeNull();
  });

  it("Fix round 1 (Important finding 2) — Escape closes the confirmation popover", async () => {
    mockWorkspaceFetch();
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
    await screen.findByRole("dialog", { name: "Publish site" });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Publish site" })).toBeNull());
  });

  it("Fix round 1 (Important finding 2) — a click outside the popover closes it", async () => {
    mockWorkspaceFetch();
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
    await screen.findByRole("dialog", { name: "Publish site" });

    fireEvent.mouseDown(document.body);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Publish site" })).toBeNull());
  });

  it("Fix round 1 (Important finding 2) — focuses the Confirm button when the popover opens", async () => {
    mockWorkspaceFetch();
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
    await screen.findByRole("dialog", { name: "Publish site" });

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Confirm" })));
  });

  it("Fix round 1 (Minor finding 3) / D312 — if the agent starts running while the popover is open, Confirm is withdrawn and the popover explains", async () => {
    mockWorkspaceFetch();
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("dialog", { name: "Publish site" });
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeTruthy();

    // Sending a chat message flips `sending` (and therefore `busy`) to true
    // synchronously, before the POST resolves — the same race the finding
    // describes ("the agent may start mid-popover").
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "Add a services page" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Confirm is withdrawn entirely (not just disabled) and the reason shows.
    await waitFor(() => expect(within(dialog).queryByRole("button", { name: "Confirm" })).toBeNull());
    expect(dialog.textContent).toMatch(/agent is still building/i);
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

  // ── Fix round 1 (reviewer) ──

  it("Finding 1 — reloads the page switcher (and keeps its value in sync) when a tailed tool call creates a page", async () => {
    // A mutable, shared-by-reference pages list: starts with just Home, so
    // the test can simulate the backend gaining a page mid-conversation by
    // pushing to the SAME array the fetch mock reads from on every call —
    // a later GET (triggered by the fix's reload) sees the new page; the
    // initial GET (on mount) must not.
    const pagesList: unknown[] = [HOME_PAGE];
    mockWorkspaceFetch({ pages: pagesList });

    renderAt("/sites/acme");
    await waitFor(() => {
      const select = screen.getByLabelText("Page") as HTMLSelectElement;
      expect(select.value).toBe("pg-home");
    });
    expect(screen.queryByRole("option", { name: "About" })).toBeNull();

    // The agent's tool call creates "About" — by the time its tool_result
    // is tailed back to the client, the page genuinely exists server-side,
    // so the (mocked) backend's pages list already reflects it.
    pagesList.push(ABOUT_PAGE);
    eventScripts["/api/sites/s1/agent/conversations/c1/events?after=m-user-1"] = [
      {
        type: "message",
        message: {
          id: "m2",
          conversation_id: "c1",
          role: "tool",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: JSON.stringify({ page_id: "pg-about", revision_id: "r1" }),
              is_error: false,
            },
          ],
          created_at: "t2",
        },
      },
    ];

    const textarea = await screen.findByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "Add an about page" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Before the fix, `onSiteChanged` was a no-op: the switcher would never
    // refetch, "About" would never appear, and `previewPageId` (pinned to
    // "pg-about" by the SAME event's `onChangeEvent`) would point at an
    // option that doesn't exist.
    await waitFor(() => expect(screen.getByRole("option", { name: "About" })).toBeTruthy());
    const select = screen.getByLabelText("Page") as HTMLSelectElement;
    expect(select.value).toBe("pg-about");
  });

  it("Finding 2 — reconnects to an already-running conversation on load: tail starts, busy shows, transcript hydrates", async () => {
    mockWorkspaceFetch({
      conversations: [{ id: "c9", site_id: "s1", title: "Old", status: "running", token_usage: {} }],
      conversationDetail: {
        conversation: { id: "c9", site_id: "s1", title: "Old", status: "running", token_usage: {} },
        messages: [
          { id: "m1", conversation_id: "c9", role: "user", content: [{ type: "text", text: "Build me a homepage" }], created_at: "t1" },
          { id: "m2", conversation_id: "c9", role: "assistant", content: [{ type: "text", text: "Working on it…" }], created_at: "t2" },
        ],
      },
    });

    renderAt("/sites/acme");

    // Hydrated from persisted history, not just the bare conversation row.
    await waitFor(() => expect(screen.getByText("Working on it…")).toBeTruthy());
    expect(screen.getByText("Build me a homepage")).toBeTruthy();

    // Reconnected — the tail is live, cursored at the last hydrated message.
    await waitFor(() =>
      expect(streamAgentEvents.mock.calls.some(([path]) => path === "/api/sites/s1/agent/conversations/c9/events?after=m2")).toBe(
        true,
      ),
    );

    // "running" reported busy immediately, from the bootstrap fetch alone —
    // no tail event needed to show it.
    expect(screen.getByLabelText("assistant is typing")).toBeTruthy();
  });

  it("Finding 2 — reconnects to an erroring conversation on load: error state hydrates with the Resume affordance", async () => {
    mockWorkspaceFetch({
      conversations: [{ id: "c9", site_id: "s1", title: "Old", status: "error", token_usage: {} }],
      conversationDetail: {
        conversation: { id: "c9", site_id: "s1", title: "Old", status: "error", token_usage: {} },
        messages: [
          {
            id: "m1",
            conversation_id: "c9",
            role: "assistant",
            content: [{ type: "text", text: "Anthropic credit balance too low — top up at console.anthropic.com" }],
            created_at: "t1",
          },
        ],
      },
    });

    renderAt("/sites/acme");

    await waitFor(() =>
      expect(screen.getByText("Anthropic credit balance too low — top up at console.anthropic.com")).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  // D318 — Resume posts the dedicated /resume endpoint (no "continue" user
  // bubble) and shows an honest, labeled system line instead.
  it("D318: Resume hits /resume, not a synthetic 'continue' user message", async () => {
    const fetchMock = mockWorkspaceFetch({
      conversations: [{ id: "c1", site_id: "s1", title: "Old", status: "error", token_usage: {} }],
      conversationDetail: {
        conversation: { id: "c1", site_id: "s1", title: "Old", status: "error", token_usage: {} },
        messages: [
          { id: "m1", conversation_id: "c1", role: "user", content: [{ type: "text", text: "Build me a homepage" }], created_at: "t1" },
        ],
      },
    });
    renderAt("/sites/acme");

    fireEvent.click(await screen.findByRole("button", { name: "Resume" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input) === "/api/sites/s1/agent/conversations/c1/resume" && init?.method === "POST",
        ),
      ).toBe(true),
    );
    // No "continue" was posted as a message, and no "continue" user bubble rendered.
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/messages")),
    ).toBe(false);
    expect(screen.queryByText("continue")).toBeNull();
    expect(screen.getByText("Resuming the build…")).toBeTruthy();
  });

  // ── Task B6 (2026-07-30 lovable-workspace SDD) — resizable chat rail ──

  it("exposes the chat-rail splitter as an accessible separator defaulting to 400px, adjustable by arrow keys and persisted to localStorage", async () => {
    mockWorkspaceFetch();
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    const splitter = screen.getByRole("separator", { name: "Resize chat panel" });
    expect(splitter.getAttribute("aria-orientation")).toBe("vertical");
    expect(splitter.getAttribute("aria-valuemin")).toBe("300");
    expect(splitter.getAttribute("aria-valuemax")).toBe("640");
    expect(splitter.getAttribute("aria-valuenow")).toBe("400");

    splitter.focus();
    fireEvent.keyDown(splitter, { key: "ArrowRight" });
    expect(splitter.getAttribute("aria-valuenow")).toBe("416");
    expect(window.localStorage.getItem("ac.workspace.chatWidth")).toBe("416");

    fireEvent.keyDown(splitter, { key: "ArrowLeft" });
    fireEvent.keyDown(splitter, { key: "ArrowLeft" });
    expect(splitter.getAttribute("aria-valuenow")).toBe("384");

    // Double-click resets to the 400px default.
    fireEvent.doubleClick(splitter);
    expect(splitter.getAttribute("aria-valuenow")).toBe("400");
    expect(window.localStorage.getItem("ac.workspace.chatWidth")).toBe("400");
  });

  it("clamps the splitter's keyboard adjustment to [300, 640] via Home/End", async () => {
    mockWorkspaceFetch();
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    const splitter = screen.getByRole("separator", { name: "Resize chat panel" });
    fireEvent.keyDown(splitter, { key: "End" });
    expect(splitter.getAttribute("aria-valuenow")).toBe("640");
    fireEvent.keyDown(splitter, { key: "Home" });
    expect(splitter.getAttribute("aria-valuenow")).toBe("300");
  });

  it("restores a previously chosen chat-rail width from localStorage on mount", async () => {
    window.localStorage.setItem("ac.workspace.chatWidth", "520");
    mockWorkspaceFetch();
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    expect(screen.getByRole("separator", { name: "Resize chat panel" }).getAttribute("aria-valuenow")).toBe(
      "520",
    );
  });

  // ── Task B6 (screenshot-driven follow-up) — no more admin sidebar on this
  // route; the account menu is the only sign-out affordance here now ──

  it("opens the account menu with a Sites link and a Sign out action that calls signOut() and navigates to /login", async () => {
    const fetchMock = mockWorkspaceFetch();
    renderAt("/sites/acme");
    await screen.findByTitle("Draft preview");

    expect(screen.queryByRole("menu", { name: "Account" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));

    const menu = screen.getByRole("menu", { name: "Account" });
    const sitesLink = within(menu).getByRole("menuitem", { name: "Sites" });
    expect(sitesLink.getAttribute("href")).toBe("/");

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/auth/sign-out")).toBe(true),
    );
  });

  it("W1.1/D213 — ?materializing shows an honest banner (count + template), polls the pages list, and retires itself when pages appear", async () => {
    mockWorkspaceFetch({ pages: [] });
    // Pages "materialize" ~1s in — so the mount fetches (WorkspaceView AND
    // SitePreviewPanel both hit this URL) see an empty site, and only the
    // 1.2s poll's refetch sees the landed pages.
    const start = Date.now();
    let pagesCalls = 0;
    const inner = global.fetch;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/sites/s1/pages") {
        pagesCalls++;
        return json({ pages: Date.now() - start > 1000 ? [HOME_PAGE, ABOUT_PAGE] : [] });
      }
      return (inner as typeof fetch)(input, init);
    }) as unknown as typeof fetch;

    renderAt("/sites/acme?materializing=2&template=Starter");

    await waitFor(() =>
      expect(screen.getByTestId("materializing-banner").textContent).toContain(
        "Materializing 2 pages from “Starter”",
      ),
    );

    // The poll (1.2s interval) refetches; once pages land the banner is gone.
    await waitFor(() => expect(screen.queryByTestId("materializing-banner")).toBeNull(), {
      timeout: 5000,
    });
    expect(pagesCalls).toBeGreaterThanOrEqual(3);
  }, 10_000);

  it("W1.1/D213 — no banner (and no polling) without the query param, even for a pageless site", async () => {
    const fetchMock = mockWorkspaceFetch({ pages: [] });
    renderAt("/sites/acme");
    await waitFor(() => expect(screen.getByTestId("workspace-preview-frame")).toBeTruthy());
    expect(screen.queryByTestId("materializing-banner")).toBeNull();
    const pagesFetches = () =>
      fetchMock.mock.calls.filter(([input]) => String(input) === "/api/sites/s1/pages").length;
    const before = pagesFetches();
    await new Promise((r) => setTimeout(r, 1500));
    expect(pagesFetches()).toBe(before);
  }, 10_000);
});
