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

### D-026: Monorepo via npm workspaces (`packages/components/` in this repo)

**Context:** Phase 2 builds `@anchorcorps/components`. The options were (a) npm workspaces inside this repo, (b) a separate `joelhmartin/anchorcorps-components` repo published to GCP Artifact Registry, (c) a git submodule. The operator was given the choice in chat on 2026-05-19 and picked option (a).

**Decision:** The package lives at `packages/components/` inside this repo. Root `package.json` declares `"workspaces": ["packages/*"]`. The renderer consumes the package via the workspace symlink (`node_modules/@anchorcorps/components → packages/components`) in both dev and prod. The package still publishes to GCP Artifact Registry on tag-driven Cloud Build runs — the AR-published versions are the contract for future **cross-repo** consumers (Phase 8 provisioned-site templates), not for this renderer.

**Rationale:**
- **Atomic commits** across renderer + package during the 2.5→2.8 migration. A breaking package change can be paired with the renderer update in one commit.
- **Single test command** at the root via `vitest.workspace.ts` (Task 2.9). 156 tests across 26 files run in one invocation.
- **Single CI pipeline** for now — the existing renderer Cloud Build trigger builds and ships everything. AR-publish runs on tag pushes only.
- **Cheap split-out** later: when a consumer outside this repo needs the package, the package directory moves to a sibling repo with no code change beyond updating the AR publish trigger.

**Alternatives considered:**
- Separate repo: cleaner long-term boundary but adds friction to the Phase 2 migration and forces a published-version round-trip for every package change during early iteration. Rejected for v0.1.
- Git submodule: operational pain noted in D-005; same conclusion stands.

**How to apply:**
- New shared frontend code goes in `packages/components/` unless it's renderer-internal (registry, BlockRenderer, route handlers).
- New shared backend code (e.g. a future `@anchorcorps/plugins-runtime` per D-016 Phase 7.5) follows the same `packages/<name>/` pattern.
- Tag-driven publishes use `components-v*` tags; renderer Cloud Build uses `main` pushes. Same repo, separate triggers.

### D-027: `tsup` as the package build pipeline

**Context:** `@anchorcorps/components` ships ESM + CJS + `.d.ts` + a CSS bundle. Options were tsup (esbuild wrapper), raw `tsc` + custom esbuild, Rollup, Vite library mode.

**Decision:** **`tsup`** (`packages/components/tsup.config.ts`). One command emits `dist/index.js` (ESM), `dist/index.cjs` (CJS), `dist/index.d.ts` (types), sourcemaps for both. Tailwind CLI runs separately (`tailwindcss -i src/styles.css -o dist/styles.css --minify`) and is chained after tsup in the package's `"build"` script — tsup's `clean: true` would otherwise wipe the CSS.

**Externals:** `react`, `react-dom`, `react/jsx-runtime`, `zod` are marked external so they're not bundled into the package — consumers' versions win.

**Rationale:**
- One config, one invocation, esbuild speed (~50ms for the JS/CJS pass, ~1.2s for the dts pass).
- No Rollup/Vite plugin tax for what's essentially a TypeScript-to-JS-plus-types transform.
- Sourcemaps land for free.

**Alternatives considered:**
- Raw `tsc` + esbuild: more boilerplate; same output. Rejected for unnecessary friction.
- Rollup: classic choice for libraries but heavier config. Rejected.
- Vite library mode: viable; rejected because the package isn't a Vite consumer in any other way.

**How to apply:** New packages under `packages/` adopt the same tsup setup unless they have an unusual build need.

### D-028: Package emits a prebuilt CSS bundle; consumers don't install Tailwind

**Context:** `@anchorcorps/components` blocks use Tailwind utility classes under the hood. The options were (a) ship Tailwind source files and require the consumer to run Tailwind during their own build, or (b) ship a prebuilt CSS bundle and let consumers `import "@anchorcorps/components/styles.css"`.

