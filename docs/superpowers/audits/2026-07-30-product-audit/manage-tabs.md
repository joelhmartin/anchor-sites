# Big-Picture Audit — Legacy Management Surfaces (`/sites/:slug/manage`)

Slice: `SiteDetailPage.tsx`, all 12 files under `src/admin/pages/site-tabs/` (10 tabs + GitCard + tests), `PostEditorPage.tsx`, `EventEditorPage.tsx`, plus `SaveAsTemplateDialog.tsx` (mounted in the manage header). Read-only audit, 2026-07-30, branch `feat/lovable-workspace`.

## Census (M = 15 units)

| # | Unit | File | What it is |
|---|------|------|------------|
| 1 | Manage shell | `src/admin/pages/SiteDetailPage.tsx` | slug→id resolution, header (name, status badge, Save-as-template, View-live link), 10-tab tablist |
| 2 | Pages tab | `src/admin/pages/site-tabs/PagesTab.tsx` | pages table, "+ New page" form, "Add from template" form, Edit→workspace |
| 3 | Blog tab | `src/admin/pages/site-tabs/BlogTab.tsx` | posts table, "+ New post" form, Edit→PostEditorPage |
| 4 | Events tab | `src/admin/pages/site-tabs/EventsTab.tsx` | events table, "+ New event" form (slug/title/starts), Edit→EventEditorPage |
| 5 | Members tab | `src/admin/pages/site-tabs/MembersTab.tsx` | read-only members table + email-password login-provider toggle |
| 6 | Media tab | `src/admin/pages/site-tabs/MediaTab.tsx` | asset grid, 3-step signed-URL upload, Refresh |
| 7 | Plugins tab | `src/admin/pages/site-tabs/PluginsTab.tsx` | per-plugin enable toggle + schema-generated config form, secret set/unset |
| 8 | Domains tab | `src/admin/pages/site-tabs/DomainsTab.tsx` | domain cards (DNS/SSL badges, Provision, Remove), add-custom-domain form, required-DNS-records table |
| 9 | Integrations tab | `src/admin/pages/site-tabs/CrmTab.tsx` | CRM site ID card, tracking phone numbers (copy), block-usage notes |
| 10 | SEO tab | `src/admin/pages/site-tabs/SeoSettingsTab.tsx` | title template, default description, twitter handle, default share image |
| 11 | Settings tab | `src/admin/pages/site-tabs/SettingsTab.tsx` | display name, CTM account ID, analytics toggle, brand tokens, hostnames card |
| 12 | Git sync card | `src/admin/pages/site-tabs/GitCard.tsx` | enable/disable toggle, Export now, sha/sync/error readout (inside Settings tab) |
| 13 | Post editor | `src/admin/pages/PostEditorPage.tsx` | title/excerpt/status metadata, SeoPanel, TipTap BlockBodyEditor, one-PUT save |
| 14 | Event editor | `src/admin/pages/EventEditorPage.tsx` | title/starts/ends/location/status, SeoPanel, BlockBodyEditor, one-PUT save |
| 15 | Save-as-template dialog | `src/admin/components/SaveAsTemplateDialog.tsx` | name/description, page-subset checkboxes, POST save-as-template |

## Brief-premise checks (per operator instruction: verify, don't assume)

- **"Sites have NO delete" — CONFIRMED.** `src/server/routes/admin-sites.ts` has get/post/patch only; `patchSitePayload` has no `status` field, so the `archived`/`suspended` states the header badge can render (SiteDetailPage.tsx:22-26) are unreachable from any UI or admin API.
- **"Failed git export — NO manual retry affordance" — PARTIALLY WRONG.** GitCard.tsx:145 ships an "Export now" button (`POST /api/sites/:siteId/git/export`) that is exactly a manual retry for exports. What is actually missing: (a) the export is an **enqueued async job** (`admin-git.ts:147-166`, pg-boss), so its outcome is invisible until the user happens to reload; (b) there is no manual **import** trigger at all. Directives D415/D416 state the real gaps.
- **"Webmaster-Central prereq surfaces as click-time PermissionDenied" — CONFIRMED server-side** (`src/server/jobs/site-provision.ts:26-28`, `src/server/sites/create-site.ts:104`) and **confirmed absent from manage UI** — no tab mentions it; DomainsTab provision failures are additionally invisible (D400).
- Posts and events **do** have server DELETE routes (`src/server/routes/admin-tenant.ts:63` posts, `:133` events) — the UI just never calls them. Pages and media have **no** DELETE route at all (`admin-pages.ts`, `media.ts`: POST/GET only).

