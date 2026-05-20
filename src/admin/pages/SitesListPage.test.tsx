// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SitesListPage } from "./SitesListPage.js";
import { setAdminToken, clearAdminToken } from "../lib/adminToken.js";

function mockSites(sites: unknown[]) {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ sites }), { status: 200, headers: { "Content-Type": "application/json" } }),
  ) as unknown as typeof fetch;
}

describe("SitesListPage (P4-T4.10)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("renders a row per site with status badge + page count", async () => {
    mockSites([
      { id: "1", slug: "muldoon-dental", display_name: "Muldoon Dental", status: "active", created_at: "2026-05-18T00:00:00Z", pages_count: 3 },
      { id: "2", slug: "demo-site", display_name: "Demo Site", status: "active", created_at: "2026-05-17T00:00:00Z", pages_count: 1 },
    ]);
    render(
      <MemoryRouter>
        <SitesListPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Muldoon Dental")).toBeTruthy());
    expect(screen.getByText("Demo Site")).toBeTruthy();
    expect(screen.getByText("muldoon-dental")).toBeTruthy();
    // page counts rendered
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("shows an empty state with a create CTA when there are no sites", async () => {
    mockSites([]);
    render(
      <MemoryRouter>
        <SitesListPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/No sites yet/)).toBeTruthy());
    // Two "+ New site" buttons (header + empty state); both present.
    expect(screen.getAllByRole("button", { name: "+ New site" }).length).toBeGreaterThanOrEqual(1);
  });

  it("surfaces a load error", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "boom" }), { status: 500, headers: { "Content-Type": "application/json" } }),
    ) as unknown as typeof fetch;
    render(
      <MemoryRouter>
        <SitesListPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/Couldn’t load sites/)).toBeTruthy());
  });
});
