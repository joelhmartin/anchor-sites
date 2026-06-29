/**
 * P12-T12.4 (D-055) — Server-side Sentry integration with env-driven mode switch.
 *
 * Modes:
 *   SENTRY_DSN present       → real capture via @sentry/node (lazy-loaded)
 *   SENTRY_DISABLED=true     → no-op (opt-out for privacy-sensitive deploys)
 *   absent / dev             → stub (log-to-console)
 *
 * Callers import captureException from here, never from @sentry directly.
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
  return {
    mode: "real",
    captureException(err) {
      try {
        // Dynamic import keeps @sentry/node out of the cold-start path when
        // the DSN is absent. The first call pays the import cost once.
        import("@sentry/node").then((Sentry) => {
          Sentry.captureException(err);
        }).catch(() => {
          // eslint-disable-next-line no-console
          console.error("[sentry/real] captureException fallback:", err);
        });
      } catch {
        // eslint-disable-next-line no-console
        console.error("[sentry/real] captureException error:", err);
      }
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
