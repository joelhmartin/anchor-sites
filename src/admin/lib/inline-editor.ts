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
  /** `conflict` (W2-CONC / D308): the server rejected a save because the
   * page changed underneath this edit session (agent turn, second tab) —
   * the operator must reload; retrying would clobber the newer content. */
  onSaveStateChange: (s: "idle" | "dirty" | "saving" | "saved" | "error" | "conflict") => void;
};

export type InlineEditorHandle = {
  token: string;
  attach(iframe: HTMLIFrameElement): void;
  applyField(blockId: string, field: string, value: string): void;
  applyImage(blockId: string, field: string, assetId: string, src: string, alt: string): void;
  /**
   * Final review Important 4: read a block's CURRENT prop value out of the
   * handle's local `blocks` (the same array `applyField`/`applyImage`
   * mutate and `post()` saves). Used by SiteDetailPage to seed
   * `<ImagePickerDialog initialAlt>` with the image block's existing alt
   * text on an `image-pick-request` — without this, the dialog always
   * opened with an empty alt field, so re-picking the SAME image (or
   * picking a different one without retyping alt) clobbered a
   * previously-set alt back to "". Returns `undefined` if the block or
   * field isn't found.
   */
  readProp(blockId: string, field: string): unknown;
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
  // D308 — the page's `updated_at` as of loadInitial, rebased from each save
  // response. Sent with every whole-array POST so the server can 409 a save
  // whose snapshot the page has moved past (agent turn, second tab) instead
  // of silently accepting a clobber.
  let baseUpdatedAt: string | null = null;
  // Once a conflict is detected the session is dead — the local blocks no
  // longer describe the server page. Saves stop; the operator reloads.
  let conflicted = false;
  let dirty = false;
  const dirtyFields = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryResolve: (() => void) | null = null;
  let saving = false;
  let queuedFollowUp = false;
  let currentSave: Promise<void> | null = null;
  let readonly = false;
  let readonlyReason: string | undefined;
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

  /** D308: a 409 from the save route is the base-marker mismatch — the page
   * changed underneath this edit session. Never retried, never treated as a
   * validation revert. */
  function isConflictReject(err: unknown): boolean {
    return getStatus(err) === 409;
  }

  async function post(): Promise<void> {
    const body: Record<string, unknown> = { blocks, source: "inline" };
    if (baseUpdatedAt) body.base_updated_at = baseUpdatedAt;
    const res = await fetchImpl<{ page?: { updated_at?: string } }>(
      `/api/sites/${siteId}/pages/${pageId}`,
      { method: "POST", body },
    );
    // Rebase: the save bumped the row's updated_at; the next save's marker
    // must match the NEW value or every follow-up save would 409 on our own
    // previous write.
    const next = res?.page?.updated_at;
    if (typeof next === "string") baseUpdatedAt = next;
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
        // D308: a base-marker conflict is terminal for the session — the
        // local snapshot no longer describes the server page, so a retry
        // (or restoring the fields for a later resend) would clobber
        // whatever landed underneath. Surface "reload" and stop saving.
        if (isConflictReject(err)) {
          conflicted = true;
          events.onSaveStateChange("conflict");
          break;
        }
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
            if (isConflictReject(retryErr)) {
              conflicted = true;
              events.onSaveStateChange("conflict");
              break;
            }
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
    // D308: after a conflict there is nothing safe to send — the session is
    // over until the operator reloads.
    if (conflicted) return Promise.resolve();
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
        // Final review Important 1: the overlay sends `edit-ready` on every
        // boot — including a mid-session iframe reload/remount (e.g. the
        // draft preview re-navigating). Without this, a freshly-booted
        // overlay always starts in its own default (editable) state and
        // never learns about a readonly lock this handle already
        // established (e.g. `agentBusy` from SiteDetailPage's effect) —
        // the operator could keep editing a page the AI is actively
        // writing to. Re-post the LAST readonly state this handle set
        // (tracked here, not re-derived) so a reloaded overlay always
        // starts in sync with it.
        postToIframe({ ac: "edit", token, type: "set-readonly", on: readonly, reason: readonlyReason });
        break;
      default:
        break;
    }
  }

  async function loadInitial(): Promise<void> {
    try {
      const res = await fetchImpl<{ page: { blocks: Block[]; updated_at?: string } }>(
        `/api/sites/${siteId}/pages/${pageId}`,
      );
      blocks = res.page.blocks ?? [];
      // D308: this GET is the edit session's snapshot point — its
      // updated_at is the base marker every save carries.
      baseUpdatedAt = typeof res.page.updated_at === "string" ? res.page.updated_at : null;
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
      // Minor (c): this is the STUDIO-initiated path (link popover Save,
      // etc.) — the overlay-initiated `field-edit` message already guards
      // on `readonly` in handleMessage above, but this method is called
      // directly from admin UI code and had no such guard, so a stale
      // popover callback firing after a readonly lock kicked in could still
      // write. Drop it, same as the overlay side does.
      if (readonly) {
        console.warn("[inline-editor] applyField dropped: editor is readonly", { blockId, field });
        return;
      }
      const block = findBlock(blockId);
      if (block) {
        block.props = { ...block.props, [field]: value };
      }
      markDirty(blockId, field);
      scheduleDebouncedSave();
      postToIframe({ ac: "edit", token, type: "apply-field", blockId, field, value });
    },

    applyImage(blockId: string, field: string, assetId: string, src: string, alt: string): void {
      // Minor (c): same readonly guard as applyField above — a stale image
      // picker callback (dialog opened before a readonly lock, resolved
      // after) must not still write.
      if (readonly) {
        console.warn("[inline-editor] applyImage dropped: editor is readonly", { blockId, field });
        return;
      }
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

    readProp(blockId: string, field: string): unknown {
      return findBlock(blockId)?.props?.[field];
    },

    setReadonly(on: boolean, reason?: string): void {
      readonly = on;
      readonlyReason = reason;
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
