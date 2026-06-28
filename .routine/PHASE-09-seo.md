# Phase 9 — SEO layer (D-049)

Operator-approved 2026-06-28 (verbal "approve and move forward") after the
EXPAND+CONFIRM gate. Four design forks confirmed via AskUserQuestion — operator
took the recommendation on all four:

1. **SEO storage** — extend the existing `seo` JSONB everywhere; add a `seo`
   JSONB column to `posts` + `events`. No normalized columns. Zod-validated.
2. **JSON-LD** — `Organization`/`WebSite` baseline on every page; `BlogPosting`
   on posts; `Event` on events.
3. **OG image** — reuse the media-library asset picker (`asset_id`), so og:image
   flows through the existing media pipeline/variants (D-003/P3 media).
4. **Sitemap** — dynamic-on-request per tenant host.

## Pre-existing base (thin)
- `pages.seo` JSONB holds only `{title, description}`; validated as
  `z.record(z.unknown())` (i.e. unvalidated) in `admin-pages.ts`.
- `render-page.tsx:shell()` emits only `<title>` + `<meta name="description">`.
- Editor treats `seo` as an opaque pass-through blob (no form).
- No sitemap, robots.txt, canonical, OG/Twitter, or JSON-LD anywhere.
- Posts/events (P8) have NO seo fields yet.

## Tasks
- **9.1** Shared SEO field schema (`src/server/seo/schema.ts`, Zod): `title,
  description, canonical, robots{index,follow}, og{title,description,imageAssetId},
  twitter{card}`. Add `seo` JSONB column to `posts`+`events` (one migration).
  Wire the shared schema into admin-pages + post/event input schemas. Tests.
- **9.2** Head renderer: extend `shell()` to emit canonical, robots,
  OG + Twitter tags from merged **site defaults → page seo**. Tests.
- **9.3** Site-level SEO defaults (default OG image, title template, twitter
  handle) — storage + migration.
- **9.4** JSON-LD: Organization/WebSite baseline; BlogPosting on posts; Event on
  events; injected into head. og:image / Event/BlogPosting resolve media URLs.
- **9.5** Dynamic `/sitemap.xml` per tenant host (published pages+posts+events).
- **9.6** `/robots.txt` per tenant (sitemap link; studio host disallowed).
- **9.7** Editor SEO panel — Zod-driven form in page editor + post/event editors
  (description, canonical, robots, og:image via media picker).
- **9.8** Studio site-level SEO settings tab (the 9.3 defaults).
- **9.9** `docs/seo.md` + decision record D-049 + STATE wrap.

Per-subitem commit cadence. STOP at the 9→10 boundary (fresh
.routine/NEXT-PHASE-APPROVED required for Phase 10).