**Decision:** Option **(b) — prebuilt CSS bundle**. The package's `tailwind.config.js` scopes content globs to `packages/components/src/**/*.{ts,tsx,css}` so Tailwind only scans the package's own source. The build emits one minified `dist/styles.css` (~12-14 KB). Consumers import it once; they don't need to install Tailwind, postcss, or any plugins.

**Rationale:**
- **Consumer ergonomics:** the renderer (and future provisioned-site templates) doesn't have to ship Tailwind or worry about content globs. One CSS import, done.
- **Stable output:** the package's CSS bundle is deterministic per version. A consumer pinning `@anchorcorps/components@0.1.5` gets the exact same CSS they tested against.
- **Bounded bundle size:** Tailwind's content globs only see the package's own usage. The CSS bundle won't bloat as consumer codebases grow.

**Brand tokens** are wired in the package's tailwind config — `bg-theme-main`, `text-theme-on-surface`, etc. resolve to CSS custom properties consumers set at `:root` per-site. The renderer already sets these in `render-page.tsx`; provisioned sites will do the same in their HTML shell.

**Block-specific CSS (keyframes etc.)** lives inlined inside `src/styles.css` under a labelled section. The Tailwind CLI does NOT run `postcss-import`, so per-block `@import` files were tried and abandoned in Task 2.5. If the bundle grows enough that this approach is messy, a follow-up can wire the full postcss pipeline.

**Alternatives considered:**
- Ship raw Tailwind sources: rejected — pushes setup burden onto every consumer.
- CSS-in-JS (Emotion / styled-components): rejected — adds a runtime dep, breaks SSR-without-hydration story.
- Per-block CSS files imported lazily: rejected — adds round-trips and Vite/bundler complications. The package is small; one bundle is fine.

**How to apply:**
- Add Tailwind classes inside `src/primitives/` and `src/blocks/<name>/component.tsx` freely.
- For animations / keyframes / anything Tailwind can't express, add to the labelled section in `src/styles.css`.
- The renderer's SSR layer inlines `dist/styles.css` into the `<style>` tag (`render-page.tsx`, see PACKAGE_BLOCK_CSS). No `<link>` to a bundle file; no client hydration needed for styles.

### D-029: Brand-token shape — keys match `--theme-<kebab>`, values are CSS color expressions or `var(--…)`

**Context:** Phase 1 stored `sites.default_brand_tokens` as freeform `Record<string, unknown>` JSONB. The renderer emits each `key: value` pair inside `:root { … }` in the SSR'd `<style>` tag. Without a schema, a malformed or hostile value (`javascript:alert(1)`, multi-line CSS, an injection that escapes the declaration) could ride through into every rendered page. Phase 3 adds `pages.brand_tokens_override` (P3-T3.4) — same risk, doubled surface.

**Decision:** `src/blocks/brand-tokens.ts` defines `brandTokensSchema` (Zod). Keys MUST match `^--theme-[a-z0-9]+(-[a-z0-9]+)*$`. Values MUST be one of:
- 3/4/6/8-digit hex (`#fff`, `#ffff`, `#ffffff`, `#ffffffaa`)
- `rgb(…)`, `rgba(…)`, `hsl(…)`, `hsla(…)`
- `var(--…)` references (optionally with a fallback comma)
- A small allow-list of named colors and CSS-wide keywords (`transparent`, `currentcolor`, `white`, etc.)

Anything else (raw URL, JS expression, multi-line value, unbalanced parens) is rejected at the validation point.

**Companion helper:** `mergeBrandTokens(siteDefault, pageOverride)` does a per-key merge (page wins). The merge does NOT re-validate — both inputs are expected to have been validated at their save points. Non-string values (defense in depth) are skipped.

