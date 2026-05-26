# Plugin / integration framework

> Phase 7.5. Implements **D-016** (the framework), refined by **D-044** (config
> storage + secret encryption) and **D-045** (manifest contract, loader scope,
> distribution). Plugins are the general-purpose way to add backend integrations
> (e-commerce, booking, custom forms, third-party CRMs) that contribute blocks,
> API routes, tables, and per-site config — distinct from `@anchorcorps/components`
> (shared UI blocks) and the special-cased CRM integration (Phase 11).

## What a plugin is

A self-describing unit of integration. One **manifest** declares everything it
contributes; the renderer composes enabled plugins at boot. Concrete plugins
(Stripe, PayPal, booking) are **post-7.5** package work — this phase ships the
framework + an in-repo **reference plugin** (`src/server/plugins/example/`) that
exercises every manifest field and is the end-to-end test target.

## Manifest contract

`src/server/plugins/manifest.ts` — `PluginManifest`:

| Field | Required | Notes |
|---|---|---|
| `name` | ✓ | kebab-case, globally unique. Also the `/api/plugins/<name>` mount + block namespace |
| `version` | ✓ | semver; recorded in `site_plugins.version` on install |
| `blocks` | — | Block entries registered into the global block registry. Each `type` MUST be namespaced `<name>/<block>` |
| `createRouter` | — | `(ctx: { pool, pluginName }) => express.Router`. Mounted once at `/api/plugins/<name>` |
| `migrations.tables` | — | The tables the plugin owns. Every name MUST start with `plg_<name>_` |
| `configSchema` | — | Zod schema for per-site config. Validated before persisting |
| `secretConfigKeys` | — | Keys within `configSchema` whose values are secret (encrypted at rest) |
| `requiredEnv` | — | Env vars that must be present for the plugin to boot (UPPER_SNAKE) |

`validatePluginManifest(manifest)` enforces all of the above structurally
(returns a list of errors); `registerPlugin` rejects an invalid or duplicate
manifest. See the reference manifest at `src/server/plugins/example/manifest.ts`.

## Runtime registry, loader, boot

- **`registerPlugin(manifest)`** (`registry.ts`) — mirrors the Phase-1
  `registerBlock()` API. Plugins self-register; the loader composes the
  registered set. Global Map, uniqueness-enforced.
- **`verifyPluginMigrations({ pool })`** (`loader.ts`, async, at boot) — for each
  registered plugin checks `requiredEnv` is present and its `plg_<name>_` tables
  exist. Returns `{ active, skipped:[{name,reason}] }`. **Fail-soft**: a plugin
  whose migration hasn't run (or whose env is missing) is skipped, never crashes
  boot.
- **`loadPlugins(app, { only })`** (`loader.ts`, sync, inside `createApp`) —
  registers each active plugin's blocks (namespaced, idempotent) and mounts its
  router at `/api/plugins/<name>`, behind `resolveSite` (pass-through) so plugin
  routes get tenant context. `createApp({ activePlugins })` passes the boot-
  verified set; omitted → all registered (the default for tests).

Boot order (`src/server/index.ts`): `registerBuiltinPlugins()` →
`verifyPluginMigrations()` (logs skips) → `createApp({ activePlugins })`.

## Per-site enablement

- **`site_plugins`** table (one row per `(site_id, plugin_name)`) — see
  `docs/data-model.md`. A row = installed; `enabled` gates mounting for that site.
- **`req.site.plugins`** — `resolveSite` attaches the resolved site's ENABLED
  plugins (`{name, version}`), fetched in the same query and cached with the
  site. The plugins admin route evicts the site's cache on change so toggles take
  effect immediately.
- **`requireSitePlugin(name)`** (`guard.ts`) — middleware a plugin guards its
  routes with: 404 if no site resolved, 403 if the plugin isn't enabled for the
  site. Blocks/routes exist globally; enablement gates **use** (D-045).

## Config + secrets (D-044)

Config is split across two columns on `site_plugins`:

- **`config`** — non-secret config, plaintext jsonb (queryable, no key needed).
- **`config_encrypted`** — the `secretConfigKeys` values, AES-256-GCM enveloped
  (`{v,iv,tag,ciphertext}`), or null.

