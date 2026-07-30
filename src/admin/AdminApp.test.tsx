// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { setAdminToken, clearAdminToken } from "./lib/adminToken.js";

// Stub Puck so the routing test doesn't pull the real (heavy, browser-only)
// editor — it only verifies route → component wiring, not the editor itself.
vi.mock("../editor/index.js", () => ({ Puck: () => null }));

// Control the auth probe so routing tests are deterministic + synchronous
// (the real hook is exercised in RequireAdmin.test.tsx).
const session: { status: "loading" | "authed" | "unauthed"; user: unknown } = {
  status: "authed",
  user: { id: "dev", email: "dev@studio.localhost" },
};
vi.mock("./auth/useStudioSession.js", () => ({ useStudioSession: () => session }));

import { AdminApp } from "./AdminApp.js";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
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

  it("renders the page editor on the page-edit route", () => {
    // Never-resolving fetch keeps EditorPage in its loading state (no async
    // state update after mount) — we only assert the route → editor wiring.
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    renderAt("/sites/muldoon-dental/pages/abc-123");
    expect(screen.getByText("Loading…")).toBeTruthy();
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
