#!/usr/bin/env bash
# Publish @anchorcorps/components to the GCP Artifact Registry npm repo
# in anchor-hub-480305/us-central1/npm-anchorcorps.
#
# Manual flow (used for the v0.1.0 bootstrap and any developer-driven
# release). For automated tag-driven publishes, see cloudbuild-components.yaml.
#
# Prereq: caller must be authenticated to gcloud with
# roles/artifactregistry.writer on the npm-anchorcorps repo.
set -euo pipefail

cd "$(dirname "$0")/.."

DIST_DIR="dist"
if [[ ! -f "$DIST_DIR/index.js" || ! -f "$DIST_DIR/styles.css" ]]; then
  echo "[publish] dist/ not built — running npm run build first"
  npm run build
fi

# Mint a short-lived .npmrc OUTSIDE the workspace and point npm at it
# via NPM_CONFIG_USERCONFIG. npm ignores workspace-local .npmrc when
# running from a workspace package, hence the explicit userconfig path.
NPMRC_PATH="$(mktemp -t anchorcorps-publish-npmrc)"
trap 'rm -f "$NPMRC_PATH"' EXIT

TOKEN="$(gcloud auth print-access-token)"
cat > "$NPMRC_PATH" <<EOF
@anchorcorps:registry=https://us-central1-npm.pkg.dev/anchor-hub-480305/npm-anchorcorps/
//us-central1-npm.pkg.dev/anchor-hub-480305/npm-anchorcorps/:always-auth=true
//us-central1-npm.pkg.dev/anchor-hub-480305/npm-anchorcorps/:_authToken=${TOKEN}
EOF

DRY_RUN_FLAG=""
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN_FLAG="--dry-run"
  echo "[publish] DRY RUN — no upload"
fi

NPM_CONFIG_USERCONFIG="$NPMRC_PATH" npm publish $DRY_RUN_FLAG
