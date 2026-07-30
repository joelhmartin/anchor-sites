# Lovable-Style Workspace — Design Spec

**Date:** 2026-07-30
**Status:** Committed (operator directive: match Lovable, remove the legacy visual builder)
**Supersedes the product shell** shipped by the ai-site-agent / inline-editing sub-projects.
Their plumbing (agent loop, block registry, preview iframe + inline editing, publish,
GitHub sync) is retained and reused.

## Why

The operator's brief: "rip off Lovable, but for websites." What shipped instead was an
agent chat **drawer** bolted onto the legacy Studio, with the Puck visual builder still
present, one bare `starter` template, and a chat path that dies at 15 tool calls /
45 seconds mid-build. This spec defines the actual product:

1. **Builds must finish.** A site build must never stop because of an arbitrary
   per-turn tool cap or a 45s HTTP deadline.
2. **The workspace IS the product.** Full-screen: chat left, live site preview right.
   No tabs-with-a-drawer. The Puck editor is removed.
3. **Templates carry the quality.** A gallery of polished, fully fleshed-out site
   templates (Lovable-gallery caliber) so the agent starts from strong bones instead
   of scaffolding from nothing.

## Phase A — Agent runs that finish (server)

- **All chat turns run as background jobs.** The inline path
  (`admin-ai-agent.ts` POST messages → `runAgentTurn` in-request with
  `{maxToolCalls: 15, deadlineMs: 45_000}`) is removed. POST message = persist user
  row → claim turn-lock → enqueue `AGENT_TURN` → 202. The client tails the existing
  DB-polling SSE (`GET …/events?after=`), which is already cross-instance safe
  (progress persists to `ai_messages`; the tail polls Postgres — verified).
- **Auto-continue batching.** `runAgentTurn` returns its end reason. When a turn ends
  on `tool-limit` and made progress, the job handler re-enqueues a continuation turn
  (the model sees its own "reached the limit" note in history and resumes). Max 3
  continuations per user message → effective budget ≈ 4 × `AI_AGENT_MAX_TOOL_CALLS`
  (default 30, env-tunable) with no user-visible stall. The chat shows one continuous
  run, not "please type continue."
- **Honest errors.** Anthropic auth/billing/overload errors surface as a labeled
  chat status ("Anthropic API: credit balance too low"), never generic "internal".

## Phase B — The Lovable workspace (Studio UI)

- **New full-screen workspace at `/sites/:slug`** (replaces SiteDetailPage as the
  default view):
  - **Left panel (~380px): chat.** The existing `agent-chat/*` components (ported ops
    copilot UX) move here from the drawer. Status strip shows run progress
    (tool steps, continuations, token use).
  - **Right panel: live preview.** `DraftPreview` lifted out of `SiteDetailPage.tsx`
    into its own component (verified self-contained: `siteId`, `previewPageId`,
    `previewNonce`, `agentBusy`). Keeps sandboxed iframe, inline edit toggle, image
    picker, link popover.
  - **Top bar:** site name, page switcher, desktop/mobile viewport toggle, Edit
    toggle, **Publish** button (publishes draft pages + shows live URL), GitHub link
    when sync is enabled, and a "Manage" link to the legacy tabs.
- **Legacy tabs survive at `/sites/:slug/manage`** (domains, blog, events, plugins,
  git, settings). They are management chrome, not the product.
- **New-site flow = prompt box + template gallery.** `/sites/new` becomes a
  Lovable-style screen: a large "What do you want to build?" prompt with an optional
  template pick (gallery cards: cover image, name, category, description). Create →
  land directly in the workspace with the initial build streaming. Blank/manual
  creation remains as a small secondary action.
- **Puck is removed.** Delete `src/editor/**` (the D-017 barrel means nothing outside
  it imports Puck), `EditorPage.tsx`, and the `@measured/puck` dependency. Page
  editing = chat + inline editing in the workspace.
  - Posts/events currently edit their `Block[]` body via Puck (`BlockBodyEditor`).
    Replaced with a TipTap rich-text editor writing a single `richText` block
    (matches the existing inline rich-text sanitizer allowlist). Post/event metadata
    forms are unchanged.

## Phase C — Template library

- **Target: 10 polished site templates** across the categories the business serves:
  medical/dental practice, home services, restaurant/cafe, law firm, fitness/wellness,
  creative portfolio, coaching/consulting, nonprofit, local retail, generic SMB
  landing. Each: 4-6 pages (home, about, services/menu, contact, plus category
  extras), real copy structure, curated stock imagery, coherent brand tokens.
- **Design source: port the *designs*, not the framework.** Layout/typography/spacing
  patterns are lifted from high-quality free references (MUI's free marketing
  templates, Tailwind UI free samples, HTML5UP) and implemented as **our** blocks.
  MUI as a runtime dependency is rejected: the whole platform (renderer, AI catalog,
  inline editing markers, git sync, Zod registry) is driven by one block system, and
  swapping it for MUI components would orphan all four. The block system is the moat;
  it needs more and better blocks, not replacement.
- **New/upgraded blocks to support the above** (Zod registry + renderer + editable
  markers + AI catalog, like every existing block): split hero (image left/right),
  stats band, pricing table, team grid, feature grid w/ icons, image gallery,
  testimonial wall, contact split (form + map/hours), rich footer (multi-column),
  navbar variants (center logo, CTA button), banner/announcement bar. Existing
  blocks (hero, cta, faq, testimonial, logo-reel, image) get polish variants where
  the templates need them.
- **Template metadata for the gallery:** `templates` table gains `category text`,
  `cover_image_url text`, `sort_order int`. Covers are curated stock images ingested
  through the existing media pipeline at seed time (no headless-browser screenshots).
- **Authoring format:** templates live as one TS module each under
  `db/templates/<slug>.ts` (typed `TemplateSeed`), imported by `db/seed-templates.ts`.
  Same idempotent UPSERT-by-slug seeding; `validateBlocks` gate unchanged.

## Sequencing & risk

A (fixes builds now) → B (workspace shell) → C (templates, parallelizable per
template once new blocks land). Phases are independently shippable; C templates can
land incrementally after C's block tasks. Biggest risk is B's scope creep into the
legacy tabs — held off by keeping `/manage` untouched.

## Definition of done

1. A prompt like the TMJ one builds a complete multi-page site in one visible run —
   no "continue", no 45s truncation; API/billing failures are labeled in chat.
2. Studio's default site view is chat-left / live-preview-right; publish from the
   top bar; Puck and its dependency are gone from the bundle.
3. `/sites/new` shows the prompt + a gallery of 10 templates with covers; picking one
   lands in the workspace with the build streaming.
4. Full test suite green; deploy pipeline unchanged (single Cloud Run service).
