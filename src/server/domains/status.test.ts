import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { setupAgentDb } from "../../../tests/helpers/agent-db.js";
import { applyDomainStatus, type DomainStatusRow } from "./status.js";

/**
 * D608 (W2-DOM): ONE guarded transition function for
 * site_domains.verification_status / ssl_status. Before this, three writers
 * (site-provision markFailed, the orchestrator's post-wait write, and the
 * status poll route) free-wrote any value — and the poll silently rewrote
 * failed→pending, erasing an exhausted-retry verdict the moment anyone
 * opened the Domains tab.
 *
 * Modes:
 *   - "authoritative": the caller has real evidence (a completed wait, an
 *     exhausted retry budget, an explicit operator-triggered re-check).
 *     Any transition is allowed; last_error is set on failure and cleared
 *     otherwise; verified_at is stamped on transition into 'verified'.
 *   - "upgrade-only": a passive observation (the GET status poll). Only
 *     success values (verified/active) are applied; pending/failed inputs
 *     never downgrade the stored value, and last_error survives until the
 *     domain actually works.
 */

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;

d("applyDomainStatus (D608 transition helper)", () => {
  const db = setupAgentDb();
  let pool: Pool;
  let siteId: string;

  beforeAll(async () => {
    await db.runMigrations();
    pool = db.getPool();
    const site = await db.seedSite("domain-status");
    siteId = site.id;
  }, 60_000);

  afterAll(async () => {
    await db.teardown();
  });

  async function seedDomain(
    hostname: string,
    verification = "pending",
    ssl = "pending",
  ): Promise<string> {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO site_domains (site_id, hostname, is_primary, verification_status, ssl_status)
       VALUES ($1, $2, false, $3, $4) RETURNING id`,
      [siteId, hostname, verification, ssl],
    );
    return r.rows[0].id;
  }

  async function readRow(id: string): Promise<DomainStatusRow> {
    const r = await pool.query<DomainStatusRow>(
      `SELECT id, hostname, verification_status, ssl_status, last_error, updated_at, verified_at
         FROM site_domains WHERE id = $1`,
      [id],
    );
    return r.rows[0];
  }

  it("authoritative: pending → failed persists last_error and touches updated_at", async () => {
    const id = await seedDomain("auth-fail.example.com");
    const before = await readRow(id);

    const row = await applyDomainStatus(
      pool,
      { id },
      {
        verification_status: "failed",
        ssl_status: "failed",
        error: "Cloud Run 403: PermissionDenied — add the service account as a verified owner",
      },
      "authoritative",
    );

    expect(row?.verification_status).toBe("failed");
    expect(row?.ssl_status).toBe("failed");
    expect(row?.last_error).toMatch(/PermissionDenied/);
    expect(row?.verified_at).toBeNull();
    expect(new Date(row!.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before.updated_at).getTime(),
    );
  });

  it("authoritative: failed → verified clears last_error and stamps verified_at", async () => {
    const id = await seedDomain("auth-recover.example.com", "failed", "failed");
    await pool.query(`UPDATE site_domains SET last_error = 'old failure' WHERE id = $1`, [id]);

    const row = await applyDomainStatus(
      pool,
      { id },
      { verification_status: "verified", ssl_status: "active" },
      "authoritative",
    );

    expect(row?.verification_status).toBe("verified");
    expect(row?.ssl_status).toBe("active");
    expect(row?.last_error).toBeNull();
    expect(row?.verified_at).not.toBeNull();
  });

  it("authoritative: failed → pending (a real re-check) is allowed and clears last_error", async () => {
    const id = await seedDomain("auth-recheck.example.com", "failed", "failed");
    await pool.query(`UPDATE site_domains SET last_error = 'stale' WHERE id = $1`, [id]);

    const row = await applyDomainStatus(
      pool,
      { id },
      { verification_status: "pending", ssl_status: "pending" },
      "authoritative",
    );

    expect(row?.verification_status).toBe("pending");
    expect(row?.last_error).toBeNull();
  });

  it("upgrade-only: NEVER downgrades failed → pending (the D608 poll bug)", async () => {
    const id = await seedDomain("poll-nodowngrade.example.com", "failed", "failed");
    await pool.query(`UPDATE site_domains SET last_error = 'exhausted retries' WHERE id = $1`, [id]);

    const row = await applyDomainStatus(
      pool,
      { id },
      { verification_status: "pending", ssl_status: "pending" },
      "upgrade-only",
    );

    expect(row?.verification_status).toBe("failed");
    expect(row?.ssl_status).toBe("failed");
    expect(row?.last_error).toBe("exhausted retries");
  });

  it("upgrade-only: never downgrades verified → pending (poll flap)", async () => {
    const id = await seedDomain("poll-noflap.example.com", "verified", "active");

    const row = await applyDomainStatus(
      pool,
      { id },
      { verification_status: "pending", ssl_status: "pending" },
      "upgrade-only",
    );

    expect(row?.verification_status).toBe("verified");
    expect(row?.ssl_status).toBe("active");
  });

  it("upgrade-only: applies verified/active upgrades, stamps verified_at, clears last_error on full success", async () => {
    const id = await seedDomain("poll-upgrade.example.com", "failed", "pending");
    await pool.query(`UPDATE site_domains SET last_error = 'was broken' WHERE id = $1`, [id]);

    const row = await applyDomainStatus(
      pool,
      { id },
      { verification_status: "verified", ssl_status: "active" },
      "upgrade-only",
    );

    expect(row?.verification_status).toBe("verified");
    expect(row?.ssl_status).toBe("active");
    expect(row?.verified_at).not.toBeNull();
    expect(row?.last_error).toBeNull();
  });

  it("upgrade-only: partial upgrade keeps last_error until the domain fully works", async () => {
    const id = await seedDomain("poll-partial.example.com", "failed", "failed");
    await pool.query(`UPDATE site_domains SET last_error = 'cert broke' WHERE id = $1`, [id]);

    const row = await applyDomainStatus(
      pool,
      { id },
      { verification_status: "verified", ssl_status: "pending" },
      "upgrade-only",
    );

    expect(row?.verification_status).toBe("verified");
    expect(row?.ssl_status).toBe("failed"); // pending is not an upgrade over failed
    expect(row?.last_error).toBe("cert broke");
  });

  it("addresses rows by hostname too (the orchestrator's key)", async () => {
    const id = await seedDomain("by-hostname.example.com");

    const row = await applyDomainStatus(
      pool,
      { hostname: "by-hostname.example.com" },
      { verification_status: "verified", ssl_status: "active" },
      "authoritative",
    );

    expect(row?.id).toBe(id);
    expect(row?.verification_status).toBe("verified");
  });

  it("returns null for a missing row instead of throwing", async () => {
    const row = await applyDomainStatus(
      pool,
      { id: "00000000-0000-0000-0000-000000000000" },
      { verification_status: "verified", ssl_status: "active" },
      "authoritative",
    );
    expect(row).toBeNull();
  });
});
