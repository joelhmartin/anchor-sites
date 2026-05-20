import { useCallback, useEffect, useState } from "react";
import { apiFetch, type ApiFetchOptions } from "./apiFetch.js";

export type ApiState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/**
 * Minimal GET data hook (P4-T4.10). Fetches on mount + when `path`
 * changes; `reload()` re-runs. No caching layer — the admin is low-
 * traffic and correctness-over-cleverness wins here. A heavier client
 * (react-query) can replace this without touching call sites if needed.
 */
export function useApi<T>(path: string, opts?: ApiFetchOptions): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<T>(path, opts)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "request failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // opts intentionally excluded — callers pass a stable path; re-fetch via reload().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce]);

  return { data, loading, error, reload };
}
