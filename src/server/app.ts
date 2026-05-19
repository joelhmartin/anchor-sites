import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { ping } from "./db.js";
import { blocksPreviewRouter } from "./routes/blocks-preview.js";
import { pageRouter } from "./routes/page.js";
import { resolveSite } from "../middleware/resolveSite.js";

export function createApp(): Express {
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ autoLogging: { ignore: (req) => req.url === "/healthz" } }));

  app.get("/healthz", async (_req: Request, res: Response) => {
    const db = await ping();
    res.status(200).json({ ok: true, db });
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

  // Tenant page renderer. Registered last so all named admin/probe routes
  // above match first. Unknown hosts pass through (Vite/SPA fallback in dev,
  // static-index fallback in prod — both mounted by `src/server/index.ts`).
  app.use(pageRouter());

  return app;
}
