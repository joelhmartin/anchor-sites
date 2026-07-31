// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act, within } from "@testing-library/react";
import { SitePreviewPanel } from "./SitePreviewPanel.js";
import { setAdminToken, clearAdminToken } from "../lib/adminToken.js";
import type { ComponentProps } from "react";
import type { ImagePickerDialog as ImagePickerDialogType } from "./ImagePickerDialog.js";

// Task 11: mock createInlineEditor so tests can capture the `events` it was
// wired with and invoke them directly (image-pick/link-edit requests,
// save-state changes), and assert on the calls made to the returned handle
// (attach/applyImage/applyField/setReadonly/flush/destroy) without exercising
// the real debounce/save-cycle machinery (that's inline-editor.test.ts's job).
const { inlineEditorCalls, inlineEditorHandle } = vi.hoisted(() => {
  const handle = {
    token: "tok-edit-1",
    attach: vi.fn(),
    applyField: vi.fn(),
    applyImage: vi.fn(),
    readProp: vi.fn(),
    setReadonly: vi.fn(),
    flush: vi.fn(async () => {}),
    destroy: vi.fn(),
  };
  return { inlineEditorCalls: [] as Array<Record<string, unknown>>, inlineEditorHandle: handle };
});
vi.mock("../lib/inline-editor.js", () => ({
  createInlineEditor: (opts: Record<string, unknown>) => {
    inlineEditorCalls.push(opts);
    return inlineEditorHandle;
  },
}));

// Task 11: stub the image picker dialog — its own sources/upload/stock flows
// are covered by ImagePickerDialog's own tests; here we only need to assert
// it opens/closes and that a pick reaches `handle.applyImage`.
const { imagePickerCalls } = vi.hoisted(() => ({
  imagePickerCalls: [] as Array<ComponentProps<typeof ImagePickerDialogType>>,
}));
vi.mock("./ImagePickerDialog.js", () => ({
  ImagePickerDialog: (props: ComponentProps<typeof ImagePickerDialogType>) => {
    imagePickerCalls.push(props);
    return props.open ? <div data-testid="image-picker-stub">Image picker stub</div> : null;
  },
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type PageRow = { id: string; slug: string; title: string; status: string; updated_at: string };

const PREVIEW_TTL_MS = 15 * 60 * 1000;

/** Fake mint response shaped like the real one (preview-token.ts's `pv1.` format). */
function previewTokenFor(siteId: string, seq = 1) {
  return `pv1.${siteId}.1785000000.sig${seq}`;
}

/**
 * Routes the two endpoints the panel itself hits:
 *   GET  /api/sites/:id/pages         -> pages
 *   POST /api/sites/:id/preview-token -> the short-lived, site-scoped iframe
 *                                        credential (2026-07-30 prod fix)
 *
 * `mintFails: true` simulates a deployment/route that can't mint, which is
 * what exercises the legacy-localStorage-token fallback.
 */
function mockPagesApi(
  siteId: string,
  pages: PageRow[] = [],
  opts: { mintFails?: boolean; mintFailsAfter?: number } = {},
) {
  let mintSeq = 0;
  const mintCalls: string[] = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `/api/sites/${siteId}/pages`) return json({ pages });
    const mint = /^\/api\/sites\/([^/]+)\/preview-token$/.exec(url);
    if (mint) {
      mintCalls.push(mint[1]);
      if (opts.mintFails) return json({ error: "preview tokens not configured" }, 503);
      if (opts.mintFailsAfter !== undefined && mintCalls.length > opts.mintFailsAfter)
        return json({ error: "transient" }, 503);
      mintSeq += 1;
      return json({
        token: previewTokenFor(mint[1], mintSeq),
        expires_at: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
      });
    }
    return json({ error: "not found" }, 404);
  }) as unknown as typeof fetch;
  return { mintCalls };
}

