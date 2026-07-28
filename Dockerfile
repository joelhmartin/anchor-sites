# syntax=docker/dockerfile:1.7

# ---- deps: all deps (dev + prod) for the build step -----------------------
# npm workspaces (P2-T2.2): the @anchorcorps/components package is consumed
# via the in-repo workspace symlink — no AR-resolved npm install needed.
# Copy both package manifests so `npm ci` sees the workspace topology.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/components/package.json ./packages/components/package.json
RUN npm ci --no-audit --no-fund

# ---- build: produces dist/ via vite build + tsup --------------------------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build the components package first so render-page.tsx can resolve
# @anchorcorps/components/styles.css at module-load time. Then build the
# renderer's vite bundle.
RUN npm run build:components && npm run build

# ---- prod-deps: prod-only node_modules for the final image ----------------
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/components/package.json ./packages/components/package.json
# --ignore-scripts: better-auth peer-depends on vitest, so npm installs
# vite-node with a NESTED esbuild@0.21.5 even under --omit=dev; that nested
# copy's postinstall validates `esbuild --version` against the hoisted
# top-level esbuild (0.28, the overlay compiler) and fails the build.
# Scripts are unnecessary here: esbuild (>=0.18) and sharp (>=0.33) ship
# their binaries via @esbuild/* / @img/* optionalDependencies, verified by
# a full runtime smoke (buildSync, sharp, react-dom/server, pg, tsx).
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ---- run: minimal runtime image -------------------------------------------
FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# tsx runs TypeScript directly at runtime. Phase 12 hardening may switch to a
# precompiled JS bundle; for now this matches dev behavior.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/db ./db
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
# Workspace package — its prebuilt dist/ is what render-page.tsx inlines.
# package.json is needed for createRequire to resolve @anchorcorps/components.
COPY --from=build /app/packages/components/package.json ./packages/components/package.json
COPY --from=build /app/packages/components/dist ./packages/components/dist
# Email module reads .routine/templates/*.md at runtime; .dockerignore
# re-includes this path so it lands in the build context.
COPY --from=build /app/.routine/templates ./.routine/templates

EXPOSE 8080
# Cloud Run sets $PORT (default 8080). package.json `start` reads it.
CMD ["npm", "start"]
