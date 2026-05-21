// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PagesTab } from "./PagesTab.js";
import { setAdminToken, clearAdminToken } from "../../lib/adminToken.js";

const PAGE_A = { id: "p1", slug: "home", title: "Home", status: "published", updated_at: "2026-05-18T00:00:00Z" };
const PAGE_B = { id: "p2", slug: "about", title: "About us", status: "draft", updated_at: "2026-05-19T00:00:00Z" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderTab() {
  return render(
    <MemoryRouter initialEntries={["/sites/acme"]}>
      <Routes>
        <Route path="/sites/:slug" element={<PagesTab siteId="s1" slug="acme" />} />
        {/* Stub destination — PagesTab only owns the navigation, not the editor. */}
        <Route path="/sites/:slug/pages/:pageId" element={<div>editor route reached</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PagesTab (P4-T4.13)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("lists pages with title, slug, and a status badge", async () => {
    global.fetch = vi.fn(async () => json({ pages: [PAGE_A, PAGE_B] })) as unknown as typeof fetch;
    renderTab();
    await waitFor(() => expect(screen.getByText("Home")).toBeTruthy());
    expect(screen.getByText("About us")).toBeTruthy();
    expect(screen.getByText("published")).toBeTruthy();
    expect(screen.getByText("draft")).toBeTruthy();
  });

  it("creates a page via POST and refreshes the list", async () => {
    let getCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/pages" && method === "POST") {
        return json({ page: { id: "p2", slug: "about", title: "About us", status: "draft" } }, 201);
      }
      // GET: first load has only PAGE_A; after the create + reload, both.
      getCount += 1;
      return json({ pages: getCount === 1 ? [PAGE_A] : [PAGE_A, PAGE_B] });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderTab();
    await waitFor(() => expect(screen.getByText("Home")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "+ New page" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "About us" } });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "about" } });
    fireEvent.click(screen.getByRole("button", { name: "Create page" }));

    await waitFor(() => expect(screen.getByText("About us")).toBeTruthy());
    const postCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body).toEqual({ slug: "about", title: "About us" });
  });

  it("routes Edit to the page editor route", async () => {
    global.fetch = vi.fn(async () => json({ pages: [PAGE_A] })) as unknown as typeof fetch;
    renderTab();
    await waitFor(() => expect(screen.getByText("Home")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText(/editor route reached/)).toBeTruthy();
  });

  it("adds a page from a page template (P7-T7.9) and refreshes the list", async () => {
    let getCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/templates")) {
        return json({ templates: [{ id: "pt1", name: "Promo block", pages_count: 1 }] });
      }
      if (url === "/api/sites/s1/pages/from-template" && method === "POST") {
        return json({ page: { id: "p2", slug: "promo", title: "Promo", status: "draft" } }, 201);
      }
      getCount += 1;
      return json({ pages: getCount === 1 ? [PAGE_A] : [PAGE_A, { ...PAGE_B, slug: "promo", title: "Promo" }] });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderTab();
    await waitFor(() => expect(screen.getByText("Home")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Add from template" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "Promo block" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Page template"), { target: { value: "pt1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add page" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) => String(c[0]) === "/api/sites/s1/pages/from-template" && (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(post).toBeTruthy();
    });
    const post = fetchMock.mock.calls.find((c) => String(c[0]) === "/api/sites/s1/pages/from-template")!;
    const body = JSON.parse((post[1] as RequestInit).body as string);
    expect(body.template_id).toBe("pt1");
    expect(body.slug).toBeUndefined(); // omitted → server defaults to the template's slug
  });

  it("surfaces a duplicate-slug 409 inline", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") return json({ error: "slug already exists" }, 409);
      return json({ pages: [PAGE_A] });
    }) as unknown as typeof fetch;

    renderTab();
    await waitFor(() => expect(screen.getByText("Home")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "+ New page" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Home again" } });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "home" } });
    fireEvent.click(screen.getByRole("button", { name: "Create page" }));

    await waitFor(() => expect(screen.getByText(/already exists/)).toBeTruthy());
  });
});