**Rationale:**
- **Bounded attack surface:** every brand token reaches the SSR'd `<style>` tag inside `:root { … }`. The schema closes the "anything goes" hole that would let a hostile JSON payload escape the declaration.
- **Forward-compat:** the `--theme-<kebab>` key convention matches what the `@anchorcorps/components` Tailwind config already expects (`bg-theme-main`, `text-theme-on-surface`, etc.). The schema *enforces* the convention so admins can't introduce a `--brand-foo` token that the package's classes won't pick up.
- **No full CSS parser:** the value regexes are deliberately lenient — they sanity-check shape, not semantics. A `rgb(999, -1, ∞)` slips through. That's acceptable because the browser silently ignores invalid color values; an admin's brand fix is one save away.

**Alternatives considered:**
- A full CSS-color parser (e.g. `csstree`): rejected — adds a runtime dep for a sanity filter that doesn't need to be exhaustive.
- Allow any `string`: rejected — leaves the SSR `<style>` injection surface open.
- Restrict to hex only: rejected — would block `var(--…)` chaining, which is genuinely useful for derived tokens.

**How to apply:**
- Anywhere brand tokens enter the system (P3-T3.4 admin save for `pages.brand_tokens_override`, the future Phase 4 admin-UI site-row editor, `db/seed.ts` for the seeded sites), validate via `brandTokensSchema.parse(...)` or `safeParse(...)` before commit.
- At render time (P3-T3.5), the renderer merges site default + page override via `mergeBrandTokens(...)` and serializes the result into the `<style>` tag. No re-validation at render time — the data was validated when written.

### D-030: pg-boss boot pattern — Express-process worker by default, `JOBS_ENABLED=false` opt-out

**Context:** Phase 3 is the first phase that needs background work (variant generation, future DNS polling, future CRM sync retries). D-019 picked pg-boss as the queue. Two boot models were on the table:
- **Same process:** Express + pg-boss worker share the Node process. One image, one Cloud Run service.
- **Separate process:** Express service + dedicated worker service. Two Cloud Run services off the same image (different `CMD` / env).

**Decision:** Same-process worker is the **v0.1 default**. `src/server/index.ts` calls `bootJobs(pool)` after the HTTP listener starts. `JOBS_ENABLED=false` (env) returns a no-op handle so tests, one-off scripts, and any future fan-out scenario can skip the worker. The boot path coalesces concurrent calls via a module-level `bootPromise` so two parallel boots never produce two pg-boss instances.

**Rationale:**
- **Cheapest correct answer for v0.1.** One image, one service, one auto-scaling profile, one observability surface.
- **No new infrastructure.** pg-boss creates its own `pgboss.*` schema in the existing Postgres at boot. No Redis, no Cloud Tasks IAM dance.
- **Easy escape hatch.** A future workload that needs isolated worker scaling can run the same image with `JOBS_ENABLED=true` and request scaling tuned for the worker pool, while the renderer service runs with `JOBS_ENABLED=false` to skip the local worker.

**Alternatives considered:**
- Always-separate worker: rejected — premature for the load profile (a few dozen image uploads/day for the foreseeable future). Re-evaluate if a job class needs >1m of CPU per task.
- Auto-discover handlers from the filesystem: rejected — explicit `registerHandlers(boss)` keeps the worker boot path one greppable list. Adding a job is one import + one line.

**How to apply:** New jobs add their handler module under `src/server/jobs/<name>.ts`, import + register inside `registerHandlers`. Tests use `bootJobs(pool, { extraHandlers })` + `__resetJobsForTests()` for isolation.

### D-031: Media URL shape — content-hash-suffixed immutable variants; v0.1 serves from `storage.googleapis.com` (Cloud CDN deferred)

**Context:** The Image block needs a stable, cacheable URL for each variant. The variant job (3.10) re-runs are possible (retries, re-processing), so the URL must be deterministic across runs of identical input while still invalidating freely when content changes. Cloud CDN under `media.anchorcorps.com` is the eventual home; Phase 3 doesn't ship it.

**Decision:** Variant URLs follow:

