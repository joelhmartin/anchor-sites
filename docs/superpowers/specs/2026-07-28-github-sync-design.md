# GitHub Sync — Design Spec

**Date:** 2026-07-28
**Status:** Approved (operator, in-chat)
**Sub-project 3 of 3** in the "Lovable for websites" evolution. Builds on sub-projects 1-2
(AI agent, inline editing). Branch: `feat/github-sync`, stacked on `feat/inline-editing`.

## Purpose

Connect the site builder to a content repo on the operator's **work GitHub account** so
sites can be exported, edited by the operator/coworkers/Claude Code as files, and synced
back — replacing any bespoke JSON-export story with "it's just a repo".

## Decisions locked during brainstorming

1. **One content monorepo** (`<work-acct>/anchor-sites-content`), `sites/<slug>/` folders.
   The work account is NOT the personal account owning the anchor-sites code repo.
2. **Bidirectional**: builder exports commits; a push webhook imports changes, validated
   through the same Zod registry gate as every other write path.
3. **Triggers & authority**: auto-export on page publish + a per-site "Export now"
   button; one commit per export. DB is authoritative between syncs; the LATER writer
   wins on both directions, with the earlier state always preserved (page_revisions on
   the DB side, git history on the repo side). No merge UI.
4. **Auth**: fine-grained PAT (`GITHUB_CONTENT_TOKEN`, Contents R/W on the one repo) +
   webhook HMAC secret (`GITHUB_WEBHOOK_SECRET`), both in Secret Manager and the
   `--set-secrets` list. `GITHUB_CONTENT_REPO` env = `owner/repo`. No token → git
   features cleanly disabled (stub mode; CI never performs network I/O).

## Repo shape

```
sites/<slug>/
  site.json                 display_name, default_brand_tokens, seo_defaults,
                            domains (informational), enabled plugins (informational)
  pages/<page-slug>.json    { title, status, seo, blocks }  (pretty-printed, stable key order)
  media.json                READ-ONLY manifest: asset_id → { alt, content_type,
                            width, height, variants: [{name,format,url}] }
README.md                   generated: how to edit, what validates, sync semantics
BLOCKS.md                   generated from the block registry (same introspection as the
                            AI catalog): every block type, its props, and JSON examples —
                            the knowledge base that makes Claude Code edits reliable
```

- **No media binaries.** Blocks reference `asset_id`s; import validates ids against
  `media_assets` (unknown id → that page rejected with a clear message).
- Pages only in v1. Posts/events use the same `Block[]` shape — documented extension,
  out of scope.
- Edits to `media.json`, `README.md`, `BLOCKS.md` in the repo are ignored on import
  (with a note in the import report).

## Export engine (`src/server/git/`)

- **GitHub client** wrapping the REST **Git Data API**: create blobs → tree → single
  atomic commit → update ref. Injectable (fake client in tests); token from env.
- **Serializer**: site + pages + media manifest → deterministic file map (stable key
  ordering, 2-space indent) so no-op exports produce identical trees.
- **Exporter**: builds the file map, diffs against the current repo tree for that site's
  folder, skips committing when identical; otherwise commits with message
  `export(<slug>): <trigger>` and trailer `Anchor-Sync: export` — the webhook skips
  commits carrying this trailer (**loop prevention**).
- **Triggers**: page save transitioning to/updating a `published` page enqueues a
  pg-boss `git.export` job (singleton per site, debounced by singletonKey); the Studio
  "Export now" button enqueues the same job. Export failures record to `site_git_state`
  and surface in Studio; pg-boss retry policy applies.
- **State**: new `site_git_state` table — `site_id PK/FK, enabled bool, last_export_sha,
  last_import_sha, last_synced_at, last_error, updated_at`.

## Import path

- **Webhook**: `POST /api/git/webhook`. Auth = HMAC `X-Hub-Signature-256` verification
  against `GITHUB_WEBHOOK_SECRET` (timing-safe compare). No admin token involved. Events:
  `push` to the default branch only; other events → 204 ignored.
