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

### D-018: shadcn/ui + Radix as the foundation for `@anchorcorps/components`

**Context:** Phase 2 builds the global component library. Writing accessible, keyboard-navigable, focus-managed UI primitives from scratch is weeks of work. shadcn/ui (MIT) provides copy-paste React component source code built on **Radix UI** primitives (a11y, keyboard, focus management) and styled with Tailwind. There is no paid tier — the CLI and all components are free forever. Third-party premium template galleries (shadcnui-blocks etc.) are unrelated and not used.

**Decision:** `@anchorcorps/components` is composed of two layers:
1. **Primitives layer:** shadcn/ui components copied into the package source (so we own the code and can edit freely). Radix UI under the hood for a11y/keyboard.
2. **Opinionated blocks layer (the public API):** higher-level components like `<HeroSlider>`, `<TestimonialCarousel>`, `<LogoReel>`, `<FAQAccordion>`, `<CTABanner>` — built *on top of* the shadcn primitives and `Embla Carousel` (for sliders/carousels) — all wearing the `ac-` class prefix, consuming CSS custom properties (`--theme-main`, `--theme-accent`), no `font-family` declarations.

**Carousels / sliders specifically:**
- shadcn's `<Carousel>` (Embla Carousel under the hood) covers hero sliders, testimonial carousels, image galleries.
- shadcn's `<Slider>` is a range input — different use case; available if needed.
- For complex needs beyond Embla (parallax, multi-row, heavy gesture work), drop **Swiper.js** (MIT) into a specific block. Default to Embla; escalate to Swiper only when warranted.

**Rationale:**
- Free, MIT, no vendor lock-in. We own every line because shadcn is copy-paste, not a runtime dependency.
- Radix solves a11y/keyboard/focus problems we'd otherwise solve badly.
- Tailwind already in the stack.
- Embla Carousel is the de-facto modern carousel: lightweight, accessible, no jQuery legacy.

**Alternatives considered:** MUI (rejected — opinionated styling, harder to brand per-site, larger bundle); Headless UI (rejected — Radix has broader coverage); Ariakit (viable; chose Radix for community/ecosystem size); building from scratch (rejected — accessibility/keyboard work too costly for v1).

### D-019: pg-boss for background jobs (no Redis)

**Context:** Several phases need background work: Phase 7 (template materialization), Phase 10 (DNS verification polling), Phase 11 (CRM sync retries), Phase 5+ (Puck save → image variant generation per D-022). Bringing in Redis just for a job queue adds a service to run, monitor, and back up.

**Decision:** Use **pg-boss** (MIT, free) for background jobs. It uses our existing Postgres as the queue backend — same DB connection pool, same backups, same observability. No Redis. Job definitions live under `src/server/jobs/`. The same Express process can act as the worker in v1; if throughput requires it, run a separate worker Cloud Run service later (same image, different `JOB_WORKER=true` env var).

**Rationale:**
- Zero new infrastructure.
- ACID job state via Postgres — exactly-once semantics easier than Redis-based queues.
- Backups already cover the queue.
- Scaling out is a Cloud Run config change, not a re-architecture.

**Alternatives considered:** BullMQ (rejected — needs Redis); RabbitMQ (rejected — operational overkill); Cloud Tasks (viable but adds GCP-specific lock-in and IAM complexity for a workload Postgres handles fine).

**How to apply:** Phases 7, 10, 11 and the image pipeline (D-022) use pg-boss. New jobs register in a central `src/server/jobs/index.ts` so the worker boot sequence sees them all.

### D-020: Better-auth for Phase 8 auth

**Context:** Phase 8 copies auth into each provisioned site. Rolling our own session management, password hashing (Argon2), email verification, password reset, and OAuth providers is substantial work and a security-sensitive surface area to maintain.

**Decision:** Use **Better-auth** (MIT, free) as the auth library inside the per-site auth copy-in template. Better-auth ships sessions, password hashing, email verification, password reset, OAuth (Google/GitHub/etc.), and optional 2FA out of the box. Per-site DB tables (`auth_users`, `auth_sessions`, etc.) — naturally fits per-site copy-in (D-008).

**Rationale:**
- Security-sensitive code is better borrowed from a maintained library than rolled.
- Better-auth's drizzle/Prisma/raw-SQL adapters work with our `pg` setup.
- Active maintenance, modern codebase, framework-agnostic (works with Express).
- Per-site copy still works: each site owns its auth tables and Better-auth config.

