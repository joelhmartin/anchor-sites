/**
 * P12-T12.4 (D-055) — Server-side Sentry integration with env-driven mode switch.
 *
 * Modes:
 *   SENTRY_DSN present       → real capture via @sentry/node (optional dep)
 *   SENTRY_DISABLED=true     → no-op (opt-out for privacy-sensitive deploys)
 *   absent / dev             → stub (log-to-console)
 *
 * Callers import captureException from here, never from @sentry directly.
 *
 * To enable real capture: `npm install --save-exact @sentry/node`, then
 * update the captureException body in the "real" mode branch.
 * The integration is scaffolded but not linked until the operator sets
 * SENTRY_DSN (operator prereq — Phase 12 plan).
 */

export type SentryMode = "real" | "disabled" | "stub";

export type ServerSentry = {
  mode: SentryMode;
  captureException: (err: unknown, ctx?: Record<string, unknown>) => void;
};

function stubSentry(): ServerSentry {
  return {
    mode: "stub",
    captureException(err) {
      // eslint-disable-next-line no-console
      console.error("[sentry/stub] captureException:", err);
    },
  };
}

function disabledSentry(): ServerSentry {
  return {
    mode: "disabled",
    captureException() {},
  };
}

let _sentry: ServerSentry | null = null;

export function resolveServerSentry(env: NodeJS.ProcessEnv): ServerSentry {
  if (env.SENTRY_DISABLED === "true") return disabledSentry();
  if (!env.SENTRY_DSN) return stubSentry();
  // Real mode: @sentry/node must be installed (optional dep, see plan).
  // Until installed, log to console and note the DSN is configured.
  return {
    mode: "real",
    captureException(err) {
      // eslint-disable-next-line no-console
      console.error("[sentry/real] captureException (install @sentry/node to enable):", err);
    },
  };
}

export function getSentry(): ServerSentry {
  if (!_sentry) _sentry = resolveServerSentry(process.env);
  return _sentry;
}

export function captureException(err: unknown, ctx?: Record<string, unknown>): void {
  getSentry().captureException(err, ctx);
}
