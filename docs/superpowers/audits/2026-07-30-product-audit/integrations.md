# Big-Picture Audit — Slice: External Integrations + Deploy/Config Surface

Date: 2026-07-30 · Branch: feat/lovable-workspace · Method: static analysis + unauthenticated network checks only (no credentialed calls). Model-ID currency verified against the claude-api skill catalog. `cdn.calltracking.com` verified NXDOMAIN via `host`/`curl`.

**Lens key (20):** T=Terminality · SG=Structure/Grain · O=Organization · PC=Provenance→Consumption · C=Comprehension · SV=State-Visibility · H=Honesty · RS=Reversibility/Safety · IA=Idempotence/Accretion · FR=Failure/Recovery · PF=Precondition/Forward-path · PD=Population/Dark · SC=Sibling-Coherence · GA=Gating-Axis · TI=Temporal-Integrity · CV=Cost/Value · CS=Contract-Stability · N=Naming/Least-astonishment · CD=Config-drift · OB=Observability

Cell convention: every unit × every lens was evaluated. Each row lists the lenses that are **n/a** and the lenses occupied by a **directive**; every other lens for that row is a **pass**. No blanks.

---

## 1. Env-var drift table (code reads vs. cloudbuild.yaml provides vs. .env.example documents)

Legend: CB = provided by cloudbuild.yaml (secret S / env E / Dockerfile D / Cloud-Run-injected R); EX = documented in .env.example.