describe("SitePreviewPanel (extracted from SiteDetailPage's DraftPreview, Task B1)", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    setAdminToken("tok");
    inlineEditorCalls.length = 0;
    imagePickerCalls.length = 0;
    inlineEditorHandle.attach.mockClear();
    inlineEditorHandle.applyField.mockClear();
    inlineEditorHandle.applyImage.mockClear();
    inlineEditorHandle.readProp.mockReset();
    inlineEditorHandle.setReadonly.mockClear();
    inlineEditorHandle.flush.mockClear();
    inlineEditorHandle.destroy.mockClear();
  });
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("shows a draft preview iframe for the first page, authed by a server-minted preview token", async () => {
    mockPagesApi("s1", [{ id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" }]);
    render(<SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={false} />);

    await waitFor(() => expect(screen.getByTitle("Draft preview")).toBeTruthy());
    // Item 9: `v=<previewNonce>` (0 on the first render) makes each preview
    // bump a distinct URL, not just a re-mounted iframe pointed at the same one.
    await waitFor(() =>
      expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toBe(
        `/api/sites/s1/pages/pg1/preview?token=${encodeURIComponent(previewTokenFor("s1", 1))}&v=0`,
      ),
    );
    const iframe = screen.getByTitle("Draft preview") as HTMLIFrameElement;
    // Critical 2: the preview iframe is same-origin (served from /api/...),
    // so it MUST be sandboxed — allow-scripts without allow-same-origin
    // gives it an opaque origin that can't reach the admin's storage/cookies.
    // That sandbox is also exactly WHY the credential has to be in the query
    // string: an opaque origin sends no cookies, so the Studio session can't
    // reach this request.
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
  });

  // THE PROD BUG (2026-07-30, operator-reported). Google-OAuth operators have
  // no localStorage admin token, so the old `getAdminToken()`-only src
  // degraded to `?v=0` and the preview route 401'd every load. A session-authed
  // mint (`apiFetch` sends the cookie) is what closes that.
  it("mints a preview token via the session-authed API when no legacy token is stored", async () => {
    clearAdminToken();
    const { mintCalls } = mockPagesApi("s1", [
      { id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" },
    ]);
    render(<SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={false} />);

    await waitFor(() => expect(screen.getByTitle("Draft preview")).toBeTruthy());
    await waitFor(() =>
      expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toBe(
        `/api/sites/s1/pages/pg1/preview?token=${encodeURIComponent(previewTokenFor("s1", 1))}&v=0`,
      ),
    );
    expect(mintCalls).toEqual(["s1"]);
    const post = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => String(c[0]).endsWith("/preview-token"),
    );
    expect((post?.[1] as RequestInit).method).toBe("POST");
    // apiFetch sends the Studio session cookie — the whole point of minting
    // from the SPA rather than from inside the (cookie-less) iframe.
    expect((post?.[1] as RequestInit).credentials).toBe("include");
  });

  it("falls back to the legacy localStorage admin token when minting is unavailable (dev workflow)", async () => {
    mockPagesApi(
      "s1",
      [{ id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" }],
      { mintFails: true },
    );
    render(<SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={false} />);

    await waitFor(() => expect(screen.getByTitle("Draft preview")).toBeTruthy());
    expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toBe(
      `/api/sites/s1/pages/pg1/preview?token=tok&v=0`,
    );
  });

  it("omits the token query param entirely when there is neither a minted nor a legacy token", async () => {
    clearAdminToken();
    mockPagesApi(
      "s1",
      [{ id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" }],
      { mintFails: true },
    );
    render(<SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={false} />);

    await waitFor(() => expect(screen.getByTitle("Draft preview")).toBeTruthy());
    const iframe = screen.getByTitle("Draft preview") as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toBe(`/api/sites/s1/pages/pg1/preview?v=0`);
  });

  // A preview token is scoped to ONE site (the server rejects it for any
  // other), so switching sites must re-mint, never reuse.
  it("re-mints for a new siteId instead of reusing the previous site's token", async () => {
    clearAdminToken();
    const { mintCalls } = mockPagesApi("s2", [
      { id: "pg9", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" },
    ]);
    const { rerender } = render(
      <SitePreviewPanel siteId="s1" previewPageId="pg9" previewNonce={0} agentBusy={false} />,
    );
    await waitFor(() => expect(mintCalls).toContain("s1"));

    rerender(<SitePreviewPanel siteId="s2" previewPageId="pg9" previewNonce={0} agentBusy={false} />);

    await waitFor(() => expect(mintCalls).toContain("s2"));
    await waitFor(() =>
      expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toContain(
        encodeURIComponent(previewTokenFor("s2", 2)),
      ),
    );
  });

  it("bubbles a drawer change event into the preview: swaps the page id and forces a reload", async () => {
    mockPagesApi("s1", [{ id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" }]);
    const { rerender } = render(
      <SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={false} />,
    );
    await waitFor(() => expect(screen.getByTitle("Draft preview")).toBeTruthy());

    const beforeSrc = (screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src");
    expect(beforeSrc).toContain("/pages/pg1/preview");

    // Simulates SiteDetailView's handleChangeEvent lifting the drawer's
    // AgentChangeEvent into previewPageId/previewNonce props.
    rerender(<SitePreviewPanel siteId="s1" previewPageId="pg2" previewNonce={1} agentBusy={false} />);

    await waitFor(() =>
      expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toContain(
        "/pages/pg2/preview",
      ),
    );
    // Item 9: the nonce bump must also show up in the URL itself (not just
    // the swapped page id) — that's what makes it a genuinely distinct URL
    // a cache can't legitimately serve stale.
    expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toContain("v=1");
  });

  // ── Task 11: inline edit mode + agent-busy guard ──

  async function openPreviewInEditMode() {
    mockPagesApi("s1", [{ id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" }]);
    const utils = render(<SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={false} />);
    await waitFor(() => expect(screen.getByTitle("Draft preview")).toBeTruthy());
    fireEvent.click(within(screen.getByTestId("draft-preview-panel")).getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(inlineEditorCalls.length).toBe(1));
    return utils;
  }

  it("Edit toggle turns on inline editing: fills the frame (no width cap, in or out of edit mode) and appends edit=1&bridge= to the iframe src", async () => {
    mockPagesApi("s1", [{ id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" }]);
    render(<SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={false} />);
    await waitFor(() => expect(screen.getByTitle("Draft preview")).toBeTruthy());

    const editToggle = within(screen.getByTestId("draft-preview-panel")).getByRole("button", { name: "Edit" });
    expect(editToggle.getAttribute("aria-pressed")).toBe("false");
    // Task B6 (Lovable-grade visual pass): the panel always fills its
    // wrapping frame — no more max-w-md/max-w-3xl cap that shrank the
    // desktop preview to a small box. `WorkspacePage`'s outer frame now
    // owns the border/shadow/margin; this panel just fills it.
    expect(screen.getByTestId("draft-preview-panel").className).toContain("h-full");
    expect(screen.getByTestId("draft-preview-panel").className).not.toContain("max-w");

    fireEvent.click(editToggle);
    expect(editToggle.getAttribute("aria-pressed")).toBe("true");

    // Synchronous — fireEvent.click already flushes the click handler's
    // batched state updates, so the handle exists and the src carries the
    // bridge token on this very render (fix-round-1 finding 1 regression:
    // previously the handle was created a tick later in an effect, so this
    // first render would have been missing `&edit=1&bridge=`).
    expect(inlineEditorCalls.length).toBe(1);
    expect(inlineEditorCalls[0]).toMatchObject({ siteId: "s1", pageId: "pg1" });
    const iframe = screen.getByTitle("Draft preview") as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toContain(`&edit=1&bridge=${inlineEditorHandle.token}`);
    expect(iframe.className).toContain("flex-1");
    expect(screen.getByTestId("draft-preview-panel").className).not.toContain("max-w");

    // Turning it back off flushes and destroys the handle.
    fireEvent.click(editToggle);
    await waitFor(() => expect(inlineEditorHandle.flush).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(inlineEditorHandle.destroy).toHaveBeenCalledTimes(1));
    expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).not.toContain("edit=1");
  });

  // Edit mode rebuilds the src as `…?token=…&v=…&edit=1&bridge=…`. The
  // preview token has to survive that rebuild or clicking Edit would 401 the
  // frame — the credential and the bridge token are independent things riding
  // the same query string.
  it("carries the preview token into edit mode alongside edit=1&bridge=", async () => {
    clearAdminToken();
    mockPagesApi("s1", [{ id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" }]);
    render(<SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={false} />);
    await waitFor(() =>
      expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toContain("token=pv1"),
    );

    fireEvent.click(within(screen.getByTestId("draft-preview-panel")).getByRole("button", { name: "Edit" }));

    const src = (screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src") ?? "";
    expect(src).toContain(`token=${encodeURIComponent(previewTokenFor("s1", 1))}`);
    expect(src).toContain(`&edit=1&bridge=${inlineEditorHandle.token}`);
  });

  // ── preview-token refresh (2026-07-30) ──
  //
  // A 15-minute token would otherwise go stale under a long-open workspace:
  // the next iframe remount, and every rewritten sibling-page link inside the
  // CURRENT document, carry whatever token was embedded when it loaded. A
  // proactive re-mint at ~80% of the TTL keeps that fresh. (There is no
  // reactive 401 path to test: the iframe is sandboxed onto an opaque origin,
  // so `onLoad` fires for a 401 body exactly as it does for a 200 and the
  // parent can read neither status nor document. Proactive refresh is the
  // only signal available.)

  it("re-mints the preview token at ~80% of its TTL and adopts the fresh one", async () => {
    clearAdminToken();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { mintCalls } = mockPagesApi("s1", [
        { id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" },
      ]);
      render(<SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={false} />);
      await waitFor(() =>
        expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toContain(
          encodeURIComponent(previewTokenFor("s1", 1)),
        ),
      );
      expect(mintCalls.length).toBe(1);

      // Just short of 80% — still the original token, no second mint.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PREVIEW_TTL_MS * 0.7);
      });
      expect(mintCalls.length).toBe(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(PREVIEW_TTL_MS * 0.15);
      });
      await waitFor(() => expect(mintCalls.length).toBe(2));
      await waitFor(() =>
        expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toContain(
          encodeURIComponent(previewTokenFor("s1", 2)),
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // Swapping the src mid-edit-session would navigate the iframe out from
  // under the live contenteditable session — the same class of silent data
  // loss `displayed.pageId` is pinned for. The refreshed token is held back
  // until edit mode exits.
  // Security-review follow-up (2026-07-30): a FAILED refresh must not discard
  // the token we already hold (still valid ~3 more minutes) — doing so blanked
  // a working preview over one network blip, with no recovery until remount.
  it("keeps the current token and retries when a refresh mint fails", async () => {
    clearAdminToken();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { mintCalls } = mockPagesApi(
        "s1",
        [{ id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" }],
        { mintFailsAfter: 1 },
      );
      render(<SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={false} />);
      const token1 = encodeURIComponent(previewTokenFor("s1", 1));
      await waitFor(() =>
        expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toContain(token1),
      );

      // Refresh timer fires; the mint 503s.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PREVIEW_TTL_MS);
      });
      await waitFor(() => expect(mintCalls.length).toBeGreaterThan(1));

      // The still-valid token stays in the src — no blanking, no credential drop.
      expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toContain(token1);

      // And a bounded retry is scheduled (another mint attempt within ~20s).
      const before = mintCalls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(21_000);
      });
      await waitFor(() => expect(mintCalls.length).toBeGreaterThan(before));
    } finally {
      vi.useRealTimers();
    }
  });

  it("never swaps the credential mid-edit-session — the refreshed token is adopted on exit", async () => {
    clearAdminToken();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { mintCalls } = mockPagesApi("s1", [
        { id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" },
      ]);
      render(<SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={false} />);
      await waitFor(() =>
        expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toContain(
          encodeURIComponent(previewTokenFor("s1", 1)),
        ),
      );

      const editToggle = within(screen.getByTestId("draft-preview-panel")).getByRole("button", { name: "Edit" });
      fireEvent.click(editToggle);
      const editingSrc = (screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src") ?? "";
      expect(editingSrc).toContain("edit=1");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(PREVIEW_TTL_MS);
      });
      await waitFor(() => expect(mintCalls.length).toBeGreaterThan(1));

      // Refreshed in state, but the LIVE frame is untouched.
      expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toBe(editingSrc);

      fireEvent.click(editToggle);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await waitFor(() =>
        expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toContain(
          encodeURIComponent(previewTokenFor("s1", mintCalls.length)),
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Task B6 (screenshot-driven follow-up): intentional loading/empty
  // states — the operator's screenshot showed a bare, blank-looking box
  // where the preview should be while pages were still loading; `return
  // null` there is indistinguishable from a bug. ──

  it("shows a loading skeleton (not a blank/broken box) while the pages fetch is in flight", async () => {
    // Only the PAGES fetch is held open — the panel also POSTs for a preview
    // token on mount, and pinning that call's resolver here instead would
    // leave the pages request hanging forever.
    let resolvePages!: (v: Response) => void;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/sites/s1/pages") {
        return new Promise<Response>((resolve) => {
          resolvePages = resolve;
        });
      }
      return json({ error: "not found" }, 404);
    }) as unknown as typeof fetch;

    render(<SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={false} />);

    expect(screen.getByTestId("draft-preview-panel")).toBeTruthy();
    expect(screen.getByText("Loading preview…")).toBeTruthy();
    expect(screen.queryByTitle("Draft preview")).toBeNull();

    resolvePages(json({ pages: [] }));
    await waitFor(() => expect(screen.getByText(/This page is empty/)).toBeTruthy());
  });

  it("shows an intentional empty-state message (not a blank/broken box) when the site has no pages to preview", async () => {
    mockPagesApi("s1", []);
    render(<SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={false} />);

    await waitFor(() =>
      expect(screen.getByText("This page is empty — ask the agent to fill it.")).toBeTruthy(),
    );
    expect(screen.queryByTitle("Draft preview")).toBeNull();
  });

  it("attaches the inline editor to the iframe on its load event, exactly once", async () => {
    await openPreviewInEditMode();
    const iframe = screen.getByTitle("Draft preview") as HTMLIFrameElement;
    inlineEditorHandle.attach.mockClear();

    fireEvent.load(iframe);

    expect(inlineEditorHandle.attach).toHaveBeenCalledTimes(1);
    expect(inlineEditorHandle.attach).toHaveBeenCalledWith(iframe);
  });

  it("bumps the preview nonce once edit-mode exit's flush resolves, so the plain iframe re-fetches saved content", async () => {
    await openPreviewInEditMode();
    const editToggle = within(screen.getByTestId("draft-preview-panel")).getByRole("button", { name: "Edit" });

    fireEvent.click(editToggle); // turn edit off — kicks off flush().then(bump nonce).finally(destroy)

    await waitFor(() => expect(inlineEditorHandle.flush).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const src = (screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src") ?? "";
      const match = src.match(/[?&]v=(\d+)/);
      expect(match).toBeTruthy();
      // Nonce started at 0 (first render); the post-flush bump must move it
      // past that, not leave the iframe pointed at a URL a cache could
      // still be legitimately serving stale for.
      expect(Number(match?.[1])).toBeGreaterThan(0);
    });
  });

  it("shows a save-state chip driven by the inline editor's onSaveStateChange", async () => {
    await openPreviewInEditMode();
    const events = inlineEditorCalls[0].events as { onSaveStateChange: (s: string) => void };

    act(() => events.onSaveStateChange("saving"));
    await waitFor(() => expect(screen.getByText("Saving…")).toBeTruthy());

    act(() => events.onSaveStateChange("saved"));
    await waitFor(() => expect(screen.getByText("Saved · just now")).toBeTruthy());

    act(() => events.onSaveStateChange("error"));
    // Minor (a): match the real retry behavior — runSaveCycle retries
    // exactly once then stops; a terminal failure is resent on the NEXT
    // edit or an explicit flush(), not by continuing to auto-retry.
    await waitFor(() => expect(screen.getByText("Save failed — will retry on next edit")).toBeTruthy());
  });

  it("shows a readonly banner and forces the inline editor readonly while the agent drawer reports busy", async () => {
    const { rerender } = await openPreviewInEditMode();

    expect(screen.queryByText(/The AI is working on this site/)).toBeNull();

    // Simulates the drawer's onStatusChange lifting agentBusy=true into this prop.
    rerender(<SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={true} />);

    await waitFor(() => expect(screen.getByText(/The AI is working on this site/)).toBeTruthy());
    await waitFor(() =>
      expect(inlineEditorHandle.setReadonly).toHaveBeenLastCalledWith(true, "The AI is working on this site…"),
    );
    // Minor (b): the toggle is gated on ENTERING edit mode while busy, but
    // must stay clickable while ALREADY editing so the operator can still
    // exit (flush + destroy the handle) instead of being trapped in edit
    // mode for the whole duration of an AI run.
    expect(
      within(screen.getByTestId("draft-preview-panel")).getByRole("button", { name: "Edit" }).hasAttribute("disabled"),
    ).toBe(false);

    rerender(<SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={false} />);
    await waitFor(() => expect(inlineEditorHandle.setReadonly).toHaveBeenLastCalledWith(false, undefined));
    expect(screen.queryByText(/The AI is working on this site/)).toBeNull();
  });

  it("Minor (b): still gates ENTERING edit mode while the agent is busy (not editing yet)", async () => {
    mockPagesApi("s1", [{ id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" }]);
    const { rerender } = render(
      <SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={false} />,
    );
    await waitFor(() => expect(screen.getByTitle("Draft preview")).toBeTruthy());

    rerender(<SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={true} />);

    const editToggle = within(screen.getByTestId("draft-preview-panel")).getByRole("button", { name: "Edit" });
    await waitFor(() => expect(editToggle.hasAttribute("disabled")).toBe(true));
    expect(inlineEditorCalls.length).toBe(0);
  });

  it("opens the image picker on an image-pick request, and a pick calls handle.applyImage", async () => {
    await openPreviewInEditMode();
    expect(screen.queryByTestId("image-picker-stub")).toBeNull();

    const events = inlineEditorCalls[0].events as { onImagePickRequest: (b: string, f: string) => void };
    act(() => events.onImagePickRequest("blk1", "image"));

    await waitFor(() => expect(screen.getByTestId("image-picker-stub")).toBeTruthy());
    expect(imagePickerCalls[imagePickerCalls.length - 1].siteId).toBe("s1");
    // Final review Important 4: onImagePickRequest must ask the handle for
    // the block's CURRENT alt via readProp — a stale/empty dialog would
    // clobber a previously-authored alt on save.
    expect(inlineEditorHandle.readProp).toHaveBeenCalledWith("blk1", "alt");

    act(() => {
      imagePickerCalls[imagePickerCalls.length - 1].onPick({
        asset_id: "asset-1",
        src: "https://cdn.example.com/asset-1.jpg",
        alt: "A picture",
      });
    });

    expect(inlineEditorHandle.applyImage).toHaveBeenCalledWith(
      "blk1",
      "image",
      "asset-1",
      "https://cdn.example.com/asset-1.jpg",
      "A picture",
    );
    await waitFor(() => expect(screen.queryByTestId("image-picker-stub")).toBeNull());
  });

  it("Important 4: seeds ImagePickerDialog's initialAlt from the image block's existing alt text", async () => {
    await openPreviewInEditMode();
    inlineEditorHandle.readProp.mockReturnValue("Existing alt text");

    const events = inlineEditorCalls[0].events as { onImagePickRequest: (b: string, f: string) => void };
    act(() => events.onImagePickRequest("blk1", "image"));

    await waitFor(() => expect(screen.getByTestId("image-picker-stub")).toBeTruthy());
    expect(imagePickerCalls[imagePickerCalls.length - 1].initialAlt).toBe("Existing alt text");
  });

  it("opens the link popover on a link-edit request; Save calls handle.applyField with a valid URL", async () => {
    await openPreviewInEditMode();
    const events = inlineEditorCalls[0].events as {
      onLinkEditRequest: (b: string, f: string, v: string) => void;
    };
    act(() => events.onLinkEditRequest("blk2", "href", "https://old.example.com"));

    await waitFor(() => expect(screen.getByText("Edit link")).toBeTruthy());
    const urlInput = screen.getByLabelText("URL") as HTMLInputElement;
    expect(urlInput.value).toBe("https://old.example.com");

    fireEvent.change(urlInput, { target: { value: "https://new.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(inlineEditorHandle.applyField).toHaveBeenCalledWith("blk2", "href", "https://new.example.com");
    await waitFor(() => expect(screen.queryByText("Edit link")).toBeNull());
  });

  it("rejects a non-http(s) URL in the link popover without calling applyField", async () => {
    await openPreviewInEditMode();
    const events = inlineEditorCalls[0].events as {
      onLinkEditRequest: (b: string, f: string, v: string) => void;
    };
    act(() => events.onLinkEditRequest("blk3", "href", ""));

    await waitFor(() => expect(screen.getByText("Edit link")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(inlineEditorHandle.applyField).not.toHaveBeenCalled();
    expect(screen.getByText(/valid http/)).toBeTruthy();
  });

  it("suppresses the preview reload while an edit session is dirty", async () => {
    const { rerender } = await openPreviewInEditMode();
    const events = inlineEditorCalls[0].events as { onSaveStateChange: (s: string) => void };
    act(() => events.onSaveStateChange("dirty"));

    const beforeSrc = (screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src");

    rerender(<SitePreviewPanel siteId="s1" previewPageId="pg2" previewNonce={1} agentBusy={false} />);
    // Still dirty — the change-event reload must be suppressed (would drop
    // the contenteditable session).
    expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toBe(beforeSrc);
  });

  // Final review Important 3: a change event's new page-id must not apply
  // while edit mode is on AT ALL — not just while dirty. The live
  // `InlineEditorHandle` is scoped to whichever page was displayed when
  // edit mode was toggled on (`toggleEdit` reads `displayed.pageId`); if
  // the iframe remounts onto a different page mid-session, the handle
  // keeps saving to the OLD page while any edits made on the newly-shown
  // page are silently dropped (nothing is editing it). The queued switch
  // is only allowed to apply once edit mode turns off.
  it("Important 3: pins the displayed page for the whole edit session (not just while dirty) — a queued page switch only applies after toggling edit off", async () => {
    const { rerender } = await openPreviewInEditMode();
    const events = inlineEditorCalls[0].events as { onSaveStateChange: (s: string) => void };
    const beforeSrc = (screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src");
    expect(beforeSrc).toContain("/pages/pg1/preview");

    rerender(<SitePreviewPanel siteId="s1" previewPageId="pg2" previewNonce={1} agentBusy={false} />);
    // Not dirty at all (still "idle") — under the OLD (dirty-only) guard
    // this would have applied immediately. It must stay pinned to pg1.
    expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toContain(
      "/pages/pg1/preview",
    );

    // Cycling through dirty -> saved while STILL editing must not release
    // the pin either.
    act(() => events.onSaveStateChange("dirty"));
    act(() => events.onSaveStateChange("saved"));
    expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toContain(
      "/pages/pg1/preview",
    );

    // Only toggling edit OFF applies the queued switch.
    const editToggle = within(screen.getByTestId("draft-preview-panel")).getByRole("button", { name: "Edit" });
    fireEvent.click(editToggle);
    await waitFor(() =>
      expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toContain(
        "/pages/pg2/preview",
      ),
    );
  });
});
