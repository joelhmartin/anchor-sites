# Data model

> Phase 1 schema. Migration `1747571000000_sites_pages_revisions.cjs`. See `DECISIONS.md` D-001 (block JSON as source of truth) and D-002 (Zod schemas as the contract).
> Phase 10 design decisions: **D-050** (pluggable `DnsProvider`, Kinsta retired — see `docs/domains.md`) and **D-051** (two domain classes: managed subdomains + client-owned custom domains). Full domain model in `docs/domains.md`.
> Phase 11 design decisions: **D-052** (CTM per-site config + PhoneNumber block) and **D-053** (CRM HTTP client, crm_form block, CRM lifecycle hooks). Full CRM/CTM model in **`docs/crm.md`**.
> Phase 12 design decisions: **D-054** (analytics script injection — Plausible/Umami; `analytics_disabled` opt-out per site), **D-055** (Sentry error tracking, Express global error handler, React ErrorBoundary, web-vitals reporting), **D-056** (CSP via `buildCsp()`). See `docs/security.md` for CSP details and migration runbook in `docs/migration.md`.

## Tables

### `sites`
The top-level multi-tenant entity.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` (PK) | `gen_random_uuid()` |
| `slug` | `text` UNIQUE | Used for `<slug>.sites.anchorcorps.com` fallback domain resolution |
| `display_name` | `text` | Shown in admin UI |
| `status` | `text` | CHECK: `'active' \| 'archived' \| 'suspended'`. Default `'active'` |
| `default_brand_tokens` | `jsonb` | Per-site CSS custom properties — e.g. `{"--theme-main": "#0a3d62"}`. Injected into HTML `<head>` by the renderer (Task 1.6) |
| `ctm_account_id` | `text` nullable | CallTrackingMetrics account ID (D-052). When set, the renderer injects the CTM script tag. Set via **Settings → CTM account ID** |
| `crm_site_id` | `text` nullable | anchor-hub CRM site ID (D-053). Populated by `provisionSite()` at site creation; null = not yet provisioned |
| `analytics_disabled` | `bool` NOT NULL DEFAULT false | P12-T12.1 (D-054). When true, analytics script injection is skipped for this site regardless of `ANALYTICS_BASE_URL`. Toggled via **Settings → Disable analytics** |
| `created_at` | `timestamptz` | |

### `site_domains`
Schema defined in Phase 1. The Phase 1 seed populates the four dev/preview hostnames (`muldoon.sites.anchorcorps.com`, `muldoon.localhost`, `demo.sites.anchorcorps.com`, `demo.localhost`); Phase 10 (domain provisioning) adds client-owned custom domains. The Phase 1 renderer falls back to subdomain → `sites.slug` resolution for `*.sites.anchorcorps.com` and `*.anchorcorps.com` (Phase 10 only) when no `site_domains` row matches.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` (PK) | |
| `site_id` | `uuid` FK → `sites.id` | `ON DELETE CASCADE` |
| `hostname` | `text` UNIQUE | e.g. `muldoondental.com` |
| `is_primary` | `bool` | |
| `verification_status` | `text` | CHECK: `'pending' \| 'verified' \| 'failed'` |
| `ssl_status` | `text` | CHECK: `'pending' \| 'active' \| 'failed'` |
| `created_at` | `timestamptz` | |

### `pages`
Block-rendered pages. `blocks` is the source of truth (D-001).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` (PK) | |
| `site_id` | `uuid` FK → `sites.id` | `ON DELETE CASCADE` |
| `slug` | `text` | e.g. `home`, `about`, `services/cleaning` |
| `title` | `text` | |
| `blocks` | `jsonb` | Array of `Block` objects validated by Zod registry at the app layer. Default `'[]'::jsonb` |
| `seo` | `jsonb` | Title / description / OG. Phase 9 expands. Default `'{}'::jsonb` |
| `status` | `text` | CHECK: `'draft' \| 'published'`. Default `'draft'` |
| `published_at` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | Auto-maintained by `pages_touch_updated_at` BEFORE-UPDATE trigger |

**Constraints / indexes:**
- `UNIQUE(site_id, slug)` — `pages_site_slug_unique`
- `INDEX(site_id, status)` — fast "list published pages for site"
- `GIN(blocks)` — `pages_blocks_index`. Enables future structural queries like "all pages using block type `cta`" via `WHERE blocks @> '[{"type":"cta"}]'`

### `page_revisions`
Every save inserts one row. Restoring an old revision = inserting a new revision row that copies the old blocks (never destructive).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` (PK) | |
| `page_id` | `uuid` FK → `pages.id` | `ON DELETE CASCADE` |
| `blocks` | `jsonb` | Snapshot of `pages.blocks` at save time |
| `seo` | `jsonb` | Snapshot of `pages.seo` |
| `author_id` | `uuid` nullable | FK to `auth_users.id` will be added in Phase 8. Type already `uuid` so no data migration needed |
| `source` | `text` | Default `'manual'`. Phase 6 sets `'ai'`. Restore uses `'restore'`. Imports use `'import'`. Free text, no CHECK |
| `created_at` | `timestamptz` | |

