# Data-Model Audit — Lovable-for-Websites (anchor-sites)

Slice: the entire data model. Scope: `db/migrations/*.cjs` (19 files), `db/seed.ts`, `db/seed-templates.ts`, cross-checked against every consumer in `src/`. Static analysis only; no DB connection.

Date: 2026-07-30. Branch: feat/lovable-workspace @ 8a379aa.

---

## 1. Census (mechanical — regenerable from the migration files)

Migration order: `1747570000000_init` → `1747604000000_template_gallery` (19 migrations, no `migrations/` subdir beyond `db/migrations/` itself).

### 1.1 Extensions / functions / triggers

| Unit | Defined in |
|---|---|
| extension `pgcrypto` | 1747570000000_init.cjs |
| function `touch_updated_at()` (plpgsql BEFORE UPDATE trigger fn) | 1747571000000 |
| trigger `pages_touch_updated_at` | 1747571000000 |
| trigger `templates_touch_updated_at` | 1747574000000 |
| trigger `site_plugins_touch_updated_at` | 1747575000000 |
| trigger `tenant_auth_config_touch_updated_at` | 1747578000000 |
| trigger `posts_touch_updated_at` | 1747579000000 |
| trigger `events_touch_updated_at` | 1747580000000 |
| (runtime) `pgboss.*` schema — created lazily by pg-boss at boot (src/server/jobs/index.ts); job rows live outside our migrations | n/a |

Deliberately trigger-less `updated_at` tables: `ai_conversations` (explicit bump in repo.ts appendMessage), `site_git_state` (explicit bump in state-repo.ts) — rationale documented in both migrations.

### 1.2 Tables and columns (23 tables, 203 columns)

**sites** (1747571000000; + seo_defaults 1747582000000; + ctm/crm 1747583000000; + analytics_disabled 1747600000000)
| Column | Type / default / constraint |
|---|---|
| id | uuid PK default gen_random_uuid() |
| slug | text NOT NULL UNIQUE |
| display_name | text NOT NULL |
| status | text NOT NULL default 'active' CHECK IN ('active','archived','suspended') |
| default_brand_tokens | jsonb NOT NULL default '{}' |
| created_at | timestamptz NOT NULL default now() |
| seo_defaults | jsonb NOT NULL default '{}' |
| ctm_account_id | text NULL |
| crm_site_id | text NULL |
| analytics_disabled | boolean NOT NULL default false |

**site_domains** (1747571000000)
| Column | Type |
|---|---|
| id | uuid PK gen_random_uuid() |
| site_id | uuid NOT NULL FK→sites ON DELETE CASCADE |
| hostname | text NOT NULL UNIQUE |
| is_primary | boolean NOT NULL default false |
| verification_status | text NOT NULL default 'pending' CHECK IN ('pending','verified','failed') |
| ssl_status | text NOT NULL default 'pending' CHECK IN ('pending','active','failed') |
| created_at | timestamptz NOT NULL now() |

**pages** (1747571000000; + brand_tokens_override 1747572000000)
| Column | Type |
|---|---|
| id | uuid PK gen_random_uuid() |
| site_id | uuid NOT NULL FK→sites CASCADE |
| slug | text NOT NULL (unique per site) |
| title | text NOT NULL |
| blocks | jsonb NOT NULL default '[]' |
| seo | jsonb NOT NULL default '{}' |
| status | text NOT NULL default 'draft' CHECK IN ('draft','published') |
| published_at | timestamptz NULL |
| created_at / updated_at | timestamptz NOT NULL now() (trigger-maintained) |
| brand_tokens_override | jsonb NULL |

**page_revisions** (1747571000000)
| Column | Type |
|---|---|
| id | uuid PK gen_random_uuid() |
| page_id | uuid NOT NULL FK→pages CASCADE |
| blocks | jsonb NOT NULL |
| seo | jsonb NOT NULL default '{}' |
| author_id | uuid NULL — no FK ("until Phase 8 lands an auth_users table") |
| source | text NOT NULL default 'manual' — free string, no CHECK |
| created_at | timestamptz NOT NULL now() |

**media_assets** (1747573000000)
| Column | Type |
|---|---|
| id | uuid PK gen_random_uuid() |
| site_id | uuid NOT NULL FK→sites CASCADE |
| gcs_key | text NOT NULL UNIQUE |
| content_type | text NOT NULL |
| alt | text NOT NULL default '' |
| focal_point | jsonb NULL ({x:0-1, y:0-1}) |
| variants_status | text NOT NULL default 'pending' CHECK IN ('pending','processing','ready','failed') |
| variants | jsonb NULL ([{name,format,width,height,url}]) |
| original_bytes | bigint NULL |
| width / height | integer NULL |
| created_at | timestamptz NOT NULL now() |
| processed_at | timestamptz NULL |
| archived_at | timestamptz NULL |
| last_error | text NULL |

**templates** (1747574000000; + category/cover_image_url/sort_order 1747604000000)
| Column | Type |
|---|---|
| id | uuid PK gen_random_uuid() |
| slug | text NOT NULL UNIQUE |
| name | text NOT NULL |
| description | text NULL |
| source_site_id | uuid NULL FK→sites ON DELETE SET NULL |
| kind | text NOT NULL default 'site' CHECK IN ('site','page') |
| brand_tokens | jsonb NOT NULL default '{}' |
| status | text NOT NULL default 'active' CHECK IN ('active','archived') |
| created_at / updated_at | timestamptz NOT NULL now() (trigger) |
| category | text NULL |
| cover_image_url | text NULL |
| sort_order | integer NOT NULL default 0 |

