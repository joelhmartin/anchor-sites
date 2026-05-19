# syntax=docker/dockerfile:1.7

# ---- deps: all deps (dev + prod) for the build step -----------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- build: produces dist/ via `vite build` --------------------------------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- prod-deps: prod-only node_modules for the final image ----------------
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

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

EXPOSE 8080
# Cloud Run sets $PORT (default 8080). package.json `start` reads it.
CMD ["npm", "start"]
