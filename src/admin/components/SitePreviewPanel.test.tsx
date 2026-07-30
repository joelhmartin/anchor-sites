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

/** Routes /api/sites/:id/pages -> pages (the only endpoint the panel itself fetches). */
function mockPagesApi(siteId: string, pages: PageRow[] = []) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `/api/sites/${siteId}/pages`) return json({ pages });
    return json({ error: "not found" }, 404);
  }) as unknown as typeof fetch;
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

  it("shows a draft preview iframe for the first page, with the admin token as a query param", async () => {
    mockPagesApi("s1", [{ id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" }]);
    render(<SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={false} />);

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
    mockPagesApi("s1", [{ id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" }]);
    render(<SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={false} />);

    await waitFor(() => expect(screen.getByTitle("Draft preview")).toBeTruthy());
    const iframe = screen.getByTitle("Draft preview") as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toBe(`/api/sites/s1/pages/pg1/preview?v=0`);
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

  it("Edit toggle turns on inline editing: widens the panel and appends edit=1&bridge= to the iframe src", async () => {
    mockPagesApi("s1", [{ id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" }]);
    render(<SitePreviewPanel siteId="s1" previewPageId={null} previewNonce={0} agentBusy={false} />);
    await waitFor(() => expect(screen.getByTitle("Draft preview")).toBeTruthy());

    const editToggle = within(screen.getByTestId("draft-preview-panel")).getByRole("button", { name: "Edit" });
    expect(editToggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("draft-preview-panel").className).toContain("max-w-md");

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
    expect(iframe.className).toContain("h-[70vh]");
    expect(screen.getByTestId("draft-preview-panel").className).toContain("max-w-3xl");

    // Turning it back off flushes and destroys the handle.
    fireEvent.click(editToggle);
    await waitFor(() => expect(inlineEditorHandle.flush).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(inlineEditorHandle.destroy).toHaveBeenCalledTimes(1));
    expect((screen.getByTitle("Draft preview") as HTMLIFrameElement).getAttribute("src")).not.toContain("edit=1");
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
