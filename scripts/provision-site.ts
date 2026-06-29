#!/usr/bin/env tsx
/**
 * Local CLI for tenant provisioning. Same logic the admin HTTP endpoint
 * uses; this just lets you run it from your laptop without burning API
 * tokens through the cloud path.
 *
 * Usage:
 *
 *   npm run provision -- --slug=muldoon-dental
 *   npm run provision -- --site-id=<uuid>
 *   npm run provision -- --slug=muldoon-dental --wait
 *
 * Env:
 *
 *   DATABASE_URL              — Postgres connection
 *   DNS_PROVIDER              — godaddy | manual | cloud-dns (default: godaddy if creds set, else manual)
 *   GODADDY_API_KEY           — GoDaddy API key (when DNS_PROVIDER=godaddy)
 *   GODADDY_API_SECRET        — GoDaddy API secret
 *   GCP_PROJECT_ID            — e.g. anchor-hub-480305
 *   GCP_REGION                — e.g. us-central1
 *   GCP_RUN_SERVICE           — Cloud Run service name to bind to (default: anchor-sites)
 *   SITES_DOMAIN_BASE         — wildcard parent (default: sites.anchorcorps.com)
 *   SITES_DOMAIN_REGISTRABLE  — registrable apex (default: anchorcorps.com)
 *
 * GCP auth comes from the operator's local `gcloud auth login` session.
 */

import { pool } from "../src/server/db.js";
import { provisionSiteHostname } from "../src/server/provisioning/orchestrator.js";

type ParsedArgs = {
  slug?: string;
  siteId?: string;
  wait: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { wait: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--wait") out.wait = true;
    else if (arg.startsWith("--slug=")) out.slug = arg.slice("--slug=".length);
    else if (arg.startsWith("--site-id=")) out.siteId = arg.slice("--site-id=".length);
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  npm run provision -- --slug=<site-slug> [--wait]
  npm run provision -- --site-id=<uuid>   [--wait]

--wait      block until Cloud Run reports Ready + CertificateProvisioned
            (up to ~20 minutes; safe to omit and check status later).
`);
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.slug && !args.siteId) {
    console.error("error: must supply --slug=<slug> or --site-id=<uuid>");
    process.exit(2);
  }

  let siteId = args.siteId;
  if (!siteId && args.slug) {
    const r = await pool.query<{ id: string }>(`SELECT id FROM sites WHERE slug = $1`, [
      args.slug,
    ]);
    if (r.rowCount === 0) {
      console.error(`error: no site with slug=${args.slug}`);
      process.exit(2);
    }
    siteId = r.rows[0].id;
  }

  const result = await provisionSiteHostname(siteId!, { pool, wait: args.wait });

  for (const s of result.steps) {
    const tag = s.status === "ok" ? "✓" : s.status === "skipped" ? "·" : "✗";
    console.log(`  ${tag}  [${s.step}]  ${s.detail ?? ""}`);
  }
  console.log(
    `\nhostname: ${result.hostname}\nready:    ${result.ready ? "yes" : "no — cert provisioning may still be in flight"}\n`,
  );

  if (result.cloud_run_mapping?.status?.resourceRecords) {
    console.log("DNS records Cloud Run expects (applied via the configured DNS provider):");
    for (const r of result.cloud_run_mapping.status.resourceRecords) {
      console.log(`  ${r.name}  ${r.type}  ${r.rrdata}`);
    }
  }

  if (result.steps.some((s) => s.status === "error")) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("provision failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => undefined));
