/**
 * W2-SEC D523/D811 — the ONE pino-http factory the app mounts, with
 * credential redaction built in.
 *
 * Why this exists: the preview <iframe> can neither send cookies (sandboxed,
 * opaque origin) nor set headers, so its credential travels in the URL as
 * `?token=…` — a short-lived pv1/ptv1 token normally, but the curl/dev path
 * may still put the long-lived ADMIN_API_TOKEN there. pino-http's default
 * serializers logged the raw url, the parsed `query` object, and every
 * request header (x-admin-token, cookie) — so every preview load wrote a
 * usable credential into the request log. This module keeps the PATH fully
 * visible (logs stay debuggable) and censors only credential values.
 *
 * OAuth `code`/`state` never reach this logger: mountStudioAuth terminates
 * /api/auth/* requests before the logging middleware is mounted (app.ts
 * ordering — Better-auth needs the raw body, so it sits above express.json
 * AND pino).
 */
import pinoHttp, { type HttpLogger } from "pino-http";
import type { DestinationStream } from "pino";

const REDACTED = "[redacted]";

/**
 * Query-param names whose VALUES are credentials. `token` is the live one
 * (preview tokens + the legacy admin-token lift); the rest are cheap
 * insurance against future credential-bearing params leaking by default.
 */
const CREDENTIAL_PARAMS = new Set([
  "token",
  "access_token",
  "api_key",
  "apikey",
  "key",
  "secret",
  "password",
  "auth",
]);

function isCredentialParam(name: string): boolean {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // malformed escape — compare the raw name
  }
  return CREDENTIAL_PARAMS.has(decoded.toLowerCase());
}

/** Censor credential param values in a URL (or query-string suffix); the path always stays. */
export function sanitizeLoggedUrl(url: string): string {
  const qIndex = url.indexOf("?");
  if (qIndex === -1) return url;
  const path = url.slice(0, qIndex);
  const query = url
    .slice(qIndex + 1)
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      const name = eq === -1 ? pair : pair.slice(0, eq);
      return isCredentialParam(name) ? `${name}=${REDACTED}` : pair;
    })
    .join("&");
  return `${path}?${query}`;
}

function sanitizeQueryObject(query: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(query)) {
    out[k] = isCredentialParam(k) ? REDACTED : v;
  }
  return out;
}

export type HttpLoggerOptions = {
  /** Injectable destination for tests; default pino's stdout. */
  stream?: DestinationStream;
};

export function httpLogger(opts: HttpLoggerOptions = {}): HttpLogger {
  return pinoHttp(
    {
      autoLogging: { ignore: (req) => req.url === "/healthz" },
      // Header credentials: redact by path. `set-cookie` on the response
      // carries session tokens (Better-auth) — same treatment.
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'req.headers["x-admin-token"]',
          'res.headers["set-cookie"]',
        ],
        censor: REDACTED,
      },
      serializers: {
        // pino-http wraps this with its std serializer, so `req` here is the
        // already-serialized {id, method, url, query, headers, …} object.
        req(req) {
          req.url = sanitizeLoggedUrl(req.url);
          if (req.query && typeof req.query === "object") {
            req.query = sanitizeQueryObject(req.query as Record<string, unknown>);
          }
          const referer = (req.headers as Record<string, unknown> | undefined)?.referer;
          if (typeof referer === "string") {
            (req.headers as Record<string, unknown>).referer = sanitizeLoggedUrl(referer);
          }
          return req;
        },
      },
    },
    opts.stream,
  );
}
