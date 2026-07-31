// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SiteDetailPage } from "./SiteDetailPage.js";
import { setAdminToken, clearAdminToken } from "../lib/adminToken.js";

const SITE = {
  id: "s1",
  slug: "acme",
  display_name: "Acme Dental",
  status: "active",
  default_brand_tokens: { "--theme-main": "#0a3d62" },
  created_at: "2026-05-18T00:00:00Z",
  pages_count: 2,
  media_count: 4,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type PageRow = { id: string; slug: string; title: string; status: string; updated_at: string };

/** Routes /api/sites -> list, /api/sites/:id -> detail, /api/sites/:id/pages -> pages. */
function mockApi(list: unknown[], detail: typeof SITE | null, pages: PageRow[] = []) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/sites") return json({ sites: list });
    if (detail && url === `/api/sites/${detail.id}/pages`) return json({ pages });
    if (detail && url === `/api/sites/${detail.id}/media`) return json({ media: [] });
    if (detail && url === `/api/sites/${detail.id}`) return json({ site: detail });
    return json({ error: "not found" }, 404);
  }) as unknown as typeof fetch;
}

function renderAt(slug: string, search = "") {
  return render(
    <MemoryRouter initialEntries={[`/sites/${slug}${search}`]}>
      <Routes>
        <Route path="/" element={<div>sites list</div>} />
        <Route path="/sites/:slug" element={<SiteDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SiteDetailPage (P4-T4.12) — management shell (served at /manage since Task B2)", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    setAdminToken("tok");
  });
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("resolves slug to the site and loads its detail (name + status)", async () => {
    mockApi([SITE], SITE);
    renderAt("acme");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme Dental" })).toBeTruthy());
    expect(screen.getByText("active")).toBeTruthy();
  });

  it("switches between tabs, mounting only the active panel", async () => {
    mockApi([SITE], SITE);
    renderAt("acme");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Pages" })).toBeTruthy());

    // Pages is the default tab — the real PagesTab shows a "+ New page" affordance.
    expect(screen.getByRole("button", { name: "+ New page" })).toBeTruthy();
    expect(screen.queryByText(/arrive in Task 4.14/)).toBeNull();

    // P8-T8.13 added the per-tenant content tabs.
    expect(screen.getByRole("tab", { name: "Blog" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Events" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Members" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Media" }));
    expect(screen.getByRole("button", { name: "Upload image" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "+ New page" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });

  it("D321: ?tab=domains deep-links straight to the Domains tab (unknown values fall back to Pages)", async () => {
    mockApi([SITE], SITE);
    renderAt("acme", "?tab=domains");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Domains" })).toBeTruthy());
    expect(screen.getByRole("tab", { name: "Domains" }).getAttribute("aria-selected")).toBe("true");
    // Pages tab content is NOT mounted.
    expect(screen.queryByRole("button", { name: "+ New page" })).toBeNull();

    cleanup();
    mockApi([SITE], SITE);
    renderAt("acme", "?tab=nonsense");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Pages" })).toBeTruthy());
    expect(screen.getByRole("tab", { name: "Pages" }).getAttribute("aria-selected")).toBe("true");
  });

  it("links 'View live site' to the canonical tenant hostname", async () => {
    mockApi([SITE], SITE);
    renderAt("acme");
    const link = await screen.findByRole("link", { name: /View live site/ });
    expect(link.getAttribute("href")).toBe("https://acme.sites.anchorcorps.com");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("shows a not-found card when the slug has no matching site", async () => {
    mockApi([SITE], SITE);
    renderAt("ghost");
    await waitFor(() => expect(screen.getByText(/No site found for/)).toBeTruthy());
  });

  // D911 — the live render strips "(placeholder)" from public surfaces; the
  // Studio's job is to get the operator to RENAME, so the strip stops mattering.
  it("nudges a rename when the display name still carries a placeholder marker", async () => {
    const placeholderSite = { ...SITE, display_name: "Acme Dental (placeholder)" };
    mockApi([placeholderSite], placeholderSite);
    renderAt("acme");
    await waitFor(() =>
      expect(screen.getByText(/won’t appear on the live site — rename/)).toBeTruthy(),
    );
  });

  it("shows no rename nudge for a real display name", async () => {
    mockApi([SITE], SITE);
    renderAt("acme");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme Dental" })).toBeTruthy());
    expect(screen.queryByText(/rename/i)).toBeNull();
  });

  it("does not mount any AI chat/preview affordance — that moved to WorkspacePage (Task B2)", async () => {
    mockApi([SITE], SITE, [
      { id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" },
    ]);
    renderAt("acme");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme Dental" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "AI" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Studio chat" })).toBeNull();
    expect(screen.queryByTitle("Draft preview")).toBeNull();
  });
});
