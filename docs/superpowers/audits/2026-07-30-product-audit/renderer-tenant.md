# Big-Picture Audit — Slice: Published-Site Renderer + Live Public Tenant Surface

Date: 2026-07-30 (probes executed 2026-07-31 UTC) · Read-only audit · Auditor: renderer/tenant-surface subagent

## Census (M = 29 units)

Files examined (all absolute under `/Volumes/G-DRIVE SSD/DEVELOPER/anchor-sites/`):
`src/server/render-page.tsx`, `src/server/render-hydration.ts`, `src/server/seo/{schema,json-ld,og-image}.ts` (+ tests), `src/server/routes/{page,sitemap,site-resolve,blog-events,vitals,blocks-preview}.ts(x)`, `src/server/{analytics,ctm-hook,csp,app}.ts`, `src/server/routes/admin-pages.ts` (preview route, lines 315–523), `src/server/{preview-links,preview-overlay,preview-token}.ts` (skimmed as preview consumer), `src/middleware/resolveSite.ts`, `src/config/domain.ts`, `src/components/BlockRenderer.tsx`, `src/blocks/brand-tokens.ts`, `packages/components/src/` (styles.css, blocks: image, nav-bar, split-hero, hero-slider schemas/components), `src/server/jobs/git-import.ts` (asset collector, for sibling comparison), `src/server/routes/templates.ts` (materialization consumer), `cloudbuild.yaml` (prod env), `docs/superpowers/handoffs/2026-07-30-lovable-workspace-handoff.md`.

Units (renderer concern × consumer; consumers = published tenant page / preview / template materialization — where consumers behave identically the unit row covers all three and Sibling-Coherence records divergences):

| # | Unit |
|---|------|
| U1 | Head/meta shell (title, description, charset, viewport, lang) — published |
| U2 | Head/meta — preview consumer |
| U3 | OG + Twitter tags (`renderSeoMeta`) |
| U4 | Canonical + robots meta (`canonicalUrl`, `effectiveRobots`) |
| U5 | JSON-LD (Organization/WebSite/WebPage/BlogPosting/Event, `renderJsonLd`) |
| U6 | og:image resolution (`seo/og-image.ts`) |
| U7 | Favicon |
| U8 | Fonts / typography delivery (brand tokens × CSS) |
| U9 | Nav (shell header + `nav-bar` block) |
| U10 | Footer (shell footer + `rich-footer` block) |
| U11 | Public route: home (`/`) |
| U12 | Public route: generic page (`/:slug`) |
| U13 | Public route: blog index (`/blog`) |
| U14 | Public route: blog post (`/blog/:slug`) |
| U15 | Public route: events index (`/events`) |
| U16 | Public route: event detail (`/events/:slug`) |
| U17 | Public route: 404 (`renderNotFound`) |
| U18 | Public route: `/sitemap.xml` |
| U19 | Public route: `/robots.txt` |
| U20 | Site resolution (`resolveSite`, `site-resolve.ts`, `config/domain.ts`) |
| U21 | Media hydration (`render-hydration.ts` × media bucket) |
| U22 | Analytics injection (`analytics.ts` + `shell()`) |
| U23 | CTM injection (`ctmScriptTag` + `ctm-hook.ts`) |
| U24 | Web vitals (shell snippet + `routes/vitals.ts`) |
| U25 | Draft-preview render path (admin-pages preview + preview-links/overlay/token) |
| U26 | Dev block-preview harness (`blocks-preview.tsx`) |
| U27 | Template materialization consumer (`from-template` → same renderer) |
| U28 | Tenant response headers (CSP `csp.ts`, helmet, cors, cache) |
| U29 | Components-package renderer (`BlockRenderer`, block components, inlined CSS) |

## Lenses (L = 20)

