import { createContext, useContext, useEffect, useState } from "react";
import { fetchMe, type StudioUser } from "../lib/session.js";

/**
 * Resolve the current Studio admin once on mount (P8-T8.5). Any failure
 * (401 or network) is treated as `unauthed` so the guard bounces to /login.
 */
export type SessionStatus = "loading" | "authed" | "unauthed";

/**
 * D813 — the resolved identity, shared DOWN the tree. `RequireAdmin` is the
 * one component that runs the probe; before this context the `user` it
 * fetched was simply dropped, and any component wanting to show "who am I"
 * (UserMenu) would have had to re-fetch `/api/me` per mount. Default value =
 * "not resolved" so components render their identity-less fallback outside
 * the provider (tests, storybook-style mounts).
 */
export type StudioSessionValue = { status: SessionStatus; user: StudioUser | null };

export const StudioSessionContext = createContext<StudioSessionValue>({
  status: "loading",
  user: null,
});

/** Read the session RequireAdmin already resolved — no extra /api/me fetch. */
export function useStudioSessionContext(): StudioSessionValue {
  return useContext(StudioSessionContext);
}

export function useStudioSession(): { status: SessionStatus; user: StudioUser | null } {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [user, setUser] = useState<StudioUser | null>(null);

  useEffect(() => {
    let active = true;
    fetchMe()
      .then((u) => {
        if (!active) return;
        setUser(u);
        setStatus(u ? "authed" : "unauthed");
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setStatus("unauthed");
      });
    return () => {
      active = false;
    };
  }, []);

  return { status, user };
}
