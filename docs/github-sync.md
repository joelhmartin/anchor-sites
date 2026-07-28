# GitHub content sync

Bidirectional sync between a site and a content-monorepo repo on the
operator's **work** GitHub account — "it's just a repo": export a site's
content as files, edit them by hand (or with Claude Code, or a coworker), and
push changes back into the builder's database, all through the same
validation gate every other write path uses. Sub-project 3/3 of the "Lovable
for websites" evolution (design spec:
`docs/superpowers/specs/2026-07-28-github-sync-design.md`; implementation
plan: `docs/superpowers/plans/2026-07-28-github-sync.md`).

## Architecture

```
src/server/git/
  client.ts       GithubClient (Git Data API) + resolveGitMode() disabled/api gate
  state-repo.ts   site_git_state pool-first CRUD (enable flag, last export/import sha, error)
  serialize.ts    DB -> deterministic file map, parsers, generated README.md/BLOCKS.md
  export.ts       exportSite(): diff against the repo tree, one commit, no-op skip

src/server/jobs/
  git-export.ts   git.export pg-boss job (handleGitExport) — wraps exportSite
  git-import.ts   git.import pg-boss job (handleGitImport) — validated apply + reporting

src/server/routes/
  git-webhook.ts  POST /api/git/webhook — HMAC verify, filter, group by site, fan out
  admin-git.ts    GET/POST /api/sites/:siteId/git[...] — Studio's GitCard API

src/admin/pages/site-tabs/GitCard.tsx   Studio Settings-tab card
```

Both `GIT_EXPORT` and `GIT_IMPORT` are pg-boss `stately`-policy queues, each
keyed by a `singletonKey` that dedupes redeliveries without ever collapsing
two genuinely different jobs together:

- `GIT_EXPORT` keys on bare `siteId` — a site should never have two export
  jobs queued/active at once (the second `enable`/"Export now" click while
  one is still running should just no-op onto the first).
- `GIT_IMPORT` keys on **`${siteId}:${headSha}`** — keying on bare `siteId`
  would let a second real push to the same site (different content, different
  `headSha`) silently collapse into the first push's still-active import job
  and never queue at all, permanently losing that push's edits. Keying on the
  pair keeps the dedupe `stately` is for (a *redelivered* webhook for the
  *same* push collapsing to one job) while letting distinct pushes both queue.

The admin API (`admin-git.ts`) disambiguates a `null` enqueue result from this
policy: it's either "the queue is genuinely down" or "deduped, a job is
already live" — it checks pg-boss's own `job` table (`hasLiveExportJob`)
before ever reporting a `503`, so a double-click on "Export now" reports
`202 {queued:true, deduped:true}` instead of a false failure.

## Repo shape

```
sites/<slug>/
  site.json                 display_name, default_brand_tokens, seo_defaults,
                             domains (informational), plugins (informational)
  pages/<page-slug>.json    { title, status, seo, blocks }
  media.json                READ-ONLY manifest: asset_id -> { alt, content_type,
                             width, height, variants: [{name,format,url}] }
README.md                   generated: how to edit, what validates, sync semantics
BLOCKS.md                   generated from the live block registry — every
                             block type, its props schema, and a JSON example
                             (same introspection `src/server/ai/catalog.ts` uses
                             for the AI agent's prompt, so this never drifts)
```

Every file is produced by `stableStringify` (recursively sorted keys,
2-space indent, trailing newline), so re-serializing unchanged DB content
always yields byte-identical files — that determinism is what lets the
exporter compare git blob shas and skip committing when nothing changed.

Pages only in v1 (posts/events use the same `Block[]` shape — see
"Extending" below). No media binaries: blocks reference `asset_id`s, and
import validates each id against `media_assets` for that site (an unknown id
rejects the whole page, with a clear message, not a broken image).

## Sync semantics

- **The database is authoritative.** Export overwrites the repo's content to
  match the database; import applies validated repo changes as new page
  revisions. There is no merge machinery — **later writer wins** on both
  sides, with the earlier state always preserved (`page_revisions` on the DB
  side, git history on the repo side). Restoring an earlier revision through
  the Studio's existing revisions panel works exactly the same way after a
  git-sourced edit as it does after any other write.
- **Triggers**: a page save that transitions to (or updates) `published`
  status enqueues `git.export`; the Studio "Export now" button enqueues the
  same job manually. First enabling git sync for a site also enqueues an
  initial export (so the repo starts populated, not empty).
