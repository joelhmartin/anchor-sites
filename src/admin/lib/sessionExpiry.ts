import { useSyncExternalStore } from "react";

/**
 * D801 — the shared 401 signal.
 *
 * `useStudioSession` probes `/api/me` exactly once on mount, so when a Google
 * session lapses MID-USE nothing re-runs the guard: apiFetch just threw 401s
 * into each caller and an operator mid-inline-edit saw only silently-failing
 * retries. This module is the one place that state lives now:
 *
 *   - `apiFetch` calls `notifySessionExpired()` on every 401;
 *   - `SessionExpiredDialog` (mounted by RequireAdmin alongside the app)
 *     subscribes via `useSessionExpired()` and flips a re-auth surface that
 *     PRESERVES the SPA state under it — no navigation, no unmount;
 *   - background retry loops (SitePreviewPanel's token mint, D815) consult
 *     `isSessionExpired()` to stop hammering endpoints that will 401 until
 *     the operator re-authenticates;
 *   - RequireAdmin clears the flag once a probe succeeds again.
 *
 * Same store shape as adminToken.ts's listener set (the codebase's existing
 * external-store precedent).
 */

let expired = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Flip the shared expired flag (idempotent). Called by apiFetch on 401. */
export function notifySessionExpired(): void {
  if (expired) return;
  expired = true;
  emit();
}

/** Reset after a successful re-auth (or on reaching /login). */
export function clearSessionExpired(): void {
  if (!expired) return;
  expired = false;
  emit();
}

/** Non-reactive read for retry loops (D815). */
export function isSessionExpired(): boolean {
  return expired;
}

export function subscribeSessionExpired(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** React binding — re-renders when the flag flips. */
export function useSessionExpired(): boolean {
  return useSyncExternalStore(subscribeSessionExpired, isSessionExpired, () => false);
}
