#!/usr/bin/env tsx
/**
 * P12-T12.8 — Smoke-test CLI for post-migration validation.
 *
 * Usage:
 *   DATABASE_URL=<url> tsx scripts/smoke-test.ts --site-id=<uuid>
 *
 * Checks:
 *   ✓ Site exists in DB
 *   ✓ Primary domain has ssl_status='active'
 *   ✓ CTM script present in rendered HTML (when ctm_account_id set)
 *   ✓ Analytics script present in rendered HTML (when ANALYTICS_BASE_URL set and not disabled)
 *   ✓ CRM site provisioned (crm_site_id non-null)
 *
 * Exits 0 on all green, 1 on any failure.
 */
import { Pool } from "pg";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

const siteId = args["site-id"];
if (!siteId) {
  console.error("Usage: smoke-test.ts --site-id=<uuid>");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL env var is required");
  process.exit(1);
}

type SiteRow = {
  id: string;
  slug: string;
  display_name: string;
  status: string;
  ctm_account_id: string | null;
  crm_site_id: string | null;
  analytics_disabled: boolean;
};

type DomainRow = {
  hostname: string;
  is_primary: boolean;
  ssl_status: string;
  verification_status: string;
};

const checks: { label: string; pass: boolean; detail?: string }[] = [];

function check(label: string, pass: boolean, detail?: string) {
  checks.push({ label, pass, detail });
}

const pool = new Pool({ connectionString: databaseUrl });

try {
  // 1. Site exists
  const siteRes = await pool.query<SiteRow>(
    `SELECT id, slug, display_name, status, ctm_account_id, crm_site_id, analytics_disabled
       FROM sites WHERE id = $1`,
    [siteId],
  );
  if (siteRes.rowCount === 0) {
    check("site exists in DB", false, `No site found with id=${siteId}`);
    printAndExit();
  }
  const site = siteRes.rows[0];
  check("site exists in DB", true, `${site.display_name} (${site.slug})`);
  check("site is active", site.status === "active", `status=${site.status}`);

  // 2. Primary domain SSL
  const domainRes = await pool.query<DomainRow>(
    `SELECT hostname, is_primary, ssl_status, verification_status
       FROM site_domains WHERE site_id = $1`,
    [siteId],
  );
  const primaryDomain = domainRes.rows.find((d) => d.is_primary);
  if (!primaryDomain) {
    check("primary domain SSL active", false, "no primary domain found");
  } else {
    check(
      "primary domain SSL active",
      primaryDomain.ssl_status === "active",
      `${primaryDomain.hostname} ssl_status=${primaryDomain.ssl_status}`,
    );
  }

  // 3. CTM script in HTML
  if (site.ctm_account_id) {
    const domain = primaryDomain?.hostname ?? `${site.slug}.sites.anchorcorps.com`;
    try {
      const resp = await fetch(`https://${domain}/`);
      const html = await resp.text();
      check(
        "CTM script present in HTML",
        html.includes("cdn.calltracking.com"),
        `fetched https://${domain}/`,
      );
    } catch (err) {
      check("CTM script present in HTML", false, `fetch failed: ${err}`);
    }
  } else {
    check("CTM script present in HTML", true, "CTM not configured — skip");
  }

  // 4. Analytics script in HTML
  const analyticsBaseUrl = process.env.ANALYTICS_BASE_URL;
  if (analyticsBaseUrl && !site.analytics_disabled) {
    const domain = primaryDomain?.hostname ?? `${site.slug}.sites.anchorcorps.com`;
    try {
      const resp = await fetch(`https://${domain}/`);
      const html = await resp.text();
      check(
        "analytics script present in HTML",
        html.includes(analyticsBaseUrl),
        `ANALYTICS_BASE_URL=${analyticsBaseUrl}`,
      );
    } catch (err) {
      check("analytics script present in HTML", false, `fetch failed: ${err}`);
    }
  } else {
    check("analytics script present in HTML", true, "analytics not configured or disabled — skip");
  }

  // 5. CRM provisioned
  check(
    "CRM provisioned (crm_site_id non-null)",
    site.crm_site_id !== null,
    site.crm_site_id ? `crm_site_id=${site.crm_site_id}` : "crm_site_id is null",
  );
} finally {
  await pool.end();
}

printAndExit();

function printAndExit() {
  console.log("\nSmoke test results:");
  let allGreen = true;
  for (const c of checks) {
    const icon = c.pass ? "✓" : "✗";
    const detail = c.detail ? `  (${c.detail})` : "";
    console.log(`  ${icon} ${c.label}${detail}`);
    if (!c.pass) allGreen = false;
  }
  console.log(allGreen ? "\nAll checks passed." : "\nSome checks failed.");
  process.exit(allGreen ? 0 : 1);
}
