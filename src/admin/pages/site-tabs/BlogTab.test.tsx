// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { BlogTab } from "./BlogTab.js";
import { setAdminToken, clearAdminToken } from "../../lib/adminToken.js";

const POST_A = { id: "b1", slug: "welcome", title: "Welcome", status: "draft", updated_at: "2026-05-18T00:00:00Z" };
const POST_B = { id: "b2", slug: "news", title: "Big news", status: "published", updated_at: "2026-05-19T00:00:00Z" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderTab() {
  return render(
    <MemoryRouter initialEntries={["/sites/acme"]}>
      <Routes>
        <Route path="/sites/:slug" element={<BlogTab siteId="s1" slug="acme" />} />
        <Route path="/sites/:slug/posts/:postId" element={<div>post editor reached</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("BlogTab (P8-T8.13)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("lists posts with title, slug, and a status badge", async () => {
    global.fetch = vi.fn(async () => json({ posts: [POST_A, POST_B] })) as unknown as typeof fetch;
    renderTab();
    await waitFor(() => expect(screen.getByText("Welcome")).toBeTruthy());
    expect(screen.getByText("Big news")).toBeTruthy();
    expect(screen.getByText("draft")).toBeTruthy();
    expect(screen.getByText("published")).toBeTruthy();
  });

  it("creates a post via POST and jumps into the editor", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/posts" && method === "POST") {
        return json({ post: { id: "b9", slug: "hello", title: "Hello", status: "draft" } }, 201);
      }
      return json({ posts: [POST_A] });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderTab();
    await waitFor(() => expect(screen.getByText("Welcome")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "+ New post" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Hello" } });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Create post" }));

    // On success it navigates to the new post's editor route.
    await waitFor(() => expect(screen.getByText(/post editor reached/)).toBeTruthy());
    const postCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(JSON.parse((postCall![1] as RequestInit).body as string)).toEqual({ slug: "hello", title: "Hello" });
  });

  it("routes Edit to the post editor route", async () => {
    global.fetch = vi.fn(async () => json({ posts: [POST_A] })) as unknown as typeof fetch;
    renderTab();
    await waitFor(() => expect(screen.getByText("Welcome")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText(/post editor reached/)).toBeTruthy();
  });

  it("surfaces a duplicate-slug 409 inline", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") return json({ error: "slug already exists" }, 409);
      return json({ posts: [POST_A] });
    }) as unknown as typeof fetch;

    renderTab();
    await waitFor(() => expect(screen.getByText("Welcome")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "+ New post" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Welcome again" } });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "welcome" } });
    fireEvent.click(screen.getByRole("button", { name: "Create post" }));

    await waitFor(() => expect(screen.getByText(/already exists/)).toBeTruthy());
  });

  it("shows an empty state when there are no posts", async () => {
    global.fetch = vi.fn(async () => json({ posts: [] })) as unknown as typeof fetch;
    renderTab();
    await waitFor(() => expect(screen.getByText(/No posts yet/)).toBeTruthy());
  });
});