**Alternatives considered:** Lucia (rejected — discontinued, successor is fragmented across Oslo/Arctic packages); Auth.js / NextAuth (rejected — Next.js coupling); Passport.js (rejected — older, more glue code); rolling our own (rejected — security risk for marginal gain).

**How to apply:** Phase 8 template copies a Better-auth config + the schema migrations + the route handlers. Per-client overrides (e.g., a client wanting only Google OAuth, no password) happen in the per-site copy without affecting other sites.

### D-021: Self-hosted Plausible or Umami over Google Analytics

**Context:** Provisioned sites need analytics. GA4 is free but requires a cookie banner under GDPR/CCPA (drags conversion rates) and ships data to Google. Privacy-first analytics is a market signal AnchorCorps clients increasingly care about.

**Decision:** Default analytics for provisioned sites is **Plausible Community Edition** or **Umami** — both MIT, both self-hostable, both cookieless and exempt from cookie banner requirements in most jurisdictions. **Plausible CE** is the default unless a specific reason pushes Umami. One shared analytics instance serves all client sites (multi-tenant), one Cloud Run service with a small Postgres database (can share the existing instance).

**Rationale:**
- No cookie banner → better conversion rates → real client value.
- Single shared instance means low marginal cost per new client site.
- Open source means no per-site SaaS bill scaling with client count.
- Clients can be offered a per-site dashboard if they want one (Plausible supports shared links + embed).

**Alternatives considered:** GA4 (rejected for default — banner, data ownership concerns); Fathom (rejected — paid SaaS); PostHog (overkill for marketing-site analytics; useful later if product analytics on the builder itself is wanted); per-site SaaS subscriptions (rejected — cost scaling).

**How to apply:** Phase 12 (hardening) installs the analytics instance. The site template includes a small `<AnalyticsScript siteId={…}>` block automatically injected into the HTML shell; admins can disable per-site if a client objects.

### D-022: Image hosting on GCS with pre-generated variants + Cloud CDN

**Context:** Multi-tenant site builder needs media (images primarily, video later). Already on GCP. Cloud Run has a 32MB request body limit, so direct-through-server uploads don't scale. Image transforms can be on-the-fly (imgproxy/Thumbor sidecar) or pre-generated (sharp at upload time). Phase 3 originally listed "media" as a one-liner; this decision concretizes it.

