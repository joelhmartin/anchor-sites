# Data model

> Phase 1 schema. Migration `1747571000000_sites_pages_revisions.cjs`. See `DECISIONS.md` D-001 (block JSON as source of truth) and D-002 (Zod schemas as the contract).

## Tables

### `sites`
The top-level multi-tenant entity.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` (PK) | `gen_random_uuid()` |
| `slug` | `text` UNIQUE | Used for `<slug>.preview.anchorcorps.dev` fallback domain resolution |
| `display_name` | `text` | Shown in admin UI |
| `status` | `text` | CHECK: `'active' \| 'archived' \| 'suspended'`. Default `'active'` |
| `default_brand_tokens` | `jsonb` | Per-site CSS custom properties — e.g. `{"--theme-main": "#0a3d62"}`. Injected into HTML `<head>` by the renderer (Task 1.6) |
| `created_at` | `timestamptz` | |

### `site_domains`
Schema defined in Phase 1. The Phase 1 seed populates the four dev/preview hostnames (`muldoon.preview.anchorcorps.dev`, `muldoon.localhost`, `demo.preview.anchorcorps.dev`, `demo.localhost`); Phase 10 (domain provisioning) adds client-owned custom domains. The Phase 1 renderer falls back to subdomain → `sites.slug` resolution for `*.preview.anchorcorps.dev` and `*.anchorcorps.dev` when no `site_domains` row matches.

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

## Triggers / functions

- **`touch_updated_at()`** — generic BEFORE-UPDATE trigger function. Currently only attached to `pages` (`pages_touch_updated_at`). Reusable when other tables grow an `updated_at` column.

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
