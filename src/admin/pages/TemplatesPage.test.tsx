// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TemplatesPage } from "./TemplatesPage.js";
import { setAdminToken, clearAdminToken } from "../lib/adminToken.js";

const TEMPLATES = {
  templates: [
    { id: "t1", name: "Dental Basic", slug: "dental-basic", kind: "site", description: "A clinic starter", pages_count: 5 },
    { id: "t2", name: "Promo Page", slug: "promo", kind: "page", description: null, pages_count: 1 },
  ],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("TemplatesPage (D429)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  function renderPage() {
    return render(
      <MemoryRouter>
        <TemplatesPage />
      </MemoryRouter>,
    );
  }

  it("lists templates with kind + page count", async () => {
    global.fetch = vi.fn(async () => json(TEMPLATES)) as unknown as typeof fetch;
    renderPage();
    await waitFor(() => expect(screen.getByText("Dental Basic")).toBeTruthy());
    expect(screen.getByText("Promo Page")).toBeTruthy();
    expect(screen.getByText("A clinic starter")).toBeTruthy();
  });

  it("archives a template via DELETE after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let getCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/templates/t1" && method === "DELETE") {
        return json({ template: { id: "t1", status: "archived" } });
      }
      getCount += 1;
      return json({ templates: getCount === 1 ? TEMPLATES.templates : [TEMPLATES.templates[1]] });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    renderPage();
    await waitFor(() => expect(screen.getByText("Dental Basic")).toBeTruthy());

    const row = screen.getByText("Dental Basic").closest("tr")!;
    fireEvent.click(row.querySelector("button")!);

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        (c) => String(c[0]) === "/api/templates/t1" && (c[1] as RequestInit | undefined)?.method === "DELETE",
      );
      expect(del).toBeTruthy();
    });
  });

  it("shows an empty state when there are no templates", async () => {
    global.fetch = vi.fn(async () => json({ templates: [] })) as unknown as typeof fetch;
    renderPage();
    await waitFor(() => expect(screen.getByText(/No templates yet/)).toBeTruthy());
  });
});
