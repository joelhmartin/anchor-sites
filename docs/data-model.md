# Data model

> Phase 1 schema. Migration `1747571000000_sites_pages_revisions.cjs`. See `DECISIONS.md` D-001 (block JSON as source of truth) and D-002 (Zod schemas as the contract).

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

## Triggers / functions

- **`touch_updated_at()`** — generic BEFORE-UPDATE trigger function. Attached to `pages` (`pages_touch_updated_at`) and `templates` (`templates_touch_updated_at`). Reusable when other tables grow an `updated_at` column.

## Future schema (reserved, NOT in this migration)

- **`site_plugins`** — per-site plugin enablement and encrypted config. Added in Phase 7.5 per D-016.
- **`auth_*`** — auth tables (users, sessions, etc.). Added in Phase 8 per D-020 (Better-auth ships its own schema).
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
