/**
 * W2-SEC D523/D811 — credential-bearing values must never reach request logs.
 *
 * pino-http previously logged the raw req.url (which carries `?token=` for
 * the preview iframe — pv1/ptv1 today, and historically the long-lived
 * ADMIN_API_TOKEN), the parsed `query` object, and every request header
 * (x-admin-token, cookie). These tests drive the shared `httpLogger` app.ts
 * mounts: URLs keep their PATH visible but credential params are censored,
 * and credential headers are redacted.
 */
import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Writable } from "node:stream";
import { httpLogger, sanitizeLoggedUrl } from "../../src/server/http-logger.js";

describe("sanitizeLoggedUrl (D523/D811)", () => {
  it("censors token-like query params but keeps the path and other params", () => {
    const out = sanitizeLoggedUrl("/api/sites/s1/pages/p1/preview?token=pv1.s1.999.abc&v=3");
    expect(out).toContain("/api/sites/s1/pages/p1/preview");
    expect(out).not.toContain("pv1.s1.999.abc");
    expect(out).toContain("token=[redacted]");
    expect(out).toContain("v=3");
  });

  it("censors other credential-named params (secret, api_key, password)", () => {
    const out = sanitizeLoggedUrl("/x?secret=s3cr3t&api_key=k123&password=pw&ok=1");
    expect(out).not.toContain("s3cr3t");
    expect(out).not.toContain("k123");
    expect(out).not.toContain("pw&");
    expect(out).toContain("ok=1");
  });

  it("leaves URLs without a query string untouched", () => {
    expect(sanitizeLoggedUrl("/api/healthz")).toBe("/api/healthz");
  });
});

function captureApp(): { app: express.Express; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  const app = express();
  app.use(httpLogger({ stream }));
  app.get("/api/thing", (_req, res) => {
    res.json({ ok: true });
  });
  return {
    app,
    lines: () =>
      chunks
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

describe("httpLogger through a real express app", () => {
  it("logs the path but never the token query value (url AND query object)", async () => {
    const { app, lines } = captureApp();
    await request(app).get("/api/thing?token=pv1.site.123.sig&v=2");
    const raw = JSON.stringify(lines());
    expect(raw).toContain("/api/thing");
    expect(raw).not.toContain("pv1.site.123.sig");
    expect(raw).toContain("[redacted]");
    // Non-credential params stay visible.
    expect(raw).toContain('"v":"2"');
  });

  it("redacts x-admin-token, authorization, and cookie headers", async () => {
    const { app, lines } = captureApp();
    await request(app)
      .get("/api/thing")
      .set("X-Admin-Token", "super-secret-admin-token")
      .set("Authorization", "Bearer abc123")
      .set("Cookie", "better-auth.session_token=sess-secret");
    const raw = JSON.stringify(lines());
    expect(raw).not.toContain("super-secret-admin-token");
    expect(raw).not.toContain("Bearer abc123");
    expect(raw).not.toContain("sess-secret");
  });

  it("sanitizes a token-bearing referer header instead of dropping the whole log line", async () => {
    const { app, lines } = captureApp();
    await request(app)
      .get("/api/thing")
      .set("Referer", "https://studio.anchorcorps.com/api/sites/s1/pages/p1/preview?token=pv1.s1.9.zz");
    const raw = JSON.stringify(lines());
    expect(raw).not.toContain("pv1.s1.9.zz");
    expect(raw).toContain("/api/sites/s1/pages/p1/preview");
  });

  it("skips /healthz noise entirely", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(String(chunk));
        cb();
      },
    });
    const app = express();
    app.use(httpLogger({ stream }));
    app.get("/healthz", (_req, res) => {
      res.json({ ok: true });
    });
    await request(app).get("/healthz");
    expect(chunks.join("")).toBe("");
  });
});
