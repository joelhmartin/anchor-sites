import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/server/app.js";
import { pool } from "../../src/server/db.js";
import { __clearResolveSiteCacheForTests } from "../../src/middleware/resolveSite.js";

const skip = !process.env.TEST_DATABASE_URL;
const d = skip ? describe.skip : describe;

const ADMIN_TOKEN = "test-admin-token-for-site-resolve";

d("GET /__site_resolve (P3-T3.2)", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    app = createApp();
  });

  beforeEach(() => {
    __clearResolveSiteCacheForTests();
  });

  afterAll(async () => {
    delete process.env.ADMIN_API_TOKEN;
    await pool.end().catch(() => {});
  });

  it("requires admin token (401 without)", async () => {
    const res = await request(app).get(
      "/__site_resolve?host=muldoon-dental.sites.anchorcorps.com",
    );
    expect(res.status).toBe(401);
  });

  it("401 when admin token is wrong", async () => {
    const res = await request(app)
      .get("/__site_resolve?host=muldoon-dental.sites.anchorcorps.com")
      .set("X-Admin-Token", "wrong");
    expect(res.status).toBe(401);
  });

  it("400 when host query param missing", async () => {
    const res = await request(app)
      .get("/__site_resolve")
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/host/);
  });

  it("returns resolved site for a known hostname (cache_hit=false on first call, true on second)", async () => {
    const r1 = await request(app)
      .get("/__site_resolve?host=muldoon-dental.sites.anchorcorps.com")
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r1.status).toBe(200);
    expect(r1.body.resolved.slug).toBe("muldoon-dental");
    // Either lookup path is correct — the seed sets both an explicit
    // site_domains row and a subdomain that matches the slug. The endpoint
    // should report whichever path actually served the result.
    expect(["domain", "subdomain"]).toContain(r1.body.source);
    expect(r1.body.cache_hit).toBe(false);
    expect(r1.body.cache_size).toBeGreaterThanOrEqual(1);

    const r2 = await request(app)
      .get("/__site_resolve?host=muldoon-dental.sites.anchorcorps.com")
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r2.status).toBe(200);
    expect(r2.body.cache_hit).toBe(true);
  });

  it("returns resolved: null + source: null for an unknown hostname", async () => {
    const res = await request(app)
      .get("/__site_resolve?host=does-not-exist.sites.anchorcorps.com")
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.resolved).toBeNull();
    expect(res.body.source).toBeNull();
  });
});