```
https://storage.googleapis.com/anchorcorps-media/variants/<site_id>/<asset_id>-<variant>.<hash>.<ext>
```

- `<variant>` ∈ `thumbnail | sm | md | lg | 2x` (200w / 480w / 768w / 1280w / 2560w).
- `<hash>` is the first 10 hex chars of `sha256(variant_bytes)`. Different bytes → different URL → free cache invalidation. Same bytes (e.g. re-running the variant job on the same source) → same URL → idempotent overwrite.
- `<ext>` ∈ `webp | jpg`. Each variant ships in BOTH formats so the `<picture>` block can pick.
- Cache-Control on every variant: `public, max-age=31536000, immutable`. The URL changes whenever content does, so this is safe.
- Originals are PRIVATE under `originals/<site_id>/<asset_id>.<ext>` — only signed URLs can read or write them.

**Cloud CDN behind `media.anchorcorps.com` is deferred** to a Phase 12 hardening task. The Image block calls a helper `variantPublicUrl(...)` so the eventual switch is a one-function change.

**Rationale:**
- **Content-hashed URLs are the standard immutable-asset pattern.** No invalidation API needed; the URL itself encodes the version.
- **Per-site prefix isolation.** Cross-tenant collision is impossible by UUID construction.
- **No upscaling.** The variant job caps each variant's target width at the source width. Smaller images don't get fake-large variants; the `<picture>` srcset just lists fewer entries.

**Alternatives considered:**
- Version-in-DB instead of content hash: rejected — adds a write path on every re-process + opens up cache-bust races.
- `?v=...` query string instead of path-embedded hash: rejected — some CDNs ignore query strings for cache key by default.
- One format per variant: rejected — WebP/AVIF support varies enough that JPG fallback matters for older browsers (D-005 wants the renderer to "just work" without runtime detection logic).

**How to apply:** Job writes to `variants/<site_id>/<asset_id>-<variant>.<hash>.<ext>` with the immutable cache header. The Image block (3.12) iterates `media_assets.variants` and assembles a `<picture>` with WebP `<source>` (srcset across the five widths) + JPG `<img>` fallback. The Phase 12 CDN switch only touches `variantPublicUrl(...)`.

### D-032: Admin control hub at `studio.anchorcorps.com` — top-level sibling, not under the tenant wildcard

**Context:** Phase 4 builds the admin UI — a single control hub for managing all tenant sites. It needs a URL. Two models were considered: (a) path-based on any tenant host (`<tenant>.sites.anchorcorps.com/admin`), (b) a dedicated host. The operator and assistant worked through it in chat on 2026-05-19.

**Decision:** The admin hub lives at **`studio.anchorcorps.com`** — a TOP-LEVEL subdomain of the registrable apex, a sibling to the `*.sites.anchorcorps.com` tenant wildcard, deliberately NOT under `sites.`.

Three clean layers result:
| Layer | Host | Purpose |
|---|---|---|
| Marketing | `anchorcorps.com` | The apex AnchorCorps site |
| Control hub | `studio.anchorcorps.com` | Admin — manage/edit all sites |
| Tenant sites | `*.sites.anchorcorps.com` | Demo/preview sites pre-real-domain (D-025) |

**Rationale:**
- **Cookie / auth boundary (decisive).** `studio.anchorcorps.com` is NOT a DNS parent of any tenant host. Browsers send a parent domain's cookies down to subdomains, so an admin host *under* `sites.` (or the bare `sites.anchorcorps.com`) would make admin session cookies (Phase 8 / Better-auth) reachable by every `*.sites.anchorcorps.com` tenant by default. A top-level sibling can only leak via a deliberately `.anchorcorps.com`-scoped cookie — the safe behavior is the default behavior.
- **Resolver isolation.** The tenant regex only matches `<label>.sites.anchorcorps.com`; `studio.anchorcorps.com` never collides. (A tenant literally named "studio" would be `studio.sites.anchorcorps.com` — distinct.)
- **Product clarity.** "studio" frames the creative-editor surface and pairs with the Phase 5 Puck visual editor. Mixing admin into a tenant host's `/admin` path conflates two product surfaces + exposes `/admin` to tenant-site crawlers.
- **No extra infra cost.** A `*.sites.anchorcorps.com` wildcard cert wouldn't cover the bare `sites.anchorcorps.com` anyway, so co-locating saves nothing. One Cloud Run domain mapping + one Kinsta CNAME — the same machinery the tenant provisioning orchestrator already uses.