- **Loop prevention**: every export commit's message ends with the exact
  trailer line `Anchor-Sync: export`. The webhook skips any push where
  **every** commit in it carries that trailer — so an export's own push
  (were the webhook even pointed at pushes from this same automation, which
  it always will be) can never re-trigger an import, and an import round-trip
  can never trigger a self-export loop either (imports don't re-export what
  they just applied).
- **Deletions are reported, never applied** (v1 safety) — a file removed in
  the repo shows up in the commit comment, but the corresponding page stays
  in the builder; delete pages from the Studio itself.
- **Generated files are read-only from the import side.** Edits to
  `media.json`, `README.md`, or `BLOCKS.md` in the repo are ignored on
  import, noted in the commit comment rather than silently dropped.
- **`site.json` apply semantics mirror the AI agent's tools**: brand tokens
  **replace** wholesale; `seo_defaults` **shallow-merges** over what's already
  in the database (a key the file omits survives untouched). Both trigger a
  site-cache eviction (`evictSiteCacheForSite`) so the change is live
  immediately.

## Validation + commit-comment reporting

Every imported `pages/*.json` file goes through the exact same gate a human
Studio save or the AI editor would use: `pageFileSchema` (structural shape:
title/status/seo/blocks) -> `validateBlocks` against the live block registry
(unknown types, invalid props) -> an existence check for every referenced
media asset id. A file that fails any stage is **skipped, not applied** —
every other valid file in the same push still lands.

Results are reported two ways:

1. **`site_git_state.last_error`** — a plain-text summary, surfaced by the
   Studio's GitCard.
2. **A commit comment on the triggering commit** (via
   `client.createCommitComment`) — bulleted sections for rejected files
   (with the validation reason), reported-but-not-applied deletions, and
   ignored generated-file edits. Capped at 20 bulleted items per section
   (`…and N more`) so a push touching hundreds of files can't blow past
   GitHub's comment size limit. Posting the comment itself is best-effort:
   a failed comment post downgrades to a `console.warn` rather than
   clobbering the validation summary already written to `last_error`.

A push is still recorded as processed (`last_import_sha` advances) even when
some files in it failed validation — the sha *as a whole* was handled, and
the comment carries what didn't land. Redelivery of an already-processed
`headSha` is a no-op (idempotent).

## Auth

- **Export → GitHub**: `GITHUB_CONTENT_TOKEN`, a fine-grained PAT scoped to
  the one content repo with Contents Read/Write.
- **GitHub → import webhook**: `GITHUB_WEBHOOK_SECRET`, an HMAC secret GitHub
  signs every push payload with (`X-Hub-Signature-256`). The webhook route is
  deliberately **not** behind `requireAdmin()` — GitHub can't send an admin
  token — so signature verification (timing-safe compare against the raw
  request body) is the entire auth story for that one route, checked before
  anything else touches the payload.
- **`GITHUB_CONTENT_REPO`** (`owner/repo`) is plain config, not a secret.