## Lens legend (L = 19)

Term=Terminality · Grain=Structure/Grain · Org=Organization · Prov=Provenance→Consumption · Comp=Comprehension · StVis=State-Visibility · Hon=Honesty · Rev=Reversibility/Safety · Idem=Idempotence/Accretion · Fail=Failure/Recovery · Pre=Precondition/Forward-path · Pop=Population/Dark · Sib=Sibling-Coherence · Gate=Gating-Axis · Temp=Temporal-Integrity · Cost=Cost/Value · Contr=Contract-Stability · Name=Naming/Least-astonishment · A11y=Accessibility

## Ledger (15 × 19 = 285 cells; P = pass, Dnnn = directive, — = n/a; no blanks)

| Unit | Term | Grain | Org | Prov | Comp | StVis | Hon | Rev | Idem | Fail | Pre | Pop | Sib | Gate | Temp | Cost | Contr | Name | A11y |
|------|------|-------|-----|------|------|-------|-----|-----|------|------|-----|-----|-----|------|------|------|-------|------|------|
| 1 Shell | D409 | D410 | D427 | P | D411 | P | P | — | — | P | P | P | D411 | P | P | P | P | D427 | D412 |
| 2 Pages | D405 | P | D432 | P | P | P | P | — | P | P | P | P | D436 | P | D433 | P | P | P | P |
| 3 Blog | D406 | P | P | P | P | P | P | — | P | P | P | P | P | P | D433 | P | P | P | P |
| 4 Events | D407 | P | P | P | P | P | P | — | P | P | P | P | P | P | P | P | P | P | P |
| 5 Members | D423 | P | P | P | P | P | P | D424 | P | P | P | P | P | P | P | P | P | P | P |
| 6 Media | D408 | P | P | P | P | P | D417 | — | P | D418 | P | P | P | P | P | P | P | P | D417 D431 |
| 7 Plugins | P | P | P | P | D439 | P | D413 | D414 | P | P | D438 | D438 D439 | P | P | P | P | D434 | P | P |
| 8 Domains | P | P | P | P | D403 | D404 | D400 D402 | D401 | P | D400 | D403 D428 | P | P | P | P | P | D400 | D403 | D428 |
| 9 Integrations | — | P | P | P | D425 | P | P | — | — | D425 | D426 | P | P | P | — | P | P | D427 | D437 |
| 10 SEO | P | P | P | P | P | P | D422 | — | D422 | P | P | P | P | P | P | P | P | P | P |
| 11 Settings | D409 | P | D427 | P | P | P | D422 | P | D422 | P | P | P | P | P | P | P | P | P | P |
| 12 GitCard | P | P | D427 | P | P | D415 | D435 | P | P | D416 | P | P | — | P | D416 | P | P | P | P |
| 13 Post editor | D406 | P | P | P | P | P | P | D420 | P | P | P | P | P | P | D430 | P | P | D419 | P |
| 14 Event editor | D407 | P | P | P | P | P | D421 | D420 | P | P | P | P | P | P | D430 | P | P | D419 | P |
| 15 Save-as-template | — | P | P | P | P | P | P | P | P | P | D429 | P | P | P | — | P | P | P | P |

**Cell tally:** 285 cells · Pass 210 · Directive cells 61 · n/a 14 · Blank 0.

### Notable passes (so they aren't relitigated)
- Slug-conflict 409s get specific human messages in every create form (PagesTab.tsx:125-127, BlogTab.tsx:66-68, EventsTab.tsx:67-69).
- Plugin secrets: set/unset indicator, blank-preserves, never echoed (PluginsTab.tsx:163-167, server contract honored) — a genuine Honesty pass.
- GitCard's unconfigured state explains itself and points at docs (GitCard.tsx:99-110); its timestamp-labeling comment (lines 151-159) shows deliberate honesty about `last_synced_at` semantics.
- Server-side export dedupe via pg-boss singleton keys (admin-git.ts) makes double-clicking "Export now" idempotent.
- MembersTab empty state explains provenance ("Visitors who sign up on this site appear here", MembersTab.tsx:111).
- Save-as-template maps 409/422 to actionable messages (SaveAsTemplateDialog.tsx:77-83).

