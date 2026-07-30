import type { Pool } from "pg";
import { pool as defaultPool } from "../src/server/db.js";
// Side-effect: register the static block types so the authored starter blocks
// are validated against the same registry the save/materialize paths use.
import "../src/blocks/index.js";
import { validateBlocks } from "../src/blocks/validate.js";

/**
 * Built-in starter template(s) (P7-T7.7). Gives the new-from-template picker
 * something to pick on day one. Idempotent: UPSERTs each template by slug and
 * replaces its pages, so re-running refreshes content without duplicating.
 * Authored blocks are validated against the block registry before insert so a
 * typo fails loudly here rather than at materialize time.
 */

type TemplatePageSeed = {
  slug: string;
  title: string;
  blocks: { id: string; type: string; props: Record<string, unknown> }[];
  seo: Record<string, unknown>;
};

type TemplateSeed = {
  slug: string;
  name: string;
  description: string;
  brand_tokens: Record<string, string>;
  /** Gallery grouping label (e.g. "Basic"). */
  category: string | null;
  /** Gallery display order (ascending); the starter sits last (999). */
  sort_order: number;
  pages: TemplatePageSeed[];
};

const TEMPLATES: TemplateSeed[] = [
  {
    slug: "starter",
    name: "Starter",
    description: "A clean two-page starting point — hero, intro copy, and a call to action, plus an About page.",
    brand_tokens: { "--theme-main": "#0a3d62", "--theme-accent": "#f6b93b" },
    category: "Basic",
    sort_order: 999,
    pages: [
      {
        slug: "home",
        title: "Home",
        seo: { title: "Welcome", description: "A fresh site built on the AnchorCorps platform." },
        blocks: [
          {
            id: "starter-home-hero",
            type: "hero",
            props: {
              eyebrow: "Welcome",
              title: "Your new site starts here.",
              subtitle: "Replace this copy, swap the colors, and publish — every block is editable.",
              cta_label: "Get in touch",
              cta_href: "#contact",
              align: "center",
            },
          },
          {
            id: "starter-home-rich",
            type: "rich-text",
            props: {
              html: "<h2>About this template</h2><p>This starter ships with a hero, a block of body copy, and a call to action. Edit it in the visual editor, or ask the AI to rework it.</p>",
              max_width: "medium",
            },
          },
          {
            id: "starter-home-cta",
            type: "cta",
            props: {
              heading: "Ready to launch?",
              body: "Customize the content, set your brand colors, and connect a domain.",
              button_label: "Contact us",
              button_href: "#contact",
              variant: "primary",
            },
          },
        ],
      },
      {
        slug: "about",
        title: "About",
        seo: { title: "About us" },
        blocks: [
          {
            id: "starter-about-hero",
            type: "hero",
            props: {
              eyebrow: "About",
              title: "A little about us.",
              subtitle: "Tell visitors who you are and what you do.",
              align: "left",
            },
          },
          {
            id: "starter-about-rich",
            type: "rich-text",
            props: {
              html: "<h2>Our story</h2><p>Replace this with your own background, mission, and the people behind the work.</p>",
              max_width: "medium",
            },
          },
        ],
      },
    ],
  },
];

export async function seedTemplates(
  pool: Pool = defaultPool,
): Promise<{ templates: number; pages: number }> {
  // Validate every authored block up front (fail loudly on a typo).
  for (const tpl of TEMPLATES) {
    for (const page of tpl.pages) {
      const failures = validateBlocks(page.blocks);
      if (failures.length > 0) {
        throw new Error(
          `seed-templates: template "${tpl.slug}" page "${page.slug}" has invalid blocks: ${JSON.stringify(failures)}`,
        );
      }
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let pageCount = 0;
    for (const tpl of TEMPLATES) {
      const tplRes = await client.query<{ id: string }>(
        `INSERT INTO templates (slug, name, description, kind, brand_tokens, category, sort_order)
         VALUES ($1, $2, $3, 'site', $4::jsonb, $5, $6)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           brand_tokens = EXCLUDED.brand_tokens,
           category = EXCLUDED.category,
           sort_order = EXCLUDED.sort_order
         RETURNING id`,
        [tpl.slug, tpl.name, tpl.description, JSON.stringify(tpl.brand_tokens), tpl.category, tpl.sort_order],
      );
      const templateId = tplRes.rows[0].id;

      // Replace pages so re-running refreshes content (no duplicates).
      await client.query(`DELETE FROM template_pages WHERE template_id = $1`, [templateId]);
      for (let i = 0; i < tpl.pages.length; i++) {
        const page = tpl.pages[i];
        await client.query(
          `INSERT INTO template_pages (template_id, slug, title, blocks, seo, sort_order)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
          [templateId, page.slug, page.title, JSON.stringify(page.blocks), JSON.stringify(page.seo), i],
        );
        pageCount++;
      }
    }
    await client.query("COMMIT");
    return { templates: TEMPLATES.length, pages: pageCount };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// CLI entry — `npm run db:seed-templates`
const invokedAsScript = import.meta.url === `file://${process.argv[1]}`;
if (invokedAsScript) {
  seedTemplates()
    .then((r) => {
      console.log(`[seed-templates] ok — ${r.templates} templates, ${r.pages} pages seeded/upserted`);
      return defaultPool.end();
    })
    .catch((err) => {
      console.error("[seed-templates] failed", err);
      defaultPool.end();
      process.exit(1);
    });
}
