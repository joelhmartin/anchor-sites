import type { PoolClient } from "pg";

/**
 * Per-site "copy-in" seeded at provision time (P8-T8.12, D-047). This is what
 * "auth/blog/events are copied into each site" means under the one shared
 * renderer (D-003): NOT forked code, but per-site **config + starter content**
 * seeded when the site is created. Runs inside the caller's transaction
 * (`createSiteWithDomains`) and is idempotent (`ON CONFLICT DO NOTHING`), so
 * re-provisioning is safe.
 *
 * Seeds:
 *   - `tenant_auth_config` — the per-site login providers (default
 *     email+password; D-048). Essential infra for tenant auth.
 *   - a **draft** "welcome" post — a starting point that is NOT public until
 *     the operator publishes it (so a fresh client site shows no stray blog).
 */
const DEFAULT_PROVIDERS = { emailPassword: true };

const WELCOME_BODY = [
  {
    id: "welcome-rt",
    type: "rich-text",
    props: {
      html: "<p>Welcome to your new blog. Edit or delete this draft post in Studio.</p>",
    },
  },
];

export async function seedSiteCopyIn(client: PoolClient, siteId: string): Promise<void> {
  await client.query(
    `INSERT INTO tenant_auth_config (site_id, providers)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (site_id) DO NOTHING`,
    [siteId, JSON.stringify(DEFAULT_PROVIDERS)],
  );

  await client.query(
    `INSERT INTO posts (site_id, slug, title, excerpt, body, status)
     VALUES ($1, 'welcome', 'Welcome', 'Your first post', $2::jsonb, 'draft')
     ON CONFLICT (site_id, slug) DO NOTHING`,
    [siteId, JSON.stringify(WELCOME_BODY)],
  );
}
