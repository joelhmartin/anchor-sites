// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../../blocks/types.js";
import { ApiError, type apiFetch } from "./apiFetch.js";
import { createInlineEditor, type InlineEditorEvents } from "./inline-editor.js";

type FetchOpts = { method?: string; body?: unknown };
type FetchMock = ReturnType<typeof vi.fn<(path: string, opts?: FetchOpts) => Promise<unknown>>>;

function makeIframe(): HTMLIFrameElement {
  return { contentWindow: { postMessage: vi.fn() } } as unknown as HTMLIFrameElement;
}

function iframePostMessageMock(iframe: HTMLIFrameElement) {
  return (iframe.contentWindow as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage;
}

function makeEvents(): InlineEditorEvents & { states: string[] } {
  const states: string[] = [];
  return {
    states,
    onImagePickRequest: vi.fn(),
    onLinkEditRequest: vi.fn(),
    onSaveStateChange: vi.fn((s: string) => states.push(s)),
  };
}

function makeBlocks(): Block[] {
  return [
    { id: "b1", type: "rich-text", props: { html: "hello" } },
    { id: "b2", type: "image", props: { image: "old-asset-id", alt: "old alt" } },
  ];
}

function postFromOverlay(
  iframe: HTMLIFrameElement,
  token: string,
  msg: Record<string, unknown>,
): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { ac: "edit", token, ...msg },
      source: iframe.contentWindow as unknown as MessageEventSource,
    }),
  );
}

