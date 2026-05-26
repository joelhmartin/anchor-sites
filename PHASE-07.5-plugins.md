# Phase 7.5 — Plugin / integration framework

> Expanded + confirmed with the operator 2026-05-26 (verbal sign-off in chat
> after the EXPAND+CONFIRM gate; operator chose to run 7.5 before Phase 8, per
> PLAN.md ordering). Implements **D-016** — the general-purpose backend
> integration framework. Builds on the runtime `registerBlock()` API reserved
> in Phase 1 (`src/blocks/registry.ts`), the `req.site.plugins` field reserved
> in `resolveSite.ts`, the pg-boss boot (D-019/D-030), and the Phase-4 Studio
> admin shell + API. **Not** the concrete plugins (Stripe, PayPal, booking) —
> those are POST-7.5 packages, not this phase. **Not** Phase 8 auth.

## What this phase delivers

A framework that treats integrations as self-describing plugins: each plugin
ships a single **manifest** declaring what it contributes (blocks, routes,
migrations, config schema, required env). The renderer composes enabled plugins
at boot; per-site enablement + encrypted config lives in `site_plugins`; Studio
gets enable/disable + a config form. One in-repo **reference plugin** proves the
contract end-to-end. Distribution as versioned Artifact Registry packages
(`@anchorcorps/plugin-<name>`, same channel as `@anchorcorps/components`) is
documented + scaffolded; dynamic discovery of installed plugin packages is a
thin add when the first real plugin ships.

## Confirmed design decisions (operator, 2026-05-26)

1. **Config secret encryption — app-level AES-256-GCM** with a 32-byte key from
   Secret Manager (`PLUGIN_CONFIG_ENC_KEY`). `node:crypto`, zero new deps; dev/
   test key local; the prod secret is a prereq only when the first key-bearing
   plugin lands. Refines D-016's "KMS-managed key" → SM-held key for v1, KMS
   upgrade path documented. → **D-044**.
2. **Loader scope — contract + loader + one in-repo reference plugin** (Fork B).
   Build the manifest contract, a `registerPlugin()` runtime API mirroring
   `registerBlock`, and a loader composing registered manifests against
   `site_plugins`. AR distribution documented; dynamic `@anchorcorps/plugin-*`
   discovery deferred to first-real-plugin. → **D-045**.
3. **Test-isolation hardening first** (Fork C) — split the root vitest project
   into `node` + `jsdom` sub-projects so they never share a fork; kills the
   FLAKE-RESOLVESITE warm-cache class before 7.5 piles on more DB tests.
4. **Block registration — global + namespaced, per-site availability.** Plugin
   blocks register into the one global registry at boot under a namespaced type
   (`<plugin>/<block>`); per-site *availability* (editor palette, route
   mounting, render gating) is driven by `site_plugins` / `req.site.plugins`.
   → **D-045**.
5. **Config UI — Zod-driven form** (reuse `src/editor/zod-fields.ts` field
   generation), NOT the full Puck editor. Plugin config is a flat form from the
   plugin's `configSchema`.
6. **Plugin migrations (v1) — standard `migrate:up` run, `plg_<name>_` table
   prefix.** Plugins own/prefix their tables and must NOT alter core tables
   (D-016). A per-install dynamic migration runner is a documented future
   refinement; the loader *verifies* a plugin's tables exist before mounting.

## Tasks

- [x] **7.5.0 — Test-isolation hardening (do first).**
  Split the root `vitest.config.ts` (currently one `singleFork` node project
  that `include`s both `tests/**` and `src/**`, while 14 files use the
  `@vitest-environment jsdom` pragma → node + jsdom share one fork, the
  FLAKE-RESOLVESITE root cause). Move to two projects so node and jsdom never
  share a fork: a `node` project (server/integration, `pool:forks`+`singleFork`
  to keep DB access serialized) and a `jsdom` project (the 14 component/UI
  files). Keep the existing `packages/components` workspace project as-is. Add
  `restoreMocks`/`unstubGlobals`/`unstubEnvs`. Re-confirm the suite is green
  COLD (`rm -rf node_modules/.vite/vitest` then `npm test`) and deterministic.
  No feature code. Record the approach in the completion log; if it fully
  resolves the flake, note FLAKE-RESOLVESITE resolved.

