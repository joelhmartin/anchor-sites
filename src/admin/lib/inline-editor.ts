import type { Block } from "../../blocks/types.js";
import { apiFetch } from "./apiFetch.js";

/**
 * Bridge protocol shared with the overlay (Task 5's `src/editor-overlay/bridge.ts`).
 * Declared locally — the overlay bundle is not importable from admin code — but
 * MUST stay field-for-field identical to the overlay's `OverlayMsg`/`StudioMsg`.
 */
type OverlayMsg =
  | { ac: "edit"; token: string; type: "edit-ready" }
  | { ac: "edit"; token: string; type: "field-edit"; blockId: string; field: string; kind: "text" | "url"; value: string }
  | { ac: "edit"; token: string; type: "image-pick-request"; blockId: string; field: string }
  | { ac: "edit"; token: string; type: "link-edit-request"; blockId: string; field: string; value: string };

type StudioMsg =
  | { ac: "edit"; token: string; type: "apply-image"; blockId: string; field: string; src: string; alt: string }
  | { ac: "edit"; token: string; type: "apply-field"; blockId: string; field: string; value: string }
  | { ac: "edit"; token: string; type: "set-readonly"; on: boolean; reason?: string };

export type InlineEditorEvents = {
  onImagePickRequest: (blockId: string, field: string) => void;
  onLinkEditRequest: (blockId: string, field: string, value: string) => void;
  onSaveStateChange: (s: "idle" | "dirty" | "saving" | "saved" | "error") => void;
};

export type InlineEditorHandle = {
  token: string;
  attach(iframe: HTMLIFrameElement): void;
  applyField(blockId: string, field: string, value: string): void;
  applyImage(blockId: string, field: string, assetId: string, src: string, alt: string): void;
  setReadonly(on: boolean, reason?: string): void;
  flush(): Promise<void>;
  destroy(): void;
};

function fieldKey(blockId: string, field: string): string {
  return `${blockId}\u001f${field}`;
}

function splitFieldKey(key: string): [string, string] {
  const [blockId, field] = key.split("\u001f");
  return [blockId, field];
}

