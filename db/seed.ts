import type { Pool } from "pg";
import { pool as defaultPool } from "../src/server/db.js";

type SiteSeed = {
  slug: string;
  display_name: string;
  default_brand_tokens: Record<string, unknown>;
  domains: string[];
};

const SITES: SiteSeed[] = [
  {
    slug: "muldoon-dental",
    display_name: "Muldoon Dental (placeholder)",
    default_brand_tokens: {
      "--theme-main": "#0a3d62",
      "--theme-accent": "#f6b93b",
    },
    domains: ["muldoon.preview.anchorcorps.dev", "muldoon.localhost"],
  },
  {
    slug: "demo-site",
    display_name: "AnchorCorps Demo Site",
    default_brand_tokens: {
      "--theme-main": "#1f1f1f",
      "--theme-accent": "#22c55e",
    },
    domains: ["demo.preview.anchorcorps.dev", "demo.localhost"],
  },
];

export async function seed(
  pool: Pool = defaultPool,
): Promise<{ sites: number; pages: number; domains: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let domainCount = 0;
    for (const site of SITES) {
      const siteRes = await client.query<{ id: string }>(
        `INSERT INTO sites (slug, display_name, default_brand_tokens)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name
         RETURNING id`,
        [site.slug, site.display_name, JSON.stringify(site.default_brand_tokens)],
      );
      const siteId = siteRes.rows[0].id;

      await client.query(
        `INSERT INTO pages (site_id, slug, title, blocks, seo, status)
         VALUES ($1, 'home', $2, '[]'::jsonb, '{}'::jsonb, 'draft')
         ON CONFLICT (site_id, slug) DO NOTHING`,
        [siteId, `${site.display_name} — Home`],
      );

      for (let i = 0; i < site.domains.length; i++) {
        const hostname = site.domains[i];
        const isPrimary = i === 0;
        await client.query(
          `INSERT INTO site_domains (site_id, hostname, is_primary, verification_status, ssl_status)
           VALUES ($1, $2, $3, 'verified', 'active')
           ON CONFLICT (hostname) DO NOTHING`,
          [siteId, hostname, isPrimary],
        );
        domainCount++;
      }
    }

    await client.query("COMMIT");
    return { sites: SITES.length, pages: SITES.length, domains: domainCount };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// CLI entry — `npm run db:seed`
const invokedAsScript = import.meta.url === `file://${process.argv[1]}`;
if (invokedAsScript) {
  seed()
    .then((r) => {
      console.log(
        `[seed] ok — ${r.sites} sites, ${r.pages} pages, ${r.domains} domains seeded/upserted`,
      );
      return defaultPool.end();
    })
    .catch((err) => {
      console.error("[seed] failed", err);
      defaultPool.end();
      process.exit(1);
    });
}
