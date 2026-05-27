// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EventsTab } from "./EventsTab.js";
import { setAdminToken, clearAdminToken } from "../../lib/adminToken.js";

const EVENT_A = { id: "e1", slug: "open-house", title: "Open House", status: "draft", starts_at: "2026-07-01T18:00:00.000Z" };
const EVENT_B = { id: "e2", slug: "gala", title: "Spring Gala", status: "published", starts_at: "2026-08-01T18:00:00.000Z" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderTab() {
  return render(
    <MemoryRouter initialEntries={["/sites/acme"]}>
      <Routes>
        <Route path="/sites/:slug" element={<EventsTab siteId="s1" slug="acme" />} />
        <Route path="/sites/:slug/events/:eventId" element={<div>event editor reached</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("EventsTab (P8-T8.13)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("lists events with title, slug, and a status badge", async () => {
    global.fetch = vi.fn(async () => json({ events: [EVENT_A, EVENT_B] })) as unknown as typeof fetch;
    renderTab();
    await waitFor(() => expect(screen.getByText("Open House")).toBeTruthy());
    expect(screen.getByText("Spring Gala")).toBeTruthy();
    expect(screen.getByText("draft")).toBeTruthy();
    expect(screen.getByText("published")).toBeTruthy();
  });

  it("creates an event via POST (start sent as ISO) and jumps into the editor", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/events" && method === "POST") {
        return json({ event: { id: "e9", slug: "fair", title: "Fair", status: "draft" } }, 201);
      }
      return json({ events: [EVENT_A] });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderTab();
    await waitFor(() => expect(screen.getByText("Open House")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "+ New event" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Fair" } });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "fair" } });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-09-01T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(screen.getByText(/event editor reached/)).toBeTruthy());
    const postCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.slug).toBe("fair");
    expect(body.title).toBe("Fair");
    expect(typeof body.starts_at).toBe("string");
    expect(body.starts_at).toContain("2026-09-01");
  });

  it("disables Create until a start time is set", async () => {
    global.fetch = vi.fn(async () => json({ events: [] })) as unknown as typeof fetch;
    renderTab();
    await waitFor(() => expect(screen.getByText(/No events yet/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "+ New event" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "x" } });
    // No start yet → submit disabled.
    expect((screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-09-01T10:00" } });
    expect((screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("routes Edit to the event editor route", async () => {
    global.fetch = vi.fn(async () => json({ events: [EVENT_A] })) as unknown as typeof fetch;
    renderTab();
    await waitFor(() => expect(screen.getByText("Open House")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText(/event editor reached/)).toBeTruthy();
  });

  it("surfaces a duplicate-slug 409 inline", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") return json({ error: "slug already exists" }, 409);
      return json({ events: [EVENT_A] });
    }) as unknown as typeof fetch;

    renderTab();
    await waitFor(() => expect(screen.getByText("Open House")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "+ New event" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Open House 2" } });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "open-house" } });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-09-01T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(screen.getByText(/already exists/)).toBeTruthy());
  });
});
