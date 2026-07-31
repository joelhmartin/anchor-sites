# Handoff: Lovable-for-Websites — state, open issues, and what the next session must do

**Date:** 2026-07-30 · **Repo:** anchor-sites · **Branch state:** everything merged to `main` (`0f8260c`), prod deployed via Cloud Build on push to main.
**Read this whole doc before touching anything.** The operator's standing rules apply: verify premises against code/prod (delegate checks, don't ask), subagent-driven execution, commit+push before major changes, never claim UI works without operator screenshots.

## The product, in one paragraph

"Rip off Lovable, but for websites." Multi-tenant site builder (Node/Express + React 18 + Postgres, single Cloud Run service `anchor-sites` in `anchor-hub-480305`): operator describes a site in chat → an agent builds it from Block-JSON (single Zod registry drives renderer, AI catalog, inline editing, git sync) → full-screen workspace (chat left / live preview right) → inline editing on the rendered page → one-click publish → auto-provisioned subdomain (`*.sites.anchorcorps.com`). Ten seeded templates are the showroom.

## What works today (verified against prod, not assumed)

- **Builds finish**: every chat turn is a background pg-boss job (no HTTP deadline), batches of 30 tool calls with auto-continue ×3, honest Anthropic error labels + Resume, survives closed tabs (`--no-cpu-throttling` is load-bearing).
- **Workspace** at `/sites/:slug`: full-bleed, resizable chat rail, scrollable transcript, tool-step progress, page switcher, viewport toggle, black-pill Publish with honest link states, account dropdown. Legacy tabs at `/sites/:slug/manage`.
- **Preview** finally renders in prod (it NEVER had before 2026-07-30): CSP `frame-src 'self'` + server-minted 15-min site-scoped HMAC preview tokens (`src/server/preview-token.ts`); in-preview nav rewritten to sibling previews; tracking scripts stripped in preview.
- **Publish**: bulk-publishes drafts, appends revisions, triggers git.export, returns `live_url` + readiness/failed state.
- **Provisioning**: `site.provision` pg-boss job on every create → Cloud Run domain mapping + Kinsta DNS (anchorcorps.com's zone is Kinsta DNS = Route 53; GoDaddy has NO zone for it). Wildcard `*.sites.anchorcorps.com → ghs.googlehosted.com.` exists.
- **Templates**: 10 authored (`db/templates/*.ts`, registered in `index.ts`), machine-validated + content-reviewed, seeded to prod with media-pipeline-ingested covers.
- **Suite**: ~1501 tests. Run with `set -a; source .env; set +a` (vitest doesn't load .env) and `TEST_DATABASE_URL="$DATABASE_URL"` for the integration set. One documented load-correlated wandering flake (different test each full run, always green isolated) — see `.superpowers/sdd/2026-07-30-lovable-workspace/test-pollution-debug.md`.

## OPEN ISSUES — operator-raised, unresolved, ranked

1. **Template gallery is not usable (operator screenshot, end of session).** Clicking a card selects it (border) but *nothing happens* — no navigation, no create, no way to preview what the template looks like. Two distinct problems: (a) the create action after selecting a card is either broken, hidden, or requires the prompt box in a way nothing communicates — trace `src/admin/pages/NewSitePage.tsx` (template-only submit path exists and passes tests, so this is a UX/discoverability failure at minimum, possibly a real event bug in prod); (b) **there is no template preview/detail view at all** — the operator cannot review a template before committing. Lovable lets you browse a template as a real site first. This needs designing (e.g. card click → full-screen preview using the existing preview infrastructure against a template-materialized demo, or pre-rendered screenshots), not just wiring.
2. **All site/template images 403 until the operator runs** `gcloud storage buckets add-iam-policy-binding gs://anchorcorps-media --member=allUsers --role=roles/storage.objectViewer` (classifier blocked the agent from making a bucket public). This is why template covers render blank and site images break — published sites included. One command, instant fix, no deploy. If not yet run by next session: it's the FIRST thing to have the operator do.
3. **Visual quality verdict still outstanding.** The operator twice rejected shipped UI ("looks like shit... nothing like what I described"). A design pass (Lovable anatomy) shipped after the last rejection, but the operator has NOT signed off on the current look. Do not treat the workspace/new-site visuals as accepted. Screenshots from the operator are the only acceptance gate (see memory `ui-needs-visual-proof`).
4. **Whole-product coherence.** The operator's closing instruction: engage the **big-picture skill** and audit everything as a user would — "consider all issues and actually make this work." Individual pieces pass reviews; the product experience keeps failing at the seams (preview CSP, bucket ACLs, template flow — all found by the operator, not by tests). The next session's job is a full user-journey audit of every flow in prod, not more feature work.

## One-time operator actions still pending (each ~1 minute, all already explained to them)

- Media bucket public-read (issue 2 above) — unblocks all images.
- Webmaster Central: add `333281424614-compute@developer.gserviceaccount.com` as verified owner of `anchorcorps.com` → makes Cloud Run domain-mapping creation (SSL) fully automatic; until then `site.provision`'s cloud_run step fails PermissionDenied and domains stay `pending`/`failed`.
- GitHub sync PAT: `GITHUB_CONTENT_TOKEN` secret is still the `"disabled"` placeholder → git sync is cleanly off. Runbook in `docs/github-sync.md` (fine-grained PAT on `jmartin-anchorcorps/anchor-sites-content`, Contents R/W).
- Delete test artifacts: sites `gate-test-phase-a`, `gate-test-unwatched` (no delete/archive API exists — SQL or build one); scratch repos on the personal GitHub account.

## Parked technical follow-ups (reviewed, consciously deferred — ledger has full context)

- Redact `?token=` from pino-http logged URLs (15-min read-only tokens land in Cloud Logging).
- Idle preview iframe reloads every ~12 min on token refresh (loses scroll position); no reactive 401 recovery possible (opaque origin — by design).
- `SITE_PROVISION` worker is serialized with up to 4-min holds per attempt → concurrent site creates queue behind each other (latency only, self-heals).
- git.export has no manual retry affordance after the bulk-publish no-op-skip; narrow mid-build revision-audit race on publish.
- Studio page-switcher is a native `<select>`; UserMenu lacks full ARIA-menu keyboard pattern; generic avatar (no /api/me identity).
- Load-correlated test flake under parallel-agent machine load.
- Inline rich-text sanitizer runs client-side only (server-side sanitizer was a pre-existing flagged follow-up).
- components package 0.6.0 not published to Artifact Registry (workspace symlink only).

## Architecture/ops gotchas that WILL bite you if unread

- **Cloud Run `--set-secrets` AND `--set-env-vars` REPLACE their whole lists per deploy** — everything must live in `cloudbuild.yaml` (17 secrets on the service; migrate job carries `DATABASE_URL` + `PIXABAY_API_KEY`). Manual `gcloud run services update` changes lapse on next CI deploy (broke OAuth once, provisioning twice).
- `--no-cpu-throttling` is required, not an optimization: background agent jobs die under request-scoped CPU.
- pg-boss v12: handlers `async ([job])`; `createQueue` before `work`; `singletonKey` needs `policy:"stately"` and silently DROPS duplicate keys — continuation/provision keys are carefully scoped (`${conversationId}:c${n}`, domain-row id).
- Tests: single forked process (`singleFork`) → `process.env` leaks across files; always `vi.stubEnv`, never raw writes.
- DNS: anchorcorps.com zone = Kinsta DNS (awsdns NS). The GoDaddy provider 404s on it. `resolveDnsProvider` prefers Kinsta when `KINSTA_API_KEY`/`KINSTA_COMPANY_ID` present.
- The classifier blocks some gcloud mutations (bucket IAM, cpu-throttling) — hand those to the operator as one-liners; config-as-code in cloudbuild is the durable path.
- Previews: sandboxed iframe (`allow-scripts` only) = opaque origin, no cookies, no parent introspection. Anything needing auth inside it must ride the URL (preview token).

## Where the history lives

- **Ledger (full task/review/fix history):** `.superpowers/sdd/2026-07-30-lovable-workspace/progress.md` (+ per-task reports, gitignored, same dir)
- Plan: `docs/superpowers/plans/2026-07-30-lovable-workspace.md` · Spec: `docs/superpowers/specs/2026-07-30-lovable-workspace-design.md`
- Docs (rewritten to match reality this session): `docs/ai-agent.md`, `docs/deploy.md`, `docs/github-sync.md`, `docs/inline-editing.md`
- Memory: `~/.claude/projects/-Volumes-G-DRIVE-SSD-DEVELOPER-anchor-sites/memory/` — read `MEMORY.md`; `ui-needs-visual-proof` and `max-subagent-delegation` are the operative ones.

## What the next session should do, in order

1. Have the operator run the bucket one-liner (and ideally the Webmaster Central add) — 90 seconds, unblocks images + SSL automation.
2. Engage **big-picture**: walk every user journey against PROD as a first-time user — new site (prompt / template / both), template browsing, build watching, preview clicking, inline editing, publish, live URL, /manage flows, sign-out/in — and catalog every failure or papercut before fixing anything. The template-selection flow (open issue 1) is the known first stop.
3. Turn the catalog into a ranked plan (operator reviews plans, not specs), then execute subagent-driven with the visual-proof rule: nothing UI-facing is "done" until the operator's screenshot says so.
