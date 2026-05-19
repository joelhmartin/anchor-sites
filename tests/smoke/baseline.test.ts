import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/server/app.js";
import { pool } from "../../src/server/db.js";

describe("baseline smoke", () => {
  const app = createApp();

  it("GET /healthz returns 200 with ok:true", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.db).toBe("boolean");
  });

  it("unknown API route returns 404", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
  });

  const dbConnect = process.env.DATABASE_URL ? it : it.skip;
  dbConnect("DB pool connects when DATABASE_URL is set", async () => {
    const res = await pool.query("SELECT 1 AS ok");
    expect(res.rows[0].ok).toBe(1);
  });

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });
});
