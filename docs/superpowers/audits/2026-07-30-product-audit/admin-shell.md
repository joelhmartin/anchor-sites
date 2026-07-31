# Admin SPA Shell + Entry Surfaces — Big-Picture Audit Slice

Date: 2026-07-30 · Branch audited: `feat/lovable-workspace` (== `main`, 0 commits ahead; merged at `a0a15ae`) · Prod: https://studio.anchorcorps.com

**Prod-parity verification:** the deployed bundle `/assets/index-CVAPU08D.js` contains the current
NewSitePage strings ("What do you want to build", "Start from a template", "Creating pages…",
"Build with AI"), so prod is running exactly the code audited here. Findings below are prod findings,
not branch-only findings.

Census sources (all absolute under `/Volumes/G-DRIVE SSD/DEVELOPER/anchor-sites/`):
`src/admin/AdminApp.tsx`, `src/admin/AdminLayout.tsx`, `src/admin/auth/LoginPage.tsx`,
`src/admin/auth/RequireAdmin.tsx`, `src/admin/auth/useStudioSession.ts`,
`src/admin/pages/SitesListPage.tsx`, `src/admin/pages/NewSitePage.tsx`, `src/admin/pages/NotFound.tsx`,
`src/admin/ui/{badge,button,card,cn,dialog,input,label,spinner,table,index}`,
supporting: `src/admin/lib/{useApi,apiFetch,session,adminToken}.ts`,
`src/admin/components/{ErrorBoundary,StudioWordmark}.tsx`,
server side of the entry flows: `src/server/routes/templates.ts`, `src/server/sites/create-site.ts`,
`src/server/templates/repo.ts`.

---

## PRIORITY DEEP-DIVE — NewSitePage template gallery

### Verdict: **(b) hidden/uncommunicated second step.** The template-only create path is NOT broken in code, and it does NOT require the prompt. It requires a second click on a small "Create site" pill that lives ~600–900 px above the gallery, and after selecting a card the UI communicates *nothing* about that next step.

### Full event-path trace (all in `src/admin/pages/NewSitePage.tsx`)

1. **Card onClick** → `pickTemplate(t)` (line 343 → 238–241): sets `selectedTemplateId`,
   clears `blankSelected`. **That is the entire effect.** No navigation, no create, no scroll,
   no focus move, no announcement. Visible feedback = border/ring change only
   (line 346: `border-zinc-900 ring-1 ring-zinc-900`).
2. **State → enablement**: with a template selected and no prompt,
   `autoName = selectedTemplate.name` (line 123) → `effectiveName` non-empty →
   `autoSlug = slugify(name)` (125) → `slugValid` (128) → `formValid` (129) → `canSubmit` (130)
   becomes **true**. So the prompt is *not* required — hypothesis (c) is false.
   `formValid` needs only name + slug, both auto-derived from the template name.
3. **Submit button** (line 281): `<Button variant="dark" … onClick={handleSubmit} disabled={!canSubmit}>`,
   label `"Create site"` (line 138, since `hasPrompt` false). This button sits inside the hero
   prompt card (line 260–291), which is separated from the gallery by the page's `gap-16` +
   `py-16` column (line 249) plus the 4-row textarea — on a laptop viewport, scrolling down to
   see/click a template card puts the button off-screen.
4. **handleSubmit** (182–236): `selectedTemplateId` branch → `POST /api/sites/from-template`
   (189–192) with `{slug, display_name, template_id}` → server `templates.ts:382–466` creates
   site + canonical domain, enqueues provision + materialization (deduped via
   `singletonKey: siteId:templateId`, templates.ts:112–121) → client sets `materializing`,
   polls `waitForPages(siteId)` (151–163, 700 ms interval, 8 s cap) → `navigate(/sites/${slug})`
   (line 206) to the workspace.