## Directives (N = 40)

[D400] (Domains: Provision) × (Honesty/Failure/Contract) — «Every step outcome an operation returns must be rendered; a failure the user cannot see did not happen, and did not fail». Instance: `provision()` stores a `ProvisionResult` whose `steps` array (including cloud_run/DNS error steps, and the catch-branch synthetic error step at DomainsTab.tsx:103-109) is NEVER rendered — the JSX only shows `required_records` (DomainsTab.tsx:225); a failed provision paints nothing at all. Fix-class: render the steps list (ok/error per step) beneath each domain card.

[D401] (Domains: Remove) × (Reversibility/Safety) — «Destructive, hard-to-reprovision actions require confirmation». Instance: "Remove" fires `DELETE .../domains/:id` (best-effort unprovision of Cloud Run mapping + DNS) on a single click with no confirm, DomainsTab.tsx:212-222. Fix-class: confirm dialog naming the hostname and what unprovisioning does.

[D402] (Domains: Remove) × (Honesty) — «Never swallow a mutation error». Instance: `removeDomain`'s `catch { /* Ignore — UI will refresh on next reload */ }` DomainsTab.tsx:86-88 — a failed removal leaves the row present with zero feedback, indistinguishable from a slow reload. Fix-class: surface the error like `addError` is surfaced.

[D403] (Domains tab) × (Precondition/Comprehension/Naming) — «Preconditions and jargon must be explained where the button lives, not discovered as click-time errors». Instance: the Webmaster-Central/Search-Console domain-verification prerequisite (site-provision.ts:26-28) appears nowhere in the UI; `managed`/`client-owned` chips and the "Provision" verb are unexplained (DomainsTab.tsx:181-183, 210). Fix-class: one help paragraph per domain class + tooltip/rename ("Set up hosting & DNS").

[D404] (Domains: status badges) × (State-Visibility) — «A displayed pending state needs a path to resolution». Instance: `verification_status`/`ssl_status` render as static badges (DomainsTab.tsx:193-198) with no "Check now"/refresh; the only way to re-evaluate is re-clicking Provision, which isn't labeled as such. Fix-class: verify/re-check action (or auto-poll while pending) per domain.

[D405] (Pages tab) × (Terminality) — «Every creatable entity needs a deletion or archival path». Instance: pages can be created two ways (PagesTab.tsx:110-133, 87-108) but deleted zero ways — no UI affordance and no `DELETE /pages/:id` route exists (admin-pages.ts has POST/GET only). Fix-class: server DELETE route + row action with confirm.

[D406] (Blog tab / Post editor) × (Terminality) — «When the API supports delete, the UI must expose it». Instance: `DELETE /api/sites/:siteId/posts/:postId` exists (admin-tenant.ts:63) but neither BlogTab rows nor PostEditorPage offer it. Fix-class: "Delete post" (confirmed) in the editor header + row menu.

[D407] (Events tab / Event editor) × (Terminality) — «Same law as D406». Instance: `DELETE /api/sites/:siteId/events/:eventId` exists (admin-tenant.ts:133); no UI calls it. Fix-class: same as D406 for events.

[D408] (Media tab) × (Terminality) — «Uploaded assets must be removable». Instance: no delete affordance and no DELETE route (media.ts: four POSTs, no delete) — every upload, including failed-variant and abandoned-pending assets, accretes forever. Fix-class: DELETE route + grid-tile remove with confirm.

