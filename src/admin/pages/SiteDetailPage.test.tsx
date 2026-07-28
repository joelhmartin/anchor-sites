// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SiteDetailPage } from "./SiteDetailPage.js";
import { setAdminToken, clearAdminToken } from "../lib/adminToken.js";
import type { AgentChatDrawerProps } from "../components/AgentChatDrawer.js";
import type { ImagePickerDialog as ImagePickerDialogType } from "../components/ImagePickerDialog.js";

// Stub the Studio chat drawer (Task 11) so this suite can assert the props
// Task 12 threads into it (open/autoTail/onChangeEvent) without dealing with
// its own conversation-loading fetches.
const { drawerCalls } = vi.hoisted(() => ({ drawerCalls: [] as AgentChatDrawerProps[] }));
vi.mock("../components/AgentChatDrawer.js", () => ({
  AgentChatDrawer: (props: AgentChatDrawerProps) => {
    drawerCalls.push(props);
    return props.open ? <div data-testid="agent-drawer-stub">Studio chat stub (open)</div> : null;
  },
}));

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
vi.mock("../components/ImagePickerDialog.js", () => ({
  ImagePickerDialog: (props: ComponentProps<typeof ImagePickerDialogType>) => {
    imagePickerCalls.push(props);
    return props.open ? <div data-testid="image-picker-stub">Image picker stub</div> : null;
  },
}));

const SITE = {
  id: "s1",
  slug: "acme",
  display_name: "Acme Dental",
  status: "active",
  default_brand_tokens: { "--theme-main": "#0a3d62" },
  created_at: "2026-05-18T00:00:00Z",
  pages_count: 2,
  media_count: 4,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type PageRow = { id: string; slug: string; title: string; status: string; updated_at: string };

/** Routes /api/sites -> list, /api/sites/:id -> detail, /api/sites/:id/pages -> pages. */
function mockApi(list: unknown[], detail: typeof SITE | null, pages: PageRow[] = []) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/sites") return json({ sites: list });
    if (detail && url === `/api/sites/${detail.id}/pages`) return json({ pages });
    if (detail && url === `/api/sites/${detail.id}/media`) return json({ media: [] });
    if (detail && url === `/api/sites/${detail.id}`) return json({ site: detail });
    return json({ error: "not found" }, 404);
  }) as unknown as typeof fetch;
}