| Var | Read at | CB | EX | Effect when absent in prod | Verdict |
|---|---|---|---|---|---|
| DATABASE_URL | db.ts, jobs/index.ts | S (svc + migrate job) | ✓ | boot fails | OK |
| ADMIN_API_TOKEN | requireAdmin, preview-token | S | ✓ | token path off (OAuth remains) | OK |
| MAILGUN_API_KEY / _DOMAIN / _DEFAULT_FROM | email/send.ts | S | ✓ | stub mode | OK but **dead code — no caller** (D1005) |
| GOOGLE_CLIENT_ID / _SECRET, BETTER_AUTH_SECRET | studio-auth, tenant-auth, preview-token | S | ✓ | auth mode "disabled" in prod | OK |
| GODADDY_API_KEY / _SECRET | dns/godaddy.ts | S | ✓ | GoDaddy provider unavailable | OK |
| GODADDY_API_BASE | dns/godaddy.ts | — | ✓ | default api.godaddy.com | OK (optional) |
| KINSTA_API_KEY / KINSTA_COMPANY_ID | dns/kinsta.ts | S (COMPANY_ID ← KINSTA_AGENCY_ID) | ✓ | falls back GoDaddy→manual | OK |
| KINSTA_API_BASE | dns/kinsta.ts | — | ✗ | default api.kinsta.com/v2 | doc gap (D1017) |
| DNS_PROVIDER | dns/resolve.ts | — | ✓ | auto: kinsta>godaddy>manual | OK (intentional) |
| ANTHROPIC_API_KEY | ai/config.ts | S | ✓ | AI stub mode (no spend) | OK |
| AI_AGENT_TOKEN_BUDGET / _MAX_TOOL_CALLS / _MAX_CONTINUATIONS | loop.ts, agent-turn.ts | — | ✓ | defaults 1M / 30 / 3 | OK (per-conversation only — D1019) |
| PIXABAY_API_KEY | media/pixabay.ts | S (svc + migrate job) | ✓ | stock search stub | OK |
| MEDIA_BUCKET | media/storage.ts | — | ✗ | hardcoded default `anchorcorps-media` | works by luck of default; doc gap (D1017) |
| PLUGIN_CONFIG_ENC_KEY | plugins/crypto.ts | S | ✗ | throws at first prod secret write | doc gap (D1017); no rotation path (D1023) |
| GITHUB_CONTENT_TOKEN | git/client.ts | S (**value = literal "disabled" placeholder → git sync off in prod — CONFIRMED**, resolveGitMode client.ts:17-22) | ✓ | mode "disabled", all entry points no-op | OK, intentional, well-gated |
| GITHUB_WEBHOOK_SECRET | git-webhook.ts | S (placeholder) | ✓ | webhook 503s (placeholder treated as unset — good) | OK |
| GITHUB_CONTENT_REPO | git/client.ts | E | ✓ | mode "disabled" | OK |
| GCP_PROJECT_ID | gcloud/run-domains.ts | E (comment cites the 2026-07-28 tmj-new-england outage) | ✗ | getGcloudConfig throws → provisioning dead | provided now; doc gap (D1017) |
| GCP_REGION / GCP_RUN_SERVICE | run-domains.ts | — | ✗ | defaults us-central1 / anchor-sites (match prod) | works by default; doc gap |
| SITES_DOMAIN_BASE / _REGISTRABLE | config/domain.ts | — | ✗ | defaults sites.anchorcorps.com / anchorcorps.com | OK by default; doc gap |
| STUDIO_HOST / STUDIO_ORIGIN / STUDIO_ALLOWED_DOMAIN / ADMIN_ALLOWED_EMAILS | admin-host.ts, studio-auth.ts | — | STUDIO_ORIGIN only | defaults studio.anchorcorps.com / anchorcorps.com domain | OK by default; doc gap |
| JOBS_ENABLED | jobs/index.ts, admin-jobs.ts | — | ✗ | default ON (correct for prod) | OK; doc gap |
| **SENTRY_DSN / SENTRY_DISABLED** | sentry/index.ts, csp.ts | **—** | ✗ | **error tracking silently off in prod** (stub console.error) | **DRIFT — D1004** |
| **CRM_BASE_URL / CRM_API_KEY / CRM_DISABLED** | crm/resolve.ts | **—** | ✗ | **NullCrmClient; CRM integration silently dark in prod** | **DRIFT — D1008** |
| CSP_CRM_EXTRA_ORIGINS | csp.ts | — | ✗ | no extra CRM frame/connect origins | OK while CRM dark |
| **ANALYTICS_BASE_URL / ANALYTICS_PROVIDER** | render-page.tsx, csp.ts | **—** | ✗ | **analytics tag never injected on any prod tenant page** | **DRIFT — D1007** |
| **WEB_VITALS_ENDPOINT** | render-page.tsx, csp.ts | **—** | ✗ | **vitals snippet never injected; /api/vitals unreachable-by-design** | **DRIFT — D1006** |
| ENABLE_EXAMPLE_PLUGIN | plugins/builtin.ts | — | ✗ | example plugin off (intended) | OK; doc gap |
| PORT / NODE_ENV | index.ts / everywhere | D (8080/production) + E (NODE_ENV) | ✓ | — | OK |
| K_SERVICE / GCE_METADATA_HOST | access-token.ts | R (Cloud Run) | n/a | local falls back to gcloud CLI | OK |
| TEST_DATABASE_URL | tests only | n/a | ✓ | tests skip | n/a |

**Drift class summary:** the `--set-secrets/--set-env-vars replace-the-whole-list` gotcha is now well-documented inside cloudbuild.yaml itself (good), but four whole integrations (Sentry, CRM, analytics, web-vitals) are coded, mode-switched, CSP-plumbed — and off in prod because their vars were never added to the deploy list, with no operator-visible signal (D1010).

---

## 2. Ledger (unit × lens)

