import { describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { globalErrorHandler } from "../../src/server/app.js";

// D102 — the global error handler must never write to a response that has
// already started: an error surfacing after res.json() (e.g. from a
// post-response tail) used to hit res.status().json() unconditionally and
// throw ERR_HTTP_HEADERS_SENT on top of the original error.
describe("globalErrorHandler (D102)", () => {
  const buildApp = () => {
    const app = express();
    app.get("/boom", (_req: Request, _res: Response, next: NextFunction) => {
      const err = new Error("teapot") as Error & { status: number };
      err.status = 418;
      next(err);
    });
    app.get("/late", (_req: Request, res: Response, next: NextFunction) => {
      res.status(200).json({ ok: true });
      next(new Error("late failure"));
    });
    app.use(globalErrorHandler());
    // Captures whatever the handler delegates onward — with the guard this
    // is the ORIGINAL error; without it, res.json() on a sent response
    // throws and Express forwards that secondary error here instead.
    const captured: unknown[] = [];
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      captured.push(err);
      if (!res.headersSent) res.status(599).end();
    });
    return { app, captured };
  };

  it("returns a JSON error when no response has started", async () => {
    const { app, captured } = buildApp();
    const res = await request(app).get("/boom");
    expect(res.status).toBe(418);
    expect(res.body).toEqual({ error: "teapot" });
    expect(captured).toHaveLength(0);
  });

  it("delegates the original error via next(err) once headers are sent", async () => {
    const { app, captured } = buildApp();
    const res = await request(app).get("/late");
    // The already-sent 200 must survive untouched.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(captured).toHaveLength(1);
    expect((captured[0] as Error).message).toBe("late failure");
  });
});
