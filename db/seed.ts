import type { Pool } from "pg";
import { pool as defaultPool } from "../src/server/db.js";
import { getDomainConfig, hostnameForSlug } from "../src/config/domain.js";

type PageSeed = {
  slug: string;
  title: string;
  status: "draft" | "published";
  blocks: unknown[];
  seo: Record<string, unknown>;
};

type SiteSeed = {
  slug: string;
  display_name: string;
  default_brand_tokens: Record<string, unknown>;
  /**
   * Extra hostnames to register beyond the canonical `<slug>.<SITES_DOMAIN_BASE>`.
   * Use for local-dev hostnames (e.g. `<slug>.localhost`) or for legacy
   * aliases. The canonical hostname is derived from the slug + domain config
   * and inserted alongside these.
   */
  extra_domains: string[];
  pages: PageSeed[];
};

const SITES: SiteSeed[] = [
  {
    slug: "muldoon-dental",
    display_name: "Muldoon Dental (placeholder)",
    default_brand_tokens: {
      "--theme-main": "#0a3d62",
      "--theme-accent": "#f6b93b",
    },
    extra_domains: ["muldoon-dental.localhost", "muldoon.localhost"],
    pages: [
      {
        slug: "home",
        title: "Muldoon Dental — Home",
        status: "published",
        seo: {
          title: "Muldoon Dental — Family + Cosmetic Dentistry",
          description:
            "Family and cosmetic dentistry serving the area for 30 years. Same-day crowns, gentle care, in-network with most plans.",
        },
        blocks: [
          {
            id: "muldoon-hero",
            type: "hero",
            props: {
              eyebrow: "Family + Cosmetic Dentistry",
              title: "Modern dental care, gentle hands.",
              subtitle:
                "Same-day crowns, sedation options, and in-network with most major insurance plans.",
              cta_label: "Book a visit",
              cta_href: "#contact",
              align: "left",
            },
          },
          {
            id: "muldoon-rich",
            type: "rich-text",
            props: {
              html: "<h2>Why patients choose Muldoon</h2><p>Three decades of family dentistry, same staff most of that time. We do the boring stuff well and the hard stuff carefully.</p>",
              max_width: "medium",
            },
          },
          {
            id: "muldoon-cta",
            type: "cta",
            props: {
              heading: "Ready when you are.",
              body: "Most new-patient appointments available within the week.",
              button_label: "Call now",
              button_href: "tel:+15555550123",
              variant: "primary",
            },
          },
        ],
      },
    ],
  },
  {
    slug: "demo-site",
    display_name: "AnchorCorps Demo Site",
    default_brand_tokens: {
      "--theme-main": "#1f1f1f",
      "--theme-accent": "#22c55e",
    },
    extra_domains: ["demo-site.localhost", "demo.localhost"],
    pages: [
      {
        slug: "home",
        title: "AnchorCorps Demo — Home",
        status: "published",
        seo: {
          title: "AnchorCorps Demo Site",
          description:
            "Sample site rendered entirely from block JSON. Same renderer as production, different content.",
        },
        blocks: [
          {
            id: "demo-hero",
            type: "hero",
            props: {
              eyebrow: "AnchorCorps Site Builder",
              title: "Same renderer. Different site.",
              subtitle:
                "Every block on this page came out of a Postgres JSONB column. No hardcoded React routes.",
              cta_label: "See how",
              cta_href: "#details",
              align: "center",
            },
          },
          {
            id: "demo-rich",
            type: "rich-text",
            props: {
              html: "<h2>Block-driven, multi-tenant</h2><p>Switch the <code>Host</code> header and a different page loads — same Express process, same renderer, same component package. This is the foundation phase.</p>",
              max_width: "wide",
            },
          },
          {
            id: "demo-cta",
            type: "cta",
            props: {
              heading: "Read the architecture notes",
              body: "DECISIONS.md captures every choice that shaped this build.",
              button_label: "Open the log",
              button_href: "https://github.com/joelhmartin/anchor-sites/blob/main/DECISIONS.md",
              variant: "muted",
            },
          },
        ],
      },
    ],
  },
];

export async function seed(
  pool: Pool = defaultPool,
): Promise<{ sites: number; pages: number; domains: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Sweep legacy hostnames from earlier seed schemes. Idempotent — no-op
    // once the rows are gone.
    //   - `%anchorcorps.dev`         → D-025 (switched the TLD entirely)
    //   - `muldoon.sites.*`, `demo.sites.*` → D-026 (short-prefix slugs
    //     replaced by full-slug hostnames). We can't generically detect this
    //     class without a column flag, but the two known legacy rows are
    //     listed by exact match so the cleanup is safe + targeted.
    await client.query(
      `DELETE FROM site_domains WHERE hostname LIKE '%anchorcorps.dev'`,
    );
    await client.query(
      `DELETE FROM site_domains WHERE hostname IN ('muldoon.sites.anchorcorps.com','demo.sites.anchorcorps.com')`,
    );

    const cfg = getDomainConfig();
    let pageCount = 0;
    let domainCount = 0;
    for (const site of SITES) {
      // Canonical hostname derived from slug + SITES_DOMAIN_BASE.
      // Extras (localhost variants, legacy aliases) follow.
      const canonical = hostnameForSlug(site.slug, cfg);
      const allDomains = [canonical, ...site.extra_domains];
      const siteRes = await client.query<{ id: string }>(
        `INSERT INTO sites (slug, display_name, default_brand_tokens)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name
         RETURNING id`,
        [site.slug, site.display_name, JSON.stringify(site.default_brand_tokens)],
      );
      const siteId = siteRes.rows[0].id;

      for (const page of site.pages) {
        await client.query(
          `INSERT INTO pages (site_id, slug, title, blocks, seo, status, published_at)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6,
                   CASE WHEN $6 = 'published' THEN now() ELSE NULL END)
           ON CONFLICT (site_id, slug) DO UPDATE SET
             title = EXCLUDED.title,
             blocks = EXCLUDED.blocks,
             seo = EXCLUDED.seo,
             status = EXCLUDED.status,
             published_at = CASE
               WHEN EXCLUDED.status = 'published' AND pages.published_at IS NULL THEN now()
               WHEN EXCLUDED.status = 'published' THEN pages.published_at
               ELSE NULL
             END`,
          [
            siteId,
            page.slug,
            page.title,
            JSON.stringify(page.blocks),
            JSON.stringify(page.seo),
            page.status,
          ],
        );
        pageCount++;
      }

      for (let i = 0; i < allDomains.length; i++) {
        const hostname = allDomains[i];
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
    return { sites: SITES.length, pages: pageCount, domains: domainCount };
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
