// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { setAdminToken, clearAdminToken } from "./lib/adminToken.js";

// Control the auth probe so routing tests are deterministic + synchronous
// (the real hook is exercised in RequireAdmin.test.tsx).
const session: { status: "loading" | "authed" | "unauthed"; user: unknown } = {
  status: "authed",
  user: { id: "dev", email: "dev@studio.localhost" },
};
vi.mock("./auth/useStudioSession.js", () => ({ useStudioSession: () => session }));

import { AdminApp } from "./AdminApp.js";

/** Surfaces the router's current location so redirect tests can assert on it
 * without pulling apart AdminApp's own <Routes> tree. */
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <AdminApp />
    </MemoryRouter>,
  );
}

const SITE = {
  id: "s1",
  slug: "acme",
  display_name: "Acme Dental",
  status: "active",
  default_brand_tokens: {},
  created_at: "2026-05-18T00:00:00Z",
  pages_count: 1,
  media_count: 0,
};
const HOME_PAGE = { id: "pg1", slug: "home", title: "Home", status: "draft", updated_at: "2026-06-01T00:00:00Z" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Full site-detail fetch graph (Task B2's route split) — `/sites/:slug`
 * (WorkspacePage) and `/sites/:slug/manage` (SiteDetailPage) both resolve
 * slug → id from `/api/sites`, then fetch overlapping site/pages/git data. */
function mockSiteFetch() {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/sites") return json({ sites: [SITE] });
    if (url === "/api/sites/s1") return json({ site: SITE });
    if (url === "/api/sites/s1/pages") return json({ pages: [HOME_PAGE] });
    if (url === "/api/sites/s1/media") return json({ media: [] });
    if (url === "/api/sites/s1/git") return json({ configured: false, repo: null, state: null });
    if (url === "/api/sites/s1/agent/conversations") return json({ conversations: [] });
    return json({ error: "not found" }, 404);
  }) as unknown as typeof fetch;
}

describe("AdminApp routing (P4-T4.9; P8-T8.5)", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    session.status = "authed";
  });
  afterEach(() => {
    cleanup();
    global.fetch = realFetch;
    clearAdminToken();
  });

  it("redirects to /login when the session is unauthed", () => {
    session.status = "unauthed";
    renderAt("/");
    expect(screen.getByText("AnchorCorps Studio")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sign in with Google/i })).toBeTruthy();
  });

  it("renders the sites list + layout chrome when authenticated", () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: /Studio/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sites" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sites" })).toBeTruthy();
  });

  it("redirects the legacy page-edit route to the workspace with ?page= (Task B5 — Puck removed)", async () => {
    setAdminToken("tok");
    mockSiteFetch();
    renderAt("/sites/acme/pages/pg1");
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/sites/acme?page=pg1"),
    );
    // The redirect lands on the workspace, not a 404 or a dead route.
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme Dental" })).toBeTruthy());
  });

  it("renders NotFound for an unknown admin route", () => {
    renderAt("/totally/unknown");
    expect(screen.getByRole("heading", { name: "Not found" })).toBeTruthy();
  });

  it("shows the Google sign-in screen at /login", () => {
    renderAt("/login");
    expect(screen.getByRole("button", { name: /Sign in with Google/i })).toBeTruthy();
  });

  // ── Task B2 (2026-07-30 lovable-workspace SDD): route split ──

  it("renders the Lovable-style workspace at /sites/:slug", async () => {
    setAdminToken("tok");
    mockSiteFetch();
    renderAt("/sites/acme");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme Dental" })).toBeTruthy());
    // Workspace-only chrome: Publish placeholder + a Manage escape hatch to
    // the tab-based shell — neither exists on the /manage route.
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Manage" }).getAttribute("href")).toBe("/sites/acme/manage");
    // The legacy tab shell must NOT also be mounted at this route.
    expect(screen.queryByRole("tab", { name: "Pages" })).toBeNull();
  });

  it("renders the legacy tab-based shell at /sites/:slug/manage", async () => {
    setAdminToken("tok");
    mockSiteFetch();
    renderAt("/sites/acme/manage");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme Dental" })).toBeTruthy());
    expect(screen.getByRole("tab", { name: "Pages" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeTruthy();
    // The workspace's chat panel/Publish button must NOT be mounted here.
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });
});