describe("createInlineEditor (Studio bridge + save engine)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("debounces rapid field-edits into exactly ONE POST after 2000ms, with source:inline", async () => {
    const blocksData = makeBlocks();
    const fetchImpl: FetchMock = vi.fn(async (_path: string, opts?: FetchOpts) => {
      if (!opts?.method || opts.method === "GET") return { page: { blocks: blocksData } };
      return { page: {}, revision: {} };
    });
    const events = makeEvents();
    const handle = createInlineEditor({
      siteId: "s1",
      pageId: "p1",
      events,
      fetchImpl: fetchImpl as unknown as typeof apiFetch,
    });
    const iframe = makeIframe();
    handle.attach(iframe);
    await vi.advanceTimersByTimeAsync(0); // let the attach() GET resolve

    postFromOverlay(iframe, handle.token, {
      type: "field-edit",
      blockId: "b1",
      field: "html",
      kind: "text",
      value: "one",
    });
    postFromOverlay(iframe, handle.token, {
      type: "field-edit",
      blockId: "b1",
      field: "html",
      kind: "text",
      value: "two",
    });
    postFromOverlay(iframe, handle.token, {
      type: "field-edit",
      blockId: "b2",
      field: "alt",
      kind: "text",
      value: "new alt",
    });

    await vi.advanceTimersByTimeAsync(2000);

    const postCalls = fetchImpl.mock.calls.filter(([, opts]) => opts?.method === "POST");
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0][0]).toBe("/api/sites/s1/pages/p1");
    expect(postCalls[0][1]?.body).toEqual({
      blocks: [
        { id: "b1", type: "rich-text", props: { html: "two" } },
        { id: "b2", type: "image", props: { image: "old-asset-id", alt: "new alt" } },
      ],
      source: "inline",
    });
    expect(events.states.at(-1)).toBe("saved");
  });

  it("retries once after a save failure, then reports error", async () => {
    const blocksData = makeBlocks();
    let postCallCount = 0;
    const fetchImpl: FetchMock = vi.fn(async (_path: string, opts?: FetchOpts) => {
      if (!opts?.method || opts.method === "GET") return { page: { blocks: blocksData } };
      postCallCount++;
      throw new ApiError("boom", 500, null);
    });
    const events = makeEvents();
    const handle = createInlineEditor({
      siteId: "s1",
      pageId: "p1",
      events,
      fetchImpl: fetchImpl as unknown as typeof apiFetch,
    });
    const iframe = makeIframe();
    handle.attach(iframe);
    await vi.advanceTimersByTimeAsync(0);

    postFromOverlay(iframe, handle.token, {
      type: "field-edit",
      blockId: "b1",
      field: "html",
      kind: "text",
      value: "x",
    });

    await vi.advanceTimersByTimeAsync(2000); // debounce fires, first POST fails, retry is scheduled
    await vi.advanceTimersByTimeAsync(1500); // retry fires, fails again -> error

    expect(postCallCount).toBe(2);
    expect(events.states.at(-1)).toBe("error");
  });

  // Mirrors the REAL server contract (src/server/routes/admin-pages.ts,
  // POST /sites/:siteId/pages/:pageId, lines ~91-95): block-content
  // rejection is 400 + { error: "block validation failed", failures }.
  // The server never sends 422 for this path — that was a planning-doc
  // assumption, not what's actually deployed.
  it("on a 400 block-validation-failed reject, re-GETs the page and reverts the rejected field via apply-field, then errors", async () => {
    const initialBlocks = makeBlocks();
    const serverBlocksAfterReject: Block[] = [
      { id: "b1", type: "rich-text", props: { html: "server-value" } },
      { id: "b2", type: "image", props: { image: "old-asset-id", alt: "old alt" } },
    ];
    let getCallCount = 0;
    const fetchImpl: FetchMock = vi.fn(async (_path: string, opts?: FetchOpts) => {
      if (!opts?.method || opts.method === "GET") {
        getCallCount++;
        return { page: { blocks: getCallCount === 1 ? initialBlocks : serverBlocksAfterReject } };
      }
      // Real shape from admin-pages.ts's `validateBlocks` failure branch:
      // res.status(400).json({ error: "block validation failed", failures })
      throw new ApiError("block validation failed", 400, {
        error: "block validation failed",
        failures: [
          { index: 0, id: "b1", type: "rich-text", reason: "invalid_props", errors: [{ path: "html", message: "too long" }] },
        ],
      });
    });
    const events = makeEvents();
    const handle = createInlineEditor({
      siteId: "s1",
      pageId: "p1",
      events,
      fetchImpl: fetchImpl as unknown as typeof apiFetch,
    });
    const iframe = makeIframe();
    handle.attach(iframe);
    await vi.advanceTimersByTimeAsync(0);

    postFromOverlay(iframe, handle.token, {
      type: "field-edit",
      blockId: "b1",
      field: "html",
      kind: "text",
      value: "bad-value",
    });

    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(0); // flush the reject handler's re-GET + revert

    expect(getCallCount).toBe(2);
    const postMessageCalls = iframePostMessageMock(iframe).mock.calls;
    const revertCall = postMessageCalls.find((args: unknown[]) => (args[0] as Record<string, unknown>).type === "apply-field");
    expect(revertCall?.[0]).toMatchObject({
      ac: "edit",
      token: handle.token,
      type: "apply-field",
      blockId: "b1",
      field: "html",
      value: "server-value",
    });
    expect(events.states.at(-1)).toBe("error");
  });

  // Belt: if the server contract ever changes to 422, the same revert path
  // still fires. Not the primary contract (see test above) — just coverage
  // for the fallback branch.
  it("also treats a 422 as a validation reject (belt for a future contract change)", async () => {
    const initialBlocks = makeBlocks();
    const serverBlocksAfterReject: Block[] = [
      { id: "b1", type: "rich-text", props: { html: "server-value" } },
      { id: "b2", type: "image", props: { image: "old-asset-id", alt: "old alt" } },
    ];
    let getCallCount = 0;
    const fetchImpl: FetchMock = vi.fn(async (_path: string, opts?: FetchOpts) => {
      if (!opts?.method || opts.method === "GET") {
        getCallCount++;
        return { page: { blocks: getCallCount === 1 ? initialBlocks : serverBlocksAfterReject } };
      }
      throw new ApiError("unprocessable", 422, { error: "unprocessable" });
    });
    const events = makeEvents();
    const handle = createInlineEditor({
      siteId: "s1",
      pageId: "p1",
      events,
      fetchImpl: fetchImpl as unknown as typeof apiFetch,
    });
    const iframe = makeIframe();
    handle.attach(iframe);
    await vi.advanceTimersByTimeAsync(0);

    postFromOverlay(iframe, handle.token, {
      type: "field-edit",
      blockId: "b1",
      field: "html",
      kind: "text",
      value: "bad-value",
    });

    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(0);

    expect(getCallCount).toBe(2);
    expect(events.states.at(-1)).toBe("error");
  });

  it("does NOT treat a generic 400 (malformed payload, no failures) as a validation reject — retries instead", async () => {
    const blocksData = makeBlocks();
    let postCallCount = 0;
    let getCallCount = 0;
    const fetchImpl: FetchMock = vi.fn(async (_path: string, opts?: FetchOpts) => {
      if (!opts?.method || opts.method === "GET") {
        getCallCount++;
        return { page: { blocks: blocksData } };
      }
      postCallCount++;
      // Real shape from admin-pages.ts's zod-parse failure branch — NOT a
      // block-content rejection, so it must fall through to retry/error,
      // not the revert path (which would wrongly re-GET here).
      throw new ApiError("invalid payload", 400, {
        error: "invalid payload",
        details: [{ path: "blocks", message: "required" }],
      });
    });
    const events = makeEvents();
    const handle = createInlineEditor({
      siteId: "s1",
      pageId: "p1",
      events,
      fetchImpl: fetchImpl as unknown as typeof apiFetch,
    });
    const iframe = makeIframe();
    handle.attach(iframe);
    await vi.advanceTimersByTimeAsync(0);

    postFromOverlay(iframe, handle.token, {
      type: "field-edit",
      blockId: "b1",
      field: "html",
      kind: "text",
      value: "x",
    });

    await vi.advanceTimersByTimeAsync(2000); // debounce fires, first POST fails
    await vi.advanceTimersByTimeAsync(1500); // retry fires, fails again -> error

    expect(getCallCount).toBe(1); // only the initial attach() GET — no revert re-GET
    expect(postCallCount).toBe(2); // the retry-once path, not the revert path
    expect(events.states.at(-1)).toBe("error");
  });

  it("applyImage saves immediately (no debounce wait) and posts apply-image to the iframe", async () => {
    const blocksData = makeBlocks();
    const postBodies: unknown[] = [];
    const fetchImpl: FetchMock = vi.fn(async (_path: string, opts?: FetchOpts) => {
      if (!opts?.method || opts.method === "GET") return { page: { blocks: blocksData } };
      postBodies.push(opts.body);
      return { page: {}, revision: {} };
    });
    const events = makeEvents();
    const handle = createInlineEditor({
      siteId: "s1",
      pageId: "p1",
      events,
      fetchImpl: fetchImpl as unknown as typeof apiFetch,
    });
    const iframe = makeIframe();
    handle.attach(iframe);
    await vi.advanceTimersByTimeAsync(0);

    handle.applyImage("b2", "image", "asset-42", "https://cdn.example.com/asset-42.jpg", "new alt text");
    await vi.advanceTimersByTimeAsync(0); // no 2s wait needed — flush microtasks only

    expect(postBodies).toHaveLength(1);
    expect(postBodies[0]).toEqual({
      blocks: [
        { id: "b1", type: "rich-text", props: { html: "hello" } },
        { id: "b2", type: "image", props: { image: "asset-42", alt: "new alt text" } },
      ],
      source: "inline",
    });

    const postMessageCalls = iframePostMessageMock(iframe).mock.calls;
    const imageMsg = postMessageCalls.find((args: unknown[]) => (args[0] as Record<string, unknown>).type === "apply-image");
    expect(imageMsg?.[0]).toMatchObject({
      ac: "edit",
      token: handle.token,
      type: "apply-image",
      blockId: "b2",
      field: "image",
      src: "https://cdn.example.com/asset-42.jpg",
      alt: "new alt text",
    });
  });

  it("ignores messages carrying the wrong token", async () => {
    const blocksData = makeBlocks();
    const fetchImpl: FetchMock = vi.fn(async (_path: string, opts?: FetchOpts) => {
      if (!opts?.method || opts.method === "GET") return { page: { blocks: blocksData } };
      return { page: {}, revision: {} };
    });
    const events = makeEvents();
    const handle = createInlineEditor({
      siteId: "s1",
      pageId: "p1",
      events,
      fetchImpl: fetchImpl as unknown as typeof apiFetch,
    });
    const iframe = makeIframe();
    handle.attach(iframe);
    await vi.advanceTimersByTimeAsync(0);

    postFromOverlay(iframe, "not-the-real-token", {
      type: "field-edit",
      blockId: "b1",
      field: "html",
      kind: "text",
      value: "hacked",
    });

    await vi.advanceTimersByTimeAsync(2000);

    const postCalls = fetchImpl.mock.calls.filter(([, opts]) => opts?.method === "POST");
    expect(postCalls).toHaveLength(0);
    expect(events.states).not.toContain("dirty");
  });

  it("drops incoming field-edits while readonly and tells the iframe to lock", async () => {
    const blocksData = makeBlocks();
    const fetchImpl: FetchMock = vi.fn(async (_path: string, opts?: FetchOpts) => {
      if (!opts?.method || opts.method === "GET") return { page: { blocks: blocksData } };
      return { page: {}, revision: {} };
    });
    const events = makeEvents();
    const handle = createInlineEditor({
      siteId: "s1",
      pageId: "p1",
      events,
      fetchImpl: fetchImpl as unknown as typeof apiFetch,
    });
    const iframe = makeIframe();
    handle.attach(iframe);
    await vi.advanceTimersByTimeAsync(0);

    handle.setReadonly(true, "another editor has the lock");
    postFromOverlay(iframe, handle.token, {
      type: "field-edit",
      blockId: "b1",
      field: "html",
      kind: "text",
      value: "should be dropped",
    });

    await vi.advanceTimersByTimeAsync(2000);

    const postCalls = fetchImpl.mock.calls.filter(([, opts]) => opts?.method === "POST");
    expect(postCalls).toHaveLength(0);

    const postMessageCalls = iframePostMessageMock(iframe).mock.calls;
    const readonlyMsg = postMessageCalls.find((args: unknown[]) => (args[0] as Record<string, unknown>).type === "set-readonly");
    expect(readonlyMsg?.[0]).toMatchObject({
      ac: "edit",
      token: handle.token,
      type: "set-readonly",
      on: true,
      reason: "another editor has the lock",
    });
  });

  it("applyField (Studio-initiated) patches the block, debounces a save, and pushes apply-field to the iframe", async () => {
    const blocksData = makeBlocks();
    const postBodies: unknown[] = [];
    const fetchImpl: FetchMock = vi.fn(async (_path: string, opts?: FetchOpts) => {
      if (!opts?.method || opts.method === "GET") return { page: { blocks: blocksData } };
      postBodies.push(opts.body);
      return { page: {}, revision: {} };
    });
    const events = makeEvents();
    const handle = createInlineEditor({
      siteId: "s1",
      pageId: "p1",
      events,
      fetchImpl: fetchImpl as unknown as typeof apiFetch,
    });
    const iframe = makeIframe();
    handle.attach(iframe);
    await vi.advanceTimersByTimeAsync(0);

    handle.applyField("b1", "html", "from the link popover");

    // not saved yet — still on the normal 2s debounce
    await vi.advanceTimersByTimeAsync(1000);
    expect(postBodies).toHaveLength(0);

    const postMessageCalls = iframePostMessageMock(iframe).mock.calls;
    const applyFieldMsg = postMessageCalls.find((args: unknown[]) => (args[0] as Record<string, unknown>).type === "apply-field");
    expect(applyFieldMsg?.[0]).toMatchObject({
      ac: "edit",
      token: handle.token,
      type: "apply-field",
      blockId: "b1",
      field: "html",
      value: "from the link popover",
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(postBodies).toHaveLength(1);
    expect(postBodies[0]).toEqual({
      blocks: [
        { id: "b1", type: "rich-text", props: { html: "from the link popover" } },
        { id: "b2", type: "image", props: { image: "old-asset-id", alt: "old alt" } },
      ],
      source: "inline",
    });
  });

  it("flush() forces a pending debounced save to run immediately and resolves once it settles", async () => {
    const blocksData = makeBlocks();
    const postBodies: unknown[] = [];
    const fetchImpl: FetchMock = vi.fn(async (_path: string, opts?: FetchOpts) => {
      if (!opts?.method || opts.method === "GET") return { page: { blocks: blocksData } };
      postBodies.push(opts.body);
      return { page: {}, revision: {} };
    });
    const events = makeEvents();
    const handle = createInlineEditor({
      siteId: "s1",
      pageId: "p1",
      events,
      fetchImpl: fetchImpl as unknown as typeof apiFetch,
    });
    const iframe = makeIframe();
    handle.attach(iframe);
    await vi.advanceTimersByTimeAsync(0);

    postFromOverlay(iframe, handle.token, {
      type: "field-edit",
      blockId: "b1",
      field: "html",
      kind: "text",
      value: "flush me",
    });

    const flushPromise = handle.flush();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromise;

    expect(postBodies).toHaveLength(1);
    expect(events.states.at(-1)).toBe("saved");
  });

  it("passes onImagePickRequest / onLinkEditRequest through untouched", async () => {
    const blocksData = makeBlocks();
    const fetchImpl: FetchMock = vi.fn(async (_path: string, opts?: FetchOpts) => {
      if (!opts?.method || opts.method === "GET") return { page: { blocks: blocksData } };
      return { page: {}, revision: {} };
    });
    const events = makeEvents();
    const handle = createInlineEditor({
      siteId: "s1",
      pageId: "p1",
      events,
      fetchImpl: fetchImpl as unknown as typeof apiFetch,
    });
    const iframe = makeIframe();
    handle.attach(iframe);
    await vi.advanceTimersByTimeAsync(0);

    postFromOverlay(iframe, handle.token, { type: "image-pick-request", blockId: "b2", field: "image" });
    postFromOverlay(iframe, handle.token, {
      type: "link-edit-request",
      blockId: "b1",
      field: "href",
      value: "https://example.com",
    });

    expect(events.onImagePickRequest).toHaveBeenCalledWith("b2", "image");
    expect(events.onLinkEditRequest).toHaveBeenCalledWith("b1", "href", "https://example.com");
  });

  // --- Fix round 1 (review I9): destroy() cancellation, flush()-after-error
  // resend, and attach() re-entrancy. ---

  it("destroy() mid-retry stops the retry: no further POST, no further onSaveStateChange", async () => {
    const blocksData = makeBlocks();
    let postCallCount = 0;
    const fetchImpl: FetchMock = vi.fn(async (_path: string, opts?: FetchOpts) => {
      if (!opts?.method || opts.method === "GET") return { page: { blocks: blocksData } };
      postCallCount++;
      throw new ApiError("boom", 500, null);
    });
    const events = makeEvents();
    const handle = createInlineEditor({
      siteId: "s1",
      pageId: "p1",
      events,
      fetchImpl: fetchImpl as unknown as typeof apiFetch,
    });
    const iframe = makeIframe();
    handle.attach(iframe);
    await vi.advanceTimersByTimeAsync(0);

    postFromOverlay(iframe, handle.token, {
      type: "field-edit",
      blockId: "b1",
      field: "html",
      kind: "text",
      value: "x",
    });

    await vi.advanceTimersByTimeAsync(2000); // debounce fires, POST #1 fails, retry(1500ms) scheduled
    expect(postCallCount).toBe(1);

    const statesBeforeDestroy = [...events.states];
    const postMessageCallsBeforeDestroy = iframePostMessageMock(iframe).mock.calls.length;

    handle.destroy(); // fires mid-retry-wait — must cancel, not let the retry fire
    await vi.advanceTimersByTimeAsync(1500); // if the retry weren't cancelled, this would fire it

    expect(postCallCount).toBe(1); // no retry POST after destroy
    expect(events.states).toEqual(statesBeforeDestroy); // no further onSaveStateChange calls
    expect(iframePostMessageMock(iframe).mock.calls.length).toBe(postMessageCallsBeforeDestroy); // no further postMessage
    expect(events.states.at(-1)).not.toBe("error"); // never reached the terminal error emission
    expect(events.states.at(-1)).not.toBe("saved");
  });

  it("flush() resends edits after a terminal (non-validation) save failure — Important 2", async () => {
    const blocksData = makeBlocks();
    let postCallCount = 0;
    const postBodies: unknown[] = [];
    const fetchImpl: FetchMock = vi.fn(async (_path: string, opts?: FetchOpts) => {
      if (!opts?.method || opts.method === "GET") return { page: { blocks: blocksData } };
      postCallCount++;
      postBodies.push(opts.body);
      if (postCallCount <= 2) throw new ApiError("boom", 500, null);
      return { page: {}, revision: {} };
    });
    const events = makeEvents();
    const handle = createInlineEditor({
      siteId: "s1",
      pageId: "p1",
      events,
      fetchImpl: fetchImpl as unknown as typeof apiFetch,
    });
    const iframe = makeIframe();
    handle.attach(iframe);
    await vi.advanceTimersByTimeAsync(0);

    postFromOverlay(iframe, handle.token, {
      type: "field-edit",
      blockId: "b1",
      field: "html",
      kind: "text",
      value: "resend me",
    });

    await vi.advanceTimersByTimeAsync(2000); // debounce fires -> POST #1 fails
    await vi.advanceTimersByTimeAsync(1500); // retry fires -> POST #2 fails -> terminal error

    expect(postCallCount).toBe(2);
    expect(events.states.at(-1)).toBe("error");

    // Without the fix, dirty/dirtyFields were cleared before POST #1 and
    // never restored — flush() would see nothing dirty and no-op here.
    const flushPromise = handle.flush();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromise;

    expect(postCallCount).toBe(3);
    expect(postBodies[2]).toEqual({
      blocks: [
        { id: "b1", type: "rich-text", props: { html: "resend me" } },
        { id: "b2", type: "image", props: { image: "old-asset-id", alt: "old alt" } },
      ],
      source: "inline",
    });
    expect(events.states.at(-1)).toBe("saved");
  });

  it("re-attaching removes the prior window listener instead of leaking a duplicate — minor (b)", async () => {
    const blocksData = makeBlocks();
    const fetchImpl: FetchMock = vi.fn(async (_path: string, opts?: FetchOpts) => {
      if (!opts?.method || opts.method === "GET") return { page: { blocks: blocksData } };
      return { page: {}, revision: {} };
    });
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const events = makeEvents();
    const handle = createInlineEditor({
      siteId: "s1",
      pageId: "p1",
      events,
      fetchImpl: fetchImpl as unknown as typeof apiFetch,
    });
    const iframe1 = makeIframe();
    const iframe2 = makeIframe();

    handle.attach(iframe1);
    await vi.advanceTimersByTimeAsync(0);
    handle.attach(iframe2);
    await vi.advanceTimersByTimeAsync(0);

    const messageAddCalls = addSpy.mock.calls.filter(([type]) => type === "message");
    const messageRemoveCalls = removeSpy.mock.calls.filter(([type]) => type === "message");
    expect(messageAddCalls).toHaveLength(2);
    expect(messageRemoveCalls).toHaveLength(1); // first attach()'s listener removed before the second is added

    // Prove the stale iframe1 listener is really gone, not just "removed
    // and re-added identically": a message sourced from iframe1 no longer
    // reaches the handler once iframe2 is the attached one.
    postFromOverlay(iframe1, handle.token, {
      type: "field-edit",
      blockId: "b1",
      field: "html",
      kind: "text",
      value: "from stale iframe",
    });
    await vi.advanceTimersByTimeAsync(2000);
    const postCalls = fetchImpl.mock.calls.filter(([, opts]) => opts?.method === "POST");
    expect(postCalls).toHaveLength(0);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
