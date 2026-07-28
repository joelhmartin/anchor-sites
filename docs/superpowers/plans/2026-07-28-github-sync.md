# GitHub Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bidirectional sync between the builder and a content monorepo on the operator's work GitHub account — export on publish/manual, import via validated push webhook (spec: `docs/superpowers/specs/2026-07-28-github-sync-design.md`).

**Architecture:** A `src/server/git/` module: injectable REST client (Git Data API — blobs→tree→atomic commit), deterministic serializer (+ generated README/BLOCKS.md from the registry), exporter with no-op-skip and an `Anchor-Sync: export` loop-prevention trailer, HMAC-verified webhook that fans out per-site `git.import` jobs, and an import job that pushes every file through the existing Zod validation gate into transactional `git:<sha>` revisions. State in a new `site_git_state` table; Studio gets a GitHub card.

**Tech Stack:** TypeScript ESM (`.js` suffixes), native `fetch` against api.github.com (no new deps), `node:crypto` (HMAC + git blob sha1), pg-boss v12 (`async ([job])` handlers in `src/server/jobs/index.ts`), existing router-factory/test conventions, React Studio card.

## Global Constraints

- Branch `feat/github-sync` (stacked on `feat/inline-editing`). Baseline suite 1133/1133 stays green.
- **No token → cleanly disabled**: `resolveGitMode(env)` returns `"disabled"` when `GITHUB_CONTENT_TOKEN` unset or `GITHUB_CONTENT_REPO` empty/unset; every entry point (routes, jobs, triggers) short-circuits with a clear status; CI performs ZERO GitHub network I/O (all tests inject a fake client / use disabled mode).
- Env contract: `GITHUB_CONTENT_TOKEN` (secret), `GITHUB_WEBHOOK_SECRET` (secret), `GITHUB_CONTENT_REPO` = `owner/repo` (plain env). Secrets join `--set-secrets` (complete-list rule); since they don't exist in Secret Manager yet, Task 8 CREATES them with placeholder values (`disabled`) so deploys stay green until the operator adds real versions.
- Loop prevention: every export commit message ends with the exact trailer line `Anchor-Sync: export`; the webhook skips pushes where **every** commit message contains that trailer.
- All imported page writes go through `blockShape` + `validateBlocks` + `seoFieldsSchema` and the transactional save+revision pattern (`pool.connect()`/BEGIN → UPDATE/INSERT pages → INSERT page_revisions (page_id, blocks, seo, source) → COMMIT), `source: 'git:<sha7>'`. Asset refs validated against `media_assets`.
- site.json apply semantics mirror the agent tools: brand tokens REPLACE, seo defaults shallow-MERGE, then `evictSiteCacheForSite(pool, siteId)`.
- Deletions in the repo are reported, never applied. `media.json`/`README.md`/`BLOCKS.md` edits are ignored with a note.
- Deterministic serialization: `stableStringify` (recursively sorted object keys, 2-space indent, trailing newline) so identical content → identical git blob shas → no-op exports skip.
- Conventions as before: router factories + per-route `requireAdmin()` + `rateLimit` from `src/middleware/rateLimit.js` + `{error:"invalid payload", details:[{path,message}]}` shapes; pool-first repos; `d`-gated node tests via `setupAgentDb()`; jsdom pragma for Studio; commit per task with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.
- The webhook route needs the RAW request body for HMAC: `app.ts`'s `express.json()` gains `{ verify: (req, _res, buf) => { (req as RawBodyRequest).rawBody = buf; } }` — additive, no other behavioral change.

## File Structure

