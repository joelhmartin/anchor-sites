import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { ping } from "./db.js";

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

  return app;
}