**Index:** `(page_id, created_at)` for chronological revision listing.

### `templates`
Phase 7 (migration `1747574000000_templates.cjs`). A reusable snapshot of pages + brand tokens. See D-041 (data-model shape), D-042 (pg-boss materialization), D-043 (media shared by reference, not copied).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` (PK) | `gen_random_uuid()` |
| `slug` | `text` UNIQUE | Stable reference handle |
| `name` | `text` | Shown in the template picker |
| `description` | `text` nullable | |
| `source_site_id` | `uuid` FK → `sites.id` | `ON DELETE SET NULL` — deleting the source site keeps the template |
| `kind` | `text` | CHECK: `'site' \| 'page'`. Default `'site'`. `'site'` = many pages + brand tokens (materialized by a pg-boss job); `'page'` = a single page inserted into an existing site |
| `brand_tokens` | `jsonb` | Captured site `default_brand_tokens` (empty for `'page'` templates). Default `'{}'::jsonb` |
| `status` | `text` | CHECK: `'active' \| 'archived'`. Default `'active'`. Delete = archive |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | Maintained by `templates_touch_updated_at` BEFORE-UPDATE trigger |

**Index:** `(kind, status)` for "list active site templates".

### `template_pages`
One row per page captured into a template. Mirrors `pages` (block JSON is still the source of truth, D-001). Captured blocks keep their source media `asset_id`s — referenced images render from the immutable public GCS variant URLs (D-031/D-043); media is **not** copied in v1.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` (PK) | |
| `template_id` | `uuid` FK → `templates.id` | `ON DELETE CASCADE` |
| `slug` | `text` | Page slug as captured |
| `title` | `text` | |
| `blocks` | `jsonb` | Snapshot of the source page's `blocks`. Default `'[]'::jsonb` |
| `seo` | `jsonb` | Snapshot of the source page's `seo`. Default `'{}'::jsonb` |
| `sort_order` | `integer` | Materialization order. Default `0` |
| `created_at` | `timestamptz` | |

**Constraints / indexes:**
- `UNIQUE(template_id, slug)` — `template_pages_template_slug_unique`
- `INDEX(template_id, sort_order)` — ordered page listing
- `GIN(blocks)` — structural block queries across templates

