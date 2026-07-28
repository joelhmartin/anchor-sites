/**
 * Overlay <-> Studio postMessage bridge (Inline Editing Task 5).
 *
 * The preview iframe is sandboxed (`sandbox allow-scripts`, no
 * `allow-same-origin`), so it renders at an OPAQUE origin — there is no
 * parent origin the overlay can verify against, and Studio (the parent
 * frame) can't target this frame's origin either. Both sides use `"*"` as
 * the postMessage targetOrigin and instead authenticate via the Studio-
 * minted `token` (see admin-pages.ts's `?bridge=` query param) carried on
 * every message in both directions. Any inbound message missing `ac: "edit"`
 * or carrying the wrong token is silently ignored.
 *
 * Protocol shapes are BINDING — Studio's save engine (Task 9) is built
 * against these verbatim. Do not change field names/shapes here without
 * updating both sides.
 */

export type FieldKind = "text" | "url" | "image";

export type OverlayMsg =
  | { ac: "edit"; token: string; type: "edit-ready" }
  | {
      ac: "edit";
      token: string;
      type: "field-edit";
      blockId: string;
      field: string;
      kind: "text" | "url";
      value: string;
    }
  | { ac: "edit"; token: string; type: "image-pick-request"; blockId: string; field: string }
  | { ac: "edit"; token: string; type: "link-edit-request"; blockId: string; field: string; value: string };

export type StudioMsg =
  | { ac: "edit"; token: string; type: "apply-image"; blockId: string; field: string; src: string; alt: string }
  | { ac: "edit"; token: string; type: "apply-field"; blockId: string; field: string; value: string }
  | { ac: "edit"; token: string; type: "set-readonly"; on: boolean; reason?: string };

export type StudioMsgHandler = (msg: StudioMsg) => void;

export interface Bridge {
  /** Post an OverlayMsg to the parent (Studio) frame. */
  send(msg: OverlayMsg): void;
  /** Remove the inbound listener. Overlay-lifetime is page-lifetime in prod; tests use this for hygiene. */
  destroy(): void;
}

function isStudioMsg(data: unknown, token: string): data is StudioMsg {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.ac === "edit" && d.token === token;
}

/**
 * Wire the bridge: an inbound `message` listener that validates
 * `ac === "edit"` and the token before dispatching to `onMessage`, plus a
 * `send` that posts to `window.parent`.
 */
export function initBridge(token: string, onMessage: StudioMsgHandler): Bridge {
  const listener = (e: MessageEvent): void => {
    if (!isStudioMsg(e.data, token)) return;
    onMessage(e.data);
  };
  window.addEventListener("message", listener);

  return {
    send(msg: OverlayMsg): void {
      window.parent.postMessage(msg, "*");
    },
    destroy(): void {
      window.removeEventListener("message", listener);
    },
  };
}
