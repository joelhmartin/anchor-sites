/**
 * P12-T12.3 (D-055 partial) — Web-vitals ingestion endpoint.
 *
 * Accepts metric payloads from the inline web-vitals CDN snippet injected by
 * shell(). Rate-limited to 60 req/min per IP (abuse prevention). No persistent
 * store in Phase 12 — logs the metric and enqueues for future aggregation.
 * requireAdmin NOT applied (tenant pages post to it).
 */
import { Router, type Request, type Response } from "express";
import cors from "cors";
import { z } from "zod";
import { rateLimit, type RateLimitOptions } from "../../middleware/rateLimit.js";

const vitalsPayload = z.object({
  name: z.string().min(1).max(50),
  value: z.number(),
  id: z.string().min(1).max(200),
  delta: z.number(),
});

export type VitalsOptions = {
  rateLimitOpts?: RateLimitOptions;
};

export function vitalsRouter(opts: VitalsOptions = {}): Router {
  const router = Router();
  const limiter = rateLimit(opts.rateLimitOpts ?? { max: 60, windowMs: 60_000 });

  // D809/D909 (W2-SEC) — the ONE scoped CORS grant in the app (the global
  // app.use(cors()) is gone). Tenant pages POST metrics to a configurable
  // WEB_VITALS_ENDPOINT which may live on another origin (a central
  // collector); the JSON body triggers a preflight, hence the OPTIONS
  // handler. Anonymous, rate-limited telemetry — a `*` grant is
  // appropriate here and nowhere else.
  const vitalsCors = cors();
  router.options("/vitals", vitalsCors);

  router.post("/vitals", vitalsCors, limiter, (req: Request, res: Response) => {
    const parsed = vitalsPayload.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid payload" });
      return;
    }
    const { name, value, id, delta } = parsed.data;
    // eslint-disable-next-line no-console
    console.log("[web-vitals]", { name, value, id, delta });
    res.status(204).end();
  });

  return router;
}
