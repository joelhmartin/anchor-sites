import { useEffect, useState } from "react";
import { fetchMe, type StudioUser } from "../lib/session.js";

/**
 * Resolve the current Studio admin once on mount (P8-T8.5). Any failure
 * (401 or network) is treated as `unauthed` so the guard bounces to /login.
 */
export type SessionStatus = "loading" | "authed" | "unauthed";

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