[D409] (Shell header / Settings tab) × (Terminality) — «The site itself needs a lifecycle exit; don't render states you can't reach». Instance: status badge can show `archived`/`suspended` (SiteDetailPage.tsx:22-26) but `patchSitePayload` has no `status` field and admin-sites.ts has no delete — no UI or API can archive, suspend, or delete a site. Fix-class: PATCH `status` support + a Settings "Danger zone" card (archive first; delete can stay withheld deliberately, but then don't render unreachable badge states without a note).

[D410] (Shell tabs) × (Structure/Grain) — «Navigational state belongs in the URL». Instance: active tab is `useState` only (SiteDetailPage.tsx:88) — refresh/back resets to Pages, tabs can't be deep-linked or shared, and every editor back-link loses your place (see D430). Fix-class: `?tab=` search param (or `/manage/:tab` route).

[D411] (Shell) × (Comprehension/Sibling-Coherence) — «When one product has two surfaces for the same site, each must name the other and the split». Instance: manage never links to the workspace and never explains what belongs where — header offers only "← Sites" and "View live site" (SiteDetailPage.tsx:95-113); WorkspacePage links here ("Manage", WorkspacePage.tsx:509-512) but not vice-versa; PagesTab silently teleports you to the workspace on Edit (PagesTab.tsx:299). Fix-class: "Open workspace" header link + one-line split explanation ("Design in the workspace; operate here").

[D412] (Shell tablist) × (Accessibility) — «role="tablist" implies the full ARIA tabs contract». Instance: tab buttons (SiteDetailPage.tsx:131-148) have `role=tab`/`aria-selected` but no `id`/`aria-controls`, the tabpanel has no `aria-labelledby`, and there is no arrow-key navigation or roving tabindex. Fix-class: complete the ARIA tabs pattern or drop the roles.

[D413] (Plugins tab) × (Honesty) — «A failed read must never masquerade as an empty/default state — especially when the view can write». Instance: PluginsTab.tsx:41-42 handles `available.error` but ignores `installed.error`; if the installed-plugins fetch fails, every card renders enabled=false with default config, and clicking Save writes those defaults over the real per-site config. Fix-class: treat `installed.error` as a blocking error state.

[D414] (Plugins: enable toggle) × (Reversibility/Safety) — «Disabling a live capability warrants a beat of friction». Instance: unchecking "Enabled" + Save silently turns off a plugin whose blocks may be live on published pages (PluginsTab.tsx:142-153); no confirm, no impact note (`blocks` metadata is available but unused). Fix-class: confirm on disable listing the plugin's block types.

[D415] (GitCard: Export now) × (State-Visibility) — «An enqueued job's outcome must reach the screen that launched it». Instance: export enqueues a pg-boss job (admin-git.ts:147-166) and GitCard calls `reload()` immediately (GitCard.tsx:70-71) — the readout races the job; success/failure only appears if the user later revisits the tab. Fix-class: poll `GET .../git` for a bounded window after enqueue (or show "export queued" explicitly).

[D416] (GitCard: error readout) × (Failure/Recovery/Temporal) — «An error without a timestamp or next step is a rumor». Instance: `last_error` renders bare (GitCard.tsx:165) with no when, no which-operation (export vs webhook import), and no import-side retry (export has "Export now"; import has nothing); `relativeTime` renders once and goes stale. Fix-class: timestamp + operation label on the error; document/import-trigger for the import path.

[D417] (Media: upload/alt) × (Honesty/Accessibility) — «Filenames are not alt text, and alt text must be editable». Instance: upload hardcodes `alt: file.name` (MediaTab.tsx:59) and no surface anywhere edits it afterward — every image on every published site carries "IMG_4032.jpg"-grade alt text. Fix-class: alt field at upload + editable in the grid tile.

[D418] (Media: variant states) × (Failure/Recovery) — «"failed" and stuck-"pending" tiles need a retry or removal path». Instance: a `variants_status: "failed"` asset renders a red badge forever with no retry (MediaTab.tsx:148-151); if the 3-step upload dies between step 1 and 3 the pending DB row becomes a permanent phantom tile (no cleanup, and no delete per D408). Fix-class: re-enqueue-variants action + delete; server-side sweep of never-completed uploads.

[D419] (Post/Event editors: save affordance) × (Naming/Least-astonishment) — «A button named Publish must publish». Instance: the only save affordance is the body editor's "Publish" button, which performs a plain save of whatever the separate status dropdown says — selecting "draft" then clicking "Publish" saves a draft (PostEditorPage.tsx:160-165, EventEditorPage.tsx:195-200; both files' helper text exists precisely because the naming is wrong). Fix-class: rename to "Save", or make it a Save/Publish split button driven by status.