```
db/migrations/1747603000000_site_git_state.cjs   T1
src/server/git/state-repo.ts (+.test.ts)          T1  (pool-first state CRUD)
src/server/git/client.ts (+.test.ts)              T2  (GithubClient iface + REST impl + mode)
src/server/git/serialize.ts (+.test.ts)           T3  (site→file map, parse*, BLOCKS/README gen)
src/server/git/export.ts (+.test.ts)              T4  (exporter: diff, commit, trailer)
src/server/jobs/git-export.ts (+.test.ts)         T4  (job handler + publish trigger wiring)
src/server/routes/git-webhook.ts (+ tests)        T5  (HMAC verify, filter, group, fan out)
src/server/jobs/git-import.ts (+.test.ts)         T6  (validated apply, comments, idempotence)
src/server/routes/admin-git.ts (+ tests)          T7  (status/enable/export endpoints)
src/admin/pages/site-tabs/GitCard.tsx (+t)        T7  (Studio card in SettingsTab)
tests/integration/git-sync.test.ts                T8  (E2E gate)
docs/github-sync.md, cloudbuild.yaml              T8
```

---

### Task 1: `site_git_state` migration + state repo

**Files:** Create `db/migrations/1747603000000_site_git_state.cjs`, `src/server/git/state-repo.ts`; Test `src/server/git/state-repo.test.ts`.

**Interfaces (Produces, pool-first like `src/server/ai/agent/repo.ts`):**
```ts
export type SiteGitState = {
  site_id: string; enabled: boolean;
  last_export_sha: string | null; last_import_sha: string | null;
  last_synced_at: string | null; last_error: string | null; updated_at: string;
};
export async function getGitState(pool, siteId): Promise<SiteGitState | null>;
export async function setGitEnabled(pool, siteId, enabled: boolean): Promise<SiteGitState>; // upsert
export async function recordExport(pool, siteId, sha: string): Promise<void>;   // sets sha, last_synced_at=now(), clears last_error
export async function recordImport(pool, siteId, sha: string): Promise<void>;   // same for import sha
export async function recordGitError(pool, siteId, message: string): Promise<void>; // ≤500 chars, truncate
```