- [x] **7.5.1 — `site_plugins` table + migration + repo.**
  New table `site_plugins` (`id` uuid PK `gen_random_uuid()`, `site_id` uuid FK
  → `sites.id` ON DELETE CASCADE, `plugin_name` text, `version` text,
  `enabled` bool default false, `config_encrypted` jsonb nullable (envelope
  `{v,iv,tag,ciphertext}`), `installed_at` timestamptz default now(),
  `updated_at` timestamptz + reuse `touch_updated_at` trigger;
  `UNIQUE(site_id, plugin_name)`; `INDEX(site_id) WHERE enabled`). Forward +
  rollback migration `db/migrations/<ts>_site_plugins.cjs`. Repo module
  `src/server/plugins/repo.ts` (pool-injected): `listSitePlugins(siteId)`,
  `getSitePlugin(siteId, name)`, `upsertSitePlugin(...)`, `setEnabled(...)`,
  `setConfig(...)`. Move `site_plugins` from "reserved" → real in
  `docs/data-model.md`. Unit + integration tests.

- [x] **7.5.2 — Plugin manifest contract + `registerPlugin()` registry.**
  `src/server/plugins/manifest.ts` — Zod-typed `PluginManifest`:
  `{ name (kebab, unique), version (semver), blocks?: BlockRegistryEntry[]
  keyed by namespaced type, createRouter?: (ctx) => express.Router,
  migrations?: { tables: string[] } (the plg_<name>_ tables it owns),
  configSchema?: ZodTypeAny, secretConfigKeys?: string[], requiredEnv?:
  string[] }`. `src/server/plugins/registry.ts` — `registerPlugin(manifest)` /
  `getPlugin(name)` / `listPlugins()`, mirroring the block registry (global
  Map, uniqueness-enforced, `__resetPluginsForTests`). Unit tests for the
  schema + registry.

- [x] **7.5.3 — Per-site config encryption helper (D-044, Fork A).**
  `src/server/plugins/crypto.ts` — `encryptConfig(plaintextObj)` /
  `decryptConfig(envelope)` using `node:crypto` AES-256-GCM. Key resolved from
  `PLUGIN_CONFIG_ENC_KEY` (base64 32 bytes); a dev/test key is generated/used
  when unset in non-prod, and the helper throws in production if the env is
  missing (never silently downgrades). Authenticated (GCM tag) so tampered
  ciphertext fails closed. Only `secretConfigKeys` fields are encrypted;
  non-secret config stays plaintext for queryability. Never logs plaintext.
  Round-trip + tamper-detection + missing-key unit tests.

