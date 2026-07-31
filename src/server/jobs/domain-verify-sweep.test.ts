import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { setupAgentDb } from "../../../tests/helpers/agent-db.js";
import type { CloudRunDomainsClient } from "../gcloud/run-domains.js";
import { sweepPendingDomains } from "./domain-verify-sweep.js";

/**
 * D515: rows stuck at 'pending' for over an hour get an automatic
 * authoritative re-check against Cloud Run — verified/active on success, an
 * honest 'failed' + instruction when the mapping is missing, untouched when
 * Cloud Run is unreachable. Fresh pending rows and terminal 'failed' rows
 * are never swept.
 */

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;

function readyMapping() {
  return {
    status: {
      conditions: [
        { type: "Ready", status: "True" },
        { type: "CertificateProvisioned", status: "True" },
      ],
    },
  };
}

function notReadyMapping() {
  return {
    status: {
      conditions: [
        { type: "Ready", status: "Unknown" },
        { type: "CertificateProvisioned", status: "Unknown" },
      ],
    },
  };
}

d("sweepPendingDomains (D515)", () => {
  const db = setupAgentDb();
  let pool: Pool;
  let siteId: string;

  beforeAll(async () => {
    await db.runMigrations();
    pool = db.getPool();
    const site = await db.seedSite("sweep-test");
    siteId = site.id;
  }, 60_000);

  afterAll(async () => {
    await db.teardown();
  });

  async function seedDomain(
    hostname: string,
    opts: { verification?: string; ssl?: string; staleMinutes?: number } = {},
  ): Promise<string> {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO site_domains (site_id, hostname, is_primary, verification_status, ssl_status, updated_at)
       VALUES ($1, $2, false, $3, $4, now() - ($5 * interval '1 minute'))
       RETURNING id`,
      [
        siteId,
        hostname,
        opts.verification ?? "pending",
        opts.ssl ?? "pending",
        opts.staleMinutes ?? 120,
      ],
    );
    return r.rows[0].id;
  }

  async function status(id: string) {
    const r = await pool.query<{
      verification_status: string;
      ssl_status: string;
      last_error: string | null;
    }>(`SELECT verification_status, ssl_status, last_error FROM site_domains WHERE id = $1`, [id]);
    return r.rows[0];
  }

  function cloudRunByHostname(map: Record<string, unknown | null | Error>) {
    return {
      async get(hostname: string) {
        const v = map[hostname];
        if (v instanceof Error) throw v;
        return v ?? null;
      },
    } as unknown as CloudRunDomainsClient;
  }

  it("upgrades a stale pending row whose mapping is Ready to verified/active", async () => {
    const id = await seedDomain("ok.sweep-test.example.com");
    const result = await sweepPendingDomains({
      pool,
      cloudRun: cloudRunByHostname({ "ok.sweep-test.example.com": readyMapping() }),
    });

    expect(result.verified).toBeGreaterThanOrEqual(1);
    expect(await status(id)).toMatchObject({
      verification_status: "verified",
      ssl_status: "active",
    });
    await pool.query(`DELETE FROM site_domains WHERE id = $1`, [id]);
  });

  it("writes an honest 'failed' + instruction when the mapping is missing", async () => {
    const id = await seedDomain("gone.sweep-test.example.com");
    const result = await sweepPendingDomains({
      pool,
      cloudRun: cloudRunByHostname({}),
    });

    expect(result.failed).toBeGreaterThanOrEqual(1);
    const s = await status(id);
    expect(s.verification_status).toBe("failed");
    expect(s.last_error).toMatch(/no Cloud Run domain mapping/i);
    await pool.query(`DELETE FROM site_domains WHERE id = $1`, [id]);
  });

  it("touches (re-arms) a stale pending row whose mapping exists but is not ready", async () => {
    const id = await seedDomain("slow.sweep-test.example.com");
    await sweepPendingDomains({
      pool,
      cloudRun: cloudRunByHostname({ "slow.sweep-test.example.com": notReadyMapping() }),
    });

    const s = await status(id);
    expect(s.verification_status).toBe("pending");
    // updated_at was touched — the row is no longer stale, so an immediate
    // second sweep skips it (no double-checking within the window).
    const second = await sweepPendingDomains({
      pool,
      cloudRun: cloudRunByHostname({ "slow.sweep-test.example.com": notReadyMapping() }),
    });
    expect(second.checked).toBe(0);
    await pool.query(`DELETE FROM site_domains WHERE id = $1`, [id]);
  });

  it("never sweeps fresh pending rows, terminal failed rows, or *.localhost rows", async () => {
    const freshId = await seedDomain("fresh.sweep-test.example.com", { staleMinutes: 5 });
    const failedId = await seedDomain("failed.sweep-test.example.com", {
      verification: "failed",
      ssl: "failed",
    });
    await pool.query(`UPDATE site_domains SET last_error = 'verdict' WHERE id = $1`, [failedId]);
    const localhostId = await seedDomain("sweep-test.localhost");

    const result = await sweepPendingDomains({
      pool,
      // Everything would report Ready if checked — proving they were NOT checked.
      cloudRun: cloudRunByHostname({
        "fresh.sweep-test.example.com": readyMapping(),
        "failed.sweep-test.example.com": readyMapping(),
        "sweep-test.localhost": readyMapping(),
      }),
    });

    expect(result.checked).toBe(0);
    expect((await status(freshId)).verification_status).toBe("pending");
    expect(await status(failedId)).toMatchObject({
      verification_status: "failed",
      last_error: "verdict",
    });
    expect((await status(localhostId)).verification_status).toBe("pending");
    await pool.query(`DELETE FROM site_domains WHERE id = ANY($1)`, [
      [freshId, failedId, localhostId],
    ]);
  });

  it("leaves the row untouched (for the next sweep) when Cloud Run is unreachable", async () => {
    const id = await seedDomain("flaky.sweep-test.example.com");
    const result = await sweepPendingDomains({
      pool,
      cloudRun: cloudRunByHostname({
        "flaky.sweep-test.example.com": new Error("Cloud Run 500: unavailable"),
      }),
    });

    expect(result.check_errors).toBeGreaterThanOrEqual(1);
    const s = await status(id);
    expect(s.verification_status).toBe("pending");
    // Still stale — the NEXT sweep picks it up again.
    const again = await sweepPendingDomains({
      pool,
      cloudRun: cloudRunByHostname({ "flaky.sweep-test.example.com": readyMapping() }),
    });
    expect(again.verified).toBeGreaterThanOrEqual(1);
    await pool.query(`DELETE FROM site_domains WHERE id = $1`, [id]);
  });
});