| # | Unit | n/a lenses | Directive cells | Pass |
|---|---|---|---|---|
| 1 | dns/provider.ts (contract) | PC,SV,PD,CV,OB | — | 15 |
| 2 | dns/resolve.ts (mode switch) | PC,CV | — | 18 |
| 3 | dns/godaddy.ts | CV | D1001(H), D1022(RS) | 17 |
| 4 | dns/kinsta.ts | CV | D1003(IA), D1021(SC) | 17 |
| 5 | dns/manual.ts | CV,IA | — | 18 |
| 6 | dns/cloud-dns.ts (stub, throws loudly) | PC,SV,IA,FR,TI,CV,OB | — | 13 |
| 7 | gcloud/access-token.ts | PD,CV | D1020(TI) | 17 |
| 8 | gcloud/run-domains.ts | CV | D1024(OB) | 18 |
| 9 | provisioning/orchestrator.ts | CV | D1014(H) | 18 |
| 10 | jobs/site-provision.ts | CV | — | 19 |
| 11 | routes/admin-domains.ts (+provision route in admin-pages) | CV | D1002(RS), D1012(TI) | 17 |
| 12 | media/storage.ts (GCS wiring, signed URLs) | — | D1016(RS) | 19 |
| 13 | media/ingest.ts (SSRF-guarded fetch→GCS) | — | D1015(FR) | 19 |
| 14 | media/pixabay.ts | — | — | 20 |
| 15 | jobs/media-process-upload.ts (+variant-spec) | — | — | 20 |
| 16 | ai/config.ts (model pin `claude-sonnet-4-6` — verified current/active) | — | — | 20 |
| 17 | ai/client.ts (pin enforced, stub/dry-run/api) | — | — | 20 |
| 18 | ai/catalog.ts (deterministic, cacheable) | — | — | 20 |
| 19 | ai/propose.ts (+edit-ops, diff) | SV | — | 19 |
| 20 | ai/agent/loop.ts | — | D1019(CV) | 19 |
| 21 | jobs/agent-turn.ts (continuations, turn lock) | — | — | 20 |
| 22 | tool get_site_overview | RS,IA,TI,CV | — | 16 |
| 23 | tool get_page | RS,IA,TI,CV | — | 16 |
| 24 | tool list_templates | RS,IA,TI,CV | — | 16 |
| 25 | tool list_media | RS,IA,TI,CV | — | 16 |
| 26 | tool create_page | — | — | 20 |
| 27 | tool update_page | — | — | 20 |
| 28 | tool delete_page | — | — | 20 |
| 29 | tool set_brand_tokens (replace — stated in description) | — | — | 20 |
| 30 | tool set_seo_defaults (merge — stated) | — | — | 20 |
| 31 | tool set_page_seo | — | — | 20 |
| 32 | tool apply_site_template | — | — | 20 |
| 33 | tool search_stock_images | — | — | 20 |
| 34 | tool import_image | — | — | 20 |
| 35 | tools/index dispatcher | RS,IA,CV | — | 17 |
| 36 | git/client.ts | — | — | 20 |
| 37 | git/serialize.ts (deterministic bytes) | SV,CV,PD | — | 17 |
| 38 | git/export.ts (no-op skip, empty-repo bootstrap) | — | — | 20 |
| 39 | git/state-repo.ts | — | — | 20 |
| 40 | jobs/git-export.ts | — | — | 20 |
| 41 | jobs/git-import.ts | — | — | 20 |
| 42 | routes/git-webhook.ts (HMAC, placeholder-aware) | — | — | 20 |
| 43 | routes/admin-git.ts | — | — | 20 |
| 44 | email/send.ts | — | D1005(PC), D1025(H) | 18 |
| 45 | plugins/registry.ts | PC,SV,FR,CV,TI | — | 15 |
| 46 | plugins/manifest.ts | PC,SV,FR,CV,TI | — | 15 |
| 47 | plugins/loader.ts (fail-soft verify) | — | — | 20 |
| 48 | plugins/crypto.ts | — | D1023(RS) | 19 |
| 49 | plugins/guard.ts | PC,SV,FR,CV,TI | — | 15 |
| 50 | plugins/repo.ts | CV,SC,TI | — | 17 |
| 51 | plugins/builtin.ts + example plugin (opt-in gated) | — | — | 20 |
| 52 | crm/client.ts (Http/Stub/Null; timeout) | — | — | 20 |
| 53 | crm/resolve.ts | — | D1008(PD) | 19 |
| 54 | crm/sync-job.ts (state-re-derived retry) | — | — | 20 |
| 55 | routes/admin-crm.ts (proxy + rate limit) | — | — | 20 |
| 56 | sentry/index.ts (server) | — | D1004(H) | 19 |
| 57 | client/sentry/index.ts | CV | — | 19 |
| 58 | events/ (calendar-content repo+schema — consumed by blog-events + admin-tenant; not an event bus) | SV,PD,CV,CD,OB,GA | — | 14 |
| 59 | ctm-hook.ts | PC,SV,RS,IA,FR,TI,CV | D1018(PD) | 12 |
| 60 | ctmScriptTag + injection (render-page.tsx) | IA,TI | D1000(H) | 17 |
| 61 | analytics.ts + injection | TI | D1007(CD) | 18 |
| 62 | vitals route + inline snippet | — | D1006(PC), D1011(CS) | 18 |
| 63 | jobs/index.ts (pg-boss boot, queue policies) | — | D1026(FR) | 19 |
| 64 | routes/admin-jobs.ts (health) | — | D1009(SV) | 19 |
| 65 | config/domain.ts | — | — | 20 |
| 66 | csp.ts | CV | — | 19 |
| 67 | cloudbuild.yaml (drift itself billed to per-feature rows) | — | — | 20 |
| 68 | Dockerfile | — | — | 20 |
| 69 | .env.example | — | D1017(C) | 19 |
| 70 | sites/create-site.ts (CRM + provision composition) | — | D1013(TI) | 19 |
| 71 | server/app.ts (integration composition + error surface) | — | D1010(SV) | 19 |