**Decision:** **GCS + Cloud CDN + pre-generated variants.**
- **One bucket** (`anchorcorps-media`) with per-site prefix (`<site_id>/<asset_id>.<ext>`). Public access on variants, private on originals.
- **Cloud CDN** in front of the bucket. Cache-Control: `public, max-age=31536000, immutable` on variants (URLs are hash-suffixed so cache invalidation is free).
- **Direct-to-GCS uploads via signed URLs:** admin UI requests a signed PUT URL from the server, browser uploads straight to GCS, server enqueues a pg-boss job (per D-019) that runs `sharp` to generate variants (thumbnail / sm / md / lg / 2x) and uploads them.
- **Block-level rendering:** the `<Image>` block stores the canonical asset ID; the renderer emits `<picture>` with `srcset` pointing at the variant URLs.
- **Lifecycle:** archive originals to Coldline after 30 days no-access; variants stay in Standard forever (they're small).

**Rationale:**
- Pre-generated variants → predictable cost, near-100% CDN cache hit rate, no transform service to run.
- Signed-URL upload → no 32MB ceiling, no Express proxy CPU spent on bytes.
- Cloud CDN edge cache → fast globally; pairs with GCS natively.
- Lifecycle archiving → ~80% storage cost savings on cold originals.

**Alternatives considered:**
- Cloudflare R2 (viable — zero egress fees, S3-compatible; rejected for v1 because it adds a cross-cloud dependency; revisit if egress becomes the dominant cost).
- On-the-fly transforms via imgproxy/Thumbor (rejected — adds an always-on service; pre-generation is simpler and cheaper for this access pattern).
- Static folder on Cloud Run (rejected — immutable revisions and request size limits).

**How to apply:** Phase 3 expansion will spec the upload signing endpoint, the pg-boss variant job, the `<Image>` block schema (canonical ID + alt text + focal point), and the renderer's `<picture>`-with-srcset output.

---

### D-023: Mailgun for email, not Resend; shared with anchor-hub

**Context:** D-012 originally specified Resend as the email provider. Once Task 1.8 began the production deploy walkthrough, the `anchor-hub-480305` GCP project surfaced and it already runs anchor-hub on Mailgun — `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_DEFAULT_FROM`, `MAILGUN_SANDBOX_*` secrets are all populated, and the From domain is already verified inside Mailgun. The builder ships in the same GCP project (see D-004 / D-024 below if introduced) so duplicating a Resend account, verifying a second domain, and authoring a second set of templates buys nothing operationally.

**Decision:** Use **Mailgun** for all builder-side email (phase started / demo milestone / phase completed / blocker / daily digest / test regression). The same Mailgun account + From domain as anchor-hub. `src/server/email/send.ts` calls `https://api.mailgun.net/v3/$MAILGUN_DOMAIN/messages` with HTTP Basic auth (`api:<key>`) and `application/x-www-form-urlencoded` payload. Env vars: `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_DEFAULT_FROM` — secret names match anchor-hub's existing Secret Manager entries.

**Rationale:**
- **One provider account.** One billing line, one set of compliance reviews, one rate-limit pool to monitor.
- **From domain already verified.** No DNS gymnastics to start sending.
- **Shared secrets in Secret Manager.** Cloud Run grants the builder service account read access on the existing `MAILGUN_*` secrets; no copy-paste.
- **Mailgun rate limits and deliverability profile match what anchor-hub has already tested in production.**

**Alternatives considered:**
- Resend (rejected — see above; the second-provider tax outweighs marketing/UX preferences for this internal-tool email surface).
- SES (rejected — adds AWS IAM to the GCP-only stack).
- Postmark (rejected — same second-account tax as Resend, no integration win).

**How to apply:**
- Phase 1, Task 1.9: `src/server/email/send.ts` already targets Mailgun. Local dev runs in stub mode (no `MAILGUN_API_KEY`).
- Phase 1, Task 1.8: `cloudbuild.yaml` injects the three Mailgun secrets via `--set-secrets`. The Cloud Run default SA must hold `roles/secretmanager.secretAccessor` on `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_DEFAULT_FROM`.
- Phase 12 hardening: re-evaluate when client-facing transactional email lands (the marketing-site email surface is different from the builder-internal one). If clients want a dedicated From for their own site (e.g. `noreply@muldoondental.com`), the renderer can authenticate Mailgun with a different sending domain per `site_id` without changing the contract.

### D-024: AnchorCorps Site Builder shares the anchor-hub GCP project + Cloud SQL instance

**Context:** Task 1.8 needed a target GCP project for the production deploy. The operator (user) confirmed `anchor-hub-480305` already runs anchor-hub on Cloud Run with a Cloud SQL Postgres 15 instance named `anchor` in us-central1, an `cloud-run-source-deploy` Artifact Registry repo with ~44GB of existing images, and an inventory of secrets covering integrations the builder will eventually need (CTM, Mailgun, Monday, Google Ads, Facebook, GA4).

**Decision:**
- **GCP project:** `anchor-hub-480305`. The builder lives alongside anchor-hub and `ai-endpoint`.
- **Cloud Run service:** new service `anchor-sites` in `us-central1`. **Separate** from `anchor-hub` per D-004 — different scale profile (renderer = public traffic), different release cadence, different security surface.
- **Cloud SQL:** reuse the existing `anchor` instance. New database `anchor_sites_prod`. New user `anchor_sites` with privileges only on that database (so anchor-hub's `anchor` database stays isolated by Postgres-native access control).
- **Artifact Registry:** reuse the existing `cloud-run-source-deploy` repo in us-central1. Images tagged `anchor-sites:<SHORT_SHA>`.
- **Cloud Build:** new trigger watching `joelhmartin/anchor-sites` `main`, separate from the anchor-hub trigger.
- **Region:** us-central1 throughout — matches anchor-hub, matches the Cloud SQL instance, zero cross-region latency.

**Rationale:**
- **Same project preserves the D-004 service-boundary isolation while eliminating duplicated infrastructure.** The anchor-hub project already pays for Artifact Registry storage, Cloud Build minutes, monitoring, billing setup, and IAM bindings; standing up a parallel project would re-pay all of that for no isolation benefit.
- **Cloud SQL multi-DB is the cheapest correct answer.** Adding `anchor_sites_prod` to the existing instance costs storage delta only (tens of MB). Phase 12 can evaluate whether the renderer's write traffic justifies a dedicated instance once real client load is measured.
- **Same-project Phase 11 CRM integration** (5 HTTP endpoints into anchor-hub) doesn't need cross-project IAM; the Cloud Run service can call anchor-hub's URL directly using the default service account if/when we move the CRM endpoints behind IAM.
- **Operator already has gcloud auth to this project.** No new credential or project setup tax.

**Alternatives considered:**
- New GCP project (`anchorcorps-sites-prod`): rejected — pure tax for the agency-scale this is built for. Re-evaluate if a tenant demands hard project-level isolation in writing.
- Shared Cloud Run service with anchor-hub: rejected — violates D-004's separation principle, breaks per-service scaling, breaks per-service IAM, mixes public traffic with internal-team traffic.

**How to apply:**
- `cloudbuild.yaml` substitutions point at `anchor-hub-480305:us-central1:anchor` for `_SQL_INSTANCE` and `cloud-run-source-deploy` for `_AR_REPO`.
- `docs/deploy.md` updated to reflect existing resources; only **new** resources are: the `anchor_sites` Cloud SQL user, the `anchor_sites_prod` database, the `ANCHOR_SITES_DATABASE_URL` + `ANCHOR_SITES_ADMIN_API_TOKEN` secrets, and the `anchor-sites` Cloud Run service. Everything else is reuse.
- Phase 10 (domain provisioning) will still map `*.preview.anchorcorps.dev` and per-client domains to the `anchor-sites` Cloud Run service, not to anchor-hub.

### D-025: Preview/builder URLs live under `*.sites.anchorcorps.com`, not `*.preview.anchorcorps.dev`

**Context:** Earlier task drafts (and the first BLOCKERS.md entry B-002) referenced `*.preview.anchorcorps.dev` as the wildcard parent for Phase 1 sites. The operator does not own `anchorcorps.dev`; they own `anchorcorps.com` (matches the jmartin@anchorcorps.com account on gcloud). The domain placeholder needed to land on a domain they actually control.

**Decision:** Builder preview / staging / production-tenant URLs live at `*.sites.anchorcorps.com`.
- Seeded hostnames: `muldoon.sites.anchorcorps.com`, `demo.sites.anchorcorps.com` (plus `muldoon.localhost`, `demo.localhost` for local dev).
- `resolveSite` subdomain-fallback regex narrowed to `^([a-z0-9][a-z0-9-]*)\.sites\.anchorcorps\.com$` so non-`sites.` subdomains under `anchorcorps.com` (mail, www, blog, etc.) never get mis-routed to the builder.
- Phase 10 client-owned custom domains still flow through explicit `site_domains` rows — D-025 doesn't constrain them.

**Rationale:**
- **Real domain ownership.** `*.dev` cost money to acquire, requires HSTS preload, and provides zero advantage here. `*.sites.anchorcorps.com` is free, already controlled, and visually clearer ("the AnchorCorps sites layer").
- **Layer-3 label `sites` keeps the apex free** for the main `anchorcorps.com` marketing site, plus any future ops subdomains.
- **Narrow regex prevents accidental tenant resolution** on hostnames that exist for other reasons under `anchorcorps.com`.

**How to apply:**
- `db/seed.ts` UPSERTs the new hostnames and also DELETEs any `*anchorcorps.dev` legacy rows before inserting (idempotent — no-op once cleaned).
- `cloudbuild.yaml` and `docs/deploy.md` reference `anchor-hub-480305` and `*.sites.anchorcorps.com` directly.
- `BLOCKERS.md` B-002 updated: verification target is now `anchorcorps.com` (Search Console TXT at the apex), and the eventual `gcloud beta run domain-mappings create --domain='*.sites.anchorcorps.com'`.
- Earlier PHASE-01 completion log entries and DEMO-LOG entries that mention `anchorcorps.dev` are left as-is (append-only history). The new completion log entry below this decision records the switch.

**Alternatives considered:**
- Buying `anchorcorps.dev` — rejected; no operational win, just calendar friction during Phase 1.
- Using the apex `*.anchorcorps.com` with no layer-3 label — rejected; collides with future marketing site / mail / ops subdomains and forces the resolver to be careful about what it claims.
- A different parent label (`preview.`, `apps.`, `builder.`) — `sites.` reads cleanest for the actual product surface (tenant sites). `preview.` was confusing because production tenant URLs aren't a "preview" of anything once a client is live.

<!-- Routine appends future decisions below this line -->