- [x] **7.5.4 — Plugin loader / boot composition.**
  `src/server/plugins/loader.ts` — `loadPlugins({ app, pool })` called from the
  boot path: for every registered plugin, register its blocks into the global
  registry (namespaced types); mount its router at `/api/plugins/<name>`
  (router exists once globally; per-site enablement is checked inside via
  `req.site.plugins`); verify its declared `plg_<name>_` tables exist (fail-soft
  + structured log if a plugin's migration hasn't run — skip mounting, don't
  crash boot); validate `requiredEnv`. Idempotent (guarded so repeated boots /
  tests don't double-register). Wired into `createApp()` (routers) and the
  block registration into the existing import-time path. Integration tests with
  the reference plugin (7.5.7).

- [x] **7.5.5 — Populate `req.site.plugins` from `site_plugins`.**
  Replace the hardcoded `plugins: []` in `resolveSite.ts` with the enabled
  plugins for the resolved site (`name` + `version` per `PluginInstance`),
  fetched in the same lookup and cached with the site (respecting the 60s TTL).
  `evictSiteCache(host)` already exists — call it from the enable/disable path
  (7.5.6) so toggles take effect without waiting out the TTL. Integration tests
  asserting enabled plugins appear and disabled ones don't.

- [ ] **7.5.6 — Admin plugins API.**
  `src/server/routes/plugins.ts`, mounted under `/api`, `requireAdmin`-gated:
  - `GET /api/plugins` — list registered/available plugins (name, version,
    config schema shape, required env).
  - `GET /api/sites/:siteId/plugins` — per-site install/enable state (config
    returned with secret fields **redacted**, never decrypted to the client).
  - `PUT /api/sites/:siteId/plugins/:name` — install/enable/disable + set
    config: validate config against the plugin's `configSchema`, encrypt
    `secretConfigKeys`, upsert `site_plugins`, evict the site's resolve cache.
  Idempotent. Supertest coverage incl. validation failure + redaction.

- [ ] **7.5.7 — Reference plugin (proves the contract).**
  In-repo `@anchorcorps/plugin-example` (a `packages/plugin-example/` workspace,
  or `src/server/plugins/example/` if lighter) exercising EVERY manifest field:
  one `ac-`-prefixed block (`example/banner`), a `createRouter` exposing
  `GET /api/plugins/example/ping` (gated by site enablement), a migration
  creating `plg_example_notes`, a `configSchema` with one normal + one secret
  field (`api_key`), and a `requiredEnv` entry. Registered via
  `registerPlugin`. This is the end-to-end test target for 7.5.4–7.5.6.

- [ ] **7.5.8 — Studio Plugins tab.**
  New "Plugins" tab on Site Detail (`src/admin/pages/site-tabs/PluginsTab.tsx`):
  list available plugins, enable/disable toggle, and a config form generated
  from the plugin's Zod `configSchema` (reuse `zod-fields.ts` field generation;
  secret fields render as password inputs, show "set/unset" not the value).
  Save → admin API (7.5.6). jsdom tests with fetch mocked; Puck stubbed per
  D-036 (not used here, but keep the test env consistent). No visual claims —
  operator QA at studio.localhost:3000.

- [ ] **7.5.9 — Packaging/distribution + docs.**
  Document + scaffold how a plugin builds/publishes to Artifact Registry like
  `@anchorcorps/components` (tsup build, `manifest` as the package entry, semver
  tags). Provide a thin documented seam for future dynamic discovery of
  installed `@anchorcorps/plugin-*` packages (the loader currently composes
  explicitly-registered manifests). `docs/plugins.md`: manifest contract,
  lifecycle (publish → install → enable → configure), config + secret handling,
  migration ordering/prefix rule, block namespacing, security notes.

- [ ] **7.5.10 — Phase wrap.**
  `npm run typecheck` clean + full COLD suite green + deterministic. Tick the
  PLAN.md Phase 7.5 box. Update STATE (`current_task=null`, test counts,
  followups). DEMO-LOG entry (Studio Plugins tab + reference plugin enable/
  disable). Confirm with the operator before the phase's first prod-deploying
  push (CI auto-deploys on push to main, D-035 — the `site_plugins` migration
  runs in the migrate step). STOP at the 7.5→8 boundary.

## Completion log

<!-- Routine appends timestamped entries below as tasks complete -->

