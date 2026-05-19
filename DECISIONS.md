# Architecture Decisions Log

> Append-only. Never edit past entries. Each decision: timestamp, context, decision, rationale, alternatives considered.

---

## 2026-05-18 — Seeded from planning conversation

### D-001: Block JSON as page storage

**Context:** Need a data model for editable pages that an AI can mutate safely.
**Decision:** Pages stored as `blocks JSONB` array in Postgres. Each block has `id`, `type`, `props`, optional `children`. Block types defined in a registry with Zod schemas.
**Rationale:** Structured tree gives AI a safe mutation surface (insert/update/delete operations on typed nodes vs. regex over HTML). JSONB gives queryability and revision tracking via a simple second table. This is the single most important decision — it's why WordPress/Divi fight AI editing and Webflow/Framer don't.
**Alternatives considered:** Normalized block rows (rejected — too many joins, no obvious win); HTML blob with parsing (rejected — what WordPress does, the exact thing we're escaping); MDX (rejected — not visually editable).

### D-002: Zod schemas as the contract

**Context:** Blocks need validation, typing, editor form generation, and AI prompt schemas.
**Decision:** One Zod schema per block type does all four jobs. Inferred type used by React component. `zod-to-json-schema` used for AI prompts. Schema introspection drives editor form fields.
**Rationale:** Single source of truth eliminates drift between validator, type, form, and AI prompt.

### D-003: Multi-tenant by Host header, not per-site deploys

**Context:** Could give each client a Cloud Run service or run one shared renderer.
**Decision:** One renderer service. Resolves `req.hostname` → `site_id` via `site_domains` table. Brand tokens and content fetched per-request, cached.
**Rationale:** Avoids Cloud Run domain mapping limits, eliminates per-site cold start costs and deploy fan-out, single observability surface. Per-client isolation can be added later if a client demands it in writing.

### D-004: Builder is a separate product from the CRM

**Context:** Could embed builder inside existing CRM or run separately.
**Decision:** Separate Node/Express + React + Postgres app, separate Cloud Run service, separate database. Integration via 5 explicit HTTP endpoints documented in Phase 11.
**Rationale:** Different change cadence (CRM stable, builder iterative), different scale profile (renderer = public traffic, CRM = internal), different security surface, different data ownership. Internal-team-only context removes SSO concerns.

### D-005: Global components as versioned NPM package on GCP Artifact Registry

**Context:** Sites need a hero, slider, accordion, etc. — same components reused everywhere. Could copy code per site, use submodules, or publish a package.
**Decision:** Publish `@anchorcorps/components` to GCP Artifact Registry. Each site depends on a version. Components use `ac-` class prefix, CSS custom properties, no font-family in component CSS, Font Awesome over inline SVG.
**Rationale:** Versioning lets sites pin a known-good release. Bug fix in v1.2.3 propagates by version bump. AI agents import from the package instead of regenerating components per site.
**Alternatives considered:** Copy-on-init (rejected — fixes don't propagate); git submodule (rejected — operational pain); runtime fetch (rejected — adds latency and a runtime dependency).

### D-006: Forms remain CRM embeds — builder never touches PHI

**Context:** Sites need contact/lead forms. Could rebuild forms in the builder or keep CRM's existing embed.
**Decision:** Builder ships a `crm_form` block that renders the CRM's existing inline-HTML embed. Form submissions go browser → CRM directly. Builder never sees or stores submission data.
**Rationale:** Preserves the existing HIPAA-aware form pipeline. Builder has no PHI surface. Zero sync work when CRM forms change. CTM SID handoff already works because embed is inline HTML, not iframe.

### D-007: Repo starts as the existing site template

**Context:** Could greenfield the builder or evolve the existing template.
**Decision:** Clone the existing core template repo, point routine at the clone. Routine sees a working app with auth/blog/events on day one and evolves it into the builder.
**Rationale:** Skips foundational stack debates (router, ORM, auth library already chosen). Routine has a working baseline to protect via tests. Routine refactors rather than greenfields, which is a better-bounded task.

### D-008: Auth/blog/events copied into each site, not centralized

**Context:** Provisioned sites need login, blog, events. Could share a central backend or copy per site.
**Decision:** When a new site is provisioned, the auth/blog/events code is copied into that site's instance. Each site owns its copy and can diverge if a client needs custom logic. Not hardwired to a shared backend.
**Rationale:** Per-client customization is a real requirement for the agency business. Central backend creates coupling that prevents client-specific overrides.

### D-009: CTM script in HTML head, PhoneNumber memoized to prevent re-render

**Context:** React re-renders can clobber CTM's swapped phone numbers.
**Decision:** CTM script in renderer's HTML shell head (before bundle). `<PhoneNumber>` block component wrapped in `memo` with `() => true` comparator — never re-renders after mount. Route changes call `__ctm.main.runNow()` via a layout-level hook.
**Rationale:** Standard CTM React integration pattern. Verified against CTM docs 2026-05-18.

### D-010: Deploy target is Cloud Run, not Vercel

**Context:** This repo currently ships as a Vite SPA with `vercel.json` and was deployable to Vercel. The builder requires server-rendered multi-tenant routing (Host header → site_id), Postgres, and wildcard subdomain mapping with managed SSL.
**Decision:** All builder deployment goes to **Google Cloud Run**. The existing `vercel.json` is legacy and will be removed during Phase 1 Task 1.8 in favor of `Dockerfile` + `cloudbuild.yaml`. Wildcard domain `*.preview.anchorcorps.dev` maps to the Cloud Run service.
**Rationale:** Cloud Run gives long-running Node server runtime, wildcard domain mapping, and managed SSL without per-deploy fan-out. Vercel's serverless model fights the multi-tenant Host-header pattern and isn't aligned with the rest of AnchorCorps infra (GCP Artifact Registry for `@anchorcorps/components`, Cloud SQL Postgres).
**Alternatives considered:** Vercel (rejected — see above); GKE (rejected — too much ops surface for v1); per-site Cloud Run services (rejected — see D-003).

### D-011: Starting repo has frontend only — backend will be scaffolded in Phase 1

**Context:** PLAN.md and PHASE-01-foundation.md were drafted assuming a working Node/Express + Postgres template with auth, blog, and events as the safety net. The actual starting repo is a Vite + React SPA with no Express server, no Postgres connection, no auth, no blog, and no events.
**Decision:** Phase 1 inserts a **Task 1.0 — Backend scaffold** before Task 1.1. Task 1.0 stands up an Express server alongside the existing Vite build, wires Postgres via `pg`, sets up `node-pg-migrate`, and adds a minimal `/healthz`. Task 1.1's baseline smoke tests then cover whatever exists after 1.0 — `/healthz` and the SPA serving — rather than auth/blog/events. The auth/blog/events flows referenced throughout the plan become Phase 8 work (per the original plan), not pre-existing baseline.
**Rationale:** Greenfielding the backend inside Phase 1 keeps the routine bounded (single phase, no separate "Phase 0"), and the architectural anchors (block JSON, Zod schemas, multi-tenant by Host) still apply on day one. Pretending an auth flow exists would cause the routine to fail Task 1.1 immediately.
**How to apply:** The routine expands Task 1.0 on its first run and asks for human confirmation of the detailed sub-task list before executing, per the daily prompt's phase-expansion rule.

### D-012: Operational pointers for the routine

**Context:** The daily prompt expects to know where email sending lives, how to run tests, and how to run migrations. None of these exist yet in the starting repo, so they need to be pre-declared rather than discovered.
**Decision:**
- **Email service:** Not yet wired. The routine creates it in Phase 1 Task 1.9 using **Resend** (HTTP API, no SMTP setup, works from Cloud Run). API key goes in GCP Secret Manager as `RESEND_API_KEY`. Sending helper lives at `src/server/email/send.ts` once Phase 1 Task 1.0/1.9 land.
- **Test command:** `npm test` (Vitest, already configured in `package.json`).
- **Migration tool:** `node-pg-migrate`. Migrations live in `db/migrations/`. Commands: `npm run migrate:up`, `npm run migrate:down`. Added in Task 1.0.
- **Deploy command:** `gcloud run deploy` driven by `cloudbuild.yaml` on push to `main`. Wired in Task 1.8.
**How to apply:** When the daily prompt references "the email sending mechanism" / "run tests" / "run migrations", use these. If any turns out wrong on first run, the routine appends a corrective decision rather than guessing.

### D-013: Local Postgres via Docker Compose; Cloud SQL in prod

**Context:** D-011 introduced Task 1.0 (backend scaffold). The routine needs a Postgres instance for dev and a path to prod that doesn't require GCP credentials on every contributor's laptop.
**Decision:** **Local dev:** `docker-compose.yml` runs Postgres 16-alpine on `localhost:5432` with user `anchor`, DB `anchor_dev`. Connection string lives in `.env` (gitignored), example in `.env.example`. **Prod:** Cloud SQL Postgres reached via Cloud SQL Auth Proxy from Cloud Run. The same `DATABASE_URL` env var is the only thing that changes between environments. The application code does not branch on environment.
**Rationale:** Docker Compose gives zero-setup local DB with no GCP coupling. Cloud SQL is the obvious managed-Postgres choice on GCP and pairs cleanly with Cloud Run via the Auth Proxy sidecar. Same `DATABASE_URL` interface keeps the code free of environment-specific branches.
**Alternatives considered:** Neon/Supabase (rejected — adds a non-GCP vendor for a workload that's clearly going to GCP); SQLite for dev (rejected — JSONB / GIN indexes / `gen_random_uuid()` need real Postgres parity).

### D-014: Express + Vite in middleware mode (single process)

**Context:** Task 1.6 needs SSR (server-rendered HTML from block JSON) for SEO (Phase 9) and CTM script ordering (anchor #5). Three options were on the table: (a) Vite middleware mode inside Express, (b) separate Vite dev server + Express with `/api` proxy, (c) Express-only with Vite as a build tool.
**Decision:** **Vite middleware mode.** `src/server/index.ts` creates Express, imports Vite via `createServer({ middlewareMode: true, appType: "custom" })`, mounts `vite.middlewares` after API routes. One process, one port (`:3000`), HMR works in dev, SSR is natural in prod via `ssrLoadModule` (Task 1.6).
**Rationale:** Middleware mode is Vite's officially supported SSR architecture. Separate processes (option b) make SSR awkward because the dev SPA and prod SSR diverge. Express-only (option c) loses HMR. The existing `vite.config.js` had a `/api → :3000` proxy implying option (b) — that proxy is now removed, since Vite no longer runs standalone.
**How to apply:** All future server routes mount on the Express app created by `createApp()` in `src/server/app.ts`. The SSR entry for Task 1.6 will be `src/entry-server.tsx` and Express will call `vite.ssrLoadModule(...)` (dev) or import the prebuilt `dist/server/entry-server.js` (prod). Do not introduce a second port for Vite — keep one process.

### D-015: Phase 1 testing language adoption

**Context:** Existing client is `.jsx`; Phase 1 task list references `.ts`/`.tsx` everywhere (server, tests, future blocks).
**Decision:** New server code, tests, and Phase 1 block schemas/components are written in **TypeScript**. Existing client files (`src/App.jsx`, `src/main.jsx`, `src/components/**/*.jsx`) stay `.jsx` and are only migrated piecemeal if a Phase 1 task touches them. No big-bang `.jsx → .tsx` rename.
**Rationale:** Minimizes Task 1.0 surface area and risk of breaking the existing client during the foundation phase. Zod's inferred types (anchor #2) and AI prompt typing (Phase 6) require TS — but only on new code paths.

### D-016: Plugin / integration framework (Phase 7.5)

**Context:** D-005 covers UI components as versioned packages and Phase 11 covers the CRM as a special-cased integration with 5 endpoints, but nothing in the plan covers general-purpose backend integrations (e-commerce, calendar booking, custom forms with payment, third-party CRMs other than the AnchorCorps one). The first concrete example surfaced was Stripe: a site that needs e-commerce wants a UI block, server routes, webhook handlers, DB tables, and per-site API key config — only the UI surface is currently covered.

**Decision:** Establish a **plugin framework** that treats integrations as versioned npm packages on GCP Artifact Registry, same channel as `@anchorcorps/components`. Each plugin ships a single manifest declaring everything it contributes; the renderer composes enabled plugins at startup.

**Plugin shape:**

```
@anchorcorps/plugin-<name>
├── manifest.ts         — declares: blocks, routes, migrations, config schema, required env vars
├── blocks/             — block schemas/components registered into the global block registry
├── server/             — Express routers mounted at /api/plugins/<name>/*
├── migrations/         — node-pg-migrate files; tables prefixed (e.g. plg_stripe_orders) or in a per-plugin schema
└── config-schema.ts    — Zod schema for per-site config; renderer validates before mounting
```

**Per-site enablement:** New table `site_plugins (site_id, plugin_name, version, config_encrypted JSONB, enabled BOOL, installed_at)`. The renderer reads this at boot (and via cache-invalidation broadcasts), mounts enabled plugins, registers their blocks, and verifies their migrations have run.

**Config secrets:** Per-site config (e.g. Stripe API keys) stored as `config_encrypted` JSONB encrypted at rest with a KMS-managed key. Plugins receive decrypted config at request time, never log it.

**Migration ordering:** Plugins own their tables. Migrations run in plugin-install order. A plugin's migration cannot reference core tables it didn't create. Core schema (sites/pages/page_revisions) is owned by Phase 1; plugins extend, never alter, core tables.

**Block registry impact (retroactive to Phase 1, Task 1.3):** The block registry must support **runtime registration**, not only static imports from `src/blocks/`. The Phase 1 implementation will use a `registerBlock(entry)` function so plugins can call it during their load step. Static blocks in `src/blocks/` call `registerBlock` themselves at import time — same API.

**Rationale:**
- **Versioned packages over copy-in (per D-008):** Auth/blog/events are forkable per-client; plugins are shared infra where a bug fix must propagate. Different lifecycle → different distribution model.
- **Single repo per plugin → independent ops:** Each plugin can be developed, versioned, and rolled out without touching the renderer or other plugins.
- **Manifest over convention:** Explicit manifest makes the "what does this plugin do?" answer machine-readable (for the admin UI, for the renderer's startup checks, and for the AI editor when it suggests adding capabilities).
- **Same Artifact Registry channel as components:** One distribution mechanism, one auth story, one upgrade story.

**Alternatives considered:**
- WordPress-style in-repo modules (rejected — couples all plugins to renderer release cadence; doesn't version cleanly per-site).
- Microservices per plugin (rejected — operational overkill for v1; can be added later if a plugin needs isolated scaling).
- Pure server-side integrations with no UI surface (rejected — most agency-grade integrations need both; framing as "UI only" or "server only" forces awkward splits).

**How to apply:**
- Phase 1, Task 1.3: build the block registry with a `registerBlock()` runtime API. Static blocks call it themselves at module load.
- Phase 1, Task 1.5: `req.site` should expose `plugins: PluginInstance[]` (empty until Phase 7.5 lands; just reserve the field).
- Phase 7.5: implement `manifest.ts` contract, `site_plugins` table, plugin loader, admin UI for enable/disable + config (with the editor from Phase 5).
- Specific plugins (Stripe, PayPal, calendar booking, custom integrations) are post-7.5 phases or out-of-band package work, not in the master plan.

### D-017: Use Puck for the Phase 5 visual editor

**Context:** Phase 5 originally specified building the on-page editor from scratch (EditableWrapper, side panel, Tiptap, undo/redo). [Puck](https://puckeditor.com) is a mature, MIT-licensed React visual editor that already ships drag-and-drop, field renderers, viewport switcher, and undo/redo. Adopting it saves weeks of Phase 5 work and lowers maintenance.

**Decision:** Use Puck as the Phase 5 editor. Block schemas, the block registry, and the block renderer (Phase 1) remain unchanged — Puck **calls** our components and **emits** JSON that we round-trip through our canonical `Block[]` shape.

**Boundary contract:**
- **Canonical data shape stays ours:** `Block[]` (id, type, props, children) per D-001. This is what's stored in `pages.blocks` JSONB, what the AI editor (Phase 6) mutates, and what the prod renderer consumes. Puck's data shape (`{ content, root, zones }`) is a *view* of our data, not the source of truth.
- **Editor boundary converter:** A pair of functions in `src/editor/puck-adapter.ts` — `toPuckData(blocks: Block[]): Data` and `fromPuckData(data: Data): Block[]`. Lossless round-trip is a tested invariant.
- **Zod stays the contract (D-002):** A `zodToPuckFields(schema)` adapter generates Puck's field config from the same Zod schema that validates props, types the React component, and serializes into AI prompts. We do not define fields twice.
- **Components are shared:** The React component a block registers is the *same* component Puck renders in the editor and the prod renderer renders on the public site. No editor-only forks.

**Rationale:**
- **Phase 5 shrinks dramatically:** Puck supplies the editor chrome we'd otherwise build. Estimated savings: 3–5 routine work blocks.
- **No coupling beyond the editor:** Phase 1, Phase 6, Phase 7.5 (plugins), and the prod renderer never import Puck. Puck only lives behind the admin editor route. If Puck ever needs to be replaced, only `src/editor/` changes.
- **Plugin compatibility (D-016):** Puck's component map is mutable — plugins that call `registerBlock()` at load can also register with Puck's editor map via the same call. No special plugin path needed.
- **AI editing compatibility:** Phase 6 mutates `Block[]` (our shape). On save, Puck reloads the converted data. AI doesn't know Puck exists.

**Trade-offs accepted:**
- **Editor UX leans side-panel + preview iframe**, not pure inline click-to-edit. Inline editing for rich text fields lands via a Puck custom field wrapping Tiptap. The "click anywhere on the page to edit" UX from the original Phase 5 spec is softened — we get drag-and-drop + side-panel forms, not Webflow-style direct manipulation. Acceptable for v1.
- **Field DSL drift risk:** If Puck's field types diverge from what Zod can express, the adapter gets uglier. Mitigation: start with simple Zod schemas; add custom Puck fields for the few cases Zod can't model (rich text, image picker, color).

**Alternatives considered:**
- Chai Builder (rejected — less mature, smaller community, would put us in the early-adopter risk seat for v1).
- Custom editor as originally specified (rejected — high cost for marginal UX upside; we can always replace Puck later via the adapter boundary).
- Builder.io / Plasmic (rejected — vendor lock-in, hosted services with their own data model; conflicts with D-001).

**How to apply:**
- Phase 1 unchanged. `Block[]` shape stays as planned. Block components must remain pure functions of props (already required).
- Phase 5 expansion will define: `puck-adapter.ts` (data converter + `zodToPuckFields`), editor route, Puck config assembly from the block registry, Tiptap-as-Puck-field for rich text.
- Phase 5 expansion will pick a Puck version to pin and freeze the data-shape conversion contract.
- Phase 6 (AI editing) is unchanged — it operates on `Block[]`, not Puck's `Data`.

---

<!-- Routine appends future decisions below this line -->