**template_pages** (1747574000000)
| Column | Type |
|---|---|
| id | uuid PK gen_random_uuid() |
| template_id | uuid NOT NULL FK→templates CASCADE |
| slug / title | text NOT NULL (slug unique per template) |
| blocks | jsonb NOT NULL default '[]' |
| seo | jsonb NOT NULL default '{}' |
| sort_order | integer NOT NULL default 0 |
| created_at | timestamptz NOT NULL now() |

**site_plugins** (1747575000000)
| Column | Type |
|---|---|
| id | uuid PK gen_random_uuid() |
| site_id | uuid NOT NULL FK→sites CASCADE |
| plugin_name | text NOT NULL (unique per site) |
| version | text NOT NULL |
| enabled | boolean NOT NULL default false |
| config | jsonb NOT NULL default '{}' (non-secret) |
| config_encrypted | jsonb NULL (AES-256-GCM envelope {v,iv,tag,ciphertext}) |
| installed_at / updated_at | timestamptz NOT NULL now() (trigger on updated_at) |

**plg_example_notes** (1747576000000) — id uuid PK, site_id uuid NOT NULL FK→sites CASCADE, note text NOT NULL, created_at timestamptz NOT NULL now().

**auth_user / auth_session / auth_account / auth_verification** (1747577000000 — Studio Better-auth, camelCase columns by design):
- auth_user: id text PK, name text NN, email text NN UNIQUE, emailVerified bool NN default false, image text, createdAt/updatedAt timestamptz NN now().
- auth_session: id text PK, expiresAt timestamptz NN, token text NN UNIQUE, createdAt/updatedAt, ipAddress text, userAgent text, userId text NN FK→auth_user CASCADE.
- auth_account: id text PK, accountId NN, providerId NN, userId NN FK→auth_user CASCADE, accessToken, refreshToken, idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt/updatedAt.
- auth_verification: id text PK, identifier NN, value NN, expiresAt NN, createdAt/updatedAt.

**tenant_auth_user / _session / _account / _verification / _config** (1747578000000 — per-site tenant auth; same shape + `site_id uuid NN FK→sites CASCADE` on every table):
- tenant_auth_user: + UNIQUE(site_id, email) — per-site email uniqueness (vs global on auth_user).
- tenant_auth_session: token UNIQUE (global), userId FK→tenant_auth_user CASCADE.
- tenant_auth_account: UNIQUE(site_id, providerId, accountId), userId FK→tenant_auth_user CASCADE.
- tenant_auth_verification: identifier/value/expiresAt as studio.
- tenant_auth_config: site_id uuid PK FK→sites CASCADE, providers jsonb NN default '{}', created_at/updated_at (trigger).

**posts** (1747579000000; + seo 1747581000000)
| Column | Type |
|---|---|
| id | uuid PK gen_random_uuid() |
| site_id | uuid NN FK→sites CASCADE |
| slug / title | text NN (slug unique per site) |
| excerpt | text NULL |
| body | jsonb NN default '[]' (Block[]) |
| status | text NN default 'draft' CHECK IN ('draft','published') |
| published_at | timestamptz NULL |
| author_id | text NULL FK→tenant_auth_user ON DELETE SET NULL |
| created_at / updated_at | timestamptz NN now() (trigger) |
| seo | jsonb NN default '{}' |

**events** (1747580000000; + seo 1747581000000)
| Column | Type |
|---|---|
| id | uuid PK gen_random_uuid() |
| site_id | uuid NN FK→sites CASCADE |
| slug / title | text NN (slug unique per site) |
| description | jsonb NN default '[]' (Block[]) |
| starts_at | timestamptz NN |
| ends_at | timestamptz NULL |
| location | text NULL |
| status | text NN default 'draft' CHECK IN ('draft','published') |
| created_at / updated_at | timestamptz NN now() (trigger) |
| seo | jsonb NN default '{}' |

**ai_conversations** (1747601000000; status CHECK widened 1747602000000)
| Column | Type |
|---|---|
| id | uuid PK gen_random_uuid() |
| site_id | uuid NN FK→sites CASCADE |
| title | text NN default 'New conversation' |
| status | text NN default 'active' CHECK IN ('active','error','archived','running') |
| token_usage | jsonb NN default '{}' |
| created_at / updated_at | timestamptz NN now() (NO trigger — explicit bumps) |

**ai_messages** (1747601000000) — id uuid PK, conversation_id uuid NN FK→ai_conversations CASCADE, role text NN CHECK IN ('user','assistant','tool'), content jsonb NN (raw Anthropic content blocks), created_at timestamptz NN now().

**site_git_state** (1747603000000) — site_id uuid PK FK→sites CASCADE, enabled bool NN default false, last_export_sha text, last_import_sha text, last_synced_at timestamptz, last_error text, updated_at timestamptz NN now() (NO trigger — explicit bumps).

