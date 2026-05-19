import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  __clearResolveSiteCacheForTests,
  evictSiteCache,
  lookupSiteForDebug,
  resolveSiteCacheSize,
} from "../../src/middleware/resolveSite.js";
import { pool } from "../../src/server/db.js";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL;
const d = skip ? describe.skip : describe;

d("resolveSite cache + eviction (P3-T3.1)", () => {
  beforeEach(() => {
    __clearResolveSiteCacheForTests();
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  it("populates cache on a debug lookup and reports cache_hit on the second call", async () => {
    const r1 = await lookupSiteForDebug(pool, "muldoon-dental.sites.anchorcorps.com");
    expect(r1.cache_hit).toBe(false);
    expect(r1.site?.slug).toBe("muldoon-dental");

    const r2 = await lookupSiteForDebug(pool, "muldoon-dental.sites.anchorcorps.com");
    expect(r2.cache_hit).toBe(true);
    expect(r2.site?.slug).toBe("muldoon-dental");
  });

  it("evictSiteCache(hostname) removes the entry; next lookup is a miss", async () => {
    await lookupSiteForDebug(pool, "muldoon-dental.sites.anchorcorps.com");
    expect(resolveSiteCacheSize()).toBe(1);

    evictSiteCache("muldoon-dental.sites.anchorcorps.com");
    expect(resolveSiteCacheSize()).toBe(0);

    const after = await lookupSiteForDebug(pool, "muldoon-dental.sites.anchorcorps.com");
    expect(after.cache_hit).toBe(false);
  });

  it("evictSiteCache is idempotent — calling on an uncached hostname is a no-op", () => {
    expect(() => evictSiteCache("never-cached.example.com")).not.toThrow();
    expect(resolveSiteCacheSize()).toBe(0);
  });

  it("evictSiteCache strips port — same hostname with :3000 evicts the cached key", async () => {
    await lookupSiteForDebug(pool, "muldoon-dental.sites.anchorcorps.com");
    expect(resolveSiteCacheSize()).toBe(1);
    evictSiteCache("muldoon-dental.sites.anchorcorps.com:3000");
    expect(resolveSiteCacheSize()).toBe(0);
  });

  it("negative results are cached too (cache_hit=true on second miss)", async () => {
    const r1 = await lookupSiteForDebug(pool, "no-such-site.sites.anchorcorps.com");
    expect(r1.site).toBeNull();
    expect(r1.cache_hit).toBe(false);

    const r2 = await lookupSiteForDebug(pool, "no-such-site.sites.anchorcorps.com");
    expect(r2.site).toBeNull();
    expect(r2.cache_hit).toBe(true);
  });
});