export function createInlineEditor(opts: {
  siteId: string;
  pageId: string;
  events: InlineEditorEvents;
  fetchImpl?: typeof apiFetch;
  debounceMs?: number;
}): InlineEditorHandle {
  const { siteId, pageId, events } = opts;
  const fetchImpl = opts.fetchImpl ?? apiFetch;
  const debounceMs = opts.debounceMs ?? 2000;

  const token =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  let iframe: HTMLIFrameElement | null = null;
  let messageHandler: ((e: MessageEvent) => void) | null = null;
  let blocks: Block[] = [];
  let dirty = false;
  const dirtyFields = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryResolve: (() => void) | null = null;
  let saving = false;
  let queuedFollowUp = false;
  let currentSave: Promise<void> | null = null;
  let readonly = false;
  let destroyed = false;

  // Cancellable version of the retry backoff: destroy() needs to be able to
  // both stop the timer AND unblock `await` on it, so runSaveCycle's
  // destroyed-check right after the await actually gets a chance to run
  // (an uncleared setTimeout would just clear silently and leave the
  // save cycle's promise dangling forever).
  function cancellableRetryDelay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      retryResolve = resolve;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        retryResolve = null;
        resolve();
      }, ms);
    });
  }

  function postToIframe(msg: StudioMsg): void {
    iframe?.contentWindow?.postMessage(msg, "*");
  }

  function findBlock(blockId: string): Block | undefined {
    return blocks.find((b) => b.id === blockId);
  }

  function markDirty(blockId: string, field: string): void {
    dirtyFields.add(fieldKey(blockId, field));
    if (!dirty) {
      dirty = true;
      events.onSaveStateChange("dirty");
    }
  }

  function scheduleDebouncedSave(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void triggerSave();
    }, debounceMs);
  }

  function getStatus(err: unknown): number | undefined {
    return typeof err === "object" && err !== null && "status" in err
      ? (err as { status?: number }).status
      : undefined;
  }

  function getBody(err: unknown): unknown {
    return typeof err === "object" && err !== null && "body" in err
      ? (err as { body?: unknown }).body
      : undefined;
  }

  // The real server contract (src/server/routes/admin-pages.ts, POST
  // /sites/:siteId/pages/:pageId) rejects invalid block content with
  // 400 + { error: "block validation failed", failures } — NOT 422. A
  // generic 400 (e.g. malformed payload / zod parse failure) is a client
  // bug, not a content rejection, and should NOT trigger a revert. 422 is
  // also accepted as a belt in case that contract changes later, but the
  // 400+failures shape is the one that must work today.
  function isBlockValidationReject(err: unknown): boolean {
    const status = getStatus(err);
    if (status === 422) return true;
    if (status !== 400) return false;
    const body = getBody(err);
    if (!body || typeof body !== "object") return false;
    const b = body as Record<string, unknown>;
    return b.error === "block validation failed" || Array.isArray(b.failures);
  }

  async function post(): Promise<void> {
    await fetchImpl(`/api/sites/${siteId}/pages/${pageId}`, {
      method: "POST",
      body: { blocks, source: "inline" },
    });
  }

  async function handleValidationReject(fields: Set<string>): Promise<void> {
    try {
      const res = await fetchImpl<{ page: { blocks: Block[] } }>(
        `/api/sites/${siteId}/pages/${pageId}`,
      );
      // destroy() may have fired while this re-GET was in flight — don't
      // mutate local state or postMessage into a torn-down consumer.
      if (destroyed) return;
      const serverBlocks = res.page.blocks ?? [];
      for (const key of fields) {
        if (destroyed) return;
        const [blockId, field] = splitFieldKey(key);
        const serverBlock = serverBlocks.find((b) => b.id === blockId);
        if (!serverBlock) continue;
        const serverValue = serverBlock.props?.[field];
        if (serverValue === undefined) continue;
        const localBlock = findBlock(blockId);
        if (localBlock) {
          localBlock.props = { ...localBlock.props, [field]: serverValue };
        }
        postToIframe({
          ac: "edit",
          token,
          type: "apply-field",
          blockId,
          field,
          value: String(serverValue),
        });
      }
    } catch {
      // best-effort revert; state still goes to "error" below regardless
    }
  }

  async function runSaveCycle(): Promise<void> {
    saving = true;
    do {
      queuedFollowUp = false;
      if (destroyed) break;
      events.onSaveStateChange("saving");
      const fields = new Set(dirtyFields);
      dirtyFields.clear();
      dirty = false;
      try {
        await post();
        if (destroyed) break;
        events.onSaveStateChange("saved");
      } catch (err) {
        if (destroyed) break;
        if (isBlockValidationReject(err)) {
          await handleValidationReject(fields);
          if (destroyed) break;
          events.onSaveStateChange("error");
        } else {
          try {
            await cancellableRetryDelay(1500);
            if (destroyed) break;
            await post();
            if (destroyed) break;
            events.onSaveStateChange("saved");
          } catch (retryErr) {
            if (destroyed) break;
            // Minor (c): the retry's own failure might ALSO be a real
            // block-validation reject (not just a transient error) — check
            // again rather than assuming "retry failed" always means
            // generic/transient.
            if (isBlockValidationReject(retryErr)) {
              await handleValidationReject(fields);
              if (destroyed) break;
              events.onSaveStateChange("error");
            } else {
              // Important 2: dirtyFields/dirty were cleared before this
              // cycle's POST attempt. A terminal (non-validation) failure
              // must NOT leave that data silently unsaved forever — restore
              // it so flush() (edit-mode exit) or the next edit resends it.
              // State stays "error" (not "dirty") — this is bookkeeping,
              // not a new user edit.
              for (const key of fields) dirtyFields.add(key);
              dirty = true;
              events.onSaveStateChange("error");
            }
          }
        }
      }
    } while (queuedFollowUp && !destroyed);
    saving = false;
  }

  function triggerSave(): Promise<void> {
    if (saving) {
      queuedFollowUp = true;
      return currentSave ?? Promise.resolve();
    }
    currentSave = runSaveCycle().finally(() => {
      currentSave = null;
    });
    return currentSave;
  }

  function handleMessage(e: MessageEvent): void {
    const data = e.data as OverlayMsg | undefined;
    if (!data || data.ac !== "edit") return;
    if (data.token !== token) return;
    // Strict guard: without an attached iframe there is no legitimate
    // source at all — a falsy `iframe` used to let this through instead
    // of rejecting it.
    if (!iframe || e.source !== iframe.contentWindow) return;

    switch (data.type) {
      case "field-edit": {
        if (readonly) return;
        const block = findBlock(data.blockId);
        if (!block) return;
        block.props = { ...block.props, [data.field]: data.value };
        markDirty(data.blockId, data.field);
        scheduleDebouncedSave();
        break;
      }
      case "image-pick-request":
        events.onImagePickRequest(data.blockId, data.field);
        break;
      case "link-edit-request":
        events.onLinkEditRequest(data.blockId, data.field, data.value);
        break;
      case "edit-ready":
      default:
        break;
    }
  }

  async function loadInitial(): Promise<void> {
    try {
      const res = await fetchImpl<{ page: { blocks: Block[] } }>(
        `/api/sites/${siteId}/pages/${pageId}`,
      );
      blocks = res.page.blocks ?? [];
    } catch {
      // leave blocks empty — a subsequent edit will still attempt to save
      // whatever the overlay reports, but nothing to hydrate here.
    }
  }

  return {
    token,

    attach(el: HTMLIFrameElement): void {
      // Minor (b): re-entrancy guard — a second attach() (e.g. iframe
      // remount) must not leak a duplicate window listener.
      if (messageHandler) {
        window.removeEventListener("message", messageHandler);
        messageHandler = null;
      }
      iframe = el;
      messageHandler = (e: MessageEvent) => handleMessage(e);
      window.addEventListener("message", messageHandler);
      void loadInitial();
    },

    applyField(blockId: string, field: string, value: string): void {
      const block = findBlock(blockId);
      if (block) {
        block.props = { ...block.props, [field]: value };
      }
      markDirty(blockId, field);
      scheduleDebouncedSave();
      postToIframe({ ac: "edit", token, type: "apply-field", blockId, field, value });
    },

    applyImage(blockId: string, field: string, assetId: string, src: string, alt: string): void {
      const block = findBlock(blockId);
      if (block) {
        block.props = { ...block.props, [field]: assetId };
        if (block.type === "image") {
          block.props = { ...block.props, alt };
        }
      }
      dirtyFields.add(fieldKey(blockId, field));
      postToIframe({ ac: "edit", token, type: "apply-image", blockId, field, src, alt });
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      void triggerSave();
    },

    setReadonly(on: boolean, reason?: string): void {
      readonly = on;
      postToIframe({ ac: "edit", token, type: "set-readonly", on, reason });
    },

    async flush(): Promise<void> {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (dirty || dirtyFields.size > 0) {
        await triggerSave();
      } else if (currentSave) {
        await currentSave;
      }
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (messageHandler) {
        window.removeEventListener("message", messageHandler);
        messageHandler = null;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      // Important 1: stop the retry backoff AND unblock anything awaiting
      // it, so an in-flight runSaveCycle hits its post-await `destroyed`
      // check and stops emitting events/postMessages instead of hanging.
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (retryResolve) {
        const resolve = retryResolve;
        retryResolve = null;
        resolve();
      }
    },
  };
}
