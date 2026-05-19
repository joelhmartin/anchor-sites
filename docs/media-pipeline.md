# Media pipeline

Phase 3 (D-022) media architecture for the AnchorCorps site builder. Covers GCS storage layout, lifecycle, IAM, signed-URL uploads, the pg-boss variant-generation job, and the `<Image>` block in `@anchorcorps/components`.

## GCS layout

Single bucket per environment:

| Field | Value |
|---|---|
| Bucket | `anchorcorps-media` |
| GCP project | `anchor-hub-480305` |
| Region | `us-central1` (matches Cloud SQL + Cloud Run) |
| Access | Uniform bucket-level access (IAM only, no per-object ACLs) |

Object key shape (each path component is **slash-delimited**, not a real directory):

```
originals/<site_id>/<asset_id>.<ext>            # private — admin-only upload + serve-via-signed-URL
variants/<site_id>/<asset_id>-<variant>.<hash>.<ext>  # public — immutable, cache-friendly
```

- `<asset_id>` is the `media_assets.id` UUID.
- `<variant>` is one of `thumbnail` / `sm` / `md` / `lg` / `2x`.
- `<hash>` is a short content hash so each variant URL is immutable. Re-processing the same source produces the same hash → same URL → free CDN cache validation.

## Lifecycle

After **30 days** with no access, objects under `originals/` move from STANDARD → COLDLINE. Variants stay in STANDARD forever (they're tiny and hot).

Policy lives at `gs://anchorcorps-media`. Re-applied via:

```bash
gcloud storage buckets update gs://anchorcorps-media \
  --lifecycle-file=docs/_anchorcorps-media-lifecycle.json
```

(See `docs/_anchorcorps-media-lifecycle.json` for the committed copy.)

## IAM

Bucket-scoped only — no project-level `roles/storage.*` bindings:

| Principal | Role | Why |
|---|---|---|
| `333281424614-compute@developer.gserviceaccount.com` (default Cloud Run / Compute SA) | `roles/storage.objectAdmin` on `gs://anchorcorps-media` | Renderer process needs read + write + signed-URL minting. The variant job runs in the same Cloud Run service (pg-boss worker mode) and needs write. |
| Same SA | `roles/iam.serviceAccountTokenCreator` on itself (self-impersonation) | Required to sign URLs from inside Cloud Run without exporting a JSON key. |

If a future need surfaces to separate the worker SA from the renderer SA (e.g. throttle one without the other), create a dedicated `anchor-sites-media-worker@...` SA, grant it `objectAdmin` on the bucket only, and run a second Cloud Run service for the worker pool.

## Cloud CDN — deferred to a hardening follow-up

For v0.1, variants are served directly via GCS public URLs:

```
https://storage.googleapis.com/anchorcorps-media/variants/<site_id>/<asset_id>-<variant>.<hash>.<ext>
```

GCS auto-caches at the edge via Google's network. The `Cache-Control: public, max-age=31536000, immutable` header on every variant signals long-lived caching to browsers + intermediaries.

A Cloud CDN front (custom domain `media.anchorcorps.com`) requires:

1. Global External HTTPS Load Balancer
2. Backend bucket pointing at `anchorcorps-media` with `enable_cdn=true`
3. DNS A record + managed SSL cert for `media.anchorcorps.com`

That's deferred to a Phase 12 hardening task. The `Image` block's variant URLs are produced by a helper (`mediaUrl(asset, variant)`) so the switch from `storage.googleapis.com/...` → `media.anchorcorps.com/...` will be a single-function change with no schema churn.

## Upload flow

1. Admin (or future editor UI) POSTs to `/api/sites/:siteId/media/upload-url`. Server validates, inserts `media_assets` row with `variants_status='pending'`, returns `{ asset_id, upload_url, expires_at, headers }`.
2. Browser PUTs the original file directly to GCS at `upload_url` (signed PUT, 15-minute window). No bytes through Cloud Run — bypasses the 32MB request-body limit.
3. Browser POSTs to `/api/sites/:siteId/media/:asset_id/complete`. Server enqueues `media.process-upload` via pg-boss. Idempotent: if `variants_status` is already `processing` or `ready`, returns 202.
4. pg-boss worker downloads the original, runs `sharp` to produce `thumbnail` (200w) / `sm` (480w) / `md` (768w) / `lg` (1280w) / `2x` (2560w) in WebP + JPG. Uploads each to `variants/` with the immutable cache header. Sets `variants_status='ready'` and `variants=[...]`. On failure: `variants_status='failed'`, `last_error=<msg>`, retries via pg-boss's exponential backoff.
5. Renderer's page route looks up `media_assets` for any block referencing an `asset_id`, threads variant URLs into the `<Image>` block, which emits `<picture>` with srcset.

## Local development

The signed-URL flow works against the real GCS bucket from a developer machine — `gcloud auth application-default login` provides the necessary credentials. No emulator is needed for v0.1; the bucket has a free tier covering local dev volume.

If a dev wants to skip GCS entirely (offline mode), set `MEDIA_STORAGE=memory` (planned for a future task) — the upload-URL endpoint returns a fake URL and the worker fakes variants. Not implemented yet.
