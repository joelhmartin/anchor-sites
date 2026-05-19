import type { Pool } from "pg";
import { pool as defaultPool } from "../src/server/db.js";

type SiteSeed = {
  slug: string;
  display_name: string;
  default_brand_tokens: Record<string, unknown>;
};

const SITES: SiteSeed[] = [
  {
    slug: "muldoon-dental",
    display_name: "Muldoon Dental (placeholder)",
    default_brand_tokens: {
      "--theme-main": "#0a3d62",
      "--theme-accent": "#f6b93b",
    },
  },
  {
    slug: "demo-site",
    display_name: "AnchorCorps Demo Site",
    default_brand_tokens: {
      "--theme-main": "#1f1f1f",
      "--theme-accent": "#22c55e",
    },
  },
];

export async function seed(pool: Pool = defaultPool): Promise<{ sites: number; pages: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

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
    }

    await client.query("COMMIT");
    return { sites: SITES.length, pages: SITES.length };
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
      console.log(`[seed] ok — ${r.sites} sites, ${r.pages} pages seeded/upserted`);
      return defaultPool.end();
    })
    .catch((err) => {
      console.error("[seed] failed", err);
      defaultPool.end();
      process.exit(1);
    });
}