**Totals:** 71 units × 20 lenses = **1,420 cells**. n/a = 83 · directive cells = 27 · pass = 1,310 · blank = 0 (verified: every row sums to 20).

Notable pass-with-note cells (recorded as pass): godaddy.ts PD (adapter effectively idle whenever Kinsta creds present — intended default); media/storage.ts CD (prod correctness depends on the `anchorcorps-media` literal default matching the real bucket); crm/client.ts H (NullCrmClient succeeds-on-noop is an explicitly documented mode, gated by resolve.ts + one boot warn); GoDaddy record removal on shared names (D1022) also affects admin-domains delete path; access-token local path shells out to `gcloud` (documented, dev-only); csp.ts hardcodes `storage.googleapis.com`/`images.unsplash.com`/`unpkg.com` independent of config (tracked under D1000/D1011).

Brief-premise checks: (1) "GITHUB_CONTENT_TOKEN 'disabled' placeholder = git sync off" — **confirmed** (client.ts:20 sentinel, webhook 503s on placeholder secret, all entry points cheap-gate first). (2) "GoDaddy 404s on the Kinsta-hosted zone — resolver correctness" — resolver correctly prefers Kinsta by default, **but** the GoDaddy adapter itself masks that 404 on writes (D1001). (3) The `--set-secrets replaces list` gotcha — real, now self-documented in cloudbuild.yaml, and the residue is the four dark integrations above.

---

## 3. Directives (D1000+)