**Alternatives considered:**
- Path-based `/admin` on tenant hosts: rejected — cookie scoping per host breaks multi-site editing under real auth; conflated surfaces.
- Bare `sites.anchorcorps.com`: rejected — it's the DNS parent of every tenant, so cookies leak by default unless every cookie is carefully host-only forever.
- `app.` / `admin.`: viable; `studio.` chosen for the editor framing.

**How to apply:**
- Served by the same single Express + Vite process. `src/config/admin-host.ts` `isAdminHost(hostname)` recognizes `studio.anchorcorps.com`, `studio.localhost` (local dev), and a `STUDIO_HOST` env override. The page router short-circuits the admin host before tenant resolution and serves the SPA.
- Infra (provisioned 2026-05-19): Cloud Run domain mapping `studio.anchorcorps.com` → `anchor-sites` service; Kinsta CNAME `studio.anchorcorps.com` → `ghs.googlehosted.com.`. Cert provisioning began once DNS resolved.
- Local dev: add `127.0.0.1 studio.localhost` to `/etc/hosts` (or rely on the OS resolving `*.localhost`), then visit `http://studio.localhost:3000`.
- Phase 8 (Better-auth) sets host-only session cookies on this host. Phase 10/12 may add a managed cert / CDN refinement but the host name is stable.

### D-033: Second production deploy — Phases 2-4 shipped together (2026-05-20)

**Context:** Operator reported `studio.anchorcorps.com` serving the old marketing SPA instead of the admin hub. Investigation: the live `anchor-sites` Cloud Run service was running the **Phase 1 image** (`anchor-sites:7f34311`) — everything from Phase 2 onward existed in git but had never been deployed. Root cause: **no Cloud Build trigger exists for `joelhmartin/anchor-sites`** (only `ai-endpoint` + `Anchor-Client-Dashboard` are wired), so Phase 1's manual deploy never got a successor.

**Decision:** With operator approval (chat, 2026-05-20), deployed current `main` (`24a2ed3`, Phases 2+3+4.1–4.10) to production. Steps: built + pushed `anchor-sites:24a2ed3`; updated the `anchor-sites-migrate` job to the new image and ran it (applied `pages.brand_tokens_override` + `media_assets` migrations to `anchor_sites_prod`); deployed via `gcloud run services update --image` (preserving env/secrets/Cloud SQL config). Verified `/` → 200 admin SPA bundle, `/api/sites` → 401 auth gate, admin strings in the shipped JS. Hard rule #9 satisfied — approval recorded here.