### 2026-05-26 09:06 UTC — Task 7.5.0
**Commit:** 9b0f299
**Done:** Split the root vitest project into isolated `node` + `jsdom` projects
so the two environments never share a worker fork (root cause of the
FLAKE-RESOLVESITE class). `vitest.workspace.ts` now defines `node` (server/
integration/smoke + pure-logic unit tests, `singleFork` to serialize test-DB
access) and `jsdom` (`src/admin/**` + the 3 editor component tests), plus the
unchanged `@anchorcorps/components` project. Added `restoreMocks` +
`unstubGlobals` + `unstubEnvs` to both as defense-in-depth. Deleted the
superseded `vitest.config.ts` (was only referenced by the workspace).
**Tests added:** 0 (test-infra change). Suite unchanged at 451/66; ran COLD =
green; node project run 3× WARM = 325/42 green every time with no `/healthz`
403 (the flake's signature). Typecheck clean.
**Next:** 7.5.1 — `site_plugins` table + migration + repo.
**Notes:** FLAKE-RESOLVESITE class considered RESOLVED — the node↔jsdom
cross-fork global-state leak is now structurally impossible (separate pools).
Suite is also ~35% faster (projects run in parallel). Block/jsdom file
membership is glob-driven in `vitest.workspace.ts`; new Studio/editor UI tests
under `src/admin/**` or `src/editor/custom-fields/**` land in jsdom
automatically.

### 2026-05-26 09:12 UTC — Task 7.5.1
**Commit:** 3516351
**Done:** `site_plugins` table (D-016, refined by D-044): `db/migrations/
1747575000000_site_plugins.cjs` (forward+rollback verified up/down/up on dev) —
`(site_id FK CASCADE, plugin_name, version, enabled, config jsonb, config_
encrypted jsonb, installed_at, updated_at)`, `UNIQUE(site_id, plugin_name)`,
partial `INDEX(site_id) WHERE enabled`, `touch_updated_at` trigger. Pool-
injected repo `src/server/plugins/repo.ts` (`upsertSitePlugin`,
`listSitePlugins`, `getSitePlugin`, `getEnabledPlugins`, `setEnabled`,
`setConfig` + `EncryptedEnvelope`/`SitePluginRow` types). Config split into
plaintext `config` + encrypted `config_encrypted` (D-044). `docs/data-model.md`
updated (site_plugins reserved → real). Recorded **D-044** (config storage +
secret crypto) and **D-045** (manifest contract + loader scope + distribution).
**Tests added:** 8 (`tests/integration/site-plugins-repo.test.ts`) — install
defaults, idempotent upsert/full-state update, get/null, enabled-only filter,
setEnabled/setConfig incl. clearing secrets + no-op on uninstalled, per-site
scoping, unique-constraint violation, CASCADE on site delete.
**Next:** 7.5.2 — plugin manifest contract + `registerPlugin()` registry.
**Notes:** 459/67 green cold; typecheck clean. Repo stays crypto-agnostic
(treats `config_encrypted` as opaque); the route layer (7.5.6) owns
encrypt/redact via the manifest's `secretConfigKeys`.

### 2026-05-26 09:16 UTC — Task 7.5.2
**Commit:** 68a5b52
**Done:** Manifest contract `src/server/plugins/manifest.ts` — `PluginManifest`
type (name, version, blocks, createRouter, migrations.tables, configSchema,
secretConfigKeys, requiredEnv), `pluginMetaSchema` (Zod for the serializable
metadata), `validatePluginManifest()` (Zod meta + structural rules Zod can't
express: block-type namespacing `<name>/`, table prefix `plg_<name>_`,
secretConfigKeys ⊆ ZodObject configSchema, UPPER_SNAKE env, function
createRouter), and `pluginTablePrefix`/`pluginBlockPrefix` helpers. Runtime
registry `src/server/plugins/registry.ts` — `registerPlugin` (validates +
uniqueness), `getPlugin`/`listPlugins`/`hasPlugin`/`__resetPluginsForTests`,
mirroring the block registry. Per D-045.
**Tests added:** 14 (`manifest.test.ts` ×10 — prefixes, valid manifest, and
each rejection path; `registry.test.ts` ×4 — register/read, duplicate throw,
invalid-manifest throw, reset).
**Next:** 7.5.3 — per-site config encryption helper (AES-256-GCM, D-044).
**Notes:** 473 total; typecheck clean. Manifest holds live values (components,
router factory, Zod schema) so it's intentionally only partly Zod-validated.

### 2026-05-26 09:18 UTC — Task 7.5.3
**Commit:** 77a3279
**Done:** `src/server/plugins/crypto.ts` — `encryptConfig`/`decryptConfig`
(AES-256-GCM via `node:crypto`, envelope `{v:1,iv,tag,ciphertext}` base64) +
`isConfigKeyConfigured()`. Key from `PLUGIN_CONFIG_ENC_KEY` (base64 32 bytes);
production REQUIRES it (throws if missing/wrong-length, never downgrades);
non-prod falls back to a deterministic sha256 dev key (warns once) so local/
tests work without provisioning a secret. GCM tag → tampered ciphertext/tag
fails closed. D-044.
**Tests added:** 7 (`crypto.test.ts`) — round-trip, tampered ciphertext,
tampered tag, unsupported version, prod-requires-key + isConfigKeyConfigured,
explicit prod key round-trip, wrong key length. Uses `vi.stubEnv` (auto-reset
via the workspace's `unstubEnvs`).
**Next:** 7.5.4 — plugin loader / boot composition.
**Notes:** 480 total; typecheck clean. Repo stays opaque to crypto; route layer
(7.5.6) splits secret vs non-secret via the manifest `secretConfigKeys`, calls
`encryptConfig` on the secret subset.

### 2026-05-26 09:23 UTC — Task 7.5.4
**Commit:** 0cfb0ce
**Done:** `src/server/plugins/loader.ts` — two phases kept separate so
`createApp` stays sync: `verifyPluginMigrations(pool)` (ASYNC, boot) checks each
plugin's `requiredEnv` + declared `plg_<name>_` tables exist via
`information_schema`, returns `{active, skipped:{name,reason}}` (fail-soft, never
crashes boot); `loadPlugins(app, {only})` (SYNC) registers each active plugin's
namespaced blocks (guarded by `hasBlock` → idempotent) + mounts its router at
`/api/plugins/<name>`. Wired into `createApp({activePlugins})` BEFORE the
catch-all `pageRouter`; `src/server/index.ts` boot now verifies plugins (logs
skips) and passes the active set. Per-site enablement is enforced inside plugin
routers (next tasks), not at mount. D-045.
**Tests added:** 5 (`tests/integration/plugin-loader.test.ts`) — verify
active/skipped (missing tables, missing env), loadPlugins registers block +
mounts router (supertest), idempotent re-load, `only` filter, createApp mounts
plugin routes before the renderer. Uses the reset+re-register-core registry
pattern for determinism.
**Next:** 7.5.5 — populate `req.site.plugins` from `site_plugins`.
**Notes:** 485/71 green cold; typecheck clean. createApp gained an optional
`activePlugins` arg (default = all registered) — existing call sites unchanged.

### 2026-05-26 09:26 UTC — Task 7.5.5
**Commit:** 1bae6e6
**Done:** `resolveSite` now populates `req.site.plugins` with the resolved
site's ENABLED plugins (`{name, version}`). Fetched in the SAME query as the
site lookup via a `json_agg` subquery over `site_plugins` (one round-trip per
cache miss — the resolve path is hot), cached with the site for the 60s TTL.
`evictSiteCache(host)` (already exists) is the toggle path: the plugins admin
route (7.5.6) calls it so enable/disable takes effect without waiting out the
TTL. Disabled plugins never appear.
**Tests added:** 3 (`tests/integration/resolveSite-plugins.test.ts`) — no
plugins, enabled-included/disabled-excluded, disable-after-evict reflects.
**Next:** 7.5.6 — admin plugins API.
**Notes:** 488/72 green cold; typecheck clean. Chose the single-query
json_agg over a second `getEnabledPlugins` call so the existing resolveSite
query-count caching test stays valid AND the hot path stays at one query.
