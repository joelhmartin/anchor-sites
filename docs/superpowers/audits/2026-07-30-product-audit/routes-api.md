# Big-Picture Audit — Slice: HTTP API Surface

Date: 2026-07-30 · Branch: feat/lovable-workspace · Auditor: routes-api slice agent
Scope: every endpoint in `src/server/routes/*` + mounting in `src/server/app.ts`, `src/server/csp.ts`, `src/server/index.ts`.

## Premise corrections vs. brief

- `blocks-preview` is **`.tsx`**, not `.ts` (`src/server/routes/blocks-preview.tsx`). All 19 route files present; census below is regenerable mechanically (grep `router\.(get|post|put|patch|delete)` over routes + `app\.(use|get|all)` over app.ts/index.ts).
- Beyond the 19 route files, app.ts/index.ts themselves mount 7 more addressable units (healthz, studio auth ×2, plugin-router mount, dev `/__site`, SPA fallback, global error handler). They are in the census — excluding them would hide two of the worst findings.

## Census — 79 units

Mount order (app.ts): helmet/CSP → CORS → studio-auth (pre-JSON) → express.json(rawBody verify) → pino → healthz → [dev: blocks-preview, /__site] → me → **adminPages** → media → adminSites → **templates** → plugins → adminTenant → adminDomains → adminCrm → vitals → adminJobs → adminAiAgent → adminGit → gitWebhook → loadPlugins → siteResolve → blogEvents → sitemap → page (catch-all) → error handler. index.ts adds prod `express.static` + `GET /.*` → index.html.

Auth legend: **A** = requireAdmin (dual-mode session/X-Admin-Token/dev-grant), **P** = public by design, **H** = HMAC, **Q** = preview-query-token or A, **E** = NODE_ENV gate (dev only), **G** = per-site plugin enablement guard.