### 1.3 Status / enum values (30 — each a state-machine node)

| Field | Values |
|---|---|
| sites.status | active, archived, suspended |
| site_domains.verification_status | pending, verified, failed |
| site_domains.ssl_status | pending, active, failed |
| pages.status | draft, published |
| media_assets.variants_status | pending, processing, ready, failed |
| templates.kind | site, page |
| templates.status | active, archived |
| posts.status | draft, published |
| events.status | draft, published |
| ai_conversations.status | active, error, archived, running |
| ai_messages.role | user, assistant, tool |

### 1.4 JSONB fields and their shape authorities (21)

| Field | Shape / validator |
|---|---|
| sites.default_brand_tokens | `brandTokensSchema` — src/blocks/brand-tokens.ts (`--theme-<kebab>` → CSS color/var) |
| sites.seo_defaults | site SEO defaults schema — src/server/seo/schema.ts (titleTemplate, defaultDescription, defaultOgImageAssetId, twitterHandle) |
| pages.blocks | Block[] — registry validator, src/blocks/validate.ts + registry.ts |
| pages.seo | `seoFieldsSchema` — src/server/seo/schema.ts (title, description, canonical, robots{index,follow}, og{title,description,imageAssetId}, twitter{card}); field-tolerant `.catch()` design |
| pages.brand_tokens_override | `brandTokensSchema` (NULL = inherit) |
| page_revisions.blocks / .seo | same as pages (snapshot) |
| media_assets.focal_point | {x:0-1, y:0-1} — zod in src/server/routes/media.ts |
| media_assets.variants | ProcessedVariant[] — src/server/media/variant-spec.ts ({name: thumbnail/sm/md/lg/2x, format: webp/jpg, width, height, url}) |
| templates.brand_tokens | `brandTokensSchema` |
| template_pages.blocks / .seo | Block[] / seoFieldsSchema (validated at seed + capture, db/seed-templates.ts + templates/repo.ts) |
| site_plugins.config | per-plugin manifest config schema — src/server/plugins/manifest.ts |
| site_plugins.config_encrypted | `EncryptedEnvelope {v, iv, tag, ciphertext}` — src/server/plugins/crypto.ts (v = rotation version) |
| tenant_auth_config.providers | `providersSchema` `{emailPassword?: boolean}.strict()` — src/server/routes/admin-tenant.ts:59 |
| posts.body / posts.seo | Block[] / seoFieldsSchema — src/server/blog/schema.ts |
| events.description / events.seo | Block[] / seoFieldsSchema — src/server/events/schema.ts |
| ai_conversations.token_usage | `Record<YYYY-MM-DD, {input, output}>` — TS type only in src/server/ai/agent/repo.ts (no zod) |
| ai_messages.content | raw Anthropic content-block array — intentionally unvalidated for lossless replay (migration header) |

### 1.5 Indexes (36 = 22 explicit + 14 unique constraints/uniques)

Explicit: site_domains(site_id); pages(site_id,status); pages(blocks) GIN; page_revisions(page_id,created_at); media_assets_site_created_idx(site_id,created_at); templates(kind,status); template_pages(template_id,sort_order); template_pages(blocks) GIN; site_plugins_enabled_idx(site_id) WHERE enabled (partial); plg_example_notes(site_id,created_at); auth_session_user_idx(userId); auth_account_user_idx(userId); auth_account_provider_idx(providerId,accountId); auth_verification_identifier_idx(identifier); tenant_auth_session_site_user_idx(site_id,userId); tenant_auth_account_site_user_idx(site_id,userId); tenant_auth_verification_site_identifier_idx(site_id,identifier); posts_body_gin(body) GIN; posts_site_status_idx(site_id,status,published_at); events_site_starts_idx(site_id,starts_at); ai_conversations_site_idx(site_id,updated_at); ai_messages_conv_idx(conversation_id,created_at,id).

Unique: sites.slug; site_domains.hostname; pages(site_id,slug); templates.slug; template_pages(template_id,slug); site_plugins(site_id,plugin_name); posts(site_id,slug); events(site_id,slug); auth_user.email; auth_session.token; tenant_auth_user(site_id,email); tenant_auth_session.token; tenant_auth_account(site_id,providerId,accountId); media_assets.gcs_key.

### 1.6 Foreign keys (23)

| FK | ON DELETE |
|---|---|
| site_domains.site_id → sites | CASCADE |
| pages.site_id → sites | CASCADE |
| page_revisions.page_id → pages | CASCADE |
| media_assets.site_id → sites | CASCADE |
| templates.source_site_id → sites | SET NULL |
| template_pages.template_id → templates | CASCADE |
| site_plugins.site_id → sites | CASCADE |
| plg_example_notes.site_id → sites | CASCADE |
| auth_session.userId → auth_user | CASCADE |
| auth_account.userId → auth_user | CASCADE |
| tenant_auth_user.site_id → sites | CASCADE |
| tenant_auth_session.site_id → sites | CASCADE |
| tenant_auth_session.userId → tenant_auth_user | CASCADE |
| tenant_auth_account.site_id → sites | CASCADE |
| tenant_auth_account.userId → tenant_auth_user | CASCADE |
| tenant_auth_verification.site_id → sites | CASCADE |
| tenant_auth_config.site_id → sites | CASCADE |
| posts.site_id → sites | CASCADE |
| posts.author_id → tenant_auth_user | SET NULL |
| events.site_id → sites | CASCADE |
| ai_conversations.site_id → sites | CASCADE |
| ai_messages.conversation_id → ai_conversations | CASCADE |
| site_git_state.site_id → sites | CASCADE |