[D420] (Post/Event editors) × (Reversibility/Safety) — «Unsaved work must not be silently discardable». Instance: metadata + body edits live only in state; the "← Back to {slug}" link (PostEditorPage.tsx:111, EventEditorPage.tsx:133) and browser nav discard everything with no dirty-check or beforeunload guard. Fix-class: dirty flag + navigation blocker.

[D421] (Event editor: Starts field) × (Honesty) — «Clearing a field must either clear the value or refuse visibly». Instance: `starts_at: fromLocalInput(startsAt) ?? undefined` (EventEditorPage.tsx:109) means clearing Starts silently keeps the old value on save while clearing Ends genuinely clears (`?? null` semantics, line 110) — asymmetric and invisible. Fix-class: make Starts required with validation message, or send explicit null handling.

[D422] (Settings tab / SEO tab: save) × (Idempotence/Honesty) — «After a successful save, the form's baseline is what you saved». Instance: both tabs compute dirty against the mount-time `site` prop which is never refreshed (SettingsTab.tsx:41-46, SeoSettingsTab.tsx:28-32), so after "Saved." the Save button stays enabled, re-sending the same PATCH forever; "Saved." and an armed Save button contradict each other. Fix-class: reset baseline state from the PATCH response (or reload site) on success.

[D423] (Members tab) × (Terminality) — «Accounts you display, you must be able to administer». Instance: members table is strictly read-only (MembersTab.tsx:115-144) — no remove/disable account, no resend-verification for `unverified`, no password reset; a spam or abusive signup is permanent. Fix-class: per-row actions backed by tenant-auth admin routes.

[D424] (Members: login-provider toggle) × (Reversibility/Safety) — «Turning off the only door needs a warning». Instance: unchecking "Email + password" — the sole v1 provider — and saving locks every existing member out of the site with no confirmation or consequence note (MembersTab.tsx:73-90). Fix-class: confirm with member count when disabling the last enabled provider.

[D425] (Integrations: CRM card) × (Failure/Recovery/Comprehension) — «Dead-end states need a retry; client UIs must not speak in env-var names». Instance: the unprovisioned state says "check the CRM_BASE_URL / CRM_API_KEY secrets" (CrmTab.tsx:110-114) — infrastructure secret names in a product surface — and offers no "retry provisioning" action; the only remedy stated is re-creating the site. Fix-class: retry-provision button + operator-appropriate copy.

[D426] (Integrations: phone numbers) × (Precondition/Forward-path) — «Name a destination, link the destination». Instance: "Configure them in anchor-hub" (CrmTab.tsx:73) and "Manage campaigns, forms, and tracking numbers in anchor-hub" (CrmTab.tsx:106) are plain text — no URL, though `crm_site_id` is known. Fix-class: deep-link to the anchor-hub site record.

[D427] (Shell tab set) × (Organization/Naming) — «Tab names must predict tab contents; features must live where users hunt for them». Instance: "Integrations" contains only CRM/CTM content (CrmTab) while the CTM account ID field lives in Settings (SettingsTab.tsx:90-100) and GitHub sync — an integration — hides as the third card inside Settings (SettingsTab.tsx:153); a user hunting "GitHub" checks Integrations and finds phones. Fix-class: move GitCard (and arguably CTM ID) into Integrations, or rename the tab "CRM".

[D428] (Domains: add form) × (Precondition/Accessibility) — «Validate before the round-trip; every input gets a label». Instance: hostname input has placeholder-only labeling and no client-side hostname validation (DomainsTab.tsx:140-148) — contrast the slug fields elsewhere which validate inline with `aria-invalid`. Fix-class: `<Label>` + hostname regex with inline message.

[D429] (Save-as-template dialog) × (Precondition/Forward-path) — «A save needs a "where did it go"». Instance: after "Saved 'X' as a template" (SaveAsTemplateDialog.tsx:101-107) there is no link to view, rename, or delete the template, and no template-management surface is referenced anywhere in manage; a typo'd template is unfixable from here (templates.ts does expose delete). Fix-class: link the success state to the template picker/management surface.

[D430] (Post/Event editors: back link) × (Temporal-Integrity/Forward-path) — «Back must return to where you were». Instance: "← Back to {slug}" targets `/sites/:slug/manage` (PostEditorPage.tsx:111, EventEditorPage.tsx:133) which always reopens on the Pages tab (D410), losing the Blog/Events context the user came from. Fix-class: carry `?tab=blog|events` once D410 lands.

