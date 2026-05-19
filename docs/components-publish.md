# `@anchorcorps/components` — publishing

Versioned npm package consumed by the renderer and (later) by provisioned-site templates. Distributed via **GCP Artifact Registry**, same `anchor-hub-480305` project as the rest of AnchorCorps infra (per D-024). The registry is npm-format, separate from the existing Docker `cloud-run-source-deploy` repo.

## Registry coordinates

| Field | Value |
|---|---|
| GCP project | `anchor-hub-480305` |
| Region | `us-central1` |
| Repository | `npm-anchorcorps` (npm format) |
| Registry URL | `https://us-central1-npm.pkg.dev/anchor-hub-480305/npm-anchorcorps/` |
| Scope | `@anchorcorps` (`@anchorcorps/components`, future `@anchorcorps/plugin-*`) |

Bootstrap (already executed 2026-05-19):

```bash
gcloud artifacts repositories create npm-anchorcorps \
  --repository-format=npm \
  --location=us-central1 \
  --project=anchor-hub-480305 \
  --description="AnchorCorps npm packages (@anchorcorps/*) — components, plugins"
```

## Local `.npmrc`

The renderer's project-root `.npmrc` (not in repo — gitignored; an `.npmrc.example` is committed) authenticates to the AR npm repo and routes the `@anchorcorps` scope at it. Auth uses your `gcloud` access token, so no service account key on developer laptops.

`.npmrc` template:

```
@anchorcorps:registry=https://us-central1-npm.pkg.dev/anchor-hub-480305/npm-anchorcorps/
//us-central1-npm.pkg.dev/anchor-hub-480305/npm-anchorcorps/:always-auth=true
//us-central1-npm.pkg.dev/anchor-hub-480305/npm-anchorcorps/:_authToken=${NPM_AR_TOKEN}
```

Refresh the token on each shell:

```bash
export NPM_AR_TOKEN="$(gcloud auth print-access-token)"
```

Tokens expire after ~1 hour. The companion alias in `docs/local-dev.md` re-exports it as needed.

## CI auth

The Cloud Build trigger for the components publish writes a short-lived `.npmrc` from a service account access token before running `npm publish`. v0.1 uses the **default Cloud Build service account** (no dedicated publisher SA yet — keeps Phase 2 from sprouting unnecessary IAM surface).

IAM scoped to **this repo only**, granted in Task 2.7:

- `333281424614@cloudbuild.gserviceaccount.com` → `roles/artifactregistry.writer` on `projects/anchor-hub-480305/locations/us-central1/repositories/npm-anchorcorps`

The renderer's Cloud Build trigger (existing) needs `roles/artifactregistry.reader` on the same repo so `npm install` can resolve `@anchorcorps/components`. This binding is added when Task 2.9 wires the renderer deploy.

No JSON keys on disk. No project-level `roles/artifactregistry.*` bindings.

If a future need surfaces for a dedicated publisher SA (e.g. to lock down which builds can publish), create `anchor-sites-components-publisher@anchor-hub-480305.iam.gserviceaccount.com`, grant it the same role, and set the Cloud Build trigger's service account to it. The `cloudbuild-components.yaml` doesn't need to change — only the trigger configuration.

## Versioning policy

Semver per the standard:

- **Patch** (`0.1.x`) — bug fix in an existing block; no schema or API change.
- **Minor** (`0.x.0`) — new block, new optional schema field with a default, new exported helper. Backwards-compatible.
- **Major** (`x.0.0`) — manifest shape change, breaking schema change (removed field, changed enum), `BlockManifestEntry` shape change.

Phase 2 ships `0.1.0` as the first labelled release. `0.x` lives in pre-1.0 territory until the manifest stabilizes; manifest shape changes during `0.x` ride minor bumps with explicit migration notes in the changelog.

## Publish flow

### Manual (developer machine)

Used for the bootstrap `0.1.0` and any developer-driven release until the trigger is wired:

```bash
cd packages/components
./scripts/publish.sh             # build + publish
./scripts/publish.sh --dry-run   # validate without uploading
```

The script auto-runs `npm run build` if `dist/` is missing, mints a short-lived `.npmrc` outside the workspace (npm ignores in-workspace `.npmrc`), points npm at it via `NPM_CONFIG_USERCONFIG`, and cleans up on exit.

### Automated (Cloud Build trigger — to be wired)

1. From the repo root, bump the package version: `npm -w @anchorcorps/components version patch` (or `minor` / `major`).
2. Commit and tag: `git commit -am "release(components): vX.Y.Z" && git tag components-vX.Y.Z`.
3. Push: `git push --follow-tags`.
4. The Cloud Build trigger fires on the `components-v*` tag, builds the package via `cloudbuild-components.yaml`, and publishes to the AR repo.

The trigger configuration (created in Cloud Build console or via `gcloud builds triggers create github`):
- Repo: `joelhmartin/anchor-sites`
- Event: Push to tag, regex `^components-v.+$`
- Build configuration: `cloudbuild-components.yaml`
- Service account: default Cloud Build (`333281424614@cloudbuild.gserviceaccount.com`) — already holds `roles/artifactregistry.writer` on `npm-anchorcorps`.

### Bootstrap log

- **2026-05-19** — `0.1.0` published manually from `jmartin@anchorcorps.com`'s gcloud session. Verified in AR via `gcloud artifacts versions list --repository=npm-anchorcorps --package=@anchorcorps%2Fcomponents`.

## Troubleshooting

- **403 on `npm publish`** — token expired (`gcloud auth print-access-token` again) or the calling principal lacks `roles/artifactregistry.writer` on `npm-anchorcorps`.
- **`npm` resolves to npmjs.com instead of AR** — `.npmrc` scope line missing or the package name isn't `@anchorcorps/*`. The package scope must match the `.npmrc` line.
- **`npm view @anchorcorps/components` returns nothing** — the package hasn't been published yet, or the `@anchorcorps` scope is not routed to the AR registry in your `.npmrc`.
- **Cloud Build trigger doesn't fire on tag push** — confirm the trigger's `tagFilter` matches `components-v.*` (regex, not glob).