**Findings for future deploys:**
- **`cloudbuild.yaml` migrate bug fixed:** added a `migrate-image` step that points the `anchor-sites-migrate` job at `${_IMAGE}` before executing it. Without this, trigger-driven deploys ran stale migration files baked into the job's prior image.
- **CI trigger still missing.** `gcloud builds triggers create github --repo-owner=joelhmartin --repo-name=anchor-sites …` fails `INVALID_ARGUMENT` — the repo isn't connected to the Cloud Build GitHub App. **Operator action:** Console → Cloud Build → Triggers → Connect Repository (`joelhmartin/anchor-sites`), then create a `^main$` trigger pointed at `cloudbuild.yaml`. Until then deploys stay manual.
- **Pre-existing tenant-cert failure (NOT this deploy), RESOLVED 2026-05-20:** `muldoon-dental.sites.anchorcorps.com` + `demo-site.sites.anchorcorps.com` mappings were `PermissionDenied` (`2026-05-19T14:47:20Z`, ~14h pre-deploy): "Caller is not authorized to administer the domain … verify ownership." Root cause: the mappings were created before `anchorcorps.com` domain ownership got verified. With operator approval, deleted + recreated both mappings against `anchor-sites`; they accepted cleanly (no PermissionDenied) and moved to `CertificatePending` — confirming verification is now valid. DNS CNAMEs were untouched (already → `ghs.googlehosted.com.`). Managed certs issue async (minutes–~1h), after which the tenant sites serve over HTTPS again.
- **`/healthz` returns a GFE 404** externally while `/` + `/api/*` work. Cosmetic — Cloud Run uses a TCP startup probe, not `/healthz`. Pre-existing; revisit Phase 12.

### D-034: Control-hub auth = Google OAuth via Better-auth in Phase 8; X-Admin-Token is interim

**Context:** Phase 4 shipped the studio control hub with a single shared `X-Admin-Token` (pasted at `/login`) as interim auth, with the plan to "replace with Better-auth in Phase 8." The operator pushed back on the token UX ("don't like this token thing one bit") and specified the target model: **Google OAuth, gated to the internal team, no per-person password setup. Locally, no auth.** Confirmed: this is the *control-hub* (studio) auth — separate from each provisioned site's own admin login, which remains the Phase 8 per-site copy-in (D-008/D-020).

**Decision:** The studio control hub authenticates via **Google OAuth, implemented with Better-auth's Google provider** (D-020's chosen library — prebuilt OAuth + sessions + hashing, no hand-rolled crypto), built as part of **Phase 8** (not pulled forward / not hand-built now). Specifics for Phase 8:
- **App-level OAuth, scoped to the studio host only** — NOT Google IAP, because the `anchor-sites` service also serves public tenant sites and IAP would gate the whole service. The studio host (`isAdminHost`) gets the auth gate; tenant hosts stay public.
- **Team-gated**: restrict to the team. Operator deferred the exact mechanism to "your normal Phase 8 plan" — default to Workspace-domain (`hd` == `anchorcorps.com`) gating with an optional `ADMIN_ALLOWED_EMAILS` allowlist for non-Workspace teammates. Finalize in the Phase 8 expansion.
- **Local = no auth**: on `studio.localhost` / non-prod, the guard auto-grants a dev session (no Google round-trip).
- **Session cookie** is httpOnly + host-only on `studio.anchorcorps.com` (the D-032 boundary already keeps it off tenant hosts).
- **`requireAdmin` flips** from token-check to session-check; all `/api` admin endpoints inherit it. The `X-Admin-Token` is retired once OAuth lands (or kept only as a documented CI/service path if a concrete need appears).

**Operator prerequisite for Phase 8:** create a Google OAuth Client ID (Console → APIs & Services → Credentials → Web application; redirect URI `https://studio.anchorcorps.com/auth/google/callback`; consent screen Internal). Client ID + secret go into Secret Manager. Cannot be created via CLI.

**Interim (now, until Phase 8):** the `X-Admin-Token` stays. Operator logs into prod studio by pasting the value of the `ANCHOR_SITES_ADMIN_API_TOKEN` secret; local uses whatever `ADMIN_API_TOKEN` is set when running `npm run dev`.

**Rationale:** Better-auth already chosen (D-020) + ships Google OAuth, so one library covers hub + per-site auth. Prebuilt over hand-rolled per operator instruction. App-level (not IAP) is forced by the shared public/admin service. Building it in Phase 8 (vs now) keeps the auth surface coherent rather than bolting on a throwaway mid-Phase-4.

### D-035: Third production deploy — Phase 4 complete (4.11-4.16) shipped to prod (2026-05-20)

