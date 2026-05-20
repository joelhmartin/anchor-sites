import { useCallback, useSyncExternalStore } from "react";

/**
 * Admin token storage (P4-T4.8). The control hub authenticates to the
 * API with `X-Admin-Token` until Phase 8 swaps in Better-auth sessions.
 * The token is pasted once at /login and kept in localStorage.
 */

const KEY = "anchorcorps.admin_token";
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string): void {
  localStorage.setItem(KEY, token);
  emit();
}

export function clearAdminToken(): void {
  localStorage.removeItem(KEY);
  emit();
}

/**
 * React binding. Re-renders when the token changes (including from
 * `clearAdminToken` on a 401 inside `apiFetch`).
 */
export function useAdminToken(): {
  token: string | null;
  setToken: (t: string) => void;
  clearToken: () => void;
} {
  const subscribe = useCallback((cb: () => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, []);
  const token = useSyncExternalStore(
    subscribe,
    () => getAdminToken(),
    () => null,
  );
  return { token, setToken: setAdminToken, clearToken: clearAdminToken };
}