1 Terminality · 2 Structure/Grain · 3 Organization · 4 Provenance→Consumption · 5 Comprehension · 6 State-Visibility · 7 Honesty · 8 Reversibility/Safety · 9 Idempotence/Accretion · 10 Failure/Recovery · 11 Precondition/Forward-path · 12 Population/Dark · 13 Sibling-Coherence · 14 Gating-Axis · 15 Temporal-Integrity · 16 Cost/Value · 17 Contract-Stability · 18 Naming/Least-astonishment · 19 Performance · 20 SEO-completeness

## Ledger matrix (P = pass, Dxxx = directive instance, n = n/a)

| Unit | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
|------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|----|----|----|
| U1 | P | P | D919 | P | P | P | D911 | P | P | P | P | P | P | P | P | P | D925 | P | P | P |
| U2 | P | P | P | P | P | P | P | P | P | P | P | P | P | D926 | P | P | P | P | P | P |
| U3 | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | D910 |
| U4 | P | P | P | P | P | P | D902 | P | P | P | P | P | P | P | P | P | P | P | P | P |
| U5 | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P |
| U6 | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P |
| U7 | D914 | n | n | n | P | n | P | n | n | n | n | n | n | n | n | D914 | n | n | P | P |
| U8 | P | P | P | P | P | P | P | P | P | P | P | D915 | D915 | P | P | P | P | P | P | P |
| U9 | P | P | P | P | P | P | P | P | P | P | D918 | P | P | P | P | P | P | P | P | P |
| U10 | P | P | P | P | P | P | P | P | P | P | D918 | P | P | P | P | P | P | P | P | P |
| U11 | P | P | P | P | P | P | D902 | P | P | D904 | P | P | P | P | P | P | P | P | P | P |
| U12 | P | P | P | P | P | P | P | P | P | P | P | P | P | P | D908 | P | P | P | P | P |
| U13 | P | P | P | P | P | P | D912 | P | P | P | P | P | P | P | P | P | P | D913 | D928 | P |
| U14 | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | D910 |
| U15 | P | P | P | P | P | P | D912 | P | P | P | P | P | P | P | P | P | P | D920 | P | P |
| U16 | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P |
| U17 | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P |
| U18 | P | P | P | P | P | P | D912 | P | P | P | P | P | P | P | P | P | D922 | P | P | P |
| U19 | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P |
| U20 | P | P | P | P | D923 | P | P | P | D921 | P | P | P | P | P | P | P | P | P | P | P |
| U21 | P | D901 | P | P | P | P | P | P | P | P | P | P | D901 | D903 | P | P | P | P | P | P |
| U22 | P | P | P | P | P | P | P | P | P | P | P | D905 | P | P | P | P | P | D924 | P | P |
| U23 | P | P | P | P | P | P | P | P | P | P | P | D927 | P | P | P | P | P | P | P | P |
| U24 | P | P | P | D907 | P | P | P | D906 | P | P | P | D905 | P | P | P | P | P | P | P | P |
| U25 | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P |
| U26 | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | n | n |
| U27 | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P |
| U28 | P | P | P | P | P | P | P | D906 | P | P | P | P | P | D909 | P | P | P | P | P | P |
| U29 | P | P | P | P | P | D916 | P | P | P | P | P | P | P | P | P | D917 | P | P | D917 | P |

Cell accounting: 29 × 20 = **580 cells, 0 blank**. Directive-bearing cells = 38. n/a = 16 (14 in U7 — lenses inapplicable to an absent concern; 2 in U26 — SEO/perf inapplicable to a dev-only harness). Passes = 526.

### Notable passes (things that are genuinely right, verified)