**Context:** Phase 4 finished on `main` (HEAD `c0b0c83`) but prod was still serving `anchor-sites:24a2ed3` (Phases 2–4.10) — the same deploy gap D-033 described, because the CI trigger is still missing. Operator approved closing the gap in chat (2026-05-20): "keep moving … you should be able to do it all with your direct connection to gcloud." This records that approval per hard rule #9.

**CI trigger — diagnosed precisely (correcting D-033's hand-wave).** D-033 claimed the repo "isn't connected to the Cloud Build GitHub App" based solely on `gcloud builds triggers create github …` returning `INVALID_ARGUMENT`. **That was a bad diagnostic:** a 2026-05-20 control test showed that exact command fails with the *same* `INVALID_ARGUMENT` even for `ai-endpoint`, which is connected and has a working trigger — so the convenience command is simply broken in this SDK/project and proves nothing. The authoritative test is **importing the trigger proto**:
```
gcloud builds triggers import --source=cloudbuild-trigger.yaml --region=global
→ FAILED_PRECONDITION: Repository mapping does not exist. Please visit
  https://console.cloud.google.com/cloud-build/triggers;region=global/connect?project=333281424614
```
So the precise state: the Cloud Build GitHub App **is** installed/configured on GitHub (it works for `ai-endpoint` + `Anchor-Client-Dashboard`), but **this GCP project (333281424614) has no repository mapping for `joelhmartin/anchor-sites`** — that specific repo was never run through Cloud Build's "Connect repository" flow. `gcloud builds connections list` is 0 in every region too (no 2nd-gen connection either).
**One-time operator action (interactive GitHub OAuth — not CLI-doable):** open the connect URL above → GitHub (Cloud Build GitHub App) → select `joelhmartin/anchor-sites` → Connect. **Then the assistant runs** `gcloud builds triggers import --source=cloudbuild-trigger.yaml --region=global` (proto committed to the repo; uses our `cloudbuild.yaml` so migrations run). Also fixed `cloudbuild.yaml`'s build step — it had `--cache-from=${_IMAGE%:*}:cache`, a bash expansion Cloud Build doesn't support, which would have broken the first trigger build; dropped it (the working `ai-endpoint` trigger builds `--no-cache` anyway).

**RESOLVED 2026-05-20:** operator connected the repo via the Console; the import then succeeded, creating trigger `anchor-sites-main` (id `6db12fd3-8701-4333-90f1-ec135fda8a1e`). Pushes to `main` now auto build→migrate→deploy — **deploys are no longer manual.** The CI gap that D-033 first flagged is closed.

**Pipeline validated end-to-end 2026-05-20.** The first trigger build failed validation — `cloudbuild.yaml` defined `_IMAGE: …:$SHORT_SHA` and Cloud Build does NOT recursively expand built-ins ($PROJECT_ID/$SHORT_SHA) nested inside a user-substitution's value, so the image name shipped literal `$SHORT_SHA`. (The manual `gcloud builds submit --tag=<resolved>` had masked this — it never used `_IMAGE`.) Fixed by inlining the full image ref at every use site and deleting `_IMAGE` (commit `2b81ded`). The next build (`fa49df32`) went green on all five steps and deployed `…:2b81ded` as revision `anchor-sites-00008-wj2` — confirming push→build→migrate→deploy works. **Operational note:** every push to `main` now deploys prod, so keep `main` releasable.

**Decision / what was deployed:** built `anchor-sites:c0b0c83` via `gcloud builds submit --tag=…` (remote Cloud Build, no local Docker, and deliberately NOT the repo `cloudbuild.yaml` whose `--cache-from=${_IMAGE%:*}:cache` uses a bash-style expansion Cloud Build substitution doesn't support — a latent bug since that pipeline has never actually run end-to-end without a trigger). Then `gcloud run services update anchor-sites --image=…:c0b0c83 --region=us-central1`, which preserves env/secrets/Cloud SQL config (same approach as D-033).

**No migrations:** `git diff 24a2ed3..HEAD -- db/` is empty — 4.11–4.16 were UI + docs only. The migrate job was NOT run (nothing pending); deploy was a pure application-image swap. Rollback path: redeploy `…:24a2ed3`.

**Verification (2026-05-20, post-deploy):** service image now `…/anchor-sites:c0b0c83` (digest `sha256:a18c94c0…`), revision `anchor-sites-00007-7pm` serving 100%. `https://studio.anchorcorps.com/` → 200; `…/api/sites` → 401 (auth gate intact). Shipped JS bundle (`/assets/index-JH5o-DYO.js`) contains all five 4.11–4.16 strings — "Reset to defaults", "View live site", "Brand colors", "Upload image", "Save changes" — confirming the new wizard/tabs/settings code is live, not just a redeploy.

<!-- Routine appends future decisions below this line -->

### D-036: Puck pinned at `0.20.2`; editor barrel is the sole Puck boundary; `Block[]`↔`Data` contract (P5-T5.1; contract frozen in 5.2)

**Context:** Phase 5 (D-017) builds the visual editor on Puck. The PHASE-05 note requires pinning a specific `@measured/puck` version and recording the data-shape conversion contract. This entry records the pin + boundary now (5.1); the exact `toPuckData`/`fromPuckData` mapping is appended/frozen when 5.2 lands.

**Decision — version + compatibility:**
- Pin **`@measured/puck` exactly `0.20.2`** (no caret, via `--save-exact`) — current stable. Bump deliberately and re-verify the round-trip invariant on any change.
- React peer is `^18 || ^19`; repo runs React `18.3.1` — compatible.
- A version-drift smoke test asserts the exported `PUCK_VERSION` constant equals the installed `@measured/puck/package.json` version, so the documented pin can't silently diverge.

**Decision — boundary (enforces D-017):**
- `src/editor/index.ts` is the **only** module that imports `@measured/puck`. Everything under `src/editor/` imports Puck values/types from this barrel; nothing outside `src/editor/` imports Puck at all. Puck stays a swappable *view*; canonical `Block[]` (D-001) remains the source of truth and the prod renderer never touches Puck.
- Build wiring needed **no** changes: the Tailwind content glob (`./src/**/*.{js,jsx,ts,tsx}`) and tsconfig `include` (`src/**/*`) already cover `src/editor/**`, and Vite bundles it on import. Puck's stylesheet (`@measured/puck/puck.css`) is imported at the editor route (5.5), not globally.

**Decision — jsdom test harness:** Puck's drag layer (`@dnd-kit`) references `ResizeObserver` at module-load time, which jsdom v29 lacks. `src/editor/__tests__/puck-jsdom.ts` installs a `ResizeObserver` stub and must be imported before the Puck barrel in any editor jsdom test. Extend this shim (e.g. `matchMedia`, `IntersectionObserver`) as later tasks render `<Puck>`. UI still can't be browser-verified on the operator's machine — adapter/field/route logic is unit-tested in jsdom; visual QA is operator-run at `studio.localhost:3000`.

**Conversion contract (placeholder — FROZEN IN 5.2):** `toPuckData(blocks: Block[]): Data` / `fromPuckData(data: Data): Block[]` will live in `src/editor/puck-adapter.ts` and preserve block `id`/`type`/`props`/nested `children`, with `fromPuckData(toPuckData(x))` deep-equal to `x` as a tested invariant. The exact field-by-field mapping (esp. how `children`/zones and block `id`s round-trip, and unknown-type passthrough) is recorded here once 5.2 lands.

**Rationale:** Exact pin keeps the conversion contract reproducible. A single-barrel boundary makes "nothing outside `src/editor/` imports Puck" mechanically checkable and keeps Puck swappable. No build-config churn because the existing globs already cover the new directory.
