// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { PagesTab } from "./PagesTab.js";
import { setAdminToken, clearAdminToken } from "../../lib/adminToken.js";

const PAGE_A = { id: "p1", slug: "home", title: "Home", status: "published", updated_at: "2026-05-18T00:00:00Z" };
const PAGE_B = { id: "p2", slug: "about", title: "About us", status: "draft", updated_at: "2026-05-19T00:00:00Z" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Stub destination (Task B5): Edit now navigates to the workspace at
 * `/sites/:slug` with `?page=<id>` — surface the search string so the test
 * can assert on it without pulling in the real WorkspacePage. */
function WorkspaceStub() {
  const location = useLocation();
  return <div>workspace reached {location.search}</div>;
}

function renderTab() {
  return render(
    <MemoryRouter initialEntries={["/sites/acme/manage"]}>
      <Routes>
        <Route path="/sites/:slug/manage" element={<PagesTab siteId="s1" slug="acme" />} />
        <Route path="/sites/:slug" element={<WorkspaceStub />} />
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

  it("shows same-day edits with distinct Updated timestamps (D433)", async () => {
    const morning = { ...PAGE_A, id: "pm", title: "Morning", updated_at: "2026-05-18T09:00:00Z" };
    const evening = { ...PAGE_A, id: "pe", title: "Evening", updated_at: "2026-05-18T17:00:00Z" };
    global.fetch = vi.fn(async () => json({ pages: [morning, evening] })) as unknown as typeof fetch;
    renderTab();
    await waitFor(() => expect(screen.getByText("Morning")).toBeTruthy());
    const cells = screen.getAllByRole("cell").map((c) => c.textContent);
    // The two rows' Updated cells must not collapse to the same string.
    const morningRow = screen.getByText("Morning").closest("tr")!;
    const eveningRow = screen.getByText("Evening").closest("tr")!;
    const morningUpdated = morningRow.querySelectorAll("td")[3].textContent;
    const eveningUpdated = eveningRow.querySelectorAll("td")[3].textContent;
    expect(morningUpdated).not.toBe(eveningUpdated);
    expect(cells.length).toBeGreaterThan(0);
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

  it("routes Edit to the workspace with the page preselected via ?page=", async () => {
    global.fetch = vi.fn(async () => json({ pages: [PAGE_A] })) as unknown as typeof fetch;
    renderTab();
    await waitFor(() => expect(screen.getByText("Home")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText(/workspace reached \?page=p1/)).toBeTruthy();
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

  it("publishes a draft page from the list via PATCH status (D436)", async () => {
    let getCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/pages/p2/status" && method === "PATCH") {
        return json({ page: { id: "p2", status: "published" } });
      }
      getCount += 1;
      return json({ pages: [getCount === 1 ? PAGE_B : { ...PAGE_B, status: "published" }] });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderTab();
    await waitFor(() => expect(screen.getByText("About us")).toBeTruthy());
    // PAGE_B is a draft → the row offers "Publish".
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (c) => String(c[0]) === "/api/sites/s1/pages/p2/status" && (c[1] as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch).toBeTruthy();
      expect(JSON.parse((patch![1] as RequestInit).body as string)).toEqual({ status: "published" });
    });
  });

  it("shows a 409 (agent running) when publishing from the list (D436/D610)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/status") && method === "PATCH") {
        return json({ error: "Agent is running — publish is disabled until the build finishes." }, 409);
      }
      return json({ pages: [PAGE_B] });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    renderTab();
    await waitFor(() => expect(screen.getByText("About us")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(screen.getByText(/Agent is running/)).toBeTruthy());
  });

  it("deletes a page (confirm-gated) via DELETE and refreshes (D105/D405/D505)", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    let getCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/pages/p2" && method === "DELETE") {
        return json({ deleted: { page_id: "p2", tombstone_id: "t1" } });
      }
      getCount += 1;
      // Two pages before delete, one after.
      return json({ pages: getCount === 1 ? [PAGE_A, PAGE_B] : [PAGE_A] });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderTab();
    await waitFor(() => expect(screen.getByText("About us")).toBeTruthy());
    // Two Delete buttons; the second row (About us) is index 1.
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(deleteButtons[1]);
    expect(confirmSpy).toHaveBeenCalled();

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        (c) => String(c[0]) === "/api/sites/s1/pages/p2" && (c[1] as RequestInit | undefined)?.method === "DELETE",
      );
      expect(del).toBeTruthy();
    });
    await waitFor(() => expect(screen.queryByText("About us")).toBeNull());
  });

  it("Delete is disabled when only one page remains (D505 last-page guard)", async () => {
    global.fetch = vi.fn(async () => json({ pages: [PAGE_A] })) as unknown as typeof fetch;
    renderTab();
    await waitFor(() => expect(screen.getByText("Home")).toBeTruthy());
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opening one create form closes the other (D432)", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("/api/templates")) {
        return json({ templates: [{ id: "pt1", name: "Promo block", pages_count: 1 }] });
      }
      return json({ pages: [PAGE_A] });
    }) as unknown as typeof fetch;

    renderTab();
    await waitFor(() => expect(screen.getByText("Home")).toBeTruthy());

    // Open "+ New page" → its Title field is present.
    fireEvent.click(screen.getByRole("button", { name: "+ New page" }));
    expect(screen.getByLabelText("Title")).toBeTruthy();

    // Open "Add from template" → the new-page Title field is gone (exclusive).
    fireEvent.click(screen.getByRole("button", { name: "Add from template" }));
    await waitFor(() => expect(screen.getByLabelText("Page template")).toBeTruthy());
    expect(screen.queryByLabelText("Title")).toBeNull();
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
