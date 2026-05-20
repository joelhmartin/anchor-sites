import { clearAdminToken, getAdminToken } from "./adminToken.js";

/** Typed API error so callers can branch on status. */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export type ApiFetchOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

/**
 * Fetch wrapper for the admin API (P4-T4.8). Attaches the `X-Admin-Token`
 * header, JSON-encodes the body, parses the JSON response, and maps
 * non-2xx to a typed `ApiError`. On 401 it clears the stored token so the
 * guard bounces the user back to /login.
 */
export async function apiFetch<T = unknown>(
  path: string,
  opts: ApiFetchOptions = {},
): Promise<T> {
  const token = getAdminToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(token ? { "X-Admin-Token": token } : {}),
    ...((opts.headers as Record<string, string>) ?? {}),
  };

  const res = await fetch(path, {
    ...opts,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401) {
    clearAdminToken();
    throw new ApiError("unauthorized", 401, await safeJson(res));
  }

  const data = await safeJson(res);
  if (!res.ok) {
    const message =
      (data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `request failed (${res.status})`);
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
