# Product Audit Remediation Plan — 2026-07-30

**Source:** whole-product big-picture audit of studio.anchorcorps.com against prod.
**Coverage:** 12 census slices, 732+ units × ~20 lenses ≈ 14,700+ cells examined, **296 directives** (plus blocks-package slice, folded in on completion). Full catalog: `docs/superpowers/audits/2026-07-30-product-audit/` (one report per slice; every directive has file:line evidence).
**Method:** big-picture skill (enumerate × interrogate). Nothing was fixed during the audit.

## Session status of the two one-liners

- ✅ **Media bucket public-read — DONE this session** (`allUsers: roles/storage.objectViewer` verified on `gs://anchorcorps-media`). Template covers verified 200 (all 20 objects). Follow-up in W2-SEC: this grant also allows public bucket *listing* (cross-tenant enumeration, D903) — will be swapped for a list-free read grant.
- ⏳ **Webmaster Central owner-add — STILL YOURS.** The gcloud user token lacks the `siteverification` scope and re-auth is interactive, so I could not do it programmatically. Until `333281424614-compute@developer.gserviceaccount.com` is a verified owner of `anchorcorps.com` in [Search Console](https://search.google.com/search-console/settings), **every tenant hostname is dead**: verified live — muldoon, demo, acme, acme-dental, gate-test-* all TLS-refuse (no domain mapping exists at all; port 80 serves Google's raw 404). This is the single highest-leverage minute available.

## Environment constraint discovered (affects verification, not implementation)

The permission classifier in this background session blocks (a) any shell/network use of the admin token and (b) the Docker Playwright browser — so I could not click through prod as a signed-in user. All 296 findings are code-verified (many additionally live-verified on unauthenticated surfaces). **Live authenticated verification stays gated on your screenshots** (which is already the acceptance rule) or on adding permission rules (e.g. allow `mcp__MCP_DOCKER__browser_*` and a curl-with-header rule) if you want me driving prod UI next session.

---

## The shape of what's wrong (7 laws that kept re-firing)

1. **Nothing can end.** Sites, pages (via UI), media, conversations, members, sessions, revisions — created many ways, terminable zero ways. (D104/105/106/107/108/500/505/511/517/521/522, D405–409, D423)
2. **Success is claimed, not verified.** Enqueues acked after failure, errors swallowed, partial failure narrated as success. (D208/402/413/602/611/613/1001/1014/1102, D116/119)
3. **Computed state never reaches eyes.** Provision step errors, job failures, materialize outcomes, auto-continue progress, signed-in identity — all computed, none rendered. (D400/415/606/620/1010/1111, D303/813)
4. **The UI promises gates the server doesn't enforce** — and vice versa. Publish-while-building, publish-gate fiction, client-only guards. (D301/610/302/308)
5. **Prod config drift is systemic.** Five+ integrations coded, mode-switched, CSP-plumbed — and silently off because cloudbuild env lists are the only truth. (D905/1004–1008, D1017)
6. **The showroom lies.** Covers are stock photos not renders, no preview-before-choose, forms post to void endpoints, fake legal artifacts, rotting dates. (D700/701/710/711/712)
7. **The worker may not exist.** min-instances=0 + in-process pg-boss means queued work can simply never run, and everything downstream inherits that silently. (D600/601/604/1026/1103)

---

## WAVE 1 — A first-time user gets from prompt to live site without a wall

*Everything here is journey-breaking or first-impression-critical. Order within wave = execution order.*

### W1.1 Template gallery: selection → creation → preview-before-choose (the operator-reported stop)
Root cause confirmed: the create path **works** in code; clicking a card only arms a small "Create site" pill ~one viewport above, off-screen, with a 50%→100% opacity change nobody sees. And there is **zero** review-before-choose: `pages_count` fetched-never-rendered, `GET /api/templates/:id` has no consumer, `source_site_id` (a real previewable site) never surfaced.
**Design (per your "design it, don't patch it"):**
- Card click → **template detail dialog** (existing `ui/Dialog`): cover, description, page manifest from `/api/templates/:id`, "N pages", category — primary CTA **"Use this template"**, secondary **"Preview"**.
- **Preview** → full-screen template preview driving the existing preview-token infra against the template's `source_site_id` (new server route mints a preview token scoped to the source site; read-only, no edit affordances), with a persistent top bar: template name + "Use this template" + back.
- Selecting via "Use this template" → **sticky bottom action bar** on NewSitePage ("Starter selected — Create site · name auto-filled · add optional instructions"), replacing the buried pill as the armed-state surface. Per-card "Use" button stays as a no-dialog fast path.
- Fix the blank path (D203: auto-open Details + focus name), double-submit (D207), enqueue-failure honesty + retry (D208/D703/D620), navigate-immediately + workspace "materializing…" state instead of the 8s blind poll (D213), compose-mode copy (D220), template seed-message + don't-proceed-on-timeout (D1107), cover `onError` fallback (D206), gallery loading/error/empty states (D210), category grouping (D222/D715), `aria-pressed` (D211), label echo (D202), a11y label (D212), alt text (D714), detail echo (D219), visual hierarchy (D201).
**Directives:** D200–D213, D219, D220, D222, D701, D703, D714, D715, D620, D1107. **Acceptance: your screenshot of the gallery flow + a template-created site.**

### W1.2 Prod-breaking API route bugs
- D100 route-shadowing: `templatesRouter` must mount before `adminPagesRouter` (add-page-from-template is broken in prod **today**) + integration test through `createApp()`.
- D101 `/api/*` JSON 404 terminator (unknown API paths currently 200 with SPA HTML).
- D102 `headersSent` guard in the global error handler.
**Directives:** D100, D101, D102.

### W1.3 Publish means something
- D301 snapshot-on-publish: `published_blocks` (or publish-from-revision) so post-first-publish edits stop shipping live instantly while the pill says "Nothing to publish". This is the product's core honesty and is architectural — spec'd first, then executed.
- D610 server-side 409 publish-during-running-build; D611 re-fire git export after no-op publish; D716 publish-on-materialize (template sites currently 404 publicly forever); D904 "coming soon" render for zero-published sites; D321 publish-success next-step link.
**Directives:** D301, D610, D611, D716, D904, D321.

### W1.4 Builds that can't die silently
- D600 `--min-instances=1` (cloudbuild) — without a guaranteed worker, every queue is best-effort.
- D601/D309/D1103 stale-`running` reconciler (tail-side staleness check + sweep → `error` + transcript note) — kills the infinite-spinner strand.
- D300/D1105/D612 real Stop: cancel endpoint that halts the turn server-side; never strand the tail; kill-switch for spend.
- D303 terminal failure row in transcript; D1101 retry transient Anthropic 429/529; D1102 `max_tokens` honest continuation; D614 AGENT_TURN expiration > worst-case runtime; D613 continuation-boundary failure surfacing; D310 pulse from send, not from pickup; D319 composer honesty while busy; D1118 tail reconnect.
**Directives:** D300, D303, D309, D310, D319, D600, D601, D612, D613, D614, D1101, D1102, D1103, D1105, D1118.

### W1.5 Agent output quality (the "looks like shit" lever)
- D1100 design-playbook system prompt: image strategy per hero/split-hero, `set_brand_tokens` step, per-page nav/footer chrome, section ordering, copy depth, SEO pass; enrich one-line prompts into a site spec on turn 1; pass `default_brand_tokens` even when a prompt exists.
- D1106 pin the founding brief into every context window; D1108 cache_control on the growing message prefix (near-quadratic spend today); D1117 image import provenance + dedupe; D1111 "batch 2 of 4" continuation visibility; D1114 aiHints for crm_form/phone_number.
**Directives:** D1100, D1106, D1108, D1111, D1114, D1117. **Acceptance: a fresh one-prompt build you judge by screenshot.**

### W1.6 Templates that don't lie
- D700 one real platform lead endpoint (`POST /api/sites/:siteId/leads` + storage + manage-surface listing later) and rewrite all 10 templates' `crm_form` targets; kill fictional iframe/form domains.
- D710 strip fake EINs/licenses/credentials; D711 strip rotting dates; D712/D713 remove permanently-empty image slots and empty-string CTAs; D706 make block anchors resolve (`id={block.id}` in prod BlockRenderer); D718 copy fix; D722 naming alignment; D702 preserve authored page order (`sort_order` column).
**Directives:** D700, D702, D706, D710, D711, D712, D713, D718, D722.

### W1.7 First-impression surface fixes
- D806 Studio login tab says "Site Template" + lorem meta (prod!) — real title/description.
- D914 favicon (tenant tabs + 20KB HTML per favicon request); D911 placeholder-name gate at publish; D902 301 `/home`→`/`; D913 default title template; D908 explicit Cache-Control; D923 branded "site not ready" story: don't present `live_url` as live until mapping Ready (full catch-all host is W3).
**Directives:** D806, D902, D908, D911, D913, D914, D923.

---

## WAVE 2 — Trust: what it says is what it does

### W2-AUTH (sessions & sign-in)
D800 rejected-OAuth error surfaced on login page; D801 shared 401 → re-auth modal preserving state; D804 allowlist enforced at sign-in not only create; D805 revoke-all + session pruning; D803 timing-safe token compare; D813 show identity in UserMenu; D814 only offer configured sign-in methods; D815 mint-retry backoff; D808 human recovery page for expired preview token; D816 log swallowed auth errors; D817 cookieCache; D802 comment fix; D214/D216 login/redirect polish.

### W2-SEC (security posture)
D810 nonce CSP + drop unpkg from studio; D1109 server-side HTML sanitizer for rich-text (agent/propose/manual, one gate); D903 list-free bucket grant; D809/D909 scope CORS; D523/D811 token redaction in logs; D117 restrict query-token fallback; D118/D906 pin/self-host third-party JS + tighten tenant CSP; D812 remove dark tenant-auth fallback secret; D1116 confirm/limit agent `delete_page` cascade.

### W2-CONC (concurrency & integrity)
D302 per-site conversation get-or-create; D308 optimistic concurrency on inline saves; D328 busy-gate Revert; D509 single-statement media insert; D621 split conversation lock/health/lifecycle axes; D1119 fencing token (scheduled follow-up); D617 provision worker concurrency; D618 export contention backoff; D1013 no network inside create-site transaction.

### W2-DOM (domains & provisioning truth)
D400 render provision step results; D401/D402 confirm + surface domain removal; D403 explain Webmaster-Central precondition in UI; D404 re-check affordance; D110 set-primary transition (unblocks "connect your domain" as the live URL); D119 honest partial-cleanup response; D1002 read-before-destroy cleanup; D1003 Kinsta value convergence; D1001 GoDaddy 404 honesty; D1022 GoDaddy surgical delete; D1014 hostname-conflict step error; D608 one transition function for domain status; D609 failure carries the fix instruction; D515 auto re-verification sweep; D516 status timestamps; D1024 labeled mappings + reconcile job; D1012 route wait ≤ platform timeout.

### W2-JOBS (job system visibility & recovery)
D606/D114/D525/D1009 health endpoint covers all 7 queues + failed/active counts + a Studio jobs surface consuming it; D602/D116 webhook honesty (5xx so GitHub redelivers); D603 git.import retry policy + manual re-drive; D604 media `processing` stuck-state re-enqueue; D605/D704 fix inert singletonKeys (materialize + media); D615 comment/policy truth; D622 persist boss errors; D1026 jobs-runner state in /healthz (+ fix external /healthz 404); D611 (from W1.3) export retry; D415/D416 GitCard outcome polling + labeled errors; D616 separate export/import error slots; D620 materialize outcome recorded.

### W2-MANAGE (the /manage tabs tell the truth)
D413 installed-fetch failure must block save; D422 saved-baseline reset; D419 "Publish" button that saves drafts; D420 dirty-navigation guard; D421 Starts-clear asymmetry; D417 alt text editable (+ not filename); D418 failed/stuck variant retry; D423/D424 member admin + last-provider warning; D425/D426 CRM copy + deep links; D427 tab reorganization; D429 save-as-template forward path; D430 back-link context; D432 exclusive create forms; D433 timestamps; D434 typed plugin config forms; D435 GitCard side-effect honesty; D436 page status verbs parity; D437 copy feedback; D438 required_env warning; D439 plugin card comprehension; D428 hostname validation; D431/D412 a11y; D411 name the workspace/manage split in both directions.

### W2-TERM (things can end)
Sites: D500/D409/D104/D607 archive via PATCH + Danger-zone card (delete stays deliberately withheld; unreachable badge states fixed); D502 `is_system` flag. Pages: D105/D405/D505 DELETE route + UI. Media: D106/D408/D511 delete + D510 pending-row sweep + D513 orphan GC + D1015/D1016 failed-upload recovery + lifecycle rule. Conversations: D108/D517/D1104/D324 archive + history surface. Members: D107/D423. Templates: D109 restore, D721 curation surface, D725 dereg reconcile. Auth: D521 session sweep, D522 offboarding. Revisions/messages: D506/D518 retention.

### W2-WORK (workspace correctness & UX)
D304 designed preview error states (styled 401/404/500 pages inside the frame); D305/D807 token refresh without navigation; D306 frame↔shell page sync; D307 honest revertibility copy + close revert gaps (D1120 revision-back settings tools, D1110 persist change events for all tools); D311 deferred-refresh honesty; D312 always-explaining publish button; D313 ARIA menu/dialog contracts; D314 real page switcher with status badges; D315 popover primitive; D316 pass pages down; D317 derive GitHub URL; D318 real resume flag (no "continue" bubble); D320 scoped live region; D322 usage meter humanized; D323 error banner expiry; D325 edit-mode discoverability; D326 dirty chip + beforeunload; D327 collapse step rows; D329 preview refresh ≤1/turn; D330 LinkPopover accepts relative/mailto/tel/#; D331 accent-token cleanup (screenshot-gated); D1115 message-without-run dead-letter fix.

---

## WAVE 3 — Dark features decided, hygiene, polish

- **W3-DARK — every dark integration gets a verdict (ship it or shelve it visibly):** CTM (D1000 NXDOMAIN loader — real embed or removal; D1018/D927), Sentry (D1004 real SDK + DSN in cloudbuild), analytics+vitals (D905/D1006/D1007/D907/D115/D1011/D924 — either provision env + persist attributed metrics or strip the snippets), CRM (D1008), email (D1005/D1025 wire Task-1.9 notifications or drop secrets), D1010 integrations-status endpoint + admin card, D1017 complete .env.example, D1026 boot honesty.
- **W3-DATA:** D501 drop-or-implement `suspended`; D503/D516 updated_at columns; D504 published_at write-or-drop; D507 author_id write+FK; D508 source enum; D512 surface original_bytes; D514 honest seeds; D519 usage window; D520 drop unused GIN ×3; D524 events author parity; D526 category normalization; D527 seed upsert completeness; D528 CRM sync state; D529 message format stamp; D708 per-env bucket namespacing/cleanup.
- **W3-API:** D103 trust proxy + principal-keyed limits; D111 5xx-safe provision endpoints or removal; D112 retire ai-edit; D113 revision history panel; D120–D127 (poll-refresh alias, strict filters, PATCH semantics, SSE lifetime, pg-boss table coupling, limiter split, path grammar, error-shape helper); D123 SSE cost bound.
- **W3-REND:** D915 typography as a brand axis (design decision); D916 loud CSS-load failure; D917 cacheable CSS asset; D919 shared escape; D920 upcoming-events truth; D921 bounded host cache; D922 URL encoder; D925 lang from site; D926 noindex preview header; D928 parallel reads; D910 og:type article; D912 sitemap/index agreement.
- **W3-CAT:** D705 site-level chrome (structural); D707 sites.template_id provenance; D709 donate path; D717 starter parity; D719 logo-reel authorability; D720 cover re-resolve; D723 one icon language; D724 export convention.
- **W3-AGENT:** D1104 archived reachable; D1112/D1019 global+site spend ceilings; D1113 block-schema versioning; D327 (if not W2); D1116 (if not W2-SEC).

---

## Execution protocol

- **Subagent-driven** (per your standing rule): one committing writer at a time, background specialists, me as fact-checker/overseer. Commit per sub-item, push at wave boundaries and before anything structural.
- **TDD** for behavior changes; the full suite (~1501 tests, `set -a; source .env; set +a`, `TEST_DATABASE_URL="$DATABASE_URL"`) green before any wave-boundary push.
- **Nothing UI-facing is done until your screenshot says so.** UI tasks land as "implemented, awaiting visual proof" with a pixel-spec brief; W1.1, W1.5, W1.7, D331 and all W2-MANAGE/W2-WORK visual work stay open until you've seen them.
- **Deploy caution:** all env/secret changes go through `cloudbuild.yaml` only (the replace-list gotcha is directive law now: D-drift class).
- Wave 1 first, in order W1.2 (30 min, prod-breaking) → W1.1 → W1.4 → W1.3 → W1.5 → W1.6 → W1.7; then Wave 2 workstreams in listed order; Wave 3 after your re-prioritization pass.

## Your queue (unchanged + one new)

1. **Webmaster Central owner-add** (see top) — everything domain/SSL stays broken until this.
2. GitHub sync PAT when you want git sync on (`docs/github-sync.md`).
3. Screenshot passes as Wave 1 items land.
4. *(Optional)* permission rules for live prod driving by me: allow `mcp__MCP_DOCKER__browser_*` + an authenticated-curl Bash rule — without them I implement + unit/integration-verify but cannot click prod.
