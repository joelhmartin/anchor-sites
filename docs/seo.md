# SEO layer (Phase 9 — D-049)

Per-tenant SEO across pages, blog posts and events: meta tags, Open Graph /
Twitter cards, JSON-LD structured data, a dynamic `sitemap.xml` + `robots.txt`,
and an editor SEO panel. One shared model, one renderer — the same as every
other content surface (D-001 blocks, D-008/D-047 multi-tenant rendering).

## Data model

Per-content SEO lives in a **`seo` JSONB** column (operator-chosen over
normalized columns — same flexibility as the `blocks` blob):

- `pages.seo` (Phase 3), `posts.seo` + `events.seo` (P9-T9.1, migration
  `1747581000000_post_event_seo`). Default `'{}'`.
- Validated by the shared **`seoFieldsSchema`** (`src/server/seo/schema.ts`):
  `title`, `description`, `canonical`, `robots {index, follow}`,
  `og {title, description, imageAssetId}`, `twitter {card}`. Unknown keys are
  **stripped**, not rejected, so legacy `{title, description}` blobs still pass.

Site-level **defaults** live in **`sites.seo_defaults`** JSONB (P9-T9.3,
migration `1747582000000_site_seo_defaults`), validated by
`siteSeoDefaultsSchema`: `titleTemplate` (`%s` = page title),
`defaultDescription`, `defaultOgImageAssetId`, `twitterHandle`. Loaded onto
`req.site.seo_defaults` by `resolveSite` (both domain and subdomain lookups).

**Precedence:** per-page `seo` wins; site defaults fill the gaps. The title
template wraps the page title; `description` falls back to the site default;
`og:image` falls back to the site default asset.

## Rendering (`src/server/render-page.tsx` + `src/server/seo/*`)

`renderSeoMeta(site, seo, { canonical, ogImage })` emits, into `<head>`:

- `<meta name="robots">` — `index,follow` by default; a 404 is always `noindex`.
- `<link rel="canonical">` — explicit `seo.canonical`, else the canonical tenant
  URL `https://<slug>.sites.anchorcorps.com<path>` (query/trailing-slash
  stripped; home → `/`).
- Open Graph: `og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`,
  and `og:image` (+ `:width/:height/:alt`) when resolved.
- Twitter: `twitter:card` (default `summary_large_image`), `twitter:site` (from
  the site handle), `twitter:title/description/image`.

**og:image** is a media `asset_id` (D-003), resolved to a CDN variant URL by
`loadOgImage` (`src/server/seo/og-image.ts`) — prefers a `jpg` variant, largest
by size order. Page seo asset wins, else the site default. Routes resolve it
(async) and pass it into `renderPage`.

**JSON-LD** (`src/server/seo/json-ld.ts`, one `<script type="application/ld+json">`
per node, `<` escaped):

- Every page: `Organization` + `WebSite` + `WebPage`.
- Blog post detail: `BlogPosting` (headline, datePublished, publisher, image).
- Event detail: `Event` (startDate/endDate, `Place` location, image).

## sitemap.xml + robots.txt (`src/server/routes/sitemap.ts`)

Dynamic, per tenant host, mounted before the catch-all (admin/unknown hosts
fall through):

- `GET /sitemap.xml` — published pages + posts (`/blog/:slug`) + events
  (`/events/:slug`), plus the `/blog` and `/events` indexes when non-empty.
  Excludes anything with `robots.index = false`. `<lastmod>` from `updated_at`;
  home collapses to `/`.
- `GET /robots.txt` — `Allow: /` + a `Sitemap:` link to the tenant sitemap.

## Editing

- **Per-content** — the reusable **`SeoPanel`** (`src/admin/components/SeoPanel.tsx`)
  is wired into the page editor (toggle), the post editor and the event editor.
  Edits the `seo` blob (SEO title, description, canonical, robots, OG fields,
  og:image via the media-library picker, twitter card); saved in the same
  request as the content body.
- **Site defaults** — the Studio **SEO tab** (`SeoSettingsTab`) edits
  `sites.seo_defaults` via `PATCH /api/sites/:siteId { seo_defaults }`.

## Per-client divergence

Deeper or bespoke SEO behavior rides the plugin framework (D-016/D-045), never a
core fork — same boundary as the rest of the tenant surface (see
`docs/tenant-sites.md`).
