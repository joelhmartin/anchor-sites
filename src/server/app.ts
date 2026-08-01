import express, { type Express, type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import { httpLogger } from "./http-logger.js";
import { ping } from "./db.js";
import { blocksPreviewRouter } from "./routes/blocks-preview.js";
import { pageRouter } from "./routes/page.js";
import { blogEventsRouter } from "./routes/blog-events.js";
import { sitemapRouter } from "./routes/sitemap.js";
import { adminPagesRouter } from "./routes/admin-pages.js";
import { siteResolveRouter } from "./routes/site-resolve.js";
import { mediaRouter } from "./routes/media.js";
import { adminSitesRouter } from "./routes/admin-sites.js";
import { templatesRouter } from "./routes/templates.js";
import { pluginsRouter } from "./routes/plugins.js";
import { adminTenantRouter } from "./routes/admin-tenant.js";
import { adminDomainsRouter } from "./routes/admin-domains.js";
import { adminCrmRouter } from "./routes/admin-crm.js";
import { vitalsRouter } from "./routes/vitals.js";
import { leadsRouter } from "./routes/leads.js";
import { adminJobsRouter } from "./routes/admin-jobs.js";
import { adminAiAgentRouter } from "./routes/admin-ai-agent.js";
import { meRouter } from "./routes/me.js";
import { gitWebhookRouter, type RawBodyRequest } from "./routes/git-webhook.js";
import { adminGitRouter } from "./routes/admin-git.js";
import { resolveSite } from "../middleware/resolveSite.js";
import { loadPlugins } from "./plugins/loader.js";
import { mountStudioAuth } from "./auth/studio-auth-mount.js";
import type { StudioAuth } from "./auth/studio-auth.js";
import { captureException } from "./sentry/index.js";
import { buildCsp, buildStudioCsp } from "./csp.js";
import { isAdminHost } from "../config/admin-host.js";

export type CreateAppOptions = {
  /**
   * Plugin names the loader should mount (P7.5-T7.5.4). At boot this is the
   * `active` set from `verifyPluginMigrations` (env + migrations verified).
   * Omitted (tests) → load every registered plugin.
   */
  activePlugins?: string[];
  /**
   * Studio Better-auth instance for the auth handler (P8-T8.3). Omitted →
   * the process singleton via `getStudioAuth()` (null in dev/disabled mode).
   * Tests inject a fresh instance to avoid env/cache coupling.
   */
  studioAuth?: StudioAuth | null;
};

export function createApp(opts: CreateAppOptions = {}): Express {
  const app = express();

  // D810 (W2-SEC) — per-host CSP. The studio host gets a strict policy
  // (script-src 'self' in prod — the SPA build has no inline scripts, and
  // unpkg/calltracking are tenant concerns); every other host keeps the
  // tenant policy. Both helmet instances are built once at app creation;
  // the branch per request is only the host check. Preview routes override
  // whichever applied via res.setHeader (admin-pages.ts / templates.ts).
  const tenantHelmet = helmet({ contentSecurityPolicy: { directives: buildCsp(process.env) } });
  const studioHelmet = helmet({
    contentSecurityPolicy: { directives: buildStudioCsp(process.env) },
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    (isAdminHost(req.headers.host) ? studioHelmet : tenantHelmet)(req, res, next);
  });

  // D809/D909 (W2-SEC) — NO blanket cors() here anymore. The old global
  // `app.use(cors())` stamped `Access-Control-Allow-Origin: *` on every
  // response, admin APIs included, with zero cross-origin consumers: the
  // Studio SPA is same-origin with the API (one process, one host), tenant
  // pages fetch same-origin, lead forms are plain navigations (CORS-exempt),
  // and a `*` grant can never serve credentialed requests anyway. The one
  // surface that may legitimately be posted to cross-origin — /api/vitals,
  // whose snippet targets a configurable WEB_VITALS_ENDPOINT — carries its
  // own scoped cors() inside vitalsRouter.

  // Studio Google-OAuth handler (D-034/D-046). MUST precede express.json() —
  // Better-auth reads the raw body. Gated to the Studio host; no-op in
  // dev/disabled mode (requireAdmin covers those).
  mountStudioAuth(app, opts.studioAuth !== undefined ? { auth: opts.studioAuth } : {});

  // GitHub sync Task 5: the push webhook needs the RAW request body to
  // verify GitHub's HMAC signature (X-Hub-Signature-256) — JSON.stringify of
  // the parsed body isn't guaranteed to byte-match what GitHub signed (key
  // order, whitespace). Additive only: every other route keeps using the
  // parsed `req.body` exactly as before.
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = buf;
      },
    }),
  );
  // D523/D811 — request logging with credential redaction (token query
  // params, x-admin-token/cookie/authorization headers). See http-logger.ts.
  app.use(httpLogger());

  app.get("/healthz", async (_req: Request, res: Response) => {
    const db = await ping();
    // D1026: report the jobs-runner state here too. bootJobs failure used to
    // log once then let every enqueue silently return null while /healthz
    // still said ok — a down runner is now visible from the liveness probe.
    // The overall `ok` stays true when jobs are deliberately "disabled"
    // (JOBS_ENABLED=false); only a genuine "down" degrades it, so a config
    // that intentionally runs no worker isn't reported as unhealthy.
    const { getJobsRunnerState } = await import("./jobs/index.js");
    const jobs = getJobsRunnerState();
    res.status(200).json({ ok: db && jobs.status !== "down", db, jobs });
  });

  // Admin-only block preview harness. Gated to non-production envs only —
  // Phase 4 will add real admin auth + a properly mounted admin UI.
  if (process.env.NODE_ENV !== "production") {
    app.use(blocksPreviewRouter);

    // Tenant resolution probe — useful for debugging Host → site lookups.
    app.get("/__site", resolveSite(), (req: Request, res: Response) => {
      res.json({ site: req.site });
    });
  }

  // P8-T8.5: who-am-I probe for the Studio client (session / token / dev).
  app.use(meRouter());

  // P7: template system — save-as-template, list/inspect/archive, from-template.
  // MUST mount before adminPagesRouter (D100): its literal
  // `POST /sites/:siteId/pages/from-template` is otherwise swallowed by
  // admin-pages' param route `POST /sites/:siteId/pages/:pageId`. Safe first:
  // every templates path ends in a literal segment (or lives under
  // /templates), so it can't capture any other router's routes.
  app.use("/api", templatesRouter());

  // Admin API: save, list revisions, restore. Gated by requireAdmin() — now a
  // Studio Better-auth session OR the X-Admin-Token (dual-mode, D-034/D-046).
  app.use("/api", adminPagesRouter());

  // P3-T3.9: media upload-url + complete callback under /api.
  app.use("/api", mediaRouter());

  // P4: admin sites API (list/detail/create/update + child resources).
  app.use("/api", adminSitesRouter());

  // P7.5: admin plugins API — list available, per-site enable/disable + config.
  app.use("/api", pluginsRouter());

  // P8-T8.13: admin tenant-content API — per-site blog/events CRUD + members/
  // auth-config. Scoped by :siteId, gated by requireAdmin (dual-mode).
  app.use("/api", adminTenantRouter());

  // P10: domain provisioning API — list/add/remove domains + provision/status.
  app.use("/api", adminDomainsRouter());

  // P11: CRM proxy API — phone numbers + campaigns read-through.
  app.use("/api", adminCrmRouter());

  // P12-T12.3: web-vitals ingestion (tenant pages post metrics here; no admin gate).
  app.use("/api", vitalsRouter());

  // W1.6/D700: tenant lead capture — template crm_forms post here from the
  // tenant origin. Host-resolved (resolveSite), rate-limited, no admin gate.
  app.use("/api", leadsRouter());

  // P12-T12.7: pg-boss health endpoint (admin-only).
  app.use("/api", adminJobsRouter());

  // Task 10 (AI site agent): conversation CRUD + SSE message/tail routes.
  app.use("/api", adminAiAgentRouter());

  // GitHub sync Task 7: admin status/enable/export endpoints backing the
  // Studio GitCard. Gated by requireAdmin like every other admin-sites route.
  app.use("/api", adminGitRouter());

  // GitHub sync Task 5: push webhook — HMAC-verified, no requireAdmin (GitHub
  // can't send an admin token; the signature check IS the auth).
  app.use("/api", gitWebhookRouter());

  // P7.5: plugin routers at /api/plugins/<name>. Mounted before the catch-all
  // page renderer so plugin API routes resolve. Each plugin's router enforces
  // per-site enablement internally (D-016 / D-045). `activePlugins` is the
  // boot-verified set; omitted → every registered plugin.
  loadPlugins(app, { only: opts.activePlugins });

  // D101 — JSON 404 terminator for unknown /api paths, all methods. Every API
  // router is mounted above; without this, unmatched /api requests fell
  // through the tenant page renderer into index.ts's SPA fallback and
  // returned 200 + HTML.
  app.all("/api/*", (_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found" });
  });

  // Admin-only debug endpoint for tenant resolution. P3-T3.2.
  app.use(siteResolveRouter());

  // P8-T8.11: public blog/events on tenant hosts (/blog, /events). Before the
  // catch-all page renderer so these reserved paths resolve; non-matching paths
  // + admin/unknown hosts fall through.
  app.use(blogEventsRouter());

  // P9-T9.5/9.6: per-tenant /sitemap.xml + /robots.txt. Before the catch-all so
  // these reserved paths resolve; admin/unknown hosts fall through.
  app.use(sitemapRouter());

  // Tenant page renderer. Registered last so all named admin/probe routes
  // above match first. Unknown hosts pass through (Vite/SPA fallback in dev,
  // static-index fallback in prod — both mounted by `src/server/index.ts`).
  app.use(pageRouter());

  // P12-T12.4 (D-055) — global error handler. Registered last.
  app.use(globalErrorHandler());

  return app;
}

// P12-T12.4 (D-055) — Global 4-param Express error handler. Logs the stack,
// captures to Sentry (when configured), and returns a safe JSON error
// response. 500 bodies are masked in production to avoid leaking internals.
// Exported for direct testing (D102).
export function globalErrorHandler() {
  return (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    // D102: once a response has started we can't write a JSON body — doing so
    // threw ERR_HTTP_HEADERS_SENT on top of the original error. Delegate to
    // Express's default handler, which closes the connection instead.
    if (res.headersSent) return next(err);
    const status = typeof (err as { status?: number }).status === "number"
      ? (err as { status: number }).status
      : 500;
    // eslint-disable-next-line no-console
    console.error("[express/error]", err);
    captureException(err);
    const message =
      process.env.NODE_ENV === "production" && status >= 500
        ? "internal server error"
        : (err instanceof Error ? err.message : String(err));
    res.status(status).json({ error: message });
  };
}