Encryption (`crypto.ts`) uses `node:crypto` with a 32-byte key from
**`PLUGIN_CONFIG_ENC_KEY`** (base64, Secret Manager → Cloud Run). Production
requires the key (throws if missing); non-prod falls back to a deterministic dev
key. The GCM tag makes tampered ciphertext fail closed.

**Operator prerequisite (deferred):** provisioning `PLUGIN_CONFIG_ENC_KEY` is
only needed once the first key-bearing plugin is enabled in prod (the framework +
reference plugin run locally with the dev key).

Secrets are **never returned** by the API — only `secrets_set` (key names with a
stored value). On save the route **merges**: a non-empty secret updates it, an
omitted/blank one preserves the stored value (a config form can't echo secrets
back). The route splits secret vs non-secret using the manifest's
`secretConfigKeys`; the repo treats `config_encrypted` as an opaque blob.

## Blocks

Plugin blocks register into the ONE global block registry under a namespaced
type (`<name>/<block>`, e.g. `example/banner`) so the renderer + editor catalog +
AI catalog see them. Per-site availability is governed by `site_plugins` /
`req.site.plugins`, not by registration.

## Migrations (v1)

Plugin migrations live in `db/migrations/` and run via the standard `migrate:up`
pass (and the CI migrate Cloud Run Job). Tables MUST be prefixed `plg_<name>_`
(hyphens → underscores) and plugins must **never alter core tables**
(sites/pages/page_revisions/templates/site_plugins). A per-install dynamic
migration runner is a documented future refinement.

## Distribution

A real plugin ships as a versioned package on GCP Artifact Registry — the same
channel as `@anchorcorps/components` (D-005/D-026/D-027):

```
@anchorcorps/plugin-<name>
├── package.json        — name, version, "exports" → dist; tsup build script
├── tsup.config.ts      — ESM + CJS + d.ts (per D-027)
├── src/
│   ├── manifest.ts     — exports the PluginManifest (the package entry)
│   ├── block.tsx       — namespaced block(s)
│   ├── router.ts       — createRouter
│   └── config-schema.ts
└── migrations/         — node-pg-migrate files (plg_<name>_ tables)
```

The consuming renderer installs the package and registers its manifest at boot.
**Dynamic discovery** (scan `node_modules/@anchorcorps/plugin-*`, import each
manifest, `registerPlugin`) is intentionally **deferred to the first real
plugin** (D-045) — for now the loader composes explicitly-registered manifests.
The wiring point is `src/server/plugins/builtin.ts` (`registerBuiltinPlugins`).

### In-repo reference plugin

`src/server/plugins/example/` is the working template. It only self-registers at
boot when **`ENABLE_EXAMPLE_PLUGIN=true`** (default off → prod stays clean); its
migration ships everywhere but the table is inert unless the plugin is enabled
for a site. Flip the env var to see the framework end-to-end at
`studio.localhost:3000`.

## Studio UI

Site Detail → **Plugins** tab (`src/admin/pages/site-tabs/PluginsTab.tsx`): lists
available plugins, per-plugin enable/disable, and a config form generated from
the plugin's `config_schema` (the server's zod-to-json-schema output). Secret
fields render as password inputs showing set/"leave blank to keep".

## Admin API

All under `/api`, gated by `requireAdmin` (the interim X-Admin-Token until
Phase 8 / D-034):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/plugins` | Available plugins (version, config_schema, secret_config_keys, blocks, required_env) |
| GET | `/api/sites/:siteId/plugins` | Per-site install/enable state (secrets redacted → `secrets_set`) |
| PUT | `/api/sites/:siteId/plugins/:name` | Install/enable/disable + set config (validates, encrypts secrets, evicts cache) |

Plugin-contributed routes live under `/api/plugins/<name>/*` (tenant-facing,
gated by `requireSitePlugin`).

## Security notes

- Secret config is encrypted at rest and never crosses the API boundary.
- Plugins own only `plg_<name>_` tables; they cannot alter core tables.
- Plugin routes are tenant-scoped (`resolveSite` + `requireSitePlugin`) — a site
  only reaches a plugin it has enabled.
- A plugin whose migration hasn't run or whose env is missing is skipped at boot,
  not mounted.
