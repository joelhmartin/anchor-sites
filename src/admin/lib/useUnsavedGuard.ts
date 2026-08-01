import { useEffect } from "react";

/**
 * D420 — guard against silently discarding unsaved editor work.
 *
 * The post/event editors keep metadata + body edits in React state only; the
 * "← Back" link and a browser tab close both discarded everything with no
 * prompt. This hook installs a `beforeunload` handler while `dirty` is true
 * (covers tab close / reload / external nav) and exposes `confirmLeave()` for
 * in-app navigation (the back link) to call before routing away.
 */
export function useUnsavedGuard(dirty: boolean): { confirmLeave: () => boolean } {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy browsers require returnValue to be set to trigger the prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function confirmLeave(): boolean {
    if (!dirty) return true;
    return window.confirm("You have unsaved changes. Leave without saving?");
  }

  return { confirmLeave };
}