| U | Method + Path | File:Line | Auth | Consumer |
|---|---|---|---|---|
| U1 | GET /healthz | app.ts:73 | P | Cloud Run probes (note: public host returns GFE 404 — see D-obs-1) |
| U2 | ALL /auth/google/callback | studio-auth-mount.ts:37 | P(OAuth) | Google redirect |
| U3 | ALL /api/auth/* | studio-auth-mount.ts:47 | P(Better-auth) | login page, auth-api.ts |
| U4 | /api/plugins/:name/* (plugin routers) | app.ts:139, loader.ts:103 | G | tenant pages (e.g. example form) |
| U5 | GET /.* prod static+SPA fallback | index.ts:38-41 | P | browser |
| U6 | global error handler | app.ts:161 | — | all routes |
| U7 | GET /__blocks/preview | blocks-preview.tsx:78 | E | dev operator |
| U8 | POST /__blocks/preview | blocks-preview.tsx:82 | E | dev harness form |
| U9 | GET /__site | app.ts:84 | E | dev debugging |
| U10 | GET /api/me | me.ts:14 | A | Studio auth probe |
| U11 | POST /api/sites/:siteId/pages/:pageId (save) | admin-pages.ts:102 | A+RL | inline-editor.ts, editors |
| U12 | GET /api/sites/:siteId/pages/:pageId | admin-pages.ts:250 | A | editor load |
| U13 | POST /api/sites/:siteId/preview-token | admin-pages.ts:284 | A | SitePreviewPanel.tsx:153 |
| U14 | GET /api/sites/:siteId/pages/:pageId/preview | admin-pages.ts:333 | Q | preview iframe |
| U15 | POST /api/sites/:siteId/pages/:pageId/ai-edit | admin-pages.ts:533 | A+RL | **none (dark)** |
| U16 | GET /api/sites/:siteId/pages/:pageId/revisions | admin-pages.ts:599 | A | **none (dark)** |
| U17 | POST …/revisions/:revisionId/restore | admin-pages.ts:633 | A+RL | ChangeCard.tsx:29 |
| U18 | POST /api/sites/:siteId/publish | admin-pages.ts:704 | A+RL | WorkspacePage.tsx |
| U19 | POST /api/sites/:siteId/provision | admin-pages.ts:826 | A | **none (ops curl only)** |
| U20 | POST /api/sites/provision | admin-pages.ts:827 | A | **none (ops curl only)** |
| U21 | POST /api/sites/:siteId/media/upload-url | media.ts:100 | A+RL | image-sources/upload |
| U22 | POST /api/sites/:siteId/media/:assetId/complete | media.ts:171 | A+RL | upload flow |
| U23 | POST /api/sites/:siteId/media/stock-search | media.ts:209 | A+RL | ImagePickerDialog |
| U24 | POST /api/sites/:siteId/media/stock-import | media.ts:264 | A+RL | ImagePickerDialog |
| U25 | GET /api/sites | admin-sites.ts:77 | A | SitesListPage, WorkspacePage |
| U26 | POST /api/sites | admin-sites.ts:103 | A+RL | NewSitePage |
| U27 | GET /api/sites/:siteId | admin-sites.ts:164 | A | SiteDetailPage, WorkspacePage |
| U28 | GET /api/sites/:siteId/pages | admin-sites.ts:192 | A | PagesTab, WorkspacePage |
| U29 | PATCH /api/sites/:siteId | admin-sites.ts:218 | A | SettingsTab |
| U30 | POST /api/sites/:siteId/pages | admin-sites.ts:330 | A | PagesTab |
| U31 | GET /api/sites/:siteId/media | admin-sites.ts:391 | A | MediaTab/pickers |
| U32 | POST /api/sites/:siteId/save-as-template | templates.ts:129 | A+RL | SaveAsTemplateDialog |
| U33 | POST …/pages/:pageId/save-as-template | templates.ts:229 | A+RL | SaveAsTemplateDialog |
| U34 | POST /api/sites/:siteId/pages/from-template | templates.ts:292 | A+RL | PagesTab.tsx:93 — **but shadowed, see D100** |
| U35 | POST /api/sites/from-template | templates.ts:383 | A+RL | NewSitePage |
| U36 | GET /api/templates | templates.ts:474 | A | NewSitePage, dialogs |
| U37 | GET /api/templates/:id | templates.ts:496 | A | gallery detail |
| U38 | DELETE /api/templates/:id (archive) | templates.ts:517 | A | template mgmt |
| U39 | GET /api/plugins | plugins.ts:89 | A | plugins UI |
| U40 | GET /api/sites/:siteId/plugins | plugins.ts:94 | A | plugins tab |
| U41 | PUT /api/sites/:siteId/plugins/:name | plugins.ts:119 | A | plugins tab |
| U42 | GET /api/sites/:siteId/posts | admin-tenant.ts:81 | A | blog tab |
| U43 | POST /api/sites/:siteId/posts | admin-tenant.ts:103 | A | PostEditorPage |
| U44 | GET /api/sites/:siteId/posts/:postId | admin-tenant.ts:135 | A | PostEditorPage |
| U45 | PUT /api/sites/:siteId/posts/:postId | admin-tenant.ts:154 | A | PostEditorPage |
| U46 | DELETE /api/sites/:siteId/posts/:postId | admin-tenant.ts:186 | A | blog tab |
| U47 | GET /api/sites/:siteId/events | admin-tenant.ts:209 | A | events tab |
| U48 | POST /api/sites/:siteId/events | admin-tenant.ts:231 | A | EventEditorPage |
| U49 | GET /api/sites/:siteId/events/:eventId | admin-tenant.ts:263 | A | EventEditorPage |
| U50 | PUT /api/sites/:siteId/events/:eventId | admin-tenant.ts:281 | A | EventEditorPage |
| U51 | DELETE /api/sites/:siteId/events/:eventId | admin-tenant.ts:314 | A | events tab |
| U52 | GET /api/sites/:siteId/members | admin-tenant.ts:338 | A | MembersTab |
| U53 | GET /api/sites/:siteId/auth-config | admin-tenant.ts:365 | A | MembersTab |
| U54 | PUT /api/sites/:siteId/auth-config | admin-tenant.ts:388 | A | MembersTab |
| U55 | GET /api/sites/:siteId/domains | admin-domains.ts:65 | A | DomainsTab |
| U56 | POST /api/sites/:siteId/domains | admin-domains.ts:91 | A | DomainsTab |
| U57 | DELETE /api/sites/:siteId/domains/:domainId | admin-domains.ts:134 | A | DomainsTab |
| U58 | POST …/domains/:domainId/provision | admin-domains.ts:189 | A | DomainsTab:97 |
| U59 | GET …/domains/:domainId/status | admin-domains.ts:289 | A | DomainsTab poll |
| U60 | GET /api/sites/:siteId/crm/phone-numbers | admin-crm.ts:31 | A+RL | CrmTab:38 |
| U61 | POST /api/vitals | vitals.ts:28 | P+RL | tenant-page vitals snippet |
| U62 | GET /api/admin/jobs/health | admin-jobs.ts:33 | A | **none (dark)** |
| U63 | POST /api/sites/:siteId/agent/conversations | admin-ai-agent.ts:282 | A+RL | AgentChatDrawer/Workspace |
| U64 | GET /api/sites/:siteId/agent/conversations | admin-ai-agent.ts:333 | A | drawer list |
| U65 | GET …/agent/conversations/:conversationId | admin-ai-agent.ts:351 | A | drawer open |
| U66 | POST …/agent/conversations/:conversationId/messages | admin-ai-agent.ts:381 | A+RL | drawer send |
| U67 | GET …/agent/conversations/:conversationId/events (SSE) | admin-ai-agent.ts:437 | A | streamAgentEvents |
| U68 | GET /api/sites/:siteId/git | admin-git.ts:120 | A+RL | GitCard |
| U69 | POST /api/sites/:siteId/git/enable | admin-git.ts:147 | A+RL | GitCard |
| U70 | POST /api/sites/:siteId/git/export | admin-git.ts:200 | A+RL | GitCard |
| U71 | POST /api/git/webhook | git-webhook.ts:122 | H | GitHub |
| U72 | GET /__site_resolve | site-resolve.ts:19 | A | ops debugging |
| U73 | GET /blog (tenant) | blog-events.ts:77 | P | tenant visitors |
| U74 | GET /blog/:slug (tenant) | blog-events.ts:97 | P | tenant visitors |
| U75 | GET /events (tenant) | blog-events.ts:130 | P | tenant visitors |
| U76 | GET /events/:slug (tenant) | blog-events.ts:152 | P | tenant visitors |
| U77 | GET /sitemap.xml (tenant) | sitemap.ts:51 | P | crawlers |
| U78 | GET /robots.txt (tenant) | sitemap.ts:77 | P | crawlers |
| U79 | GET /.* tenant page renderer | page.ts:25 | P | tenant visitors |

## Lenses (21)

T=Terminality · S=Structure/Grain · O=Organization · Pv=Provenance→Consumption · C=Comprehension · SV=State-Visibility · Hn=Honesty · R=Reversibility/Safety · I=Idempotence/Accretion · F=Failure/Recovery · Pc=Precondition/Forward-path · Pd=Population/Dark · Sb=Sibling-Coherence · G=Gating-Axis · Tm=Temporal-Integrity · CV=Cost/Value · CS=Contract-Stability · N=Naming · IV=Input-validation · ES=Error-shape · AZ=AuthZ-consistency

## Ledger — per-unit results

Every cell not listed as a directive-hit or n/a is a **pass**. n/a convention: pure-read GETs get n/a on T, R, I (nothing to terminate, nothing destructive, safe method) unless a directive makes that lens applicable; U6 (error handler) n/a on T, I, Pc, Pd, G, AZ, IV.

| U | Directive hits (lens→D) | n/a |
|---|---|---|
| U1 | — | T,R,I |
| U2 | — | — |
| U3 | — | — |
| U4 | — | — |
| U5 | Hn→D101, F→D101, ES→D101 | T,R,I |
| U6 | F→D102 | T,I,Pc,Pd,G,AZ,IV |
| U7 | — | T,R,I |
| U8 | ES→D127 | — |
| U9 | — | T,R,I |
| U10 | O→D126 | T,R,I |
| U11 | G→D103, Sb→D100 | — |
| U12 | — | T,R,I |
| U13 | — | — |
| U14 | R→D117 | T,I |
| U15 | Pd→D112, CV→D112 | — |
| U16 | Pd→D113, Pv→D113 | T,R,I |
| U17 | — | — |
| U18 | — | — |
| U19 | Pd→D111 | — |
| U20 | Pd→D111, F→D111, Sb→D111 | — |
| U21 | I→D106 | — |
| U22 | — | — |
| U23 | — | — |
| U24 | — | — |
| U25 | — | T,R,I |
| U26 | — | — |
| U27 | — | T,R,I |
| U28 | — | T,R,I |
| U29 | T→D104, Hn→D104, F→D102 | — |
| U30 | T→D105, Sb→D105 | — |
| U31 | T→D106 | R,I |
| U32 | — | — |
| U33 | — | — |
| U34 | Sb→D100, O→D100 | — |
| U35 | — | — |
| U36 | IV→D121, Hn→D121 | T,R,I |
| U37 | — | T,R,I |
| U38 | R→D109 | — |
| U39 | — | T,R,I |
| U40 | — | T,R,I |
| U41 | — | — |
| U42 | — | T,R,I |
| U43 | — | — |
| U44 | — | T,R,I |
| U45 | N→D122 | — |
| U46 | — | — |
| U47 | — | T,R,I |
| U48 | — | — |
| U49 | — | T,R,I |
| U50 | N→D122 | — |
| U51 | — | — |
| U52 | T→D107 | R,I |
| U53 | — | T,R,I |
| U54 | — | — |
| U55 | — | T,R,I |
| U56 | — | — |
| U57 | T→D110, Pc→D110, Hn→D119 | — |
| U58 | — | — |
| U59 | N→D120 | — |
| U60 | — | T,R,I |
| U61 | G→D103, CV→D103, Pv→D115, S→D115, ES→D127 | T,R,I |
| U62 | SV→D114, Tm→D114, Pd→D114, N→D126 | T,R,I |
| U63 | T→D108 | — |
| U64 | — | T,R,I |
| U65 | — | T,R,I |
| U66 | CS→D124 | — |
| U67 | CV→D123, Tm→D123 | T,R,I |
| U68 | CV→D125 | T,R,I |
| U69 | CS→D124 | — |
| U70 | CS→D124 | — |
| U71 | Hn→D116 | — |
| U72 | — | T,R,I |
| U73 | — | T,R,I |
| U74 | — | T,R,I |
| U75 | — | T,R,I |
| U76 | — | T,R,I |
| U77 | — | T,R,I |
| U78 | — | T,R,I |
| U79 | R→D118 | T,I |

Notable **passes** worth recording (things checked and found sound): dual-mode requireAdmin applied to every admin unit (AZ consistent — verified per-route across all 12 admin files); siteId-scoping in every WHERE clause (cross-tenant 404s, incl. conversation/revision/asset ownership chains); Zod on every mutating body except U8 (dev-only) and U19/U20 (raw-cast body — inside D111); consistent `{error, details?}` error JSON on all admin routes; webhook HMAC length-guarded timingSafeEqual; preview token siteId-scope + expiry + constant-time verify (preview-token.ts); save route's RETURNING-seo revision fix; publish idempotent-by-WHERE; after-commit job enqueues everywhere (U26, U35); enqueue-null disambiguation via pgboss.job (honest 503s in U63/U66/U69/U70); 401 verified live on prod (`/api/sites` → `{"error":"unauthorized"}`); webhook placeholder-secret 503 fail-closed; prod webhook rejects unsigned POSTs (verified live, 401).

## Directives

[D100] (U34 POST /sites/:siteId/pages/from-template, U11) × Sibling-Coherence/Organization — «A router mounted earlier must never own a param pattern that swallows a later router's literal path; route literals win over params or don't coexist.» Instance: app.ts:94 mounts adminPagesRouter before templatesRouter (app.ts:103); adminPages `POST /sites/:siteId/pages/:pageId` (admin-pages.ts:102) matches `/sites/X/pages/from-template` first, so U34 (templates.ts:292) is unreachable in the composed app — the save handler parses `{template_id}` against savePayload and 400s "invalid payload". PagesTab.tsx:93 calls exactly this path, so "add page from template" is broken in prod. Invisible to tests: tests/integration/page-templates.test.ts:69 mounts ONLY templatesRouter. Fix-class: mount templatesRouter before adminPagesRouter (or exclude literal `from-template` from the `:pageId` pattern) + one integration test through `createApp()`.

[D101] (U5 SPA fallback) × Honesty/Failure/Error-shape — «An unknown /api path must return a JSON 404, never a 200 HTML page.» Instance: verified live — `GET https://studio.anchorcorps.com/api/definitely-not-a-route` → **200** + SPA index.html (index.ts:39 `app.get(/.*/)` catches everything the page router passes through); non-GET gets Express's default HTML "Cannot POST" 404. Every fetch client that typos a path parses HTML as JSON and reports a confusing error. Fix-class: an `/api` 404 JSON terminator mounted after all API routers, before the page renderer/SPA fallback.

[D102] (U6 error handler; U29) × Failure/Recovery — «A global error handler must guard res.headersSent.» Instance: app.ts:161-173 calls `res.status(...).json(...)` unconditionally; U29 (admin-sites.ts:283-322) continues awaiting queries *after* `res.json` inside the same try — a throw there reaches the handler post-send and throws ERR_HTTP_HEADERS_SENT. Fix-class: `if (res.headersSent) return next(err);` first line; move U29's post-response CRM work out of the try or into a job.

[D103] (rate limiting, cells U11/U61) × Gating-Axis/Cost — «Per-IP rate limiting behind a proxy requires trust proxy, or the key is the proxy.» Instance: no `app.set("trust proxy", …)` anywhere (verified grep); on Cloud Run `req.ip` is the connecting GFE/loadbalancer address, so all clients share few buckets — the public U61 limit (60/min "per IP", vitals.ts:26) is effectively global and any tenant visitor can starve it; admin limiters (save 10/min) pool all operators. Fix-class: `app.set("trust proxy", true)` (Cloud Run-safe) + keyFn on authenticated principal for admin routes.

[D104] (U29 sites) × Terminality/Honesty — «A managed thing must be endable: sites have no delete OR archive transition.» Instance: no DELETE /api/sites/:id anywhere; `status` is not in patchSitePayload (admin-sites.ts:32-55) so the `site.status === "archived"` CRM-deprovision branch at admin-sites.ts:308 is dead code that implies a transition that cannot happen. Known gap per brief — confirmed, and the dead branch makes it look implemented. Fix-class: PATCH-able `status: "archived"` (renderer + resolveSite honoring it) or DELETE with cascade policy; delete the dead branch until then.

[D105] (U30 pages) × Terminality/Sibling-Coherence — «Pages can be created three ways (blank, from-template, agent) but ended zero ways over HTTP.» Instance: no DELETE /api/sites/:siteId/pages/:pageId in any router, while the AI agent's tool surface CAN delete pages (src/server/ai/agent/tools/pages.ts) — the agent outranks the operator; one-click publish (admin-pages.ts:704) then flips every stray page live. Fix-class: DELETE pages route (revisions retained), wired into PagesTab.

[D106] (U21, U31 media) × Idempotence-Accretion/Terminality — «Assets minted before upload need a terminal path for both the abandoned and the unwanted.» Instance: U21 (media.ts:134) inserts a media_assets row before the browser PUT; abandoned uploads accrete `pending` rows forever (no cleanup job, no DELETE); no DELETE media endpoint at all, so blobs+rows are permanent. Fix-class: DELETE /media/:assetId (+ GCS object delete) and a pending-row sweep job.

[D107] (U52 members) × Terminality — «Member accounts are listed but can never be removed, disabled, or password-reset by the operator.» Instance: admin-tenant.ts:339-362 is the entire member surface (read-only). Fix-class: DELETE/disable member route.

[D108] (U63 conversations) × Terminality — «Agent conversations accrete forever — no delete/archive.» Instance: admin-ai-agent.ts has create/list/get/message/tail only; ai_conversations/ai_messages grow unboundedly and the list endpoint has no pagination. Fix-class: DELETE (or archived flag) + list limit.

[D109] (U38 templates) × Reversibility — «A soft delete needs an un-delete.» Instance: DELETE /api/templates/:id archives (templates.ts:517, D-041 never-hard-delete) but no route restores `status:'active'`; listTemplates(status:archived) can see them, nothing can revive them. Fix-class: PATCH template status (or POST /templates/:id/restore).

[D110] (U57, U56 domains) × Terminality/Precondition — «Primary is forever: no set-primary transition and the primary can't be deleted.» Instance: admin-domains.ts:149 blocks deleting `is_primary`; no endpoint writes `is_primary` after create (create-site sets canonical primary); therefore a customer's custom domain can never become the canonical/live URL — publish's `live_url` (admin-pages.ts:773 `WHERE is_primary = true`) is pinned to `*.sites.anchorcorps.com` for the site's lifetime. For a Lovable-for-websites product this blocks the core "connect your domain" promise. Fix-class: POST /domains/:domainId/set-primary (swap flags transactionally, evict caches).

[D111] (U19, U20 provision) × Population-Dark/Failure/Sibling-Coherence — «Two unconsumed provisioning endpoints duplicate the domains-tab provisioning path and 500 on bad input.» Instance: no UI calls U19/U20 (DomainsTab uses U58; NewSite flow auto-enqueues SITE_PROVISION); U20's body is raw-cast, not Zod (admin-pages.ts:808); unknown slug → `siteIdFromSlug` throws plain Error (orchestrator.ts:74) → 500 masked as "internal server error" in prod instead of 404; `wait:true` can hold a request through a "20+ min cert wait" (comment at admin-pages.ts:806) — guaranteed death on Cloud Run's 60s timeout, violating the project's own no-long-requests constraint. Fix-class: delete U19/U20 (or fold into U58) — keep one provisioning surface.

[D112] (U15 ai-edit) × Population-Dark/Cost — «A paid-model endpoint nothing calls should not stay mounted.» Instance: `ai-edit` appears nowhere outside admin-pages.ts + its test — the P6 propose/apply editor flow was superseded by the agent (Task 10); the route still spends real Anthropic tokens for any operator/script that finds it. Fix-class: remove route (keep proposeEdit for the agent) or wire an editor consumer.

[D113] (U16 revisions list) × Population-Dark/Provenance — «Revision history is written on every save but readable by no UI.» Instance: only consumer of the revisions family is ChangeCard's restore (agent flow); U16's list feeds nothing — the operator has no history/undo surface even though the data model is append-only for exactly that purpose. Fix-class: history panel in the editor consuming U16 + U17.

[D114] (U62 jobs/health) × State-Visibility/Temporal-Integrity/Population-Dark — «A health endpoint that omits half the queues reports health that isn't.» Instance: QUEUES (admin-jobs.ts:19) = media/template/crm/agent only — GIT_EXPORT, GIT_IMPORT, SITE_PROVISION (jobs/index.ts:35-37) are invisible, and site-provision is the queue whose backlog most directly breaks the new-site flow; endpoint also has no consumer (no Studio surface, grep-verified). Fix-class: derive QUEUES from the exported registry; give it a Studio ops widget or remove.

[D115] (U61 vitals) × Provenance→Consumption/Structure — «Ingested metrics must land somewhere attributable.» Instance: vitals.ts:36 `console.log`s and discards; payload carries no site/page identity (name/value/id/delta only) so even the log line can't be attributed to a tenant. Every tenant page pays the POST; nobody can ever read the answer. Fix-class: add site_id (from Origin/host) + persist to a table or drop the snippet until P-next.

[D116] (U71 git-webhook) × Honesty — «Don't report queued for an enqueue that returned null.» Instance: git-webhook.ts:241-242 ignores `enqueueImport`'s return — the default impl swallows pg-boss failures to `null` (line 116), yet `queued.push(slug)` runs regardless, so a queue outage still answers `202 {queued:[slug]}` and GitHub will never redeliver. Fix-class: only push on truthy job id (or after hasLive check), else 500 so GitHub retries.

[D117] (U14 preview) × Reversibility-Safety — «Long-lived credentials don't belong in URLs.» Instance: previewQueryAuth (preview-token.ts:168) still lifts `?token=` into X-Admin-Token via tokenFromQuery, so the static ADMIN_API_TOKEN remains acceptable in a query string (access logs, history) — acknowledged as deferred in admin-pages.ts:494-498 but now that pv1 tokens exist the fallback's only remaining users are curl/dev. Fix-class: restrict the query-string fallback to non-production, keep header-borne admin token for curl.

[D118] (U79 tenant renderer / csp.ts) × Reversibility-Safety — «Tenant pages should not execute arbitrary third-party CDN script under an 'unsafe-inline' policy.» Instance: csp.ts:30-36 ships `script-src 'self' 'unsafe-inline' cdn.calltracking.com unpkg.com` globally; render-page.tsx:212 loads web-vitals from unpkg.com at runtime (supply-chain exposure on every tenant page); 'unsafe-inline' negates XSS protection for operator/AI-authored block HTML. Known gap per csp.ts:6-9 — recorded so it stays on the books. Fix-class: self-host web-vitals; nonce-per-request migration.

[D119] (U57 domain delete) × Honesty — «A 204 that skipped its side effects should say so.» Instance: admin-domains.ts:159-176 swallows Cloud Run unmapping + DNS removal failures (`catch(() => undefined)`) then returns bare 204 — orphaned mappings/records are invisible and there is no retry surface (row already deleted). Fix-class: return `{warnings:[…]}` (200) on partial cleanup, or delete row last.

[D120] (U59 domain status) × Naming/Least-astonishment — «A GET that writes should be visibly a poll-refresh.» Instance: admin-domains.ts:317-325 updates site_domains + evicts cache inside a GET. Acceptable as a poll pattern, but uncached/unsafe semantics are undocumented in the path. Fix-class: comment/OpenAPI marking, or POST …/refresh alias; low priority.

[D121] (U36 templates list) × Input-validation/Honesty — «Reject bad filters, don't silently reinterpret them.» Instance: templates.ts:478-484 — `?status=bogus` fails safeParse and silently becomes `active`, `?kind=bogus` silently becomes "all kinds"; caller can't tell a typo from a filter. Fix-class: 400 on present-but-invalid query values.

[D122] (U45, U50) × Naming — «PUT implies full replace; these are PATCH semantics.» Instance: admin-tenant.ts:154/281 use `postPatchSchema`/`eventPatchSchema` (all-optional partial update) behind PUT. Contract-stability hazard for future clients that PUT a partial and expect the rest untouched (works today, will surprise if ever made spec-compliant). Fix-class: expose PATCH (keep PUT as alias one release).

[D123] (U67 SSE tail) × Cost-Value/Temporal — «An unbounded per-client 1s DB poll needs a lifetime.» Instance: admin-ai-agent.ts:491-516 polls listMessages+getConversation every second per open tab forever (no max duration, no idle shutdown once status is terminal); N idle tabs = 2N queries/sec indefinitely. Fix-class: close the stream after terminal status + idle grace, client reconnects on demand.

[D124] (U66, U69, U70) × Contract-Stability — «Reading pg-boss's private `pgboss.job` table couples routes to a dependency's internals.» Instance: admin-ai-agent.ts:164, admin-git.ts:101 raw-SQL pg-boss's schema (column/state names version-locked to pg-boss 10.x); a pg-boss upgrade silently turns dedupe-detection into "queue unavailable" 503s. Fix-class: one shared `hasLiveJob(name,key)` helper with a version-pinned comment + test against the installed schema.

[D125] (U68 git status GET) × Cost-Value — «Don't spend the mutation budget on the status poll.» Instance: admin-git.ts:71 one 10/min limiter shared across GET /git and both POSTs; GitCard refetches status after actions — bursty UI use 429s the read. Fix-class: separate (or no) limiter for the GET.

[D126] (U62, U10) × Organization/Naming — «One path grammar for admin APIs.» Instance: jobs health lives at `/api/admin/jobs/health` — the only `/api/admin/*` path in the product (everything else is `/api/<resource>`); meRouter hard-codes `/api/me` inside the router while every sibling mounts relative paths under `"/api"` (me.ts:14 vs app.ts:90). Fix-class: `/api/jobs/health`; mount me at "/api" prefix like the rest.

[D127] (U61, U8) × Error-shape-consistency — «Same error JSON contract everywhere.» Instance: vitals.ts:31 400 omits the `details` array every other Zod reject includes; blocks-preview.tsx:86/92 returns text/html + text/plain errors (dev-only, but it's the only non-JSON error producer). The prod HTML-404 case is D101. Fix-class: shared `invalidPayload()` helper (three files already hand-roll identical copies — admin-pages, admin-ai-agent, admin-git).

Observation (not a directive — infra, out of this slice's fix scope): **/healthz on the public studio host returns Google's GFE "Error 404 (Not Found)!!1" page** (verified live), i.e. the public URL map doesn't route it; Cloud Run's internal probes presumably hit the service directly. Worth confirming in the deploy/infra slice that nothing external monitors that URL.

## Tally

- Census: **79 units** (72 route-file endpoints + 7 app.ts/index.ts-level units)
- Lenses: **21**
- Cells: 79 × 21 = **1659**, all adjudicated (blank: 0)
- Directives: **28** (D100–D127), covering **54** cells
- n/a cells: **116** (37 pure-read GETs × 3 [T,R,I] = 111, minus 2 reinstated for U14/U79 = 109, + 7 for U6)
- Passes: 1659 − 54 − 116 = **1489**