### `site_plugins`
Phase 7.5 (migration `1747575000000_site_plugins.cjs`). Per-site plugin enablement + config (D-016). One row per `(site_id, plugin_name)`. A plugin is "installed" when a row exists; `enabled` gates whether the loader mounts it for that site. See D-016 (framework) and the Phase-7.5 decisions (config split + AES-GCM secrets).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` (PK) | `gen_random_uuid()` |
| `site_id` | `uuid` FK → `sites.id` | `ON DELETE CASCADE` |
| `plugin_name` | `text` | The plugin's manifest `name` (kebab) |
| `version` | `text` | Installed plugin version (semver) |
| `enabled` | `bool` | Default `false`. Loader mounts the plugin for this site only when true |
| `config` | `jsonb` | **Non-secret** per-site config, plaintext. Default `'{}'::jsonb` |
| `config_encrypted` | `jsonb` nullable | The plugin's `secretConfigKeys` values, AES-256-GCM enveloped (`{v,iv,tag,ciphertext}`) by the crypto helper. Null when the plugin has no secret config set. **Refines** D-016's single `config_encrypted` into a plaintext/encrypted pair so non-secret config is storable without the key |
| `installed_at` | `timestamptz` | Default `now()` |
| `updated_at` | `timestamptz` | Maintained by `site_plugins_touch_updated_at` BEFORE-UPDATE trigger |

**Constraints / indexes:**
- `UNIQUE(site_id, plugin_name)` — `site_plugins_site_name_unique`
- partial `INDEX(site_id) WHERE enabled` — `site_plugins_enabled_idx`, the loader/`resolveSite` hot path

Plugins own their OWN tables, prefixed `plg_<name>_`, created by the plugin's own migration; they must NOT alter core tables (D-016).

## Triggers / functions

- **`touch_updated_at()`** — generic BEFORE-UPDATE trigger function. Attached to `pages` (`pages_touch_updated_at`), `templates` (`templates_touch_updated_at`), and `site_plugins` (`site_plugins_touch_updated_at`). Reusable when other tables grow an `updated_at` column.

## Studio auth (P8-T8.2 — D-034 / D-046)

- **`auth_user` / `auth_session` / `auth_account` / `auth_verification`** — Better-auth's core schema for the STUDIO internal-team Google login. Authored verbatim from `getAuthTables()` (better-auth@1.6.11). **Column names are camelCase** (`emailVerified`, `userId`, `createdAt`, …) because Better-auth's Kysely adapter quotes identifiers; the migration creates them case-preserved so queries match. `id` is `text` (Better-auth generates string ids). This is the internal-admin auth surface — the per-site visitor auth (`tenant_auth_*`, P8-T8.7) is a SEPARATE set keyed by `site_id`.

## Tenant (per-site) auth (P8-T8.7 — D-047)

- **`tenant_auth_user` / `tenant_auth_session` / `tenant_auth_account` / `tenant_auth_verification`** — Better-auth's schema, **multi-tenant by `site_id`** (FK → `sites` ON DELETE CASCADE), camelCase columns like the Studio set. Uniqueness is **per-site**: `UNIQUE(site_id, email)` on users (the same person can be a member of two tenant sites), `UNIQUE(site_id, providerId, accountId)` on accounts. A request-scoped Better-auth instance per `req.site.id` reads/writes only its own rows (D-048, P8-T8.8). Separate from the Studio `auth_*` set.
- **`tenant_auth_config`** — per-site `providers jsonb` (which login methods a tenant enables), seeded at provision (P8-T8.12).

## Blog (P8-T8.9 — D-047)

- **`posts`** — per-site blog posts (`site_id` FK → `sites` CASCADE). `body jsonb` = `Block[]` (D-001), re-validated through the shared registry validator (D-039) on write. `status` CHECK `draft|published`; `published_at` stamped on first publish, cleared on revert to draft. `author_id` → `tenant_auth_user` ON DELETE SET NULL. `UNIQUE(site_id, slug)`, `GIN(body)`, `INDEX(site_id, status, published_at)`. Repo: `src/server/blog/{schema,repo}.ts` (every query scoped by `site_id`).

- **`events`** (P8-T8.10) — per-site events (`site_id` FK → `sites` CASCADE). `description jsonb` = `Block[]` (validated via D-039). `starts_at` (NOT NULL, ordering), `ends_at`, `location`, `status` CHECK `draft|published`. `UNIQUE(site_id, slug)`, `INDEX(site_id, starts_at)`. Repo: `src/server/events/{schema,repo}.ts`.

> The full per-site auth/blog/events model — scoping (D-048), public rendering, provision copy-in, the Studio admin API + tabs, and the per-client-divergence boundary — is in **`docs/tenant-sites.md`** (D-047).

## SEO (P9 — D-049)

- **`pages.seo` / `posts.seo` / `events.seo`** (`jsonb`, default `'{}'`) — one shared `seoFieldsSchema` (`title`, `description`, `canonical`, `robots`, `og`, `twitter`); unknown keys stripped. `posts`/`events` columns added by `1747581000000_post_event_seo` (P9-T9.1).
- **`sites.seo_defaults`** (`jsonb`, default `'{}'`, migration `1747582000000_site_seo_defaults`, P9-T9.3) — site-level defaults (`titleTemplate`, `defaultDescription`, `defaultOgImageAssetId`, `twitterHandle`) applied **under** per-page `seo`. Loaded onto `req.site` by `resolveSite`.

> The full SEO model — head meta (canonical/robots/OG/Twitter), og:image media resolution, JSON-LD (Organization/WebSite/WebPage + BlogPosting + Event), dynamic `sitemap.xml` + `robots.txt`, and the editor SEO panel + Studio SEO tab — is in **`docs/seo.md`** (D-049).
- **`media_assets`** / **`media_variants`** — GCS asset references and pre-generated image variant URLs. Added in Phase 3 per D-022.

## Migration commands

```bash
# Local dev (anchor_dev database, port 5434)
npm run migrate:up
npm run migrate:down            # rolls back one migration
npm run db:seed                 # idempotent — 2 sites + 1 home page each

# Test database (anchor_test) — used by tests/integration/*
TEST_DATABASE_URL=postgres://anchor:anchor@localhost:5434/anchor_test npm test
```

`pgcrypto` is enabled by the init migration (`1747570000000_init.cjs`) which is a separate migration from this one. `migrate:down` only rolls back the most recent migration; running `down` multiple times unwinds further.
