import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { adminTenantRouter } from "../../src/server/routes/admin-tenant.js";

function buildApp(pool: Pool) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", adminTenantRouter({ pool }));
  return app;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;
const TOKEN = "admin-tenant-events-test-token";
const RT = [{ id: "e1", type: "rich-text", props: { html: "<p>come</p>" } }];
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

d("admin tenant events API (P8-T8.13)", () => {
  let pool: Pool;
  let siteId: string;
  let app: express.Express;

  beforeAll(async () => {
    await migrate({
      databaseUrl: TEST_DB_URL!,
      dir: MIGRATIONS_DIR,
      migrationsTable: "pgmigrations",
      direction: "up",
      count: Infinity,
      log: () => undefined,
    });
    pool = new Pool({ connectionString: TEST_DB_URL });
    const res = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ('atevents', 'AT Events') RETURNING id`,
    );
    siteId = res.rows[0].id;
    app = buildApp(pool);
  }, 60_000);

  // vi.stubEnv, not a raw `process.env` write — vitest's `unstubEnvs`
  // hygiene then guarantees this resets before the next test runs anywhere
  // in the suite, regardless of how long this file's own `afterAll` takes
  // (see .superpowers/sdd/2026-07-30-lovable-workspace/test-pollution-debug.md).
  beforeEach(() => {
    vi.stubEnv("ADMIN_API_TOKEN", TOKEN);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM sites WHERE slug = 'atevents'`).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  const auth = (r: request.Test) => r.set("x-admin-token", TOKEN);

  it("requires admin auth", async () => {
    expect((await request(app).get(`/api/sites/${siteId}/events`)).status).toBe(401);
  });

  it("404s an unknown site on list + create", async () => {
    expect((await auth(request(app).get(`/api/sites/${NIL_UUID}/events`))).status).toBe(404);
    expect(
      (await auth(
        request(app).post(`/api/sites/${NIL_UUID}/events`).send({ slug: "x", title: "X", starts_at: "2026-07-01T18:00:00Z" }),
      )).status,
    ).toBe(404);
  });

  it("creates an event (ISO date coerced), lists it (description omitted), reads it back", async () => {
    const created = await auth(
      request(app).post(`/api/sites/${siteId}/events`).send({
        slug: "launch",
        title: "Launch",
        starts_at: "2026-07-01T18:00:00Z",
        location: "HQ",
        description: RT,
      }),
    );
    expect(created.status).toBe(201);
    expect(created.body.event.status).toBe("draft");
    expect(created.body.event.starts_at).toContain("2026-07-01");
    const eventId = created.body.event.id as string;

    const list = await auth(request(app).get(`/api/sites/${siteId}/events`));
    expect(list.status).toBe(200);
    const row = list.body.events.find((e: { id: string }) => e.id === eventId);
    expect(row).toBeTruthy();
    expect(row.description).toBeUndefined();

    const full = await auth(request(app).get(`/api/sites/${siteId}/events/${eventId}`));
    expect(full.body.event.description).toEqual(RT);
    expect(full.body.event.location).toBe("HQ");
  });

  it("updates status + description via PUT", async () => {
    const created = await auth(
      request(app).post(`/api/sites/${siteId}/events`).send({ slug: "upd", title: "Upd", starts_at: "2026-08-01T10:00:00Z" }),
    );
    const eventId = created.body.event.id as string;
    const upd = await auth(
      request(app).put(`/api/sites/${siteId}/events/${eventId}`).send({ status: "published", location: "Main St" }),
    );
    expect(upd.status).toBe(200);
    expect(upd.body.event.status).toBe("published");
    expect(upd.body.event.location).toBe("Main St");
  });

  it("409s a duplicate slug; 400s a bad description", async () => {
    await auth(request(app).post(`/api/sites/${siteId}/events`).send({ slug: "dup", title: "A", starts_at: "2026-09-01T10:00:00Z" }));
    expect(
      (await auth(request(app).post(`/api/sites/${siteId}/events`).send({ slug: "dup", title: "B", starts_at: "2026-09-01T10:00:00Z" }))).status,
    ).toBe(409);
    expect(
      (await auth(
        request(app).post(`/api/sites/${siteId}/events`).send({
          slug: "baddesc",
          title: "Bad",
          starts_at: "2026-09-01T10:00:00Z",
          description: [{ id: "n", type: "nope", props: {} }],
        }),
      )).status,
    ).toBe(400);
  });

  it("400s a missing starts_at", async () => {
    expect(
      (await auth(request(app).post(`/api/sites/${siteId}/events`).send({ slug: "nostart", title: "X" }))).status,
    ).toBe(400);
  });

  it("deletes an event and then 404s it", async () => {
    const created = await auth(
      request(app).post(`/api/sites/${siteId}/events`).send({ slug: "gone", title: "Gone", starts_at: "2026-10-01T10:00:00Z" }),
    );
    const eventId = created.body.event.id as string;
    expect((await auth(request(app).delete(`/api/sites/${siteId}/events/${eventId}`))).status).toBe(204);
    expect((await auth(request(app).get(`/api/sites/${siteId}/events/${eventId}`))).status).toBe(404);
    expect((await auth(request(app).delete(`/api/sites/${siteId}/events/${eventId}`))).status).toBe(404);
  });
});