(page_revisions.author_id has NO FK — deliberate deferral in the migration comment, never landed. auth_verification / tenant_auth_verification have no user FK — better-auth design, keyed by identifier.)

### 1.7 Seeds (2)

- **db/seed.ts** — 2 sites (muldoon-dental, demo-site) + pages + domains. Transactional, idempotent-ish: sites upsert refreshes display_name only; pages fully refresh; domains `ON CONFLICT DO NOTHING` and are inserted `verification_status='verified', ssl_status='active'` unconditionally. Sweeps two legacy hostname schemes by exact match.
- **db/seed-templates.ts** — seeds `allTemplates` from db/templates/*.ts; validates blocks against the registry pre-insert; cover ingestion via the real media pipeline hung off a reserved system site (`__system-templates`, status='archived', excluded from admin list by slug); skips re-ingest when cover_image_url already set; documented accumulation risk on manual re-null.

Census unit count M = 23 tables + 203 columns + 30 status values + 21 JSONB shapes + 36 indexes + 23 FKs + 9 misc (1 extension, 1 function, 6 triggers, 1 pgboss runtime schema) + 2 seeds = **347 units**.

---

## 2. Lens ledger

Lenses (20): 1 Terminality · 2 Structure/Grain · 3 Organization · 4 Provenance→Consumption · 5 Comprehension · 6 State-Visibility · 7 Honesty · 8 Reversibility/Safety · 9 Idempotence/Accretion · 10 Failure/Recovery · 11 Precondition/Forward-path · 12 Population/Dark · 13 Sibling-Coherence · 14 Gating-Axis · 15 Temporal-Integrity · 16 Cost/Value · 17 Contract-Stability · 18 Naming · 19 Multi-tenant-isolation · 20 Retention/Privacy.

**Encoding (complete, no blank cells):** every one of the 347 units carries one cell per lens (6,940 cells). Applicability is fixed per unit class; every applicable cell is **pass** unless a D### is recorded against that unit+lens below; every non-applicable cell is **n-a**. This section therefore enumerates all cells.

Applicable lens sets by unit class:
- **Table** (23 units): all 20 lenses applicable.
- **Column** (203): 2,3,4,5,7,12,13,15,16,17,18,20 applicable (12); rest n-a (state-machine behavior is audited on the owning table / status-value units).
- **Status value** (30): 1,6,7,10,12,14,17,18 applicable (8); rest n-a.
- **JSONB shape** (21): 2,3,5,7,9,12,13,17,18,20 applicable (10); rest n-a.
- **Index** (36): 3,5,16,18,19 applicable (5); rest n-a.
- **FK** (23): 5,8,13,18,19 applicable (5); rest n-a.
- **Misc** (9): 5,15,16,18 applicable (4); rest n-a.
- **Seed** (2): 5,7,9,11,12,20 applicable (6); rest n-a.

n-a cells Q = 203×8 + 30×12 + 21×10 + 36×15 + 23×15 + 9×16 + 2×14 = **3,251**. Applicable cells = 3,689. Directive-flagged cells = **46** (listed below). Pass cells P = 3,689 − 46 = **3,643**.

### 2.1 Deviations by unit (everything not listed here is pass / n-a per the class rule)

**sites (table)** — Term: D500 · Hon: D502 · Temp: D503 · Fail: D528 · StVis: D528 · Priv: D523. All other lenses pass (Tenant: n/a-by-nature — it's the tenant root; treated pass).
- sites.status value `active`: pass all applicable.
- sites.status value `archived`: Hon D502, Pop D502 (only writer is the system-site hack).
- sites.status value `suspended`: Pop D501 (zero writers anywhere in src/).
- sites.published columns (slug, display_name, default_brand_tokens, seo_defaults, ctm_account_id, crm_site_id, analytics_disabled, created_at): pass — all verified written AND read (resolveSite.ts, admin-sites.ts, crm/sync-job.ts, preview CSP path).

**site_domains (table)** — Temp: D516. Fail (value-level, below). Terminality: pass — DELETE route exists (admin-domains.ts:178) with primary-domain guard.
- verification_status `pending`: Fail D515 (strand admitted at create-site.ts:122; recovery is manual refresh only).
- ssl_status `pending`: Fail D515 (same path).
- verification_status `verified` / `failed`, ssl `active` / `failed`: pass (written by orchestrator.ts:198, admin-domains.ts:275/319, site-provision.ts:76; read by admin UI list).
- is_primary: pass (read admin-domains.ts:149, CRM sync admin-sites.ts:289).

**pages (table)** — Term: D505 (no human/admin DELETE route; only the AI tool deletes, tools/pages.ts:276). Others pass (updated_at trigger-maintained; site-scoped everywhere; publish gating on status verified in page.ts/sitemap.ts).
- pages.published_at: Prov D504, Hon D504 — written by db/seed.ts only; zero writers and zero readers in src/ (grep `published_at` excluding blog/events = empty); both publish paths (admin-pages.ts:70 save, :719 bulk publish) flip status without touching it.
- pages.status values draft/published: pass (gate verified: resolveSite + page.ts render only 'published').
- pages.blocks / seo / brand_tokens_override JSONB shapes: pass (registry-validated on every write path incl. git-import and AI tools).

**page_revisions (table)** — Accr: D506 (append-only: every save, restore, bulk-publish-per-page, template materialize, git import inserts; no pruning/retention code exists anywhere — grep prune/retention/cleanup over src/ returns nothing DB-related). Term: covered by D506 (no delete except page CASCADE).
- author_id: Pop D507 — every INSERT omits it (admin-pages.ts:194/672/729, tools/pages.ts:61/194/207, tools/settings.ts:146/159, materialize-template.ts:79, git-import.ts:323, admin-sites.ts:373); it is SELECTed into the revision-list API (admin-pages.ts:615) — always null; the "Phase 8 FK" promised in the migration never landed though Phase 8 shipped.
- source: Struct D508, Contr D508 — free string (`z.string().max(64)`, admin-pages.ts:43) while 'manual'/'ai'/'template'/'git-import' are load-bearing provenance values; no CHECK, no TS union shared with consumers.

**media_assets (table)** — Term: D511 · Accr: D513 · Pre: D509 · Fail: D509.
- gcs_key: Hon D509 — magic placeholder value `'pending'` inserted into a UNIQUE column (media.ts:135-138), replaced by a second UPDATE (media.ts:149).
- variants_status value `pending`: Fail D510 — row is created at upload-url time; a browser that never PUTs / never calls `/complete` leaves the row `pending` forever; no reaper.
- variants_status `processing`/`ready`/`failed`: pass (job transitions media-process-upload.ts:72/130/145; idempotent re-entry guard at :63; failure records last_error).
- archived_at: Pop D511 — zero references in all of src/ (write or read).
- original_bytes: Prov D512 — written (media-process-upload.ts:133), read nowhere.
- width/height/processed_at/last_error/focal_point/variants: pass (read by render-hydration.ts, media routes, admin UI).

**templates (table)** — pass on Terminality (DELETE route templates.ts:517 → soft-archive repo.ts:213; archived filtered from gallery via (kind,status) queries).
- category: Struct D526 — free-text grouping key, no enum/normalization; gallery grouping fragments on case/spelling drift.
- cover_image_url / sort_order / kind / status values: pass (all written by seed/capture, read by gallery list — repo.ts:71).
- source_site_id FK SET NULL: pass — survives source-site deletion by design.

**template_pages (table)** — pass across applicable lenses (validated blocks, CASCADE to template, unique slug per template).

**site_plugins (table)** — pass. config/config_encrypted split verified consumed (plugins/repo.ts:41, routes/plugins.ts:57-59, loader hot path repo.ts:116 reads name+version). Envelope versioned (`v`) for key rotation. Partial index matches the hot path.

**plg_example_notes (table)** — pass (dev-gated reference plugin, ENABLE_EXAMPLE_PLUGIN=false default; documented as inert-in-prod, so not dark).

**auth_user (table)** — Term: D522 — no route deletes or deactivates a Studio user; the domain/allowlist check runs at sign-in only (studio-auth.ts:101-115), so an offboarded person's user row and any live auth_session rows persist until token expiry with no operator kill switch.
**auth_session (table)** — Accr: D521 (expired rows never swept — no cron, no sweep query anywhere).
**auth_account (table)** — pass. (`password` column always-null under google-only config — accepted: schema is generated verbatim from better-auth `getAuthTables()`, documented in migration header; treated pass-with-note, not dark.)
**auth_verification (table)** — Accr: D521.

**tenant_auth_user (table)** — pass on Terminality (member DELETE routes exist, admin-tenant.ts:186/314, cascades sessions/accounts). Sib: pass — the auth_* / tenant_auth_* duplication is **justified**: different uniqueness grain (global email vs UNIQUE(site_id,email)), different provider sets, different trust domains; both migration headers document the split, and rows never mix.
**tenant_auth_session (table)** — Accr: D521. Tenant: pass (site_id on every row + site-scoped better-auth instance per req.site.id).
**tenant_auth_account (table)** — pass.
**tenant_auth_verification (table)** — Accr: D521.
**tenant_auth_config (table)** — pass (providers validated `.strict()`, default-on-absence explicit — admin-tenant.ts:380).

**posts (table)** — pass. Terminality: DELETE exists (blog/repo.ts:163, site-scoped). published_at written/read correctly (unlike pages). author_id FK SET NULL keeps posts on member deletion — intentional.
**events (table)** — Sib: D524 — no author_id while posts (the sibling content type sharing the same Block[]/status/seo pattern) records authorship; event provenance is unrecordable. Terminality: DELETE exists (events/repo.ts:176). events_site_starts_idx lacks status but tables are small — pass on Cost.

**ai_conversations (table)** — Term: D517 · StVis: D519. Status machine: claim/release verified sound (repo.ts:143-183 — atomic claim, 10-min stale takeover, conditional release that never clobbers 'error').
- status value `archived`: Pop D517 — no code path ever sets it (setConversationStatus callers pass only 'error'; no archive route among admin-ai-agent.ts:282/333/351/381/437); conversations and their messages are immortal and always listed.
- status value `running`: pass — Fail covered by the stale-takeover branch; strand risk is bounded at 10 minutes by design.
- token_usage (JSONB shape): Accr D519 — day-keyed map grows forever per conversation; only today's key is ever read (repo.ts getTodayUsage); no UI surfaces spend history.
**ai_messages (table)** — Accr: D518 · Priv: D518 (unbounded; content carries full page copy and operator prompts indefinitely).
- content (JSONB shape): Contr D529 — raw Anthropic block arrays with no version marker; an Anthropic content-block format change breaks history replay (loop.ts:130 already patches role 'tool'→'user' at read time) with no migration hook.
- role values user/assistant/tool: pass (all three written — loop.ts:237/465).

**site_git_state (table)** — pass. All six data columns verified written (state-repo.ts:37-75) and read (admin-git.ts:132/211 surface state incl. last_error; jobs gate on enabled). Explicit updated_at bumps consistent with migration rationale. One-row-per-site PK = site_id, CASCADE.

**Indexes** — all pass on Org/Compr/Tenant (tenant-scoped tables lead with site_id) except:
- pages(blocks) GIN: Cost D520.
- template_pages(blocks) GIN: Cost D520.
- posts_body_gin: Cost D520.
No JSONB containment/path query (`@>`, `jsonb_path_*`, `jsonb_each`) exists anywhere in src/ — these three GIN indexes tax every save on the hottest write paths and serve zero reads.

**FKs** — all 23 pass on Reversibility: CASCADE fans out from sites exactly as a full-tenant wipe should (verified no cross-tenant FK); the two SET NULLs (templates.source_site_id, posts.author_id) are deliberate survivorship. Note: deleting a `sites` row would also cascade-destroy tenant members, media rows (but NOT GCS objects — no delete hook) and conversations; safe only because nothing can delete a site today (D500) — flagged as the forward-path caveat inside D500's fix.

**Misc units** — touch_updated_at, 6 triggers, pgcrypto: pass. pgboss runtime schema: StVis D525 — the only queue-health surface (admin-jobs.ts:19-20) hard-codes 4 of the 7 registered queues, omitting GIT_EXPORT, GIT_IMPORT, SITE_PROVISION; job rows in those queues are invisible. (pg-boss's own archive/retention defaults manage job-row growth — Accr pass.)

**db/seed.ts** — Hon: D514 (domains seeded pre-verified) · Accr/Idem: D527 (upsert refreshes display_name but silently never brand tokens, while pages fully refresh — half-idempotent).
**db/seed-templates.ts** — pass (validates via real registry, real media pipeline, idempotence + failure modes explicitly documented, incl. the honest note that Pixabay attribution is NOT persisted — a documented accepted gap, not a hidden one).

---

## 3. Directives (D500–D529)

[D500] (sites) × (Terminality) — «Every first-class entity must have an operator-reachable terminal state». Instance: no route writes sites.status and no delete exists; patchSitePayload omits status, and admin-sites.ts even carries dead guard code for "when it lands" (src/server/routes/admin-sites.ts:305-312 comment "status not in patchSitePayload yet"). Fix-class: add status to the PATCH payload (archive only; deletion needs a GCS/CRM offboarding job first since CASCADE won't touch external state).

[D501] (sites.status:'suspended') × (Population/Dark) — «A CHECK-enum value with no writer is dead state; delete it or build it». Instance: 'suspended' appears only in the CHECK (1747571000000:36) and UI types (src/admin/lib/siteTypes.ts:1); zero writers in src/. Fix-class: drop from CHECK+types, or implement suspension semantics in resolveSite.

[D502] (sites.status:'archived') × (Honesty) — «Do not overload a lifecycle state as a type marker». Instance: the ONLY writer of 'archived' is ensureSystemTemplatesSite creating the reserved cover-assets site (src/server/templates/system-site.ts:44-49), with a slug special-case exclusion patched into the admin list query. Fix-class: `is_system boolean` (or kind) column; free 'archived' for real archival (D500).

[D503] (sites) × (Temporal-Integrity) — «Mutable rows carry updated_at». Instance: sites has only created_at (1747571000000:28-40) yet PATCH mutates display_name/tokens/seo/ctm/analytics (admin-sites.ts:239) — no audit timestamp. Fix-class: add updated_at + reuse touch_updated_at trigger.

[D504] (pages.published_at) × (Provenance→Consumption + Honesty) — «A timestamp column both publish paths skip is a lie, not data». Instance: no writer and no reader in src/ (grep empty); page save (admin-pages.ts:70) and bulk publish (admin-pages.ts:719-722) set status='published' without it; only db/seed.ts populates it. Fix-class: set it in both publish paths (CASE like seed.ts) or drop the column.

[D505] (pages) × (Terminality) — «Human surface must reach every terminal state the AI surface can». Instance: pages are deletable only via the agent tool (src/server/ai/agent/tools/pages.ts:276); no admin DELETE route exists (admin-pages.ts route list). Fix-class: DELETE /sites/:siteId/pages/:pageId reusing the tool's transaction pattern.

[D506] (page_revisions) × (Idempotence/Accretion) — «Append-only history requires a retention policy at birth». Instance: 10 insert sites (saves, restores, per-page rows on every bulk publish — admin-pages.ts:729, template materialize, git import), zero pruning code anywhere. Fix-class: retention job keeping last N revisions per page (N≈50) + age cap.

[D507] (page_revisions.author_id) × (Population/Dark) — «A column surfaced to the UI must have a writer». Instance: every INSERT omits author_id yet the revision-list API returns it (admin-pages.ts:615) — permanently null; the migration's "FK once Phase 8 lands" (1747571000000:113-115) never landed though Phase 8 shipped requireAdmin's studioUser. Fix-class: write req.studioUser.id (type change uuid→text to match auth_user.id) + FK, or drop the column.

[D508] (page_revisions.source) × (Contract-Stability + Structure) — «Load-bearing provenance values are enums, not free strings». Instance: `source: z.string().max(64)` (admin-pages.ts:43) while 'manual'/'ai'/'template'/'git-import' are semantically distinct writers scattered across 6 files; no CHECK, no shared union. Fix-class: CHECK constraint + exported TS union consumed by all insert sites.

[D509] (media_assets upload-url flow) × (Precondition/Failure + Honesty) — «Never insert a shared magic placeholder into a UNIQUE column». Instance: `INSERT ... VALUES ($1, 'pending', ...)` into UNIQUE gcs_key then a second UPDATE with the id-derived key (src/server/routes/media.ts:135-149); two concurrent upload-url calls collide with unique_violation (500), and a crash between the two statements strands a 'pending'-keyed row that blocks ALL future uploads platform-wide. Fix-class: single INSERT with the key derived in-statement (`'originals/' || $1 || '/' || id || '.ext'` via CTE) or pre-generate the uuid app-side.

[D510] (media_assets.variants_status:'pending') × (Failure/Recovery) — «Every non-terminal status needs a path out that doesn't require the client to behave». Instance: the row is created before the browser PUTs to GCS; abandonment leaves it 'pending' forever — no reaper, no TTL (media.ts:100-165). Fix-class: scheduled sweep deleting pending rows older than 24h with no GCS object.

[D511] (media_assets) × (Terminality) — «Media needs delete/archive; a dead archived_at column is not a lifecycle». Instance: no delete/archive route on any surface (media.ts routes are upload-url/complete/stock-search/stock-import); archived_at has zero references in src/. Fix-class: archive endpoint setting archived_at + excluding archived from listings; GCS object deletion job for hard delete.

[D512] (media_assets.original_bytes) × (Provenance→Consumption) — «Written-never-read is dark data». Instance: set by media-process-upload.ts:133, read nowhere. Fix-class: surface in admin media list (storage accounting) or stop writing.

[D513] (media_assets) × (Accretion) — «Unreferenced assets need a GC story». Instance: nothing removes assets no block references; seed-templates.ts header itself documents cover re-ingest accumulating rows under the system site. Fix-class: reference-scan sweep (blocks/seo og.imageAssetId → media ids) marking orphans past a grace period.

[D514] (db/seed.ts domains) × (Honesty) — «Seeds must not fabricate verification state». Instance: seed inserts verification_status='verified', ssl_status='active' for every hostname unconditionally (db/seed.ts:212-218). Fix-class: seed as 'pending' and let the refresh path verify (dev resolveSite doesn't read these fields, so nothing breaks).

[D515] (site_domains.verification_status/ssl_status:'pending') × (Failure/Recovery) — «Pending states need an automatic retry path». Instance: create-site.ts:122 comment concedes rows stick at 'pending' when provisioning fails; recovery is only the manual refresh endpoint (admin-domains.ts:275). Fix-class: scheduled re-verification job over rows pending > 1h.

[D516] (site_domains) × (Temporal-Integrity) — «Status-bearing rows record when the status changed». Instance: verification/ssl transitions (orchestrator.ts:198, admin-domains.ts:275/319) mutate a table whose only timestamp is created_at. Fix-class: add updated_at (+trigger) or verified_at.

[D517] (ai_conversations) × (Terminality + Population/Dark) — «'archived' in the CHECK must be writable from some surface». Instance: no route or repo call ever sets 'archived' (setConversationStatus callers: only 'error' — loop.ts:260/374/473); admin-ai-agent.ts exposes create/list/get/message/tail only — conversations are immortal and permanently listed. Fix-class: PATCH status route + hide archived in listConversations.

[D518] (ai_messages) × (Accretion + Retention/Privacy) — «Unbounded transcripts holding site content need retention». Instance: no pruning; content persists full page copy, prompts and tool results forever (repo.ts appendMessage; no delete path except conversation CASCADE — which nothing triggers, see D517/D500). Fix-class: retention window (e.g. 90d) tied to conversation archival.

[D519] (ai_conversations.token_usage) × (State-Visibility + Accretion) — «Cost data that only ever reads 'today' shouldn't accrete history nobody can see». Instance: day-keyed map grows per-day forever; sole reader is getTodayUsage (repo.ts:216); no UI or endpoint surfaces spend history. Fix-class: keep a rolling window (prune keys at write) or surface a usage endpoint.

[D520] (pages.blocks GIN, template_pages.blocks GIN, posts_body_gin) × (Cost/Value) — «An index no query uses is a pure write tax». Instance: zero JSONB containment/path queries in src/ (grep `@>`/`jsonb_path` empty) while every page/post save pays GIN maintenance on multi-KB documents. Fix-class: drop all three until a search feature needs them.

[D521] (auth_session, tenant_auth_session, auth_verification, tenant_auth_verification) × (Accretion) — «Expiring rows need a sweeper». Instance: nothing deletes rows past expiresAt (no cron/sweep anywhere in src/); dead sessions and verification tokens accumulate indefinitely (tokens-at-rest exposure too). Fix-class: scheduled `DELETE ... WHERE "expiresAt" < now() - interval '7 days'` job.

[D522] (auth_user) × (Terminality) — «Admin identities need an offboarding path». Instance: allowlist/domain check runs only at sign-in (studio-auth.ts:101-115); no route deletes/deactivates a Studio user or revokes their sessions — an offboarded employee's live session works until expiresAt. Fix-class: admin route deleting auth_user (CASCADE kills sessions/accounts).

[D523] (preview tokens in URLs) × (Retention/Privacy) — «Capability tokens must not persist in logs». Instance: pino-http logs full req.url for every request except /healthz (src/server/app.ts:71) and the preview document URL is `/api/sites/:siteId/pages/:pageId/preview?token=…` (src/server/preview-links.ts:5) — live short-lived site-scoped tokens land in pino output (known issue, confirmed). Fix-class: pino redact/serializer stripping `token`/`bridge` query params.

[D524] (events) × (Sibling-Coherence) — «Sibling content types record provenance the same way». Instance: posts carry author_id → tenant_auth_user (1747579000000:591); events — same Block[]/status/seo pattern — have no author column (1747580000000). Fix-class: nullable author_id text FK SET NULL on events.

[D525] (pgboss queues) × (State-Visibility) — «The health surface must cover every registered queue». Instance: admin-jobs.ts:19-20 hard-codes 4 queues, omitting GIT_EXPORT, GIT_IMPORT, SITE_PROVISION registered in jobs/index.ts:33-37 — their depth/failures are invisible. Fix-class: export a QUEUES array from jobs/index.ts and consume it.

[D526] (templates.category) × (Structure/Grain) — «Grouping keys are enums or normalized, never raw text». Instance: `category: { type: "text" }` (1747604000000:823) with no CHECK/lookup; gallery grouping splits on "Basic" vs "basic". Fix-class: normalize on write (lower/trim) + CHECK against the known category set.

[D527] (db/seed.ts sites upsert) × (Idempotence/Honesty) — «A seed is either fully idempotent-refresh or clearly insert-only — not silently half of each». Instance: `ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name` (db/seed.ts:170) never refreshes default_brand_tokens while pages DO fully refresh — token edits in the seed silently no-op on existing DBs. Fix-class: add default_brand_tokens to the DO UPDATE (or comment the asymmetry as intended).

[D528] (sites CRM/CTM linkage) × (Failure/Recovery + State-Visibility) — «Cross-system links need a recorded sync state». Instance: crm_site_id/ctm_account_id are bare text; failed best-effort syncs fall to console.error + a retryLimit:3 pg-boss job (admin-sites.ts:299-325) after which the failure vanishes — no last_crm_sync_at/last_crm_error anywhere. Fix-class: crm_sync_error column (or reuse a generic site_integrations row) written by the job's final failure.

[D529] (ai_messages.content) × (Contract-Stability) — «Externally-defined payloads stored verbatim need a version stamp». Instance: raw Anthropic content-block arrays with no schema/version marker (1747601000000 comment: lossless replay by design); loop.ts:130 already rewrites role 'tool'→'user' at replay time, i.e. the format has drifted once with no migration hook. Fix-class: add a `format` int column (or key inside content) defaulting to 1.

---

## 4. Brief-premise check

- "sites have NO delete/archive — a known gap": **confirmed** (D500), with the extra finding that 'archived' is already squatted on by the system-site hack (D502).
- "preview tokens in URLs land in pino logs — known": **confirmed** with exact instances (D523).
- "studio auth_* vs tenant_auth_* duplication justified?": **yes, justified** — different uniqueness grain (global vs per-site email), different provider sets, documented in both migration headers; recorded as pass, not a directive.
- Multi-tenant isolation: **pass overall** — every tenant-scoped table carries site_id; all query paths checked (pages/posts/events/media/plugins/tenant_auth/ai/site_git_state) filter by it; ai_messages is scoped transitively via a site-scoped getConversation before any message query (admin-ai-agent.ts:352-360); no cross-site leak path found in static review.
- "jobs rows" have no migration of ours: pg-boss owns `pgboss.*` with its own archive/retention defaults — growth pass, visibility directive D525.

## 5. Tally

- Census units M = **347** (23 tables, 203 columns, 30 status values, 21 JSONB shapes, 36 indexes, 23 FKs, 9 misc, 2 seeds)
- Lenses L = **20** · Cells = 347 × 20 = **6,940** — all recorded (0 blank) via the class-applicability encoding in §2
- Passes P = **3,643** · n-a Q = **3,251** · Directive-flagged cells = **46**
- Directives N = **30** (D500–D529)