- **Draft gating holds** (U12/U13/U14/U15/U16 ×14): every public query filters `status = 'published'` (`page.ts:38`, `blog-events.ts:81,102,134,157`); unknown slug → real 404 with `noindex` (verified live, status 404). No draft leak found.
- **XSS hygiene is consistent**: attribute-escaped meta (`render-page.tsx:98`), `<`-escaped JSON-LD (`json-ld.ts:107`) and edit-boot payload (`render-page.tsx:335`), escaped CTM account id, escaped blog/event list items, XML-escaped sitemap locs.
- **Tolerant SEO parsing** (`seo/schema.ts`): per-field `.catch()` so one dirty field can't drop a `noindex` — a deliberate, correct honesty defense.
- **Preview divergence is documented and deliberate** (U25): tracking stripped (`admin-pages.ts:378-384`), per-response CSP replaces the global one with rationale, `Cache-Control: no-store`, `Referrer-Policy: no-referrer` (token in URL), sibling-preview link rewriting, home slug↔path mapping mirrored from `page.ts`.
- **Image block** (U29): webp+jpg `srcset`, `sizes`, `loading="lazy"`, `decoding="async"`, intrinsic `width`/`height` (CLS-safe), focal-point `object-position`. Best-in-slice component.
- **404s are real 404s** with helpful copy, site branding, and `noindex` (verified live).
- **Sitemap/robots** are per-tenant, fresh-on-request, home-first, `robots.index=false` rows excluded at the SQL level (`sitemap.ts:39-44`).
- **blocks-preview harness** correctly gated out of production (`app.ts:80`).

## Directives (D900+)

