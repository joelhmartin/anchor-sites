import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../db.js";
import { bootJobs, getBoss, stopJobs, __resetJobsForTests } from "./index.js";

const skip = !process.env.TEST_DATABASE_URL;
const d = skip ? describe.skip : describe;

d("pg-boss bootstrap (P3-T3.8 / D-030)", () => {
  beforeEach(() => {
    __resetJobsForTests();
    delete process.env.JOBS_ENABLED;
  });

  afterEach(async () => {
    await stopJobs().catch(() => {});
    __resetJobsForTests();
  });

  it("boot → register → handle a job round-trip", async () => {
    const seen: string[] = [];
    const boot = await bootJobs(pool, {
      connectionString: process.env.TEST_DATABASE_URL,
      extraHandlers: async (boss) => {
        // pg-boss v12: queues are created lazily on first send. Create
        // it explicitly so work() doesn't race.
        await boss.createQueue("test.echo");
        await boss.work<{ msg: string }>("test.echo", async ([job]) => {
          seen.push(job.data.msg);
        });
      },
    });
    expect(boot.boss).toBeDefined();

    await boot.boss.send("test.echo", { msg: "hello" });

    // pg-boss polls; give it up to 3s.
    const deadline = Date.now() + 3000;
    while (seen.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(seen).toEqual(["hello"]);

    // This test boots a REAL pg-boss against the shared local Postgres test
    // database (not an ephemeral per-run DB), so the completed "test.echo"
    // job row it just created would otherwise persist forever — pg-boss's
    // own maintenance sweep only runs on a 60s `superviseIntervalSeconds`
    // timer, far longer than this short-lived boss instance's life, so it
    // never fires before `stopJobs()` tears the boss down in `afterEach`.
    // Left unchecked across many local test runs during development, this
    // accumulates into a large `pgboss.job` table that measurably slows down
    // every OTHER integration test file's own bootJobs()/pool queries in the
    // same single-fork suite — the proven root cause of a cross-file test
    // flake (see .superpowers/sdd/2026-07-30-lovable-workspace/
    // test-pollution-debug.md). Delete the queue (and its job row) so
    // repeated local runs don't destabilize the rest of the suite.
    await boot.boss.deleteQueue("test.echo");
  }, 15_000);

  it("bootJobs is idempotent — second call returns the same instance", async () => {
    const b1 = await bootJobs(pool, { connectionString: process.env.TEST_DATABASE_URL });
    const b2 = await bootJobs(pool, { connectionString: process.env.TEST_DATABASE_URL });
    expect(b1.boss).toBe(b2.boss);
  }, 15_000);

  it("getBoss throws when bootJobs hasn't run", () => {
    expect(() => getBoss()).toThrow(/pg-boss not started/);
  });

  it("JOBS_ENABLED=false returns a no-op boot handle", async () => {
    process.env.JOBS_ENABLED = "false";
    const boot = await bootJobs(pool);
    expect(boot.boss).toBeUndefined();
    await expect(boot.stop()).resolves.toBeUndefined();
  });

  it("stopJobs is idempotent", async () => {
    await bootJobs(pool, { connectionString: process.env.TEST_DATABASE_URL });
    await stopJobs();
    await expect(stopJobs()).resolves.toBeUndefined();
  }, 15_000);
});