5. **Proof the path works**: `src/admin/pages/NewSitePage.test.tsx:167–188`
   ("template-only: selecting a template card (no prompt) creates from-template, polls for pages,
   and navigates to the workspace") — click card, find enabled `"Create site"` button, click,
   asserts the POST body and the navigation. Passing in CI.

### Why the operator saw "nothing starts a site"

- Before any selection or prompt, the button is **disabled** (opacity-50) with **no stated reason**.
- After clicking a card, the *only* change anywhere on the page is the card border. The button
  (a) is likely scrolled out of view, (b) keeps the same generic label `"Create site"` — it never
  echoes the selection ("Create from Starter"), and (c) at 50 %→100 % opacity across a scroll
  boundary, its enablement transition is invisible.
- Nothing on or near the card offers an action: no per-card "Use template" CTA, no sticky action
  bar, no auto-scroll to the submit, no toast/hint "Starter selected — press Create site".
- The Lovable pattern the page imitates (click template → detail/preview → explicit "Use template")
  has been compressed to "click template → silently arm a distant button".

Worse sibling of the same defect: the **"Start blank" card** (362–377). Selecting it with an empty
prompt leaves `effectiveName === ""` → `canSubmit === false` **forever**; the operator must
independently discover the collapsed "Details" toggle (271–280) and type a display name.
Blank + no prompt is a hard dead end with zero communication. And `blankSelected` is **never read
by `handleSubmit`** (188 branches only on `selectedTemplateId`) — blank + prompt behaves
identically to nothing-selected + prompt, so the highlighted "Start blank" selection is decorative.

### Review-before-choose: what exists vs. what's missing

**Data that already exists (server, all admin-gated):**

| Data | Where | Used by gallery? |
|---|---|---|
| `name, description, category, cover_image_url, sort_order` | `GET /api/templates` (templates.ts:474–491; repo `listTemplates`) | partially (sort_order honored server-side; category as chip) |
| `pages_count` | same list row (`repo.ts:37`, `COUNT(tp.id)` repo.ts:171); **declared in the client type** (NewSitePage.tsx:45) | **fetched, typed, never rendered** |
| Full ordered pages — `slug, title, blocks, seo` per page | `GET /api/templates/:id` (templates.ts:496–511) | **no client consumer at all** (`grep templates/:id src/admin` → 0 hits) |
| `source_site_id` (the live site the template was captured from) | template row (templates.ts:193) | never surfaced — a real site whose rendered pages could serve as the preview |
| Block renderer capable of rendering template blocks | public page renderer (`src/server/routes/page.ts`); dev-only harness `POST /__blocks/preview` (blocks-preview.tsx:78–82) | no template-preview route exists; preview tokens are site-scoped, not template-scoped |
| Cover images | media bucket (403-for-everyone until today, now public) | rendered raw `<img>`, **no onError fallback** (NewSitePage.tsx:81–89) |

**Affordances that do not exist (the whole review-before-choose flow):**

1. No detail view: the card's only handler is *select* — there is no way to open, inspect, or
   preview a template. The `Dialog` primitive sits unused in `src/admin/ui/dialog.tsx`.
2. No page manifest on the card: not even the already-fetched `pages_count`
   ("5 pages: Home, About, Services…" is one extra render away via `/api/templates/:id`).
3. No rendered preview: no route renders a template's blocks (the public renderer renders *sites*;
   `/__blocks/preview` is dev-only and POST-driven). A template-preview endpoint
   (`GET /api/templates/:id/preview` rendering page 1's blocks, or an iframe on the
   `source_site_id`'s canonical host) would close this with existing primitives.
4. No cover enlargement / screenshot set — one `h-40` crop per template, `alt=""`.
5. No category grouping or filter despite `category` + `sort_order` existing precisely for
   gallery organization.
6. No "what you'll get" contract: brand tokens travel with the template (D-042) but the card
   never says fonts/colors come with it.

**Cover-outage interaction:** during the 403 window, `cover_image_url` was truthy so the code chose
the `<img>` branch (81–89) and rendered the browser's broken-image glyph — the gradient-initials
fallback (90–100) only triggers on *null* URL, not on *failed* URL. So the outage produced a
gallery of broken images AND the selection→hidden-button defect on top. Fixing covers alone does
not fix the gallery; D200/D201/D202 stand regardless.

---

## LEDGER

56 units × 20 lenses = 1120 cells. Legend: `✓` pass · `–` n/a · `D2xx` directive. Blank cells: none.

Lens key: Term=Terminality, Grain=Structure/Grain, Org=Organization, Prov=Provenance→Consumption,
Comp=Comprehension, StVis=State-Visibility, Hon=Honesty, Rev=Reversibility/Safety,
Idem=Idempotence/Accretion, Fail=Failure/Recovery, Pre=Precondition/Forward-path,
Pop=Population/Dark, Sib=Sibling-Coherence, Gate=Gating-Axis, Temp=Temporal-Integrity,
Cost=Cost/Value, Contr=Contract-Stability, Name=Naming/Least-astonishment,
A11y=Accessibility, VisH=Visual-hierarchy.

| # | Unit (file:line) | Term | Grain | Org | Prov | Comp | StVis | Hon | Rev | Idem | Fail | Pre | Pop | Sib | Gate | Temp | Cost | Contr | Name | A11y | VisH |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| U1 | Route split: public /login vs guarded rest (AdminApp.tsx:35–36) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – | – | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | – |
| U2 | Route /sites/:slug full-bleed sibling of layout (AdminApp.tsx:46) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – | – | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | – |
| U3 | Route / → SitesListPage (AdminApp.tsx:48) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – | – | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | – |
| U4 | Route /sites/new → NewSitePage (AdminApp.tsx:49) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – | – | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | – |
| U5 | Route /sites/:slug/manage (AdminApp.tsx:50) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – | – | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | – |
| U6 | PageEditRedirect legacy → ?page= (AdminApp.tsx:21–24,51) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | – |
| U7 | Post/Event editor routes (AdminApp.tsx:52–53; wiring only) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – | – | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | – |
| U8 | Catch-all * → NotFound inside layout (AdminApp.tsx:54) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – | ✓ | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | – |
| U9 | ErrorBoundary fallback + "Try again" (ErrorBoundary.tsx:26–41) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | D217 | ✓ | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U10 | Sidebar + StudioWordmark link (AdminLayout.tsx:28–31) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – | – | ✓ | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U11 | NavLink "Sites" + active state (AdminLayout.tsx:33–44) | ✓ | ✓ | D221 | ✓ | ✓ | ✓ | ✓ | – | – | – | ✓ | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U12 | Sign out button (AdminLayout.tsx:47–53; session.ts:40–45) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U13 | Content outlet max-w-5xl (AdminLayout.tsx:56–60) | ✓ | ✓ | ✓ | – | ✓ | – | – | – | – | – | – | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U14 | RequireAdmin loading spinner (RequireAdmin.tsx:15–21) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| U15 | Unauthed redirect + `from` state (RequireAdmin.tsx:22–24) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | – | ✓ | D214 | ✓ | – | – |
| U16 | Login card + heading (LoginPage.tsx:63–68) | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | – | – | – | – | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U17 | Google sign-in button + busy (LoginPage.tsx:29–39,71–73) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| U18 | "Use an admin token instead" reveal (LoginPage.tsx:94–100) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | D216 | ✓ | – | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U19 | Token label + password input (LoginPage.tsx:78–88) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U20 | "Use token" submit + verify-then-persist (LoginPage.tsx:41–60,89–91) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| U21 | Login error line (LoginPage.tsx:103) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | – | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U22 | ?mode=token deep link (LoginPage.tsx:22–24) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | – |
| U23 | Sites header + "+ New site" (SitesListPage.tsx:31–34) | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | – | ✓ | – | ✓ | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U24 | Sites loading state (SitesListPage.tsx:36–40) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – | – | – | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| U25 | Sites error card (SitesListPage.tsx:42–46) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | – | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U26 | Sites empty state + CTA (SitesListPage.tsx:48–55) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – | ✓ | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U27 | Table columns Name/Slug/Status/Pages/Created (SitesListPage.tsx:60–69) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| U28 | Row click→workspace + nested name Link (SitesListPage.tsx:71–89) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | – | – | ✓ | ✓ | ✓ | D215 | ✓ |
| U29 | Status badge tones (SitesListPage.tsx:18–22,84) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – | – | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U30 | Hero heading + subcopy (NewSitePage.tsx:251–257) | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | – | – | – | – | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U31 | Prompt textarea autofocus (NewSitePage.tsx:261–268) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | – | ✓ | – | – | ✓ | ✓ | ✓ | D212 | ✓ |
| U32 | Details toggle + name·slug echo (NewSitePage.tsx:271–280) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | – | – | ✓ | ✓ | D219 | ✓ | ✓ |
| U33 | Display-name input + touched logic (NewSitePage.tsx:296–307) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U34 | Slug input + validation + host hint (NewSitePage.tsx:308–327) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U35 | Primary submit button + labels/enable (NewSitePage.tsx:130–138,281–289) | ✓ | ✓ | ✓ | ✓ | ✓ | D202 | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | D201 |
| U36 | Inline error line + 409 mapping (NewSitePage.tsx:140–146,332) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | D209 | ✓ | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U37 | Gallery heading + grid (NewSitePage.tsx:336–338) | ✓ | ✓ | D222 | ✓ | ✓ | – | ✓ | – | – | – | – | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U38 | Template card button (NewSitePage.tsx:339–360) | ✓ | ✓ | ✓ | D205 | D200 | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | – | – | ✓ | ✓ | ✓ | D211 | ✓ |
| U39 | TemplateCover img/gradient (NewSitePage.tsx:80–101) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | D206 | – | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U40 | Card category badge + description clamp (NewSitePage.tsx:353–357) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – | – | – | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U41 | "Start blank" card (NewSitePage.tsx:243–246,362–377) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | D204 | ✓ | ✓ | – | D203 | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U42 | Templates fetch wiring (NewSitePage.tsx:117–118; useApi.ts) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | – | D210 | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | – |
| U43 | handleSubmit orchestration (NewSitePage.tsx:182–236) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | D207 | ✓ | ✓ | – | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | – |
| U44 | waitForPages poll (NewSitePage.tsx:151–163) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | D208 | – | ✓ | ✓ | ✓ | – | ✓ | – | D213 | ✓ | ✓ | ✓ | – | – |
| U45 | startConversationAndNavigate + ai_error (NewSitePage.tsx:170–180) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | – |
| U46 | Compose path template+prompt (NewSitePage.tsx:196–197) | ✓ | ✓ | ✓ | ✓ | D220 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | – |
| U47 | NotFound page + back link (NotFound.tsx:3–13) | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U48 | ui/Badge (badge.tsx) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – | – | – | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U49 | ui/Button incl. dark variant, disabled, focus ring (button.tsx) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – | – | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U50 | ui/Card family (card.tsx) | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | – | – | – | – | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U51 | ui/Dialog family (dialog.tsx) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – | – | ✓ | – | – | ✓ | ✓ | ✓ | D218 | ✓ |
| U52 | ui/Input (input.tsx) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – | – | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U53 | ui/Label (label.tsx) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – | – | – | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U54 | ui/Spinner role=status (spinner.tsx) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – | – | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U55 | ui/Table family + overflow wrapper (table.tsx) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – | – | – | – | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| U56 | ui/cn + index barrel (cn.ts, index.ts) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – | – | – | – | ✓ | – | – | ✓ | ✓ | ✓ | – | – |

---

## DIRECTIVES

- **[D200] (template card, U38) × Comprehension — «A selection gesture must surface its consequence and its next step at the point of interaction.»** Instance: clicking a template card only sets `selectedTemplateId` and paints a border (NewSitePage.tsx:238–241, 343–347); the create action is a small pill inside the hero card ~one viewport above (line 281), with no CTA on/near the card, no scroll, no hint — operator-verified as "nothing happens". Fix-class: per-card "Use template" button, or a sticky bottom action bar that appears on selection ("Starter selected → Create site").
- **[D201] (primary submit, U35) × Visual-hierarchy — «The page's single terminal action must be visually dominant and reachable from every place that arms it.»** Instance: the only create control is an `h-9` rounded pill sharing a row with a text-xs toggle inside the prompt card (NewSitePage.tsx:270–290); the gallery — half the page — has no action affordance and scrolls the button off-screen. Fix-class: sticky/floating primary CTA visible whenever `canSubmit`, or duplicate CTA at gallery level.
- **[D202] (primary submit, U35) × State-Visibility — «A disabled primary action must say why; an enabled one must say what it will do.»** Instance: `disabled={!canSubmit}` renders 50 %-opacity "Create site" with no reason (button.tsx disabled:opacity-50; NewSitePage.tsx:281); once a template is picked the label still reads generic "Create site", never "Create from Starter". Fix-class: dynamic label echoing the armed path + helper line ("pick a template, start blank, or describe the site" while disabled).
- **[D203] (Start blank card, U41) × Precondition/Forward-path — «Every selectable option must have a completable forward path from the state it creates.»** Instance: "Start blank" + empty prompt yields `effectiveName === ""` → `canSubmit` false forever (NewSitePage.tsx:123–130, 243–246); the required name field is hidden behind the collapsed "Details" toggle and nothing points to it. Fix-class: on `pickBlank()` with no prompt, auto-open Details and focus the name input (or inline-prompt for a name on the card).
- **[D204] (Start blank card, U41) × Honesty — «Selected state must change behavior, not just pixels.»** Instance: `blankSelected` is never read by `handleSubmit` (branch at NewSitePage.tsx:188 keys only on `selectedTemplateId`); blank+prompt is byte-identical to no-selection+prompt, so the highlighted card claims an effect it doesn't have. Fix-class: collapse choice into one source-of-truth enum (`"blank" | "template:<id>" | null`) consumed by submit, or drop the fake selected state.
- **[D205] (template card, U38) × Provenance→Consumption — «Data fetched for a decision must reach the decision-maker's eyes.»** Instance: `pages_count` is selected by the API (repo.ts:171), declared in the client type (NewSitePage.tsx:45), and never rendered; `GET /api/templates/:id` (full ordered page manifest, templates.ts:496–511) has zero client consumers; `source_site_id` (a rendered, previewable origin site) is never surfaced — so choosing a template is blind. Fix-class: card click opens a `Dialog` (already in ui/) showing pages list from `/api/templates/:id` + a "Use template" CTA; add a template-preview render route later.
- **[D206] (TemplateCover, U39) × Failure/Recovery — «An image with a designed fallback must use it on load failure, not only on absence.»** Instance: `coverImageUrl` truthy → bare `<img>` with no `onError` (NewSitePage.tsx:81–89); during the media-bucket 403 outage every card showed a broken-image glyph while a purpose-built gradient fallback sat one branch away (90–100). Fix-class: `onError` state flips the component to the gradient branch.
- **[D207] (handleSubmit, U43) × Idempotence/Accretion — «A terminal create action must be single-fire at the click layer, not only at the render layer.»** Instance: `busy` is React state; two clicks before re-render both read stale `canSubmit === true` closures (NewSitePage.tsx:130, 182–183) → two `POST /api/sites/from-template`; the loser's 409 paints "slug already in use. Pick another." over a create that is actually succeeding. Fix-class: synchronous `useRef` in-flight guard at the top of `handleSubmit`.
- **[D208] (from-template create, U43/U44) × Honesty — «When the server reports a partial failure, the client must not narrate success.»** Instance: `POST /api/sites/from-template` returns `job:{queued:false,error}` on enqueue failure (templates.ts:435–441); the client discards the `job` field (NewSitePage.tsx:189–194), polls 8 s, times out silently, and lands the operator on an empty workspace with no explanation. Fix-class: read `job.queued`; on false, surface "site created, pages failed to queue — retry" instead of navigating clean.
- **[D209] (inline error, U36) × Failure/Recovery — «An error that demands an edit must reveal and focus the field it names.»** Instance: 409 message says "Pick another" slug (NewSitePage.tsx:141–142) while the slug input is hidden behind the collapsed Details toggle (293) — the named remedy is invisible. Fix-class: `setDetailsOpen(true)` + focus slug input inside `handleConflict`.
- **[D210] (templates fetch, U42) × Population/Dark — «A collection surface must distinguish loading, error, and truly-empty.»** Instance: `const { data } = useApi(...)` discards `loading` and `error` (NewSitePage.tsx:117); a failed or slow `/api/templates` renders the gallery as just the "Start blank" card under an unexplained heading. Fix-class: skeleton cards while loading; inline error + retry (`reload()` already exists in useApi).
- **[D211] (template card, U38) × Accessibility — «Selection state must be programmatic, not purely chromatic.»** Instance: selected card differs only by `border-zinc-900 ring-1` (NewSitePage.tsx:346); no `aria-pressed`/`aria-selected`, so screen-reader and keyboard users cannot perceive which template is armed. Fix-class: `aria-pressed={selectedTemplateId === t.id}` on the card buttons (and blank card).
- **[D212] (prompt textarea, U31) × Accessibility — «The page's primary input needs an accessible name beyond its placeholder.»** Instance: hero textarea has only a placeholder (NewSitePage.tsx:261–267); placeholders vanish on input and aren't reliable accessible names. Fix-class: `aria-label="Describe the site to build"` (or visually-hidden label).
- **[D213] (waitForPages, U44) × Temporal-Integrity — «A fixed client-side wait must not stand in for job completion it cannot observe.»** Instance: 8 s cap (NewSitePage.tsx:37, 151–163) regardless of template size or queue depth; on timeout it navigates as if done and the workspace shows an unexplained partial site. Fix-class: navigate immediately and let the workspace render a "materializing pages…" state driven by `pages_count`/job status, retiring the blocking poll.
- **[D214] (RequireAdmin redirect, U15) × Contract-Stability — «Auth bounces must preserve the full attempted location, query included.»** Instance: `state={{ from: location.pathname }}` (RequireAdmin.tsx:23) drops `location.search`, so deep links like `/sites/x?page=…` (the very contract PageEditRedirect mints at AdminApp.tsx:23) and `?ai=1` lose their context across login. Fix-class: `from: location.pathname + location.search`.
- **[D215] (sites table row, U28) × Accessibility — «Row-level navigation must be keyboard-reachable and single-targeted.»** Instance: `<TR onClick>` (SitesListPage.tsx:74–75) is not focusable; only the nested name `<Link>` (78) is, creating an unreachable click surface plus nested interactive targets. Fix-class: drop TR onClick and stretch the Link across the row (or add proper role/tabindex/keydown).
- **[D216] (token-mode reveal, U18) × Reversibility/Safety — «A progressive-disclosure toggle must disclose both ways.»** Instance: "Use an admin token instead" swaps itself out permanently (LoginPage.tsx:75–101) — no way back to the Google-only view without a reload; `?mode=token` similarly sticky. Fix-class: keep a "Back to Google sign-in" link that sets `tokenMode(false)`.
- **[D217] (ErrorBoundary, U9) × Failure/Recovery — «A crash screen must offer an exit that doesn't re-run the crash.»** Instance: "Try again" merely clears state and re-renders the same tree (ErrorBoundary.tsx:34–38); deterministic render errors loop, and there is no "back to sites" escape hatch. Fix-class: add a hard link to `/` (full navigation) beside Try again.
- **[D218] (ui/Dialog, U51) × Accessibility — «A modal primitive must ship its own discoverable close affordance and title contract.»** Instance: `DialogContent` renders no close (X) button and doesn't require `DialogTitle` (dialog.tsx:9–31) — close is Esc/overlay-only, and title omission is left to each consumer (Radix a11y warning). Fix-class: build an absolute-positioned `DialogClose` X into `DialogContent`; make title a required prop.
- **[D219] (Details toggle, U32) × Naming/Least-astonishment — «A summary echo must read as information, not punctuation.»** Instance: collapsed toggle renders "Details  Untitled site · —" (NewSitePage.tsx:276–279) — an em-dash as the slug placeholder, and no cue that name/slug are editable inside. Fix-class: "Name & URL: Untitled · not set — edit" phrasing, or hide the echo until a name exists.
- **[D220] (compose path, U46) × Comprehension — «A product's marquee combination must be discoverable in the UI, not only in a comment.»** Instance: template+prompt "compose" (materialize then run agent) exists only in code (NewSitePage.tsx:24–29, 196–197); no copy anywhere tells the operator they can pick a template *and* describe changes — the hero copy says "Or pick a template" (255–256), framing the modes as exclusive. Fix-class: subcopy/selected-state hint "Add a prompt to customize Starter with AI" when a template is selected.
- **[D221] (sidebar nav, U11) × Organization — «The nav must show where you are for every route it owns.»** Instance: `NavLink to="/" end` (AdminLayout.tsx:33–35) means /sites/new, /manage, posts and events editors all render a sidebar with *no* active item and no breadcrumb. Fix-class: match "Sites" active state on `/sites/*` (drop `end`, use pathname match), or add a breadcrumb row in the outlet.
- **[D222] (gallery grid, U37) × Organization — «Grouping data captured for a gallery must group the gallery.»** Instance: `category` and `sort_order` exist on templates expressly for gallery organization (templates.ts:52–57) but the grid is a flat list with per-card chips only (NewSitePage.tsx:338–360) — fine at N≈3, illegible at N≈30. Fix-class: group headers or a category filter row derived from the already-fetched list.

---

## Notable passes (worth keeping)

- Token login verifies against `/api/me` before persisting, and `apiFetch` clears the token on any 401 (LoginPage.tsx:47–49; apiFetch.ts:52–55) — good provenance hygiene.
- `POST /api/sites/from-template` enqueues materialization with `singletonKey: siteId:templateId` (templates.ts:112–121) — server-side idempotence backstop for D207.
- Conversation-create failure never strands the operator: `?ai=1&ai_error=1` navigation (NewSitePage.tsx:170–180).
- Slug hint `{slug}.sites.anchorcorps.com` (NewSitePage.tsx:325) is honest — matches `create-site.ts` canonical hostname.
- Legacy Puck-editor URLs redirect with page preselection (AdminApp.tsx:21–24) — contract-stable retirement.
- Workspace route deliberately escapes the sidebar shell (AdminApp.tsx:37–46) — correct grain for a full-bleed canvas.
- `TemplateCover` gradient is deterministic per name (hashHue, NewSitePage.tsx:69–73) — stable identity across reloads.

## Census totals

Units 56 · Lenses 20 · Cells 1120 (100 % recorded, 0 blank) · Directives 23 · n/a 324 · Passes 773.