`resolveGitMode(env)` (`src/server/git/client.ts`) is `"disabled"` whenever
`GITHUB_CONTENT_TOKEN` is unset, `GITHUB_CONTENT_REPO` is empty/unset, **or**
the token is the literal placeholder sentinel `"disabled"` (mirroring the AI
client's `"dry-run"` convention) — that last rule is what lets Task 8 seed a
real Secret Manager entry with a safe placeholder value *before* the operator
has a real PAT, without ever flipping sync on with a bogus token. Every
git-sync entry point (both jobs, both routes, the publish trigger) checks
this first and short-circuits with zero GitHub network I/O when disabled —
which is also why CI and local dev, which never set these, are unaffected.

## Studio UI

Site Settings gets a **GitHub card** (`GitCard.tsx`): when the server isn't
configured at all, a muted note pointing at this doc; once configured, a
per-site enable toggle, an "Export now" button, last export/import sha +
relative time, any error in red, and a link to
`https://github.com/<repo>/tree/main/sites/<slug>`.

## Operator runbook

1. On the **work** GitHub account, create a private repo (e.g.
   `anchor-sites-content`), default branch `main`.
2. Create a fine-grained PAT scoped to that repo: Contents Read/Write. Store
   it as `GITHUB_CONTENT_TOKEN` in Secret Manager (project
   `anchor-hub-480305`):
   ```bash
   printf '<the PAT>' | gcloud secrets versions add GITHUB_CONTENT_TOKEN --data-file=-
   ```
3. Generate a random webhook secret and store it as `GITHUB_WEBHOOK_SECRET`
   in Secret Manager; both already join `cloudbuild.yaml`'s `--set-secrets`
   (remember: that flag **replaces the whole list** on every deploy — see the
   note at the top of `cloudbuild.yaml`).
   ```bash
   openssl rand -base64 32 | gcloud secrets versions add GITHUB_WEBHOOK_SECRET --data-file=-
   ```
4. Set `GITHUB_CONTENT_REPO=<owner>/anchor-sites-content` — update the
   `--set-env-vars` value in `cloudbuild.yaml` (currently left empty on
   purpose) and redeploy.
5. Add the repo webhook: payload URL
   `https://studio.anchorcorps.com/api/git/webhook`, content type
   `application/json`, secret from step 3, **push events only**.

Both `GITHUB_CONTENT_TOKEN` and `GITHUB_WEBHOOK_SECRET` were created in
Secret Manager with the placeholder value `disabled` ahead of this runbook
(Task 8) — `roles/secretmanager.secretAccessor` already granted to the Cloud
Run runtime service account (`<project-number>-compute@developer.gserviceaccount.com`),
mirroring `PLUGIN_CONFIG_ENC_KEY`'s binding:
```bash
for secret in GITHUB_CONTENT_TOKEN GITHUB_WEBHOOK_SECRET; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:<project-number>-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```
Steps 2-3 above just add a new **version** to each existing secret — no new
`gcloud secrets create` or IAM step needed; `:latest` in `--set-secrets`
picks up the new version on the next deploy.

## Troubleshooting

- **GitCard shows "GitHub sync isn't configured"** — `resolveGitMode(env)`
  is `"disabled"` server-wide: either `GITHUB_CONTENT_TOKEN` is unset/still
  the placeholder, or `GITHUB_CONTENT_REPO` is empty. Check the Cloud Run
  revision's env/secrets (or your local `.env`); this is server-wide, not
  per-site — the per-site toggle only matters once the server itself is
  configured.
- **Webhook returns `401`** — the `X-Hub-Signature-256` header didn't match
  `GITHUB_WEBHOOK_SECRET`. Almost always either the GitHub webhook's
  configured secret and the deployed `GITHUB_WEBHOOK_SECRET` have drifted
  (re-check both after any secret rotation), or the payload was modified
  in transit — the signature is computed over the exact raw request bytes,
  so anything that re-serializes the body upstream (a proxy, a "helpful"
  middleware) breaks verification.
- **Webhook returns `503`** — `GITHUB_WEBHOOK_SECRET` isn't set at all on
  the running service. Distinguish from `401`: `503` means "not configured",
  `401` means "configured, but this request's signature didn't match".
- **Webhook returns `204` unexpectedly** — one of: the event wasn't `push`;
  the push wasn't against the repo's default branch; every commit in the
  push carried the `Anchor-Sync: export` trailer (loop prevention, working
  as intended); or git sync is server-wide disabled. None of these are
  errors — GitHub's webhook delivery log will show the `204` with no retry.
- **A page didn't update after a push** — check the commit comment GitHub
  posted on the triggering commit (or `site_git_state.last_error` via the
  GitCard) for the specific validation failure. Common causes: an unknown
  block `type` (check `BLOCKS.md` in the content repo for the current
  registry), an `*_asset_id` referencing a media asset that doesn't exist
  for that site, or malformed JSON.
- **A site isn't picking up pushes at all** — confirm the site's own toggle
  is enabled (`site_git_state.enabled`), not just the server-wide config;
  the webhook silently skips a matched-but-disabled site (by design — a
  push to a slug this builder doesn't have opted in is not an error).

## Extending (out of scope for v1)

- **Posts/events sync**: both already store content as `Block[]` (same shape
  pages use), so the serializer/import-validation path generalizes directly
  — the main work is deciding their repo paths (e.g.
  `sites/<slug>/posts/<slug>.json`) and wiring the publish trigger for each.
- **GitHub App instead of a PAT**: `GithubClient` (`src/server/git/client.ts`)
  is the single seam token acquisition goes through — `makeGithubClient()` is
  the only place that reads `GITHUB_CONTENT_TOKEN` today. Swapping to a
  GitHub App (installation tokens, higher rate limits, no PAT tied to one
  human's account) means changing that one function's token-acquisition
  logic; every caller (exporter, import job) is unaffected.
- **Branch-based / PR-based imports**: v1 only imports pushes to the repo's
  default branch. A PR-review workflow (import a branch's proposed changes
  into a **draft** revision for review before applying) is a natural
  extension of the same validation path, not a rewrite.
- **Per-site repos**: v1 is deliberately one monorepo with `sites/<slug>/`
  folders (simpler webhook routing, one PAT to manage). Splitting to
  per-site repos would mean per-site `GITHUB_CONTENT_REPO` values (a column
  on `site_git_state` rather than one shared env var) and a webhook per repo.
