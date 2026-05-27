// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Stub Puck (D-036).
vi.mock("../../editor/index.js", () => ({
  Puck: ({ data, onPublish }: { data: unknown; onPublish: (d: unknown) => void }) => (
    <div>
      <pre data-testid="puck-data">{JSON.stringify(data)}</pre>
      <button type="button" onClick={() => onPublish(data)}>
        Stub publish
      </button>
    </div>
  ),
}));

import { EventEditorPage } from "./EventEditorPage.js";
import { toPuckData } from "../../editor/puck-adapter.js";
import { clearAdminToken, setAdminToken } from "../lib/adminToken.js";

const SITE = { id: "s1", slug: "acme", display_name: "Acme", status: "active", created_at: "2026-05-18T00:00:00Z", pages_count: 1 };
const DESC = [{ id: "d1", type: "rich-text", props: { html: "<p>join us</p>", max_width: "medium" } }];
const EVENT = {
  id: "e1",
  site_id: "s1",
  slug: "open-house",
  title: "Open House",
  description: DESC,
  starts_at: "2026-07-01T18:00:00.000Z",
  ends_at: null,
  location: "HQ",
  status: "draft",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let lastPut: { url: string; body: Record<string, unknown> } | null = null;

function mockApi(opts: { savePut?: () => Response } = {}) {
  lastPut = null;
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/sites") return json({ sites: [SITE] });
    if (url === "/api/sites/s1/events/e1") {
      if (init?.method === "PUT") {
        lastPut = { url, body: JSON.parse(String(init.body)) };
        if (opts.savePut) return opts.savePut();
        return json({ event: { ...EVENT, ...lastPut.body } });
      }
      return json({ event: EVENT });
    }
    return json({ error: "not found" }, 404);
  }) as unknown as typeof fetch;
}

function renderAt(path = "/sites/acme/events/e1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sites/:slug" element={<div>site detail</div>} />
        <Route path="/sites/:slug/events/:eventId" element={<EventEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("EventEditorPage (P8-T8.13)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("loads the event and renders Puck with toPuckData(description) + seeded metadata", async () => {
    mockApi();
    renderAt();
    const pre = await screen.findByTestId("puck-data");
    expect(JSON.parse(pre.textContent ?? "null")).toEqual(toPuckData(DESC));
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Open House");
    expect((screen.getByLabelText("Location (optional)") as HTMLInputElement).value).toBe("HQ");
  });

  it("publishing saves metadata + description in one PUT", async () => {
    mockApi();
    renderAt();
    await screen.findByTestId("puck-data");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Open House 2026" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "published" } });
    fireEvent.click(screen.getByRole("button", { name: "Stub publish" }));
    await waitFor(() => expect(lastPut).toBeTruthy());
    expect(lastPut?.url).toBe("/api/sites/s1/events/e1");
    expect(lastPut?.body.title).toBe("Open House 2026");
    expect(lastPut?.body.status).toBe("published");
    expect(lastPut?.body.description).toEqual(DESC);
    expect(typeof lastPut?.body.starts_at).toBe("string");
    await screen.findByText("Saved ✓");
  });

  it("surfaces a save error", async () => {
    mockApi({ savePut: () => json({ error: "boom" }, 500) });
    renderAt();
    await screen.findByTestId("puck-data");
    fireEvent.click(screen.getByRole("button", { name: "Stub publish" }));
    await screen.findByText("boom");
  });

  it("shows a not-found card when the slug has no matching site", async () => {
    mockApi();
    renderAt("/sites/ghost/events/e1");
    await screen.findByText(/No site found for/);
  });
});
