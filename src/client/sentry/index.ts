/**
 * P12-T12.4 (D-055) — Client-side Sentry wrapper for Studio.
 *
 * Same mode-switch pattern as server/sentry/index.ts. SENTRY_DSN is injected
 * at build time via Vite's define (or left absent). Callers never import
 * @sentry/react directly.
 */

export type ClientSentry = {
  mode: "real" | "disabled" | "stub";
  captureException: (err: unknown) => void;
};

declare const __SENTRY_DSN__: string | undefined;
declare const __SENTRY_DISABLED__: boolean | undefined;

function resolveClientSentry(): ClientSentry {
  try {
    if (typeof __SENTRY_DISABLED__ !== "undefined" && __SENTRY_DISABLED__) {
      return { mode: "disabled", captureException() {} };
    }
    const dsn = typeof __SENTRY_DSN__ !== "undefined" ? __SENTRY_DSN__ : undefined;
    if (dsn) {
      return {
        mode: "real",
        captureException(err) {
          import("@sentry/react").then((Sentry) => {
            Sentry.captureException(err);
          }).catch(() => {
            console.error("[sentry/client/real] captureException fallback:", err);
          });
        },
      };
    }
  } catch {
    // define constants absent in non-Vite contexts (tests) — fall through to stub
  }
  return {
    mode: "stub",
    captureException(err) {
      console.error("[sentry/client/stub] captureException:", err);
    },
  };
}

let _clientSentry: ClientSentry | null = null;

export function getClientSentry(): ClientSentry {
  if (!_clientSentry) _clientSentry = resolveClientSentry();
  return _clientSentry;
}

export function captureException(err: unknown): void {
  getClientSentry().captureException(err);
}