- **[D1000]** (CTM tag injection) × **Honesty** — «A third-party loader you inject on every tenant page must be a real, verified embed». Instance: «`ctmScriptTag` loads `https://cdn.calltracking.com/call-tracking.min.js` — domain is NXDOMAIN (verified); the `data-ctm-account-id` attribute format is invented; every site with `ctm_account_id` ships a dead script and call tracking silently never runs; csp.ts:33 whitelists the phantom origin — render-page.tsx:79-82». Fix-class: «replace with CTM's real per-account embed (`https://<account>.tctm.co/t.js` per CTM docs), derive the CSP origin from the same constant, add a resolvability smoke test».
- **[D1001]** (dns/godaddy.ts) × **Honesty** — «An adapter must not report success for a write the provider rejected». Instance: «`req()` treats 404 as benign for every method — a PUT/DELETE against a zone GoDaddy doesn't host (the documented anchorcorps.com case) returns "created"/silently no-ops with zero records written — godaddy.ts:54-59». Fix-class: «tolerate 404 only on GET; throw on 404 for PUT/DELETE».
- **[D1002]** (admin-domains DELETE) × **Reversibility/Safety** — «Deprovision must read cleanup targets before destroying the source of truth for them». Instance: «`deleteMapping` runs first, then `getRequiredDnsRecords` reads the now-deleted mapping → always `[]` → the DNS record is never removed, and every error is swallowed — admin-domains.ts:159-176». Fix-class: «capture required records before deleting the mapping; log cleanup failures».
- **[D1003]** (dns/kinsta.ts) × **Idempotence/Accretion** — «ensureRecord with a changed value must converge on exactly the desired value». Instance: «value-mismatch path PUTs `new_resource_records` only, appending the new value while the stale one persists (invalid multi-value CNAME / stale target still served); `removed_resource_records` never used — kinsta.ts:188-195». Fix-class: «include `removed_resource_records` for existing values not equal to the target».
- **[D1004]** (sentry, server+client) × **Honesty** (+Config-drift) — «A mode named "real" must actually capture». Instance: «with SENTRY_DSN set, `captureException` still only console.errors ("install @sentry/node to enable"); the SDK is not installed AND SENTRY_DSN is absent from cloudbuild — prod error tracking is doubly off while app.ts/ErrorBoundary call it as if wired — sentry/index.ts:48-54, cloudbuild.yaml». Fix-class: «install @sentry/node + provision SENTRY_DSN, or rename/collapse the fake real branch until then».
- **[D1005]** (email/send.ts) × **Provenance→Consumption** — «Don't provision secrets and ship runtime assets for an integration nothing calls». Instance: «`sendEmail` has zero call sites in src/ and scripts/, yet MAILGUN_* are deployed via --set-secrets and Dockerfile copies `.routine/templates` for it — send.ts:70, Dockerfile:56-57». Fix-class: «wire the intended notification events (Task 1.9) or drop the secrets + template shipping until then».
- **[D1006]** (vitals) × **Provenance→Consumption** (+Config-drift) — «An ingestion endpoint must feed a consumer, and its producer must be deployable». Instance: «/api/vitals console.logs and discards every metric, and WEB_VITALS_ENDPOINT is unset in prod so the emitting snippet is never injected — the pipeline is dark at both ends — vitals.ts:34-37, render-page.tsx:203». Fix-class: «persist metrics (table or analytics forward) + add the env var to cloudbuild, or delete route+snippet».
- **[D1007]** (analytics tag) × **Config-drift** — «A per-site feature toggle (`analytics_disabled`) implies the feature is on somewhere». Instance: «ANALYTICS_BASE_URL absent from cloudbuild → `analyticsScriptTag` never injected on any prod tenant page; the schema/admin carry `analytics_disabled` for a feature that is globally off — render-page.tsx:194-201». Fix-class: «provision ANALYTICS_BASE_URL/_PROVIDER, or mark the feature dormant in admin UI/docs».
- **[D1008]** (crm/resolve.ts) × **Population/Dark** — «A prod-degraded mode needs an operator-visible signal, not a boot log line». Instance: «CRM_BASE_URL/CRM_API_KEY absent from cloudbuild → NullCrmClient forever; `crm_site_id` stays null, phone-numbers panel always empty, only signal is one console.warn at boot — resolve.ts:33-40». Fix-class: «provision creds or surface "CRM: not configured" in the admin sites/CRM UI».
- **[D1009]** (admin-jobs health) × **State-Visibility** — «A queue-health endpoint must cover every queue». Instance: «QUEUES lists 4 of 7 — GIT_EXPORT, GIT_IMPORT, SITE_PROVISION missing, so the queues backing git sync and domain provisioning are invisible — admin-jobs.ts:17-19». Fix-class: «export the queue list from jobs/index.ts registration and import it here».
- **[D1010]** (app-level) × **State-Visibility** — «Every mode-switched integration must report its resolved mode somewhere an operator can read». Instance: «AI (stub/api), git (disabled/api), DNS (kinsta/godaddy/manual), CRM (null/stub/http), email (stub/api), Sentry (stub/real) each resolve silently; four are dark in prod and nothing but behavior reveals it — app.ts + resolvers». Fix-class: «admin `/api/admin/integrations` endpoint returning `{name, mode}` from each resolver (all are already pure functions)».
- **[D1011]** (vitals snippet) × **Contract-Stability** — «Third-party runtime JS on tenant pages must be version-pinned». Instance: «snippet loads `https://unpkg.com/web-vitals/dist/web-vitals.iife.js` (floating latest; web-vitals major bumps rename/remove `on*` API, and unpkg is a supply-chain surface CSP-whitelisted wholesale) — render-page.tsx:212». Fix-class: «pin `web-vitals@<x.y.z>` or self-host the IIFE».
- **[D1012]** (provision route wait) × **Temporal-Integrity** — «A request-path wait must fit inside the platform request timeout». Instance: «POST /api/sites/provision with `wait` uses the orchestrator's 20-minute default under Cloud Run `--timeout=60s` — the wait can never complete in prod — admin-pages.ts:817-819, orchestrator.ts:180, cloudbuild.yaml». Fix-class: «cap route wait ≤ ~45s or make waiting job-only (job path already bounds at 4min)».
- **[D1013]** (sites/create-site.ts) × **Temporal-Integrity** — «No network calls inside an open DB transaction». Instance: «`crmClient.provisionSite` (up to 10s) runs inside the caller-owned site-creation transaction, holding a pooled connection during network I/O; the provision-enqueue was already moved post-COMMIT for exactly this reason, the CRM call was not — create-site.ts:143-148». Fix-class: «return the CRM call as a post-COMMIT thunk like `enqueueProvision`».
- **[D1014]** (orchestrator step 2) × **Honesty** — «"Upserted" must not paper over a hostname owned by another site». Instance: «`ON CONFLICT (hostname) DO NOTHING` then reports `status:"ok", upserted` even when the row belongs to a different site_id, and provisioning proceeds against a hostname that will route elsewhere — orchestrator.ts:111-118». Fix-class: «detect conflicting owner and emit a step error».
- **[D1015]** (media/ingest.ts) × **Failure/Recovery** — «A row must not outlive a failed upload with no retry or surface». Instance: «media_assets row committed before `storage.save`; a GCS failure leaves a row whose gcs_key has no object, `variants_status` stuck 'pending' forever, nothing retries, nothing lists it — ingest.ts:239-259». Fix-class: «mark row 'failed' on save error (mirrors media-process-upload) or upload before insert».
- **[D1016]** (media pipeline) × **Reversibility/Safety** (+Accretion) — «Stored bytes need a deletion story». Instance: «no route or job deletes media assets or GCS objects anywhere; originals + variants accrete forever, including orphans from D1015 — media/*, routes/media.ts». Fix-class: «asset delete endpoint that removes row + objects, plus a bucket lifecycle rule for orphans».
- **[D1017]** (.env.example) × **Comprehension** — «The env catalog must enumerate everything the code reads». Instance: «≥17 read vars undocumented: MEDIA_BUCKET, SENTRY_DSN/DISABLED, CRM_BASE_URL/API_KEY/DISABLED, CSP_CRM_EXTRA_ORIGINS, ANALYTICS_BASE_URL/PROVIDER, WEB_VITALS_ENDPOINT, JOBS_ENABLED, SITES_DOMAIN_BASE/REGISTRABLE, GCP_PROJECT_ID/REGION/RUN_SERVICE, STUDIO_HOST, STUDIO_ALLOWED_DOMAIN, ADMIN_ALLOWED_EMAILS, ENABLE_EXAMPLE_PLUGIN, PLUGIN_CONFIG_ENC_KEY, KINSTA_API_BASE — .env.example». Fix-class: «add each with the existing mode-switch comment convention».
- **[D1018]** (ctm-hook.ts) × **Population/Dark** — «Scaffolds with zero callers should be tied to a live plan or removed». Instance: «`runCtmNow` has no call sites; combined with D1000 the entire CTM integration is dark — ctm-hook.ts:11-16». Fix-class: «fold into the CTM-tag fix or delete until SPA navigation lands».
- **[D1019]** (agent loop) × **Cost/Value** — «Spend caps must exist at the level spend actually aggregates». Instance: «token budget is per-conversation-per-day (default 1M); N conversations/sites multiply Anthropic spend unbounded, and there is no per-site or global cap nor any spend report — loop.ts:305,338-345». Fix-class: «aggregate daily usage per site + a global budget env; expose in admin».
- **[D1020]** (gcloud/access-token.ts) × **Temporal-Integrity** — «Cache tokens by their actual expiry». Instance: «fixed 50-minute TTL ignores the metadata server's `expires_in`; a shorter-lived token would be served after expiry — access-token.ts:25,66-70». Fix-class: «use `expires_in - margin` from the response».
- **[D1021]** (kinsta vs godaddy) × **Sibling-Coherence** — «Both providers implement one DnsRecord contract; the record-name grain must be identical and pinned». Instance: «GoDaddy converts FQDN→zone-relative (`relativeName`), Kinsta sends the FQDN as-is (`stripDot` only); the contract in provider.ts doesn't say which grain the provider receives, and no integration test pins Kinsta's expectation (header cites doc-reading only) — kinsta.ts:167-171 vs godaddy.ts:70-73». Fix-class: «state the grain in the DnsProvider contract + one live-API smoke script per provider».
- **[D1022]** (dns/godaddy.ts removeRecord) × **Reversibility/Safety** — «Remove exactly the record you created». Instance: «DELETE at `/records/{type}/{name}` drops the entire recordset at that name/type regardless of `data`; any co-resident record (e.g. multiple A values) is destroyed — godaddy.ts:89-95». Fix-class: «read, filter out the target value, PUT the remainder (GoDaddy has no per-value delete)».
- **[D1023]** (plugins/crypto.ts) × **Reversibility/Safety** — «Encrypted-at-rest data needs a key-rotation path». Instance: «envelope v1 carries no key identifier; rotating PLUGIN_CONFIG_ENC_KEY makes every stored plugin secret permanently undecryptable with no re-encrypt tooling — crypto.ts:74-101, repo.ts EncryptedEnvelope». Fix-class: «add key-fingerprint to the envelope + a re-encrypt script».
- **[D1024]** (run-domains.ts) × **Observability** — «Cloud resources created per-tenant must be attributable and reconcilable». Instance: «domain mappings are created without labels tying them to site ids and nothing ever lists/reconciles them; orphans (from D1002, slug renames, deleted sites) are undetectable — run-domains.ts:83-94». Fix-class: «set `metadata.labels.site_id` on create + a periodic list-and-reconcile job».
- **[D1025]** (email/send.ts) × **Honesty** — «Sibling not-really-sent modes should agree on what "ok" means». Instance: «stub returns `ok:false` ("MAILGUN_API_KEY not set") while dry-run returns `ok:true` — a caller cannot distinguish "misconfigured" from "failed" from "simulated" without also switching on `mode` — send.ts:99-108». Fix-class: «tri-state result (`sent|skipped|failed`) or ok:true+mode for stub».
- **[D1026]** (jobs boot) × **Failure/Recovery** — «If the job runner is down, the system must say so where health is read». Instance: «bootJobs failure logs "continuing without job runner"; thereafter every enqueue (provisioning, media variants, CRM retries, agent turns) silently returns null through scattered try/catch, while `/healthz` still reports ok — index.ts:47-51, ingest.ts:262-272». Fix-class: «include jobs-runner state in /healthz and the admin jobs endpoint».

---

## 4. Five most severe (verbatim)

1. D1000 — CTM loader domain is NXDOMAIN; call tracking is fake on every tenant site.
2. D1001 — GoDaddy adapter reports "created" on writes the provider 404-rejected.
3. D1002 — Domain delete queries cleanup targets after destroying them; DNS records orphan silently.
4. D1004 — Sentry "real" mode is a console.error stub and the DSN was never deployed.
5. D1012 — The provision-and-wait route can never complete inside Cloud Run's 60s timeout.