- [D901] (U21 media hydration) × (Structure/Grain + Sibling-Coherence) — «One generic asset-reference scan must feed every consumer; never a per-block allowlist in one consumer and a generic scan in another». Instance: `render-hydration.ts:16-39` collects only `props.asset_id` and `props.slides[].image_asset_id`, but `nav-bar` declares `logo_asset_id` (`packages/components/src/blocks/nav-bar/schema.ts:29`) and `split-hero` declares top-level `image_asset_id` (`split-hero/schema.ts:20`) — those assets are never queried, so nav logos and split-hero images render as missing-asset placeholders on published pages, previews, AND materialized templates, while `git-import.ts:143-156` already has the correct generic `/asset_id$/i` recursive scan. Fix-class: replace `collectAssetIds` with the shared generic scanner (extract `collectAssetIdsGeneric` to a common module).
- [D902] (U11/U4 home route × canonical) × (Honesty/SEO) — «One page, one URL: the slug↔path mapping must be bijective on the public surface». Instance: verified live — `https://muldoon-dental.sites.anchorcorps.com/home` serves the identical home page with `<link rel="canonical" href=".../home">` while `/` canonicalizes to `/`; `normalizeSlug` (`page.ts:70-75`) maps `/home`→`home` but never redirects. Duplicate indexable content with split canonicals. Fix-class: 301 `/home` → `/` in `pageRouter` (mirror of the mapping already special-cased in `admin-pages.ts:393`).
- [D903] (U21 media bucket, live tenant surface) × (Gating-Axis) — «Public objects must not imply a public index; cross-tenant enumeration is never acceptable». Instance: verified live — `GET https://storage.googleapis.com/anchorcorps-media/` returns 200 with a full `ListBucketResult` of every object key (all tenants' media enumerable by anyone; the objectViewer-for-allUsers grant includes `storage.objects.list`). Fix-class: replace bucket-level `roles/storage.objectViewer` with a list-free read grant (custom role with only `storage.objects.get`, or serve via CDN/signed paths).
- [D904] (U11 home route) × (Failure/Recovery) — «A provisioned site with zero published pages must show a deliberate state, not an error». Instance: `page.ts:43-47` — no published `home` row → `renderNotFound` → a brand-new tenant's ROOT URL is "Page not found" (404). The live-URL handed to the operator after provisioning is an error page until first publish. Fix-class: distinct "coming soon" render (site exists, nothing published) branch before `renderNotFound`.
- [D905] (U22/U24 analytics + vitals) × (Population/Dark) — «A shipped feature must be reachable by the deployed configuration or explicitly retired». Instance: `shell()` gates analytics on `ANALYTICS_BASE_URL` and vitals on `WEB_VITALS_ENDPOINT` (`render-page.tsx:194,203`), but `cloudbuild.yaml` defines neither (grep: zero hits) — verified live: no analytics/vitals script on any published page. Phases 11–12 code is fully dark in prod. Fix-class: add the env vars to `cloudbuild.yaml` (config-as-code, per the `--set-secrets` gotcha) or record the retirement decision.
- [D906] (U24/U28 vitals loader × CSP) × (Reversibility/Safety) — «Third-party script sources must be version-pinned and allowlisted only when used». Instance: `render-page.tsx:212` loads `https://unpkg.com/web-vitals/dist/web-vitals.iife.js` (unpinned latest — supply-chain exposure if ever enabled), and `csp.ts:30-36` allowlists `unpkg.com` + `cdn.calltracking.com` in `script-src` on EVERY tenant response (verified live) even when neither script is emitted. Fix-class: self-host a pinned web-vitals copy under `'self'`; make CSP entries conditional on the features being enabled.
- [D907] (U24 vitals endpoint) × (Provenance→Consumption) — «Data accepted from the public must carry attribution and land somewhere readable». Instance: `routes/vitals.ts:28-38` — unauthenticated POST (verified live: 204 from arbitrary caller), payload has no site/page/host field, handler `console.log`s and discards; nothing ever reads it. Collected-but-unattributed-and-unread. Fix-class: derive site from `Host`/`Origin`, persist (or delete the route until Phase 12 aggregation exists).
- [D908] (U12 published pages, also sitemap/robots) × (Temporal-Integrity) — «Every public response declares an explicit caching contract». Instance: verified live — tenant HTML, `/sitemap.xml`, `/robots.txt` carry NO `Cache-Control` header (weak ETag only, Express default); intermediary/browser behavior after a re-publish is left to heuristics, and every request is a full DB render. Fix-class: set explicit `Cache-Control` (e.g. `no-cache` now; `s-maxage` + purge later) in `shell()`/sitemap responses.
- [D909] (U28 headers) × (Gating-Axis) — «CORS grants belong to the endpoints that need them, not the whole app». Instance: `app.ts:51` `app.use(cors())` → verified live: `access-control-allow-origin: *` on published tenant HTML and on admin API responses. Fix-class: scope `cors()` to the API sub-routers that actually serve cross-origin consumers.
- [D910] (U3/U14 OG tags on posts) × (SEO-completeness) — «Content type must flow into og:type». Instance: `render-page.tsx:146` hardcodes `og:type=website` for every render; blog posts should emit `article` (+ `article:published_time` from `post.published_at`, which is already fetched). Fix-class: `ogType` option on `renderSeoMeta`, set by the blog-post route.
- [D911] (U1 head, live data) × (Honesty) — «Seed/placeholder markers must never reach an indexable public surface». Instance: verified live — `og:site_name`, Organization/WebSite JSON-LD and the 404 title on muldoon-dental all say "Muldoon Dental (placeholder)" on an `index,follow` page. No gate between provisioning display_name and publish. Fix-class: publish-time lint (block or warn on placeholder-marked display names).
- [D912] (U13/U15/U18 index routes × sitemap) × (Honesty) — «The sitemap and the reachable-indexable set must agree». Instance: `/blog` and `/events` return 200 with `index,follow` even with zero content ("No posts yet." — verified live) yet `sitemap.ts:66,68` only lists them when rows exist; empty index pages are indexable thin content invisible to the sitemap. Fix-class: `noindex` empty index pages (or 404 them), and include the index URLs in the sitemap exactly when they are indexable.
- [D913] (U13/U15 index titles) × (Naming/Least-astonishment) — «Every public page title carries site identity by default». Instance: verified live — blog index `<title>` is bare `Blog` (no site name) because `applyTitleTemplate` is a no-op when `seo_defaults.titleTemplate` is unset (`seo/schema.ts:102-105`) and index routes pass a bare "Blog"/"Events" title (`blog-events.ts:91,146`). Fix-class: default suffix `«%s — ${display_name}»` when no template is configured.
- [D914] (U7 favicon) × (Terminality + Cost/Value) — «The shell must terminate the favicon request». Instance: `shell()` emits no `<link rel="icon">`; verified live — `/favicon.ico` returns the full ~20 KB HTML 404 page on every browser tab-open, and tenant tabs show no icon. Fix-class: emit a default favicon link (data-URI or platform asset) in `shell()`, plus a tiny static `/favicon.ico` handler before the page router.
- [D915] (U8 fonts) × (Population/Dark + Sibling-Coherence) — «Brand identity axes the product promises (typography) must exist end-to-end or not be half-plumbed». Instance: brand tokens are colors-only (`src/blocks/brand-tokens.ts` — key/value grammar admits no font values; `packages/components/src/styles.css:9` "No font-family declarations live here (D-005)"), so every tenant renders in the Tailwind system stack; meanwhile `csp.ts:62-64` allowlists Google Fonts on tenant responses for a stylesheet only the Studio SPA loads. Fix-class: either add a `--theme-font-*` token + head `<link>` pipeline, or scope the fonts CSP to the Studio host.
- [D916] (U29 CSS load) × (State-Visibility) — «A failed asset resolve that blanks every tenant site must be loud». Instance: `render-page.tsx:38-52` — `tryReadPackageAsset("@anchorcorps/components/styles.css")` returns `""` on any error; a mis-installed package ships completely unstyled HTML platform-wide with zero log line. Fix-class: log an error (and export a healthz signal) when `PACKAGE_BLOCK_CSS` is empty at boot.
- [D917] (U29 CSS delivery) × (Cost/Value + Performance) — «Shared, immutable CSS belongs in a cacheable resource, not re-inlined per response». Instance: ~15 KB (`packages/components/dist/styles.css` = 14 841 B) + shell/rich-text CSS is inlined into EVERY response — pages, 404s, favicon-404s (live pages ≈ 20 KB, mostly CSS), with no client cache possible (compounded by D908). Fix-class: serve the package CSS as a hashed `/assets/blocks.<hash>.css` link (keep a small critical-inline shell).
- [D918] (U9/U10 nav + footer links) × (Precondition/Forward-path) — «Internal links must be validated against the pages that exist». Instance: `nav-bar`/`rich-footer`/CTA hrefs are free-text block props; nothing at save/publish checks a `/about` link targets an existing published page — a deleted/renamed page silently leaves dead nav on the live site (the preview path already builds a slug→page map, `admin-pages.ts:508-516`, proving the check is cheap). Fix-class: publish-time link lint reusing the preview resolver's slug map (warn or block).
- [D919] (U1 renderer modules) × (Organization) — «One escape function per encoding». Instance: `escapeHtml` is triplicated (`render-page.tsx:63`, `analytics.ts:8`, `blog-events.ts:24-33`) beside a fourth `xmlEscape` (`sitemap.ts:17-26`). Fix-class: shared `src/server/escape.ts`.
- [D920] (U15 events index) × (Naming/Least-astonishment) — «Copy must match the query». Instance: `blog-events.ts:134-145` lists ALL published events (`ORDER BY starts_at ASC`, no date filter — `events/repo.ts:100`) yet the empty state says "No upcoming events."; past events render indistinguishably above the fold. Fix-class: filter/split past vs upcoming (or change copy + ordering).
- [D921] (U20 resolve cache) × (Idempotence/Accretion) — «A per-request cache keyed by attacker-controlled input must be bounded». Instance: `resolveSite.ts:40` — plain `Map` keyed by `Host` header; expired entries are never swept (only overwritten), and arbitrary Host values (each also costing a DB miss + negative-cache insert) grow it without limit. Fix-class: size cap with eviction sweep (LRU or periodic purge of expired entries).
- [D922] (U18 sitemap URLs) × (Contract-Stability) — «URL construction goes through one encoder». Instance: `sitemap.ts:67,69` interpolates `${base}/blog/${p.slug}` raw while the blog index anchor uses `encodeURIComponent(p.slug)` (`blog-events.ts:85`) — two contracts for the same URL; a slug that ever escapes the charset guard produces a sitemap/anchor mismatch. Fix-class: shared `publicUrlForPost/Event(base, slug)` helper that encodes.
- [D923] (U20 unprovisioned domains, live) × (Comprehension) — «A tenant hostname that exists in DNS must never show a raw platform error». Instance: verified live — `muldoon/demo/acme/acme-dental/gate-test-*.sites.anchorcorps.com` all resolve via the wildcard `*.sites → ghs.googlehosted.com`, TLS handshake is refused (no cert/mapping) and HTTP:80 serves Google's bare "Error 404 (Not Found)!!1" page; a visitor (or the operator checking a "live" URL) gets zero meaningful signal. Fix-class: don't surface the URL as live until the mapping is Ready (workspace side), and/or map a catch-all host serving a branded "site not ready" page.
- [D924] (U22 analytics tag) × (Naming/Least-astonishment) — «A fallback value must still satisfy the field's contract». Instance: `render-page.tsx:197` — on `hostnameForSlug` throw, `canonicalHost = opts.site.slug` (a bare slug, not a hostname) becomes the analytics `data-domain` key; silent wrong-key attribution instead of skipping the tag. Fix-class: skip analytics injection when the canonical host can't be built.
- [D925] (U1 html element) × (Contract-Stability) — «Per-tenant content attributes must come from tenant data». Instance: `render-page.tsx:219` hardcodes `lang="en"` for every tenant with no site-level locale field. Fix-class: optional `sites.locale` (default `en`) threaded into `shell()`.
- [D926] (U2 preview head) × (Gating-Axis) — «Non-public renders must self-declare as non-indexable at the HTTP layer». Instance: the preview response (`admin-pages.ts:517-518`) reuses `renderPage` unchanged, so draft HTML carries `robots index,follow` + the future publish canonical; it is auth-gated, but any saved/leaked copy is index-clean-looking. Fix-class: `X-Robots-Tag: noindex` header on the preview route (one line, no render change).
- [D927] (U23 CTM hook) × (Population/Dark) — «Scaffolds must be tracked, not shipped as dead exports». Instance: `ctm-hook.ts` — `runCtmNow()` has zero importers repo-wide (grep confirmed); documented as a Phase-13 wiring point but nothing marks it as pending work. Fix-class: reference it from the Phase-13 plan/ledger or delete until needed.
- [D928] (U13/U15 index render) × (Performance) — «Independent reads on one request run concurrently». Instance: `blog-events.ts:60-63` awaits `resolveOgImage` then `loadAssetsForBlocks` sequentially; the page route already parallelizes the same pair (`page.ts:52-55`) — sibling incoherence costing one DB round-trip per blog/event render. Fix-class: `Promise.all`, mirroring `page.ts`.

Directive count: **N = 28** (D901–D928).

## Live-probe results (all unauthenticated; no secrets used)

### Hostname reachability

| Hostname (.sites.anchorcorps.com) | DNS | HTTPS | HTTP :80 | Verdict |
|---|---|---|---|---|
| muldoon-dental | ghs.googlehosted.com | **200, TLS valid** (HTTP/2, Google Frontend) | — | LIVE |
| demo-site | ghs.googlehosted.com | **200, TLS valid** | — | LIVE |
| muldoon | ghs.googlehosted.com | TLS handshake refused (SSL_ERROR_SYSCALL) | Google generic "Error 404 (Not Found)!!1" | no Cloud Run domain mapping / cert — matches handoff "pending/failed provisioning" |
| demo | same | same | same | same |
| acme-dental | same | same | same | same |
| acme | same | same | same | same |
| gate-test-phase-a | same | same | same | test artifact still in DNS-wildcard limbo |
| gate-test-unwatched | same | same | same | same |
| no-such-site-zzz (control) | ghs.googlehosted.com (wildcard) | same | same | indistinguishable from a "provisioning" site — see D923 |

Note: the failure mode of the stuck domains is *no mapping at all* at Google's frontend (generic GFE 404 on port 80), not a mapping-with-pending-cert; consistent with the handoff's `site.provision` PermissionDenied at the cloud_run step.

### Deep probes — muldoon-dental (live)

| Check | Result |
|---|---|
| `GET /` | 200, full meta set: title w/ page title, description, `robots index,follow`, canonical `/`, og:site_name/title/description/url, `twitter:card summary` (correct no-image fallback), 3 JSON-LD nodes (Organization/WebSite/WebPage). **No og:image** (no default configured). **No analytics/CTM/vitals scripts** (see D905). ~20 KB, mostly inlined CSS |
| Headers | Helmet CSP present (script-src 'self' 'unsafe-inline' cdn.calltracking.com unpkg.com …), HSTS, nosniff, `x-frame-options: SAMEORIGIN`, `referrer-policy: no-referrer`, weak ETag, **no Cache-Control** (D908), **`access-control-allow-origin: *`** (D909) |
| `/robots.txt` | 200 — `Allow: /` + correct absolute sitemap URL |
| `/sitemap.xml` | 200 `application/xml`, 1 URL (`/`, lastmod 2026-05-19), no Cache-Control |
| `/definitely-not-a-page-xyz` | **404** status, branded HTML 404, `noindex`, brand tokens applied |
| `/home` | **200 — duplicate of `/` with canonical `…/home`** (D902) |
| `/favicon.ico` | 404 (HTML 404 page — D914) |
| `/blog` | 200, `<title>Blog</title>` (bare — D913), "No posts yet.", indexable but absent from sitemap (D912) |
| `/blog/` (trailing slash) | 200 (Express non-strict routing; canonical normalizes — OK) |
| `/events/nope` | 404 correctly |
| `/healthz` | Intercepted by Google frontend (GFE 404 page, charset=UTF-8) — the app is never reached on mapped custom domains for this path; monitoring must use the run.app URL |
| `/api/sites`, `/__site_resolve` | 401 JSON — admin API surface reachable on tenant hostnames but auth-gated (works as designed; noted, no directive) |
| `POST /api/vitals` | **204 for an arbitrary unauthenticated cross-origin payload** (D907) |
| `/me` | Falls through to branded tenant 404 (correct) |

### Deep probes — demo-site (live)

| Check | Result |
|---|---|
| `GET /` | 200, title "AnchorCorps Demo Site", full meta/JSON-LD, no og:image, no tracking scripts |
| `/sitemap.xml`, `/robots.txt` | 200, correct, 1 URL |
| `/blog`, `/events` | 200 (empty states) |
| Body hrefs | `#details`, self-link, external GitHub link — **zero `<img>` tags on either live homepage** |

### Image / bucket status

- Neither live site's homepage contains any `<img>` — the "images 200 now" question cannot be answered from page markup (both sites are text-only block sets).
- The bucket itself: `GET https://storage.googleapis.com/anchorcorps-media/` → **200 with a full public object LISTING** (first key: `logo-dark.svg`). Objects are public (the operator ran the one-liner), but the grant also made the bucket **listable — cross-tenant media enumeration for anyone** (D903).

### Brief premise check (per operator's verify-don't-ask rule)

The brief said "analytics/CTM scripts present on published but ABSENT in preview — verify the published side." **The premise is wrong on the published side**: tracking scripts are absent from published pages too. Evidence: live HTML of both tenants has no plausible/umami, CTM, or vitals script; `cloudbuild.yaml` sets none of `ANALYTICS_BASE_URL` / `WEB_VITALS_ENDPOINT` / analytics provider env; both live sites presumably have `ctm_account_id = null`. The preview-side stripping code (b50925d) is correct and present — it just currently strips nothing that the published side would have emitted (D905).
