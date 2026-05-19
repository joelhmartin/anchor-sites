# Demo Log

> **Routine instructions:** Append an entry every time there's something visible/interactive a human can look at. Each entry fires a `[Builder] Demo ready:` email (deduped via `demo_milestones_sent` in `STATE.json`). Newest entries on top.

## Format

```
### <date> — <short title>
**Milestone ID:** <stable identifier, e.g., phase1-blockrenderer-demo>
**Phase/Task:** <e.g., Phase 1, Task 1.4>
**Commit:** <short SHA>

**What to look at:**
<URL or curl command or test page>

**What's new since last demo:**
<bullets>

**Known limitations:**
<what's intentionally not yet working>

**Next visible thing coming:**
<one line>
```

---

<!-- Routine appends demos below this line. Newest on top. -->

### 2026-05-18 — First multi-tenant pages render from block JSON (local)
**Milestone ID:** first-multi-tenant-page-local
**Phase/Task:** Phase 1, Task 1.6
**Commit:** 1737b62

**What to look at:**

```bash
# Boot the dev server (Express + Vite middleware):
docker compose up -d postgres
npm run migrate:up && npm run db:seed
DATABASE_URL=postgres://anchor:anchor@localhost:5434/anchor_dev npm run dev

# Two sites, one renderer, different content:
curl -s http://muldoon.localhost:3000/ | head -40
curl -s http://demo.localhost:3000/   | head -40

# 404 still wears the site shell + brand tokens:
curl -i http://muldoon.localhost:3000/nope
```

**What's new since last demo:**
- Catch-all `GET /*` route (`src/server/routes/page.ts`) resolves `Host` → site, looks up the published page, SSRs `<BlockRenderer>` in a shell with the site's brand tokens.
- Both seeded sites have real home pages (hero + rich-text + cta) in `pages.blocks` JSONB.
- Unknown hosts pass through to the Vite/SPA dev server, so `http://localhost:3000/` still loads the legacy SPA.

**Known limitations:**
- The existing `marketing/Navbar.jsx` / `Footer.jsx` shell isn't SSR-imported yet (Phase 5 + Puck per D-014 / D-017). Current shell is intentionally minimal.
- No production deployment yet — Task 1.8 maps `*.preview.anchorcorps.dev` to Cloud Run.
- No editor — Phase 5. Saves arrive in Task 1.7 (revision tracking endpoint).

**Next visible thing coming:** `POST /api/sites/:siteId/pages/:pageId` with revision history (Task 1.7), then the production URLs in Task 1.8.
