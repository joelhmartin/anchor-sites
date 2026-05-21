# Template system

Phase 7. A **template** is a reusable snapshot of pages (block JSON) + brand
tokens. You can save an existing site (or a single page) as a template, then
create a new site (or add a page) from one. Templates are **not** the per-site
auth/blog/events copy-in (Phase 8, D-008) and **not** the plugin framework
(Phase 7.5, D-016).

See `DECISIONS.md` **D-041** (data model), **D-042** (pg-boss materialization),
**D-043** (media shared by reference).

## Data model

Two tables (migration `1747574000000_templates.cjs`) — full column list in
`docs/data-model.md`:

- **`templates`** — `slug` (unique), `name`, `description`, `kind`
  (`'site' | 'page'`), `brand_tokens`, `status` (`'active' | 'archived'`),
  `source_site_id` (FK → `sites`, `ON DELETE SET NULL`).
- **`template_pages`** — `template_id` (FK → `templates`, `ON DELETE CASCADE`),
  `slug`, `title`, `blocks`, `seo`, `sort_order`.

Captured page blocks are validated against the **same** block registry the
page-save path uses (`src/blocks/validate.ts`, D-039), so a template can never
hold blocks the save path would later reject.

## Concepts

- **`kind:'site'`** — a whole-site template: many pages + brand tokens.
  Materialized into a brand-new site by a background job.
- **`kind:'page'`** — a single-page template: one page, no brand tokens.
  Inserted into an existing site synchronously.
- **Archive, never delete.** `DELETE /api/templates/:id` flips `status` to
  `archived`; the row and its history stay. Archived templates are hidden from
  the default lists and can't be used to create from.

## API

All routes are admin-gated (`requireAdmin`, interim `X-Admin-Token` per D-034).

| Method + path | Purpose |
|---|---|
| `POST /api/sites/:siteId/save-as-template` | Capture a site (all pages, or `page_ids`) + brand tokens → `kind:'site'` template |
| `POST /api/sites/:siteId/pages/:pageId/save-as-template` | Capture one page → `kind:'page'` template |
| `GET  /api/templates` | List (newest first) + `pages_count`; `?kind=`, `?status=` (default `active`) |
| `GET  /api/templates/:id` | Template + ordered pages |
| `DELETE /api/templates/:id` | Archive (soft delete) |
| `POST /api/sites/from-template` | Create a new site from a `kind:'site'` template (enqueues materialization) |
| `POST /api/sites/:siteId/pages/from-template` | Insert a `kind:'page'` template's page into an existing site |

### Save-as-template (site)

```jsonc
POST /api/sites/:siteId/save-as-template
{
  "name": "Dental Starter",
  "description": "optional",
  "slug": "dental-starter",        // optional — derived from name when omitted
  "page_ids": ["…","…"],           // optional — omit to capture every page
  "include_brand_tokens": true     // default true
}
```

Captured-page block validation failures return **422** with per-page detail;
a slug clash returns **409**.

### Create site from template

```jsonc
POST /api/sites/from-template
{
  "slug": "acme-dental",
  "display_name": "Acme Dental",
  "template_id": "…",
  "brand_tokens": { "--theme-main": "#0a3d62" }  // optional
}
```

This:

1. Creates the site + its canonical `<slug>.sites.anchorcorps.com` and
   `<slug>.localhost` domains (shared `createSiteWithDomains` primitive — same
   path the new-site wizard uses).
2. Enqueues a **`template.materialize`** pg-boss job (D-019/D-042), deduped per
   `${siteId}:${templateId}`, and returns `{ site, template_id, job }`
   immediately. Provisioning the public hostname stays the separate explicit
   `/provision` step.

The response is `201` even while pages are still materializing — poll
`GET /api/sites/:siteId` (`pages_count`) for completion. The Studio wizard does
this automatically before routing to the new site.

## Materialization (the job)

`src/server/jobs/materialize-template.ts`, queue `template.materialize`. Given
`{ siteId, templateId }` it, in one transaction:

- Inserts each template page into `pages` with
  `ON CONFLICT (site_id, slug) DO NOTHING`; each newly-created page gets a
  `page_revisions` row with `source:'import'`.
- Adopts the template's brand tokens **only if the site has none yet** — so
  brand tokens the operator chose at creation time win, and re-runs never
  clobber.
- Evicts the resolver cache for the site's hostnames.

It is **idempotent**: a retry or re-send creates only the pages that are
missing and never overwrites existing ones, so pg-boss retries are safe.

### Media (D-043)

Captured blocks keep their **source `asset_id`s**. Referenced images render
from the existing immutable, content-hashed, public GCS variant URLs (D-031) —
no media is copied. The new site therefore shares those image bytes with the
source. Trade-off: the new site's media library doesn't "own" them, and
deleting the source site cascades its `media_assets` rows. Full per-site media
copy is a documented Phase-12 follow-up.

## Page templates

Symmetric, lighter flow for reusing a single page:

- **Save:** `POST /api/sites/:siteId/pages/:pageId/save-as-template` →
  `kind:'page'` template (one `template_pages` row, no brand tokens).
- **Use:** `POST /api/sites/:siteId/pages/from-template`
  `{ template_id, slug?, title? }` inserts the template's page into the site
  **synchronously** (no job — it's one page), with an `'import'` revision.
  `slug`/`title` default to the template page's; a slug clash returns **409**.

## Studio (UI)

- **New-site wizard** (`/sites/new`) — a "Start from" selector: *Blank site*
  (the existing 2-step flow) or a site template (skips the brand-colors step,
  creates from the template, shows a "Creating pages…" state while polling).
- **Save as template** — a button in the site detail header opens a dialog to
  name the template and pick which pages to capture.
- **Add from template** — a lazy-loaded form on the site's **Pages** tab inserts
  a page template's page into the current site.

Visual QA is operator-run at `studio.localhost:3000`.

## Seed

`npm run db:seed-templates` (`db/seed-templates.ts`) idempotently UPSERTs a
built-in **Starter** `kind:'site'` template (two pages) so the picker isn't
empty on a fresh database. Authored blocks are validated up front.