- Commits with the `Anchor-Sync: export` trailer are skipped. Changed files under
  `sites/**` are grouped by site slug; one `git.import` job per affected+enabled site
  (payload: site_id, head sha, changed paths).
- **Import job**: fetches each changed file at the head sha; validates —
  `site.json` against a dedicated Zod schema (brand tokens + seo defaults reuse the
  existing schemas); page files against `blockShape` + `validateBlocks` + `seoFieldsSchema`
  (+ slug/title constraints). Valid page → applied via the same transactional
  save+revision pattern, `source: 'git:<short-sha>'`. New page files create pages
  (draft/published per the file's `status`). **Deletions are reported, never applied**
  (v1 safety). `site.json` changes apply brand tokens/seo defaults (same tools' semantics
  as the agent: brand tokens replace, seo defaults merge — mirrors sub-project 1/2
  behavior) with resolver-cache eviction.
- **Rejects**: invalid files are skipped; errors recorded in `site_git_state.last_error`
  AND posted as a **commit comment** on the offending commit (so the pusher learns in
  GitHub, not just in Studio). Processing continues for valid files.
- `last_import_sha` prevents reprocessing on redelivery; webhook deliveries are
  idempotent per head sha.

## Studio UI

Site Settings tab gains a **GitHub card**: connection status (global config present?),
per-site enable toggle (first enable runs an initial export), "Export now", last
export/import SHA + time + error, deep link to `https://github.com/<repo>/tree/<default>/sites/<slug>`.

## Error handling

- Missing/invalid token: git features disabled; card shows why. API errors: job retry
  (pg-boss), error persisted to `site_git_state`, surfaced in the card.
- Rate limiting: exports are per-publish + manual (low volume); client honors
  `Retry-After` with bounded retries via the job layer.
- Webhook signature failure → 401, no processing. Malformed payload → 400.

## Testing

- Serializer round-trip against the real registry (serialize → parse → identical blocks).
- Exporter vs fake GitHub client: file map correctness, no-op skip, trailer present.
- Webhook: signature verify (valid/invalid/timing-safe), event filtering, trailer skip,
  site grouping.
- Import job: valid page applies with `git:` revision; invalid blocks rejected + error
  recorded + commit-comment call made (fake client); unknown asset_id rejected;
  deletion reported-not-applied; site.json apply path.
- E2E gate: seed site → export (fake client captures tree) → construct a push payload
  from an edited page file → webhook → import → page updated + revision + restore
  round-trip. Full suite green.

## Operator runbook (ships in docs/github-sync.md)

1. On the WORK GitHub account: create `anchor-sites-content` (private), default branch `main`.
2. Create a fine-grained PAT scoped to that repo: Contents Read/Write. →
   `GITHUB_CONTENT_TOKEN` in Secret Manager.
3. Generate a random webhook secret → `GITHUB_WEBHOOK_SECRET` in Secret Manager; both
   join `cloudbuild.yaml` `--set-secrets` (the list REPLACES per deploy — complete set).
4. Set `GITHUB_CONTENT_REPO=<owner>/anchor-sites-content` (env via cloudbuild).
5. Add the repo webhook: payload URL `https://<studio-host>/api/git/webhook`,
   content type json, secret from step 3, push events only.

## Out of scope (v1)

Posts/events sync; media binary sync; repo-side deletions applying; per-site repos;
GitHub App auth (PAT client wraps token acquisition in one function for a later swap);
branch-based workflows/PR-based imports (webhook imports from the default branch only);
conflict merge UI.

## Definition of done

1. Enabling GitHub on a seeded site produces one commit containing `site.json`, every
   page file, `media.json`, `README.md`, `BLOCKS.md`; publishing a page produces exactly
   one further commit; an unchanged re-export produces none.
2. Editing a page file (valid change) + push → page updates in the builder with a
   `git:<sha>` revision; the revisions panel can roll it back.
3. Pushing an invalid block type → page unchanged, error in the Studio card AND a commit
   comment on GitHub.
4. Builder's own export commits never trigger imports (no loops).
5. No token configured → suite green, git card shows disabled, zero network calls.
6. Full suite green; secrets wired; runbook accurate.