function renderAt(slug: string, search = "") {
  return render(
    <MemoryRouter initialEntries={[`/sites/${slug}${search}`]}>
      <Routes>
        <Route path="/" element={<div>sites list</div>} />
        <Route path="/sites/:slug" element={<SiteDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SiteDetailPage (P4-T4.12)", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    setAdminToken("tok");
    drawerCalls.length = 0;
    inlineEditorCalls.length = 0;
    imagePickerCalls.length = 0;
    inlineEditorHandle.attach.mockClear();
    inlineEditorHandle.applyField.mockClear();
    inlineEditorHandle.applyImage.mockClear();
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

  it("resolves slug to the site and loads its detail (name + status)", async () => {
    mockApi([SITE], SITE);
    renderAt("acme");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme Dental" })).toBeTruthy());
    expect(screen.getByText("active")).toBeTruthy();
  });

  it("switches between tabs, mounting only the active panel", async () => {
    mockApi([SITE], SITE);
    renderAt("acme");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Pages" })).toBeTruthy());

    // Pages is the default tab — the real PagesTab shows a "+ New page" affordance.
    expect(screen.getByRole("button", { name: "+ New page" })).toBeTruthy();
    expect(screen.queryByText(/arrive in Task 4.14/)).toBeNull();

    // P8-T8.13 added the per-tenant content tabs.
    expect(screen.getByRole("tab", { name: "Blog" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Events" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Members" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Media" }));
    expect(screen.getByRole("button", { name: "Upload image" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "+ New page" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });

  it("links 'View live site' to the canonical tenant hostname", async () => {
    mockApi([SITE], SITE);
    renderAt("acme");
    const link = await screen.findByRole("link", { name: /View live site/ });
    expect(link.getAttribute("href")).toBe("https://acme.sites.anchorcorps.com");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("shows a not-found card when the slug has no matching site", async () => {
    mockApi([SITE], SITE);
    renderAt("ghost");
    await waitFor(() => expect(screen.getByText(/No site found for/)).toBeTruthy());
  });

  it("shows a banner when the wizard hands off with ai_error=1 (item 8 — conversation/job POST failed after site creation)", async () => {
    mockApi([SITE], SITE);
    renderAt("acme", "?ai=1&ai_error=1");
    await waitFor(() =>
      expect(screen.getByText(/initial AI build couldn.t be started automatically/)).toBeTruthy(),
    );
  });

  it("does not show the ai_error banner on a normal ?ai=1 hand-off", async () => {
    mockApi([SITE], SITE);
    renderAt("acme", "?ai=1");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme Dental" })).toBeTruthy());
    expect(screen.queryByText(/initial AI build couldn.t be started automatically/)).toBeNull();
  });

  it("opens the Studio drawer on ?ai=1 (wizard hand-off) with autoTail on", async () => {
    mockApi([SITE], SITE);
    renderAt("acme", "?ai=1");
    await waitFor(() => expect(drawerCalls.length).toBeGreaterThan(0));
    const last = drawerCalls[drawerCalls.length - 1];
    expect(last.open).toBe(true);
    expect(last.autoTail).toBe(true);
    expect(last.siteId).toBe("s1");
    expect(last.slug).toBe("acme");
  });

  it("toggles the Studio drawer via the AI header button (aria-pressed)", async () => {
    mockApi([SITE], SITE);
    renderAt("acme");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme Dental" })).toBeTruthy());

    const aiButton = screen.getByRole("button", { name: "AI" });
    expect(aiButton.getAttribute("aria-pressed")).toBe("false");
    expect(drawerCalls[drawerCalls.length - 1]?.open).toBe(false);

    fireEvent.click(aiButton);
    expect(aiButton.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(drawerCalls[drawerCalls.length - 1]?.open).toBe(true));
  });

  it("shows a draft preview iframe for the first page, with the admin token as a query param", async () => {
    mockApi([SITE], SITE, [
      { id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" },
    ]);
    renderAt("acme");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme Dental" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    await waitFor(() => expect(screen.getByTitle("Draft preview")).toBeTruthy());
    const iframe = screen.getByTitle("Draft preview") as HTMLIFrameElement;
    // Item 9: `v=<previewNonce>` (0 on the first render) makes each preview
    // bump a distinct URL, not just a re-mounted iframe pointed at the same one.
    expect(iframe.getAttribute("src")).toBe(`/api/sites/s1/pages/pg1/preview?token=tok&v=0`);
    // Critical 2: the preview iframe is same-origin (served from /api/...),
    // so it MUST be sandboxed — allow-scripts without allow-same-origin
    // gives it an opaque origin that can't reach the admin's storage/cookies.
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("omits the token query param when Studio runs on session auth (no token stored)", async () => {
    clearAdminToken();
    mockApi([SITE], SITE, [
      { id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" },
    ]);
    renderAt("acme");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme Dental" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    await waitFor(() => expect(screen.getByTitle("Draft preview")).toBeTruthy());
    const iframe = screen.getByTitle("Draft preview") as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toBe(`/api/sites/s1/pages/pg1/preview?v=0`);
  });

  it("only fetches the site's pages list when the AI drawer is open (doesn't duplicate PagesTab's own fetch)", async () => {
    mockApi([SITE], SITE, [
      { id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" },
    ]);
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    renderAt("acme");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme Dental" })).toBeTruthy());

    const pagesCalls = () => fetchMock.mock.calls.filter(([u]) => String(u) === "/api/sites/s1/pages").length;
    // Pages is the default active tab, so PagesTab's own fetch already fired —
    // that's the only reason this is 1, not 0. The drawer/preview must not
    // add a second, redundant call while it's closed.
    expect(pagesCalls()).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() => expect(screen.getByTitle("Draft preview")).toBeTruthy());
    expect(pagesCalls()).toBe(2);
  });

  it("bubbles a drawer change event into the preview: swaps the page id and forces a reload", async () => {
    mockApi([SITE], SITE, [
      { id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" },
    ]);
    renderAt("acme");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme Dental" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() => expect(screen.getByTitle("Draft preview")).toBeTruthy());

    const beforeSrc = (screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src");
    expect(beforeSrc).toContain("/pages/pg1/preview");

    const last = drawerCalls[drawerCalls.length - 1];
    act(() => {
      last.onChangeEvent?.({ kind: "page_updated", page_id: "pg2", revision_id: "rev1", summary: "Updated hero" });
    });

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
    mockApi([SITE], SITE, [
      { id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" },
    ]);
    renderAt("acme");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme Dental" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() => expect(screen.getByTitle("Draft preview")).toBeTruthy());
    fireEvent.click(within(screen.getByTestId("draft-preview-panel")).getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(inlineEditorCalls.length).toBe(1));
  }

  it("Edit toggle turns on inline editing: widens the panel and appends edit=1&bridge= to the iframe src", async () => {
    mockApi([SITE], SITE, [
      { id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" },
    ]);
    renderAt("acme");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme Dental" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() => expect(screen.getByTitle("Draft preview")).toBeTruthy());

    const editToggle = within(screen.getByTestId("draft-preview-panel")).getByRole("button", { name: "Edit" });
    expect(editToggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("draft-preview-panel").className).toContain("max-w-md");

    fireEvent.click(editToggle);
    expect(editToggle.getAttribute("aria-pressed")).toBe("true");

    await waitFor(() => expect(inlineEditorCalls.length).toBe(1));
    expect(inlineEditorCalls[0]).toMatchObject({ siteId: "s1", pageId: "pg1" });

    await waitFor(() => {
      const iframe = screen.getByTitle("Draft preview") as HTMLIFrameElement;
      expect(iframe.getAttribute("src")).toContain(`&edit=1&bridge=${inlineEditorHandle.token}`);
    });
    const iframe = screen.getByTitle("Draft preview") as HTMLIFrameElement;
    expect(iframe.className).toContain("h-[70vh]");
    expect(screen.getByTestId("draft-preview-panel").className).toContain("max-w-3xl");

    // Turning it back off flushes and destroys the handle.
    fireEvent.click(editToggle);
    await waitFor(() => expect(inlineEditorHandle.flush).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(inlineEditorHandle.destroy).toHaveBeenCalledTimes(1));
    expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).not.toContain("edit=1");
  });

  it("shows a save-state chip driven by the inline editor's onSaveStateChange", async () => {
    await openPreviewInEditMode();
    const events = inlineEditorCalls[0].events as { onSaveStateChange: (s: string) => void };

    act(() => events.onSaveStateChange("saving"));
    await waitFor(() => expect(screen.getByText("Saving…")).toBeTruthy());

    act(() => events.onSaveStateChange("saved"));
    await waitFor(() => expect(screen.getByText("Saved · just now")).toBeTruthy());

    act(() => events.onSaveStateChange("error"));
    await waitFor(() => expect(screen.getByText("Save failed — retrying")).toBeTruthy());
  });

  it("shows a readonly banner and forces the inline editor readonly while the agent drawer reports busy", async () => {
    await openPreviewInEditMode();
    const last = drawerCalls[drawerCalls.length - 1];

    expect(screen.queryByText(/The AI is working on this site/)).toBeNull();

    act(() => {
      last.onStatusChange?.("running", true);
    });

    await waitFor(() => expect(screen.getByText(/The AI is working on this site/)).toBeTruthy());
    await waitFor(() =>
      expect(inlineEditorHandle.setReadonly).toHaveBeenLastCalledWith(true, "The AI is working on this site…"),
    );
    // The Edit toggle itself is gated too — can't leave/enter edit mode mid-run.
    expect(
      within(screen.getByTestId("draft-preview-panel")).getByRole("button", { name: "Edit" }).hasAttribute("disabled"),
    ).toBe(true);

    act(() => {
      last.onStatusChange?.("active", false);
    });
    await waitFor(() => expect(inlineEditorHandle.setReadonly).toHaveBeenLastCalledWith(false, undefined));
    expect(screen.queryByText(/The AI is working on this site/)).toBeNull();
  });

  it("opens the image picker on an image-pick request, and a pick calls handle.applyImage", async () => {
    await openPreviewInEditMode();
    expect(screen.queryByTestId("image-picker-stub")).toBeNull();

    const events = inlineEditorCalls[0].events as { onImagePickRequest: (b: string, f: string) => void };
    act(() => events.onImagePickRequest("blk1", "image"));

    await waitFor(() => expect(screen.getByTestId("image-picker-stub")).toBeTruthy());
    expect(imagePickerCalls[imagePickerCalls.length - 1].siteId).toBe("s1");

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

  it("suppresses the preview reload while an edit session is dirty, then catches up once it settles", async () => {
    await openPreviewInEditMode();
    const events = inlineEditorCalls[0].events as { onSaveStateChange: (s: string) => void };
    act(() => events.onSaveStateChange("dirty"));

    const last = drawerCalls[drawerCalls.length - 1];
    const beforeSrc = (screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src");

    act(() => {
      last.onChangeEvent?.({ kind: "page_updated", page_id: "pg2", revision_id: "rev1", summary: "Updated hero" });
    });
    // Still dirty — the change-event reload must be suppressed (would drop
    // the contenteditable session).
    expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toBe(beforeSrc);

    act(() => events.onSaveStateChange("saved"));
    await waitFor(() =>
      expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).toContain(
        "/pages/pg2/preview",
      ),
    );
  });
});
