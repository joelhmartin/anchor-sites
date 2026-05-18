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

---

<!-- Routine appends future decisions below this line -->