[D431] (Media: tile metadata) × (Accessibility) — «Hover-only information excludes keyboard and touch». Instance: alt/dimensions overlay appears only on `group-hover` with `pointer-events-none` (MediaTab.tsx:152-159); tiles are unfocusable divs — no keyboard path to any asset info. Fix-class: focusable tiles with `focus-within` overlay (or click-to-detail).

[D432] (Pages tab: create forms) × (Organization) — «Mutually exclusive entry forms should be mutually exclusive on screen». Instance: "Add from template" and "+ New page" toggle independently (PagesTab.tsx:140-146) — both cards can be open at once, two competing creation flows stacked. Fix-class: opening one closes the other (single `mode` state).

[D433] (Pages/Blog tables: Updated column) × (Temporal-Integrity) — «Same-day edits need more than a date». Instance: `toLocaleDateString()` (PagesTab.tsx:294, BlogTab.tsx:165) collapses today's 9am and 5pm edits into the same string, while EventsTab correctly uses `toLocaleString()` for starts. Fix-class: relative time or date+time, consistently.

[D434] (Plugins: config form) × (Contract-Stability) — «A schema-generated form must round-trip the schema's types». Instance: every config value is coerced to `String(...)` on load and sent back as a string (PluginsTab.tsx:89, 113-119) — a Zod `number`/`boolean` config field will fail server validation (or corrupt config) with an opaque error; booleans render as text inputs. Fix-class: type-aware widgets + typed serialization from `config_schema.properties[].type`.

[D435] (GitCard: Enable) × (Honesty) — «Announce side effects at the button». Instance: enabling sync also enqueues an initial full export (admin-git.ts:18, :166) but the UI says nothing — the operator doesn't learn a commit is about to land in the repo; the single shared `busy` flag also spinners the Enable button while an export runs, conflating the two actions (GitCard.tsx:50, 137-147). Fix-class: "Enabling runs a first export" note + per-action busy state.

[D436] (Pages tab: rows) × (Sibling-Coherence) — «Sibling surfaces should agree on which verbs exist for an entity». Instance: page status can be published/unpublished per-page via workspace publish and API (`admin-pages.ts` P5-T5.10 status toggle) but the manage Pages list — the operational surface — offers no status change, only Edit-which-leaves-the-surface (PagesTab.tsx:295-303); Blog/Events editors meanwhile DO expose status dropdowns. Fix-class: publish/unpublish row action on the Pages list.

[D437] (Integrations: Copy button) × (Accessibility) — «Actions must confirm they happened». Instance: phone-number "Copy" (CrmTab.tsx:61-67) gives zero feedback on success and silently swallows clipboard failure (`.catch(() => undefined)`) — no "Copied", no aria-live. Fix-class: transient "Copied" state + aria-live region.

[D438] (Plugins: required_env) × (Precondition/Population-Dark) — «Data fetched for a reason must serve that reason». Instance: `required_env: string[]` arrives in the payload typed at PluginsTab.tsx:23 and is never read — a plugin whose env is missing can be enabled from here and will fail at runtime with no UI warning. Fix-class: render an unmet-env warning chip on the card; disable Enable when unmet.

[D439] (Plugins: cards) × (Comprehension/Population-Dark) — «A first-time user must learn what a thing does from its card». Instance: cards show only `name` + `vX.Y.Z` (PluginsTab.tsx:138-140); the fetched `blocks` (type+label) and `has_router` metadata that would explain what enabling adds are never rendered, and raw config keys (`key`, not labels) double as field labels. Fix-class: description line + "provides blocks: …" from existing payload fields.

## Severity ranking (top tier first)

1. **D400** — provision failures are literally invisible; combined with D403 the known Webmaster-Central failure mode is undiagnosable from the UI.
2. **D413** — a transient fetch failure can lead an operator to overwrite real plugin config with defaults.
3. **D424** — one unconfirmed checkbox locks all members out of a live site.
4. **D402** — destructive domain removal swallows its own errors.
5. **D409/D405/D408** — the terminality family: sites, pages, and media cannot be deleted/archived by any path; posts/events can (API) but the UI hides it (D406/D407).
6. D415/D416, D417, D422, D419-D421, then the remainder.
