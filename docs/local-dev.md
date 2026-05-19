# Local development

## One-time setup

```bash
# 1. Install
npm install

# 2. Boot local Postgres (Docker)
docker compose up -d postgres
#    container: anchor-sites-postgres-1
#    host port: 5434 (5432 and 5433 were already in use on the author's box; see D-013)

# 3. Environment
cp .env.example .env
#    expects:
#      DATABASE_URL=postgres://anchor:anchor@localhost:5434/anchor_dev
#      TEST_DATABASE_URL=postgres://anchor:anchor@localhost:5434/anchor_test

# 4. Apply migrations + seed
npm run migrate:up
npm run db:seed
```

## Run the dev server

```bash
npm run dev
# Express + Vite (middleware mode) on http://localhost:3000
```

`/healthz` and `/__blocks/preview` are tenant-less and work on `localhost:3000`
directly.

## Multi-tenant local hostnames

Phase 1 Task 1.5 resolves `Host` → site via the `site_domains` table.
The seed in `db/seed.ts` adds these dev hostnames:

| Host                              | Site            |
| --------------------------------- | --------------- |
| `muldoon.preview.anchorcorps.dev` | `muldoon-dental`|
| `muldoon.localhost`               | `muldoon-dental`|
| `demo.preview.anchorcorps.dev`    | `demo-site`     |
| `demo.localhost`                  | `demo-site`     |

`*.localhost` resolves to `127.0.0.1` automatically on macOS and most modern
Linux distros — no `/etc/hosts` edit is required.

If your environment doesn't auto-resolve `*.localhost`, add this to
`/etc/hosts`:

```
127.0.0.1 muldoon.localhost demo.localhost
```

Then probe the tenant resolver:

```bash
curl -s http://muldoon.localhost:3000/__site | jq
# → {"site":{"id":"…","slug":"muldoon-dental","matched_via":"domain",...}}

curl -s http://demo.localhost:3000/__site | jq
# → {"site":{"id":"…","slug":"demo-site","matched_via":"domain",...}}

curl -i http://nope.localhost:3000/__site
# → 404 Site not found
```

The `/__site` route is gated to non-production envs. It will be replaced by
the catch-all page renderer in Task 1.6; the middleware itself stays.

## Test commands

```bash
# Unit + integration suite (requires DATABASE_URL + TEST_DATABASE_URL)
DATABASE_URL=postgres://anchor:anchor@localhost:5434/anchor_dev \
TEST_DATABASE_URL=postgres://anchor:anchor@localhost:5434/anchor_test \
  npm test

# Type-check only
npx tsc --noEmit
```

`tests/integration/*` are gated on `TEST_DATABASE_URL`; without it they skip
cleanly and the suite drops to baseline-only coverage.

## Resetting the local DB

```bash
npm run migrate:down  -- --count 9999  # tear everything down
npm run migrate:up                     # rebuild
npm run db:seed                        # repopulate sites + pages + site_domains
```

The seed is idempotent (UPSERT on `sites.slug`, `pages(site_id, slug)`, and
`site_domains.hostname`) so re-running is safe.
