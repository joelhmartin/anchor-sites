// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SiteDetailPage } from "./SiteDetailPage.js";
import { setAdminToken, clearAdminToken } from "../lib/adminToken.js";
import type { AgentChatDrawerProps } from "../components/AgentChatDrawer.js";

// Stub the Studio chat drawer (Task 11) so this suite can assert the props
// Task 12 threads into it (open/autoTail/onChangeEvent) without dealing with
// its own conversation-loading fetches.
const { drawerCalls } = vi.hoisted(() => ({ drawerCalls: [] as AgentChatDrawerProps[] }));
vi.mock("../components/AgentChatDrawer.js", () => ({
  AgentChatDrawer: (props: AgentChatDrawerProps) => {
    drawerCalls.push(props);
    return props.open ? <div data-testid="agent-drawer-stub">Studio chat stub (open)</div> : null;
  },
}));

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

describe("SiteDetailPage (P4-T4.12)", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    setAdminToken("tok");
    drawerCalls.length = 0;
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

  it("shows a banner when the wizard hands off with ai_error=1 (item 8 — conversation/job POST failed after site creation)", async () => {
    mockApi([SITE], SITE);
    renderAt("acme", "?ai=1&ai_error=1");
    await waitFor(() =>
      expect(screen.getByText(/initial AI build couldn.t be started automatically/)).toBeTruthy(),
    );
  });

  it("does not show the ai_error banner on a normal ?ai=1 hand-off", async () => {
    mockApi([SITE], SITE);
    renderAt("acme", "?ai=1");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme Dental" })).toBeTruthy());
    expect(screen.queryByText(/initial AI build couldn.t be started automatically/)).toBeNull();
  });

  it("opens the Studio drawer on ?ai=1 (wizard hand-off) with autoTail on", async () => {
    mockApi([SITE], SITE);
    renderAt("acme", "?ai=1");
    await waitFor(() => expect(drawerCalls.length).toBeGreaterThan(0));
    const last = drawerCalls[drawerCalls.length - 1];
    expect(last.open).toBe(true);
    expect(last.autoTail).toBe(true);
    expect(last.siteId).toBe("s1");
    expect(last.slug).toBe("acme");
  });

  it("toggles the Studio drawer via the AI header button (aria-pressed)", async () => {
    mockApi([SITE], SITE);
    renderAt("acme");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme Dental" })).toBeTruthy());

    const aiButton = screen.getByRole("button", { name: "AI" });
    expect(aiButton.getAttribute("aria-pressed")).toBe("false");
    expect(drawerCalls[drawerCalls.length - 1]?.open).toBe(false);

    fireEvent.click(aiButton);
    expect(aiButton.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(drawerCalls[drawerCalls.length - 1]?.open).toBe(true));
  });

  it("only fetches the site's pages list when the AI drawer is open (doesn't duplicate PagesTab's own fetch)", async () => {
    mockApi([SITE], SITE, [
      { id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" },
    ]);
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    renderAt("acme");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme Dental" })).toBeTruthy());

    const pagesCalls = () => fetchMock.mock.calls.filter(([u]) => String(u) === "/api/sites/s1/pages").length;
    // Pages is the default active tab, so PagesTab's own fetch already fired —
    // that's the only reason this is 1, not 0. The drawer/preview must not
    // add a second, redundant call while it's closed.
    expect(pagesCalls()).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() => expect(screen.getByTitle("Draft preview")).toBeTruthy());
    expect(pagesCalls()).toBe(2);
  });
});
