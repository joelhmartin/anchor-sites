// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Stub BlockBodyEditor (Task B5 — Puck removed): real TipTap/ProseMirror is
// fragile in jsdom; visual QA is operator-run. Surfaces the `value` it was
// given and fires `onSave` with it, plus the `slug` it was passed.
vi.mock("../components/BlockBodyEditor.js", () => ({
  BlockBodyEditor: ({
    slug,
    value,
    onSave,
  }: {
    slug: string;
    value: unknown;
    onSave: (v: unknown) => void;
  }) => (
    <div>
      <pre data-testid="body-value">{JSON.stringify(value)}</pre>
      <span data-testid="body-slug">{slug}</span>
      <button type="button" onClick={() => onSave(value)}>
        Stub publish
      </button>
    </div>
  ),
}));

import { PostEditorPage } from "./PostEditorPage.js";
import { clearAdminToken, setAdminToken } from "../lib/adminToken.js";

const SITE = { id: "s1", slug: "acme", display_name: "Acme", status: "active", created_at: "2026-05-18T00:00:00Z", pages_count: 1 };
const BODY = [{ id: "b1", type: "rich-text", props: { html: "<p>hi</p>", max_width: "medium" } }];
const POST = { id: "b1", site_id: "s1", slug: "welcome", title: "Welcome", excerpt: "First", body: BODY, status: "draft" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let lastPut: { url: string; body: Record<string, unknown> } | null = null;

function mockApi(opts: { savePut?: () => Response } = {}) {
  lastPut = null;
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/sites") return json({ sites: [SITE] });
    if (url === "/api/sites/s1/posts/b1") {
      if (init?.method === "PUT") {
        lastPut = { url, body: JSON.parse(String(init.body)) };
        if (opts.savePut) return opts.savePut();
        return json({ post: { ...POST, ...lastPut.body } });
      }
      return json({ post: POST });
    }
    return json({ error: "not found" }, 404);
  }) as unknown as typeof fetch;
}

function renderAt(path = "/sites/acme/posts/b1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sites/:slug" element={<div>site detail</div>} />
        <Route path="/sites/:slug/posts/:postId" element={<PostEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PostEditorPage (P8-T8.13)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("loads the post and renders BlockBodyEditor with the body + slug + seeded metadata", async () => {
    mockApi();
    renderAt();
    const pre = await screen.findByTestId("body-value");
    expect(JSON.parse(pre.textContent ?? "null")).toEqual(BODY);
    expect(screen.getByTestId("body-slug").textContent).toBe("acme");
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Welcome");
    expect((screen.getByLabelText("Excerpt") as HTMLInputElement).value).toBe("First");
  });

  it("publishing saves title/excerpt/status + body in one PUT", async () => {
    mockApi();
    renderAt();
    await screen.findByTestId("body-value");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Welcome v2" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "published" } });
    fireEvent.click(screen.getByRole("button", { name: "Stub publish" }));
    await waitFor(() => expect(lastPut).toBeTruthy());
    expect(lastPut?.url).toBe("/api/sites/s1/posts/b1");
    expect(lastPut?.body.title).toBe("Welcome v2");
    expect(lastPut?.body.status).toBe("published");
    expect(lastPut?.body.body).toEqual(BODY); // round-trip preserved
    await screen.findByText("Saved ✓");
  });

  it("surfaces a save error", async () => {
    mockApi({ savePut: () => json({ error: "boom" }, 500) });
    renderAt();
    await screen.findByTestId("body-value");
    fireEvent.click(screen.getByRole("button", { name: "Stub publish" }));
    await screen.findByText("boom");
  });

  it("shows a not-found card when the slug has no matching site", async () => {
    mockApi();
    renderAt("/sites/ghost/posts/b1");
    await screen.findByText(/No site found for/);
  });

  it("links Back-to-site at the site detail", async () => {
    mockApi();
    renderAt();
    const link = await screen.findByRole("link", { name: /Back to acme/ });
    expect(link.getAttribute("href")).toBe("/sites/acme/manage");
  });
});
