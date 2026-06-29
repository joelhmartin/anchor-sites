/**
 * P12-T12.4 (D-055) — Client-side Sentry wrapper for Studio.
 *
 * Same mode-switch pattern as server/sentry/index.ts. SENTRY_DSN is injected
 * at build time via Vite's define (or left absent). Callers never import
 * @sentry/react directly.
 *
 * To enable real capture: `npm install --save-exact @sentry/react`, then
 * un-stub the captureException body here. The integration is scaffolded but
 * not linked to the optional @sentry/react package until the operator sets
 * SENTRY_DSN (operator prereq — Phase 12 plan).
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
    if (typeof __SENTRY_DSN__ !== "undefined" && __SENTRY_DSN__) {
      // Real mode: @sentry/react must be installed (optional dep, see plan).
      // Until installed, falls through to stub below.
      return {
        mode: "real",
        captureException(err) {
          console.error("[sentry/client] captureException (install @sentry/react to enable):", err);
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
