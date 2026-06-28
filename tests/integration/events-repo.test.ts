import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEvent,
  deleteEvent,
  EventSlugConflictError,
  getEventBySlug,
  InvalidEventDescriptionError,
  listEvents,
  updateEvent,
} from "../../src/server/events/repo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const DESC = [{ id: "r1", type: "rich-text", props: { html: "<p>Join us</p>" } }];

d("events repo (P8-T8.10)", () => {
  let pool: Pool;
  let siteA: string;
  let siteB: string;

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
    const a = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name, default_brand_tokens) VALUES ('p8t810-a','A','{}'::jsonb) RETURNING id`,
    );
    const b = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name, default_brand_tokens) VALUES ('p8t810-b','B','{}'::jsonb) RETURNING id`,
    );
    siteA = a.rows[0].id;
    siteB = b.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM sites WHERE slug IN ('p8t810-a','p8t810-b')`).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it("creates events (ISO date coerced) and orders by starts_at", async () => {
    await createEvent(pool, siteA, {
      slug: "later",
      title: "Later",
      description: DESC,
      starts_at: new Date("2026-09-01T18:00:00Z"),
      status: "published",
    });
    await createEvent(pool, siteA, {
      slug: "sooner",
      title: "Sooner",
      description: DESC,
      starts_at: new Date("2026-07-01T18:00:00Z"),
      status: "published",
    });
    const list = await listEvents(pool, siteA, { status: "published" });
    expect(list.map((e) => e.slug)).toEqual(["sooner", "later"]); // ascending by starts_at
    expect(list[0].starts_at).toContain("2026-07-01");
  });

  it("rejects a duplicate slug within a site, allows it across sites", async () => {
    await createEvent(pool, siteA, { slug: "gala", title: "A", description: DESC, starts_at: new Date("2026-10-01T00:00:00Z") });
    await expect(
      createEvent(pool, siteA, { slug: "gala", title: "A2", description: DESC, starts_at: new Date("2026-10-02T00:00:00Z") }),
    ).rejects.toThrow(EventSlugConflictError);
    const inB = await createEvent(pool, siteB, { slug: "gala", title: "B", description: DESC, starts_at: new Date("2026-10-01T00:00:00Z") });
    expect(inB.site_id).toBe(siteB);
  });

  it("rejects a description that fails registry validation", async () => {
    await expect(
      createEvent(pool, siteA, {
        slug: "bad",
        title: "Bad",
        description: [{ id: "rx", type: "rich-text", props: { max_width: "huge" } }],
        starts_at: new Date("2026-11-01T00:00:00Z"),
      }),
    ).rejects.toThrow(InvalidEventDescriptionError);
  });

  it("persists and updates the seo blob (P9-T9.1)", async () => {
    const created = await createEvent(pool, siteA, {
      slug: "seo-event",
      title: "SEO Event",
      description: DESC,
      starts_at: new Date("2027-01-01T00:00:00Z"),
      seo: { title: "Gala SEO", og: { title: "Come!" } },
    });
    expect(created.seo).toEqual({ title: "Gala SEO", og: { title: "Come!" } });
    const bare = await createEvent(pool, siteA, {
      slug: "seo-bare-event",
      title: "Bare",
      description: DESC,
      starts_at: new Date("2027-02-01T00:00:00Z"),
    });
    expect(bare.seo).toEqual({});
    const patched = await updateEvent(pool, siteA, created.id, {
      seo: { description: "updated" },
    });
    expect(patched?.seo).toEqual({ description: "updated" });
  });

  it("updates and scopes reads/deletes by site_id", async () => {
    const e = await createEvent(pool, siteA, { slug: "movable", title: "M", description: DESC, starts_at: new Date("2026-12-01T00:00:00Z") });
    const updated = await updateEvent(pool, siteA, e.id, { status: "published", location: "Hall A" });
    expect(updated?.status).toBe("published");
    expect(updated?.location).toBe("Hall A");

    expect(await getEventBySlug(pool, siteB, "movable")).toBeNull(); // scoped out
    expect(await deleteEvent(pool, siteB, e.id)).toBe(false); // wrong site
    expect(await deleteEvent(pool, siteA, e.id)).toBe(true);
  });
});
