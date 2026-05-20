# Admin control hub (Studio)

The admin UI — "Studio" — is a single React SPA for managing every tenant
site: listing sites, creating new ones, browsing/creating pages, uploading
media, and editing brand tokens. It is served by the **same** Express + Vite
process that renders public tenant sites (D-014); a host guard decides which
surface answers a given request.

Phase 4 ships the shell, navigation, lists, and the supporting read/write API.
The page **editor** (drag-and-drop Puck) is Phase 5 — Studio routes to a
labeled placeholder for now.

## Host model (D-032)

Three sibling layers under the `anchorcorps.com` apex:

| Layer       | Host                        | Purpose                                  |
|-------------|-----------------------------|------------------------------------------|
| Marketing   | `anchorcorps.com`           | The apex AnchorCorps site                |
| Control hub | `studio.anchorcorps.com`    | Admin — manage/edit all sites (this app) |
| Tenant sites| `*.sites.anchorcorps.com`   | Demo/preview sites pre-real-domain (D-025)|

`studio.anchorcorps.com` is deliberately **not** under `sites.` — it is not a
DNS parent of any tenant host, so admin session cookies (Phase 8 / Better-auth)
can't leak onto public tenant sites by default. Full rationale in **D-032**.

`src/config/admin-host.ts` → `isAdminHost(hostname)` recognizes
`studio.anchorcorps.com`, `studio.localhost`, and a `STUDIO_HOST` env override
(all port-insensitive). Two enforcement points share that one predicate:

- **Server:** `src/server/routes/page.ts` short-circuits the admin host before
  `resolveSite`, so a Studio request never 404s as a missing tenant page.
- **Client:** `src/App.jsx` renders `<AdminApp />` when
  `isAdminHost(window.location.host)`, else the legacy marketing/app routes.

## Auth (interim — X-Admin-Token; D-034)

Phase 4 auth is a single shared **`X-Admin-Token`**, pasted once at `/login`,
verified against a `GET /api/sites` probe, and stored in `localStorage`.

- `src/admin/lib/adminToken.ts` — `get/set/clear` + a `useAdminToken` hook
  (backed by `useSyncExternalStore`, so a 401-clear re-renders every consumer).
- `src/admin/lib/apiFetch.ts` — attaches `X-Admin-Token`, JSON-encodes the
  body, maps non-2xx to a typed `ApiError`, and clears the token on 401.
- `src/admin/auth/RequireAdmin.tsx` — guards everything except `/login`,
  redirecting (with the attempted path preserved) when there's no token.

**This is interim.** Per **D-034**, Phase 8 replaces it with **Google OAuth via
Better-auth**, scoped to the Studio host only, team-gated, with **no auth
locally**. `requireAdmin` flips from a token check to a session check then.

> Note: Studio uses real `<form>` elements (login, new-site, new-page). That
> does not violate the "no `<form>` in React" anchor — that anchor governs CRM
> embeds and editor previews, not admin chrome.

## Route map

All admin routes live under the admin host (`src/admin/AdminApp.tsx`):

| Route                          | Screen                | Notes                                   |
|--------------------------------|-----------------------|-----------------------------------------|
| `/login`                       | Token paste           | Public; verifies before persisting      |
| `/`                            | Sites list            | Table; row → detail; "+ New site"        |
| `/sites/new`                   | New-site wizard       | 2-step: name+slug, then brand colors     |
| `/sites/:slug`                 | Site detail + tabs    | Pages · Media · Settings                 |
| `/sites/:slug/pages/:pageId`   | Editor placeholder    | **Phase 5** (Puck) lands here            |
| `*`                            | Not found             |                                          |

The detail tabs route by **slug**, but the detail/pages/media API endpoints key
off the site **UUID**. Studio resolves slug → id client-side from the (cheap)
`GET /api/sites` list, then loads detail by id. The `:siteId` endpoints query a
UUID column, so a slug must never be sent to them directly.

## Admin API

Mounted under `/api`, all gated by `requireAdmin` (per-route, so unknown
`/api/*` paths fall through to 404 rather than 401).

| Method + path                                   | Purpose                              |
|-------------------------------------------------|--------------------------------------|
| `GET  /api/sites`                               | List sites (+ page counts)           |
| `POST /api/sites`                               | Create site (+ canonical domains)    |
| `GET  /api/sites/:siteId`                       | Site detail (+ page/media counts)    |
| `PATCH /api/sites/:siteId`                      | Update display_name / brand tokens   |
| `GET  /api/sites/:siteId/pages`                 | List pages                           |
| `POST /api/sites/:siteId/pages`                 | Create empty page + initial revision |
| `GET  /api/sites/:siteId/media`                 | List media (paginated)               |
| `POST /api/sites/:siteId/media/upload-url`      | Mint signed GCS upload URL (P3)      |
| `POST /api/sites/:siteId/media/:assetId/complete`| Enqueue variant processing (P3)     |

Brand-token writes (create + settings) validate through `brandTokensSchema`
(**D-029**). Studio's color editor uses `<input type="color">`, which always
emits 6-digit hex, so assembled token maps are schema-valid by construction.

The media upload flow is three steps: `POST .../upload-url` → browser **PUT**
straight to the signed GCS URL (a raw `fetch`, *not* `apiFetch` — the admin
token must never go to `storage.googleapis.com`) → `POST .../complete`. The
Phase-3 variant job then processes the upload asynchronously; the grid flips a
tile to "ready" on refresh.

## Run Studio locally

```bash
# Boot Postgres + migrate + seed (see docs/local-dev.md), then:
npm run dev          # Express + Vite on :3000
```

Visit **`http://studio.localhost:3000`**. Most OS resolvers map `*.localhost`
to `127.0.0.1` automatically; if yours doesn't, add `127.0.0.1 studio.localhost`
to `/etc/hosts`. Paste any value matching the server's `ADMIN_TOKEN` at
`/login`. (Locally, set `ADMIN_TOKEN` in `.env`; in prod it's a Secret Manager
value. Phase 8 removes the local token requirement entirely — D-034.)

The "View live site" link and the Settings "Hostnames" card show the canonical
`<slug>.sites.anchorcorps.com` host (`src/admin/lib/siteUrl.ts`). That host only
serves over the public internet, not on `localhost`.

## UI building blocks

- `src/admin/ui/` — vendored shadcn-style primitives (Button, Card, Input,
  Label, Badge, Spinner, Table, Dialog) on an indigo/zinc palette, distinct
  from the brand-token-driven public blocks (D-005). Not re-exported from
  `@anchorcorps/components` — that package is the public *site* surface.
- `src/admin/components/BrandTokenFields.tsx` — the shared color-pair editor
  (Main/Accent/Surface + `on-*`) with a live preview, used by both the new-site
  wizard and the Settings tab. `DEFAULT_BRAND_TOKENS` lives here too.
- `src/admin/lib/useApi.ts` — minimal GET hook (`{ data, loading, error,
  reload }`), no cache. A heavier client (react-query) can replace it behind the
  same call sites if the admin ever needs it.

## Phase hand-offs

- **Phase 5** — the visual editor (Puck, D-017) replaces `EditorPlaceholder` at
  `/sites/:slug/pages/:pageId`.
- **Phase 8** — Better-auth Google OAuth (D-034) replaces the `X-Admin-Token`
  gate on the Studio host.
- **Phase 10** — real custom-domain provisioning; the Settings "Hostnames" card
  becomes editable. Until then every site is reachable at its canonical
  `<slug>.sites.anchorcorps.com`.