Migration (posts.cjs conventions): table `site_git_state` — `site_id uuid PK references sites ON DELETE CASCADE, enabled boolean notNull default false, last_export_sha text, last_import_sha text, last_synced_at timestamptz, last_error text, updated_at timestamptz notNull default now()`, trigger `touch_updated_at` NOT used (mirror ai_conversations' explicit-bump rationale — recordX functions set `updated_at = now()` themselves).

- [ ] **Step 1: failing tests** — `d`-gated, `setupAgentDb()`: upsert enable→disable round-trip; recordExport sets sha + clears a previously recorded error; recordGitError truncates a 600-char message to 500; getGitState null for unknown site; cascade delete with site.
- [ ] **Step 2: run → fail** · **Step 3: implement** (~90 lines) · **Step 4: `npm run migrate:up` + tests + typecheck** · **Step 5: commit** `feat(git): site_git_state table + state repo`

---

### Task 2: GitHub client (Git Data API, injectable, disabled mode)

**Files:** Create `src/server/git/client.ts`; Test `src/server/git/client.test.ts` (node, no DB, fetch stubbed).

**Interfaces (Produces):**
```ts
export type GitMode = "disabled" | "api";
export function resolveGitMode(env?: NodeJS.ProcessEnv): GitMode;  // token AND repo present → "api"
export type TreeEntry = { path: string; sha: string; type: "blob" | "tree" };
export type GithubClient = {
  repo: string;                                                    // "owner/name"
  getDefaultBranch(): Promise<string>;                             // GET /repos/{repo} → default_branch
  getRefSha(branch: string): Promise<string>;                      // GET /repos/{repo}/git/ref/heads/{branch}
  getTree(sha: string): Promise<TreeEntry[]>;                      // GET .../git/trees/{sha}?recursive=1 (flag truncated:true as error)
  getFileAtRef(path: string, ref: string): Promise<string>;        // GET .../contents/{path}?ref= → base64 decode
  createBlob(content: string): Promise<string>;
  createTree(baseTreeSha: string, entries: { path: string; sha: string | null }[]): Promise<string>; // sha null = delete (unused v1, typed for completeness)
  createCommit(message: string, treeSha: string, parentSha: string): Promise<string>;
  updateRef(branch: string, sha: string): Promise<void>;
  createCommitComment(sha: string, body: string): Promise<void>;
};
export function makeGithubClient(env?: NodeJS.ProcessEnv, fetchFn?: typeof fetch): GithubClient; // throws if mode disabled
export function computeGitBlobSha(content: string): string;        // sha1("blob " + byteLen + "\0" + content) hex — node:crypto
```
All requests: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`; non-2xx → `Error("github <method> <path> failed: <status> <bodySnippet>")`; honor `Retry-After` once with a bounded wait ≤10s, then throw (jobs handle further retries).

- [ ] **Step 1: failing tests** — fetch-spy asserts URL/method/headers/body per method; base64 decode; blob-sha matches a known git fixture (`computeGitBlobSha("hello\n") === "ce013625030ba8dba906f756967f9e9ca394464a"`); disabled mode: `resolveGitMode({})==="disabled"`, `makeGithubClient({})` throws; Retry-After path (fake timers) retries once then succeeds.
- [ ] **Step 2: run → fail** · **Step 3: implement** (~180 lines) · **Step 4: tests + typecheck** · **Step 5: commit** `feat(git): github rest client (git data api) + disabled mode`

---

### Task 3: Serializer + parsers + generated docs

**Files:** Create `src/server/git/serialize.ts`; Test `src/server/git/serialize.test.ts` (node, DB for the site-reading path).

**Interfaces (Produces):**
```ts
export function stableStringify(value: unknown): string;            // sorted keys, 2-space, trailing \n
export function pageFileName(slug: string): string;                 // "pages/<slug>.json" (slug already /^[a-z0-9-]+$/ per DB constraint — no extra sanitization)
export async function serializeSite(pool, siteId): Promise<Map<string, string>>;
// keys relative to sites/<slug>/: "site.json", "pages/<page-slug>.json"×N, "media.json"
export function generateBlocksMd(): string;                         // from listBlocks() + zodToJsonSchema (catalog.ts pattern): per block — type, label, description, aiHints, props schema, minimal JSON example
export function generateReadme(repo: string): string;               // editing rules, validation, sync semantics, links
export const siteFileSchema: z.ZodType<...>;                        // { display_name: string, default_brand_tokens: brandTokensSchema, seo_defaults: siteSeoDefaultsSchema, domains?: string[], plugins?: string[] }
export const pageFileSchema: z.ZodType<...>;                        // { title: string.min(1), status: z.enum(["draft","published"]), seo: seoFieldsSchema.default({}), blocks: z.array(blockShape) }
export function parsePageFile(jsonText: string): { ok: true; page: PageFile } | { ok: false; errors: {path,message}[] };  // JSON.parse guarded + zod; blocks NOT yet registry-validated (import job does that)
export function parseSiteFile(jsonText: string): { ok: true; site: SiteFile } | { ok: false; errors: [...] };
```
`site.json` content: display_name, default_brand_tokens, seo_defaults, `domains` (from site_domains hostnames, informational), `plugins` (enabled plugin ids, informational). `media.json`: `{ assets: { [asset_id]: { alt, content_type, width, height, variants: [{name,format,url}] } } }` from ready assets.

- [ ] **Step 1: failing tests** — stableStringify sorts nested keys + deterministic across property-insertion orders; serializeSite on a seeded site (2 pages, 1 ready asset) yields exactly the expected key set + parseable values that round-trip (`parsePageFile(map.get("pages/home.json")).page.blocks` deep-equals the seeded blocks); parsePageFile rejects malformed JSON and a missing title with path-bearing errors; generateBlocksMd contains every registered type name (loop `listBlocks()`); generateReadme mentions the repo and the `Anchor-Sync: export` trailer.
- [ ] **Step 2: run → fail** · **Step 3: implement** (~220 lines; registry side-effect import) · **Step 4: tests + typecheck** · **Step 5: commit** `feat(git): deterministic site serializer + file schemas + generated docs`

---

### Task 4: Exporter + `git.export` job + publish trigger

**Files:** Create `src/server/git/export.ts`, `src/server/jobs/git-export.ts`; Modify `src/server/jobs/index.ts` (const `GIT_EXPORT = "git.export"` + registration), `src/server/routes/admin-pages.ts` (publish trigger); Tests `src/server/git/export.test.ts`, `src/server/jobs/git-export.test.ts`.

**Interfaces (Produces):**
```ts
// export.ts
export type ExportResult = { skipped: boolean; sha?: string; files: number };
export async function exportSite(pool, siteId, trigger: string, client: GithubClient): Promise<ExportResult>;
// jobs/git-export.ts
export type GitExportInput = { siteId: string; trigger: string };
export async function handleGitExport(data: GitExportInput, deps: { pool: Pool; client?: GithubClient }): Promise<void>;
```
`exportSite` flow: `serializeSite` → prefix keys with `sites/<slug>/` → add repo-root `README.md` + `BLOCKS.md` → `getDefaultBranch`/`getRefSha`/`getTree(headSha)` → for each file compare `computeGitBlobSha(content)` against the tree entry sha; all equal → `{skipped:true}` (no API writes). Else: createBlob per changed file, `createTree(headTreeSha, changedEntries)`, `createCommit("export(<slug>): <trigger>\n\nAnchor-Sync: export", tree, headSha)`, `updateRef`, `recordExport`. Errors → `recordGitError` + rethrow (job retries).
`handleGitExport`: mode disabled OR state not enabled → return silently (log line). Builds the real client when `deps.client` absent.
Registration (jobs/index.ts, v12 pattern): `createQueue(GIT_EXPORT)` + `work<GitExportInput>(GIT_EXPORT, async ([job]) => handleGitExport(job.data, { pool: defaultPool }))`.
Publish trigger (admin-pages.ts save route): after a successful save where the resulting `page.status === "published"`, fire-and-forget enqueue via an injectable `enqueueGitExport?: (input: GitExportInput) => Promise<string | null>` router option defaulting to the lazy-`getBoss().send(GIT_EXPORT, input, { singletonKey: siteId })`-in-try/catch idiom (`routes/media.ts:58-66` precedent). Only when `getGitState` says enabled — one cheap SELECT, skip when no row/disabled (and skip entirely in `resolveGitMode()==="disabled"` without the SELECT).

- [ ] **Step 1: failing tests** — exporter with a fake client: first export commits all files with the trailer + updates ref + records sha; identical re-export → `{skipped:true}` and ZERO createBlob/createCommit calls; changed page → only changed blobs created; client error → recordGitError called + throws. Job: disabled mode → no client construction (spy); enabled+state row → runs exporter. Route: publish save with injected enqueue spy → called once with `{siteId, trigger:"publish"}`; draft save → not called; git state absent → not called.
- [ ] **Step 2: run → fail** · **Step 3: implement** (~200 lines) · **Step 4: tests + typecheck + re-run admin-pages tests** · **Step 5: commit** `feat(git): exporter with no-op skip + git.export job + publish trigger`

---

### Task 5: Webhook route

**Files:** Create `src/server/routes/git-webhook.ts`; Modify `src/server/app.ts` (json `verify` rawBody capture + mount `app.use("/api", gitWebhookRouter())` with the other routers); Test `tests/integration/git-webhook.test.ts`.

**Interfaces (Produces):**
```ts
export type GitImportInput = { siteId: string; headSha: string; paths: string[] };
export type GitWebhookOptions = {
  pool?: Pool;
  enqueueImport?: (input: GitImportInput) => Promise<string | null>;  // default: lazy getBoss().send(GIT_IMPORT, input, { singletonKey: siteId }) in try/catch
  env?: NodeJS.ProcessEnv;
};
export function gitWebhookRouter(opts?: GitWebhookOptions): Router;   // POST /git/webhook (mounted under /api)
export function verifyGithubSignature(secret: string, rawBody: Buffer, signatureHeader: string | undefined): boolean; // sha256=<hmac>, crypto.timingSafeEqual, false on any malformed input
```
Handler logic (exact order): no `GITHUB_WEBHOOK_SECRET` → 503 `{error:"webhook not configured"}`. Bad/missing signature vs `req.rawBody` → 401. `X-GitHub-Event !== "push"` → 204. Parse payload; `payload.ref !== "refs/heads/" + payload.repository.default_branch` → 204. Every commit message contains `Anchor-Sync: export` → 204 (loop prevention). Collect distinct changed paths (`added`+`modified` across commits; `removed` kept separately) matching `^sites/([a-z0-9-]+)/`; group by slug; for each slug resolve site by slug + `getGitState.enabled` — enabled → enqueue `{siteId, headSha: payload.after, paths: [added+modified for that site, plus "REMOVED:"-prefixed removed paths]}` (removed prefix keeps one payload shape; import reports them). Respond `202 {queued: [slugs]}` or `204` when nothing matched. Signature check happens BEFORE any parsing.

- [ ] **Step 1: failing tests** — helper `sign(body) = "sha256="+hmac`; valid push with one page modification → 202 + enqueue spy called with correct siteId/headSha/paths; bad signature → 401 + no enqueue; non-push event → 204; non-default branch → 204; all-trailer commits → 204; disabled site → no enqueue; removed file → path arrives `REMOVED:`-prefixed; missing secret env → 503. Verify `verifyGithubSignature` directly: valid, invalid, undefined header, wrong length (timingSafeEqual guard).
- [ ] **Step 2: run → fail** · **Step 3: implement** (~150 lines + the 3-line app.ts verify hook; confirm rawBody typing via a `RawBodyRequest` interface) · **Step 4: tests + typecheck + re-run one existing /api suite (app.ts touched)** · **Step 5: commit** `feat(git): push webhook — hmac verify, filtering, per-site fan-out`

---

### Task 6: `git.import` job

**Files:** Create `src/server/jobs/git-import.ts`; Modify `src/server/jobs/index.ts` (const `GIT_IMPORT = "git.import"` + registration, same pattern as T4); Test `src/server/jobs/git-import.test.ts`.

**Interfaces (Produces):**
```ts
export type GitImportDeps = { pool: Pool; client?: GithubClient };
export async function handleGitImport(data: GitImportInput, deps: GitImportDeps): Promise<void>;
```
Flow: mode disabled / state row missing / `!enabled` → return. `state.last_import_sha === headSha` → return (idempotent redelivery). Partition paths: `REMOVED:` → report list; `media.json`/`README.md`/`BLOCKS.md` basenames → ignored list; `site.json` → site apply; `pages/*.json` → page applies. Per page file: `client.getFileAtRef(path, headSha)` → `parsePageFile` → registry gate: `validateBlocks(page.blocks)` must be `[]` AND every referenced asset id exists (`collectAssetIds(blocks)` — recursive scan of props for keys matching `/asset_id$/` with string values + hero-slider's `image_asset_id` inside `slides` — write it generically: ANY string value under a key matching `/asset_id$/i` at any depth; then one `SELECT id FROM media_assets WHERE site_id=$1 AND id = ANY($2)` and diff) → apply: existing page (by slug) → transactional UPDATE blocks/seo/title/status + revision `source: 'git:' + headSha.slice(0,7)`; new slug → transactional INSERT + same revision. `site.json` → `parseSiteFile` → UPDATE sites (brand tokens REPLACE, seo_defaults shallow-MERGE over current) → `evictSiteCacheForSite`. Failures per file accumulate `{path, errors}` — continue processing others. End: any failures → `recordGitError(pool, siteId, summary)` + `client.createCommitComment(headSha, markdownBulletsOfFailures + reportedDeletions + ignoredEdits)`; deletions/ignored-only → comment too (informational); all clean → `recordImport(pool, siteId, headSha)` (also record when partially applied — sha processed; comment carries what didn't). A file-fetch/API error (vs validation error) → rethrow after recordGitError (pg-boss retry; idempotence guard makes replays safe because revisions are only written for files that validate, and re-applying the same content is a harmless identical revision).

- [ ] **Step 1: failing tests** — fake client with canned file contents: valid page edit applies (blocks in DB change, revision `git:<sha7>`, status honored); invalid block type → page unchanged + `recordGitError` + `createCommitComment` (spy, body mentions the path); unknown asset_id → rejected same way; NEW page file → created with revision; site.json → brand replaced, seo merged (pre-existing key preserved); removed path → reported in comment, page NOT deleted; media.json edit → ignored note; same headSha twice → second run no-ops (client not called); disabled state → no-op.
- [ ] **Step 2: run → fail** · **Step 3: implement** (~230 lines) · **Step 4: tests + typecheck** · **Step 5: commit** `feat(git): validated import job with commit-comment reporting`

---

### Task 7: Admin git endpoints + Studio card

**Files:** Create `src/server/routes/admin-git.ts`, `src/admin/pages/site-tabs/GitCard.tsx`; Modify `src/server/app.ts` (mount), `src/admin/pages/site-tabs/SettingsTab.tsx` (render `<GitCard siteId={site.id} slug={site.slug} />` below the existing cards — confirm SiteDetail passes slug; it does via `site`); Tests `tests/integration/admin-git.test.ts`, `src/admin/pages/site-tabs/GitCard.test.tsx`.

**Interfaces (Produces):**
```ts
// admin-git.ts — factory { pool?, enqueueExport? (same GitExportInput default idiom), env? }
// GET  /api/sites/:siteId/git        → 200 { configured: boolean, repo: string | null, state: SiteGitState | null }
// POST /api/sites/:siteId/git/enable → body { enabled: boolean }; upserts; enabling ALSO enqueues {siteId, trigger:"initial"}; 200 { state }
// POST /api/sites/:siteId/git/export → 409 {error:"git not enabled"} unless enabled; enqueues {siteId, trigger:"manual"}; 202 { queued: true }
// configured = resolveGitMode(env) === "api"; site 404 pattern; requireAdmin + rateLimit({max:10,windowMs:60_000}).
```
`GitCard` (Card/Button/Badge idiom from SettingsTab): loads GET; not configured → muted "GitHub sync isn't configured — see docs/github-sync.md"; configured → toggle (POST enable), "Export now" (POST export, disabled while pending), status lines (`Exported <sha7> · <relative time>`, `Imported <sha7>`, error in `text-red-600`), repo link `https://github.com/<repo>/tree/main/sites/<slug>` (`target="_blank"`).

- [ ] **Step 1: failing tests** — integration: GET unconfigured (`env:{}` injected) → `configured:false`; enable → state row created + enqueue spy `{trigger:"initial"}`; export when disabled → 409; export when enabled → 202 + spy `{trigger:"manual"}`; cross-site 404. jsdom: unconfigured copy renders; configured + enabled state renders shas + link href; Export now fires POST (global.fetch mock idiom, `PagesTab.test.tsx` conventions).
- [ ] **Step 2: run → fail** · **Step 3: implement** (~120 + ~140 lines) · **Step 4: tests + typecheck** · **Step 5: commit** `feat(git): admin git endpoints + Studio GitHub card`

---

### Task 8: E2E gate + docs + secrets

**Files:** Create `tests/integration/git-sync.test.ts`, `docs/github-sync.md`; Modify `cloudbuild.yaml` (secrets + `GITHUB_CONTENT_REPO` env), `docs/ai-agent.md` (one-line cross-link for `git:` revision sources).

- [ ] **Step 1: E2E gate** (per-router app: adminGitRouter + gitWebhookRouter + adminPagesRouter, shared pool, ONE fake in-memory GithubClient instance shared across the flow that stores blobs/trees/commits): enable site → initial export job run inline via `handleGitExport({...}, {pool, client: fake})` → fake repo contains `sites/<slug>/site.json` + page files + root README/BLOCKS; re-export → skipped; mutate a page file in the fake repo + construct a real push payload (correct HMAC via the test secret) → POST webhook → assert 202 + captured import input → run `handleGitImport` inline with the fake client → page updated, revision `git:<sha7>` at top, restore round-trip returns pre-import blocks; push an invalid-block edit → page unchanged + fake client's commit-comment recorded; export commit trailer → webhook 204.
- [ ] **Step 2: full suite + typecheck** (`TEST_DATABASE_URL=… DATABASE_URL=… npm test`) — green vs 1133 baseline; triage any failure via git stash.
- [ ] **Step 3: secrets + env** — `printf 'disabled' | gcloud secrets create GITHUB_CONTENT_TOKEN --project=anchor-hub-480305 --data-file=-` (same for `GITHUB_WEBHOOK_SECRET`), mirror the IAM binding pattern used for `PLUGIN_CONFIG_ENC_KEY`; append both to `--set-secrets`; add `GITHUB_CONTENT_REPO=` (empty = disabled) to the `--set-env-vars` line with a comment; `.env.example` entries with the disabled-by-default note. Placeholder value `disabled` keeps `resolveGitMode` returning `"api"`?? NO — token present would flip mode on. Guard: `resolveGitMode` treats the literal value `disabled` (and empty repo) as disabled — add that rule to Task 2's implementation + test NOW (it is part of T2's contract: `GITHUB_CONTENT_TOKEN === "disabled"` → `"disabled"`, mirroring the AI client's `"dry-run"` sentinel convention).
- [ ] **Step 4: `docs/github-sync.md`** — architecture, repo shape, sync semantics (DB-authoritative, later-writer-wins, loop trailer), validation + commit-comment reporting, the 5-step operator runbook from the spec (verbatim, with the real service URL), troubleshooting (card errors, webhook 401s), extension notes (posts/events, GitHub App swap).
- [ ] **Step 5: commit** `test(git): e2e sync gate + docs + secret wiring`

---

## Self-Review Notes (performed at write time)

- **Spec coverage:** monorepo layout + generated docs (T3), bidirectional (T4/T5/T6), publish+manual triggers (T4/T7), DB-authoritative/later-writer-wins (import applies as revision T6; export overwrites repo T4 — no merge machinery, per spec), PAT + HMAC + disabled mode (T2/T5/T8), loop trailer both sides (T4/T5), deletions-report-only + ignored files (T6), commit comments (T6), Studio card (T7), state table (T1), runbook + secrets with placeholder-safe deploys (T8), DoD 1-6 → T4/T8 (1), T6/T8 (2), T6 (3), T5 (4), T2/T8 (5), T8 (6).
- **Placeholder scan:** clean — the one mid-write correction (placeholder secret value vs resolveGitMode) was folded into T2's contract as the `"disabled"` sentinel rule with its own test.
- **Type consistency:** `GitExportInput`/`GitImportInput` shared T4→T5→T6→T7; `GithubClient` methods used in T4/T6/T8 all declared in T2; state-repo names used in T4/T6/T7 match T1; `REMOVED:` prefix convention defined T5, consumed T6.
- **Known drift risks (read-first, marked in-task):** SettingsTab's current card layout for GitCard placement (T7); admin-pages save-route shape for the publish trigger insertion point (T4); app.ts json() options (T5).
