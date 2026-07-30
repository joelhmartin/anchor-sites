// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Stub Puck: surfaces the converted `data` and fires onPublish with it.
// Rendering Puck's real drag-and-drop editor in jsdom is fragile and brittle;
// visual QA is operator-run at studio.localhost:3000 (D-017 hard constraint).
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

import { EditorPage } from "./EditorPage.js";
import { toPuckData } from "../../editor/puck-adapter.js";
import { clearAdminToken, setAdminToken } from "../lib/adminToken.js";

const SITE = {
  id: "s1",
  slug: "acme",
  display_name: "Acme",
  status: "active",
  created_at: "2026-05-18T00:00:00Z",
  pages_count: 1,
};
const BLOCKS = [
  { id: "b1", type: "hero", props: { title: "Hi" } },
  { id: "b2", type: "rich-text", props: { html: "<p>x</p>", max_width: "medium" } },
];
const PAGE = {
  id: "p1",
  site_id: "s1",
  slug: "home",
  title: "Home",
  status: "draft",
  blocks: BLOCKS,
  seo: { title: "SEO" },
};

const BLOCKS_B = [{ id: "rb", type: "cta", props: { label: "Restored" } }];
const REVS = [
  { id: "r1", created_at: "2026-05-19T00:00:00Z", source: "manual", author_id: null },
];

// Stateful mock: GET page returns BLOCKS until r1 is restored, then BLOCKS_B.
function mockApiWithRevisions() {
  let restored = false;
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/sites") return json({ sites: [SITE] });
    if (url === "/api/sites/s1/pages/p1/revisions") return json({ revisions: REVS });
    if (url === "/api/sites/s1/pages/p1/revisions/r1/restore" && init?.method === "POST") {
      restored = true;
      return json({ restored_from: "r1", revision: { id: "r9", created_at: "2026-05-20T00:00:00Z" } });
    }
    if (url === "/api/sites/s1/pages/p1") {
      return json({ page: { ...PAGE, blocks: restored ? BLOCKS_B : BLOCKS } });
    }
    return json({ error: "not found" }, 404);
  }) as unknown as typeof fetch;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let lastPost: { url: string; body: Record<string, unknown> } | null = null;

function mockApi(opts: { savePost?: () => Response } = {}) {
  lastPost = null;
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/sites") return json({ sites: [SITE] });
    if (url === "/api/sites/s1/pages/p1") {
      if (init?.method === "POST") {
        lastPost = { url, body: JSON.parse(String(init.body)) };
        if (opts.savePost) return opts.savePost();
        // Echo the requested status so the publish/draft toggle reflects it.
        const status = (lastPost.body.status as string) ?? PAGE.status;
        return json({
          page: { ...PAGE, status },
          revision: { id: "r1", created_at: "2026-05-20T00:00:00Z" },
        });
      }
      return json({ page: PAGE });
    }
    return json({ error: "not found" }, 404);
  }) as unknown as typeof fetch;
}

const AI_PROPOSED = [
  ...BLOCKS,
  { id: "ai1", type: "rich-text", props: { html: "<p>added by ai</p>", max_width: "medium" } },
];
const AI_DIFF = {
  added: [{ id: "ai1", type: "rich-text" }],
  removed: [],
  updated: [],
  moved: [],
  unchanged: 2,
  summary: "1 added",
};

// Mock for the "Ask AI" panel: an ai-edit POST returns a proposal; applying it
// saves through the page-save endpoint with source:'ai', after which the page
// re-fetch returns the applied blocks (so the editor remounts with them).
function mockApiWithAi(opts: { aiStatus?: number } = {}) {
  lastPost = null;
  let applied = false;
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/sites") return json({ sites: [SITE] });
    if (url === "/api/sites/s1/pages/p1/ai-edit" && init?.method === "POST") {
      if (opts.aiStatus && opts.aiStatus >= 400) {
        return json(
          { error: "ai proposal rejected", message: "Proposal rejected at the validate stage." },
          opts.aiStatus,
        );
      }
      return json({ mode: "dry-run", message: "Added a section.", proposed_blocks: AI_PROPOSED, diff: AI_DIFF });
    }
    if (url === "/api/sites/s1/pages/p1") {
      if (init?.method === "POST") {
        lastPost = { url, body: JSON.parse(String(init.body)) };
        if ((lastPost.body.source as string) === "ai") applied = true;
        return json({ page: { ...PAGE, blocks: AI_PROPOSED }, revision: { id: "r9", created_at: "2026-05-20T00:00:00Z" } });
      }
      return json({ page: { ...PAGE, blocks: applied ? AI_PROPOSED : BLOCKS } });
    }
    return json({ error: "not found" }, 404);
  }) as unknown as typeof fetch;
}

function renderAt(path = "/sites/acme/pages/p1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sites/:slug" element={<div>site detail</div>} />
        <Route path="/sites/:slug/pages/:pageId" element={<EditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("EditorPage (P5-T5.5)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("loads the page and renders Puck with toPuckData(blocks)", async () => {
    mockApi();
    renderAt();
    const pre = await screen.findByTestId("puck-data");
    expect(JSON.parse(pre.textContent ?? "null")).toEqual(toPuckData(BLOCKS));
  });

  it("publishing converts back via fromPuckData and POSTs to the save endpoint", async () => {
    mockApi();
    renderAt();
    await screen.findByTestId("puck-data");
    fireEvent.click(screen.getByRole("button", { name: "Stub publish" }));
    await waitFor(() => expect(lastPost).toBeTruthy());
    expect(lastPost?.url).toBe("/api/sites/s1/pages/p1");
    expect(lastPost?.body.blocks).toEqual(BLOCKS); // round-trip preserved
    expect(lastPost?.body.seo).toEqual({ title: "SEO" });
    expect(lastPost?.body.source).toBe("editor");
    await screen.findByText("Saved ✓");
  });

  it("surfaces a save error", async () => {
    mockApi({ savePost: () => json({ error: "boom" }, 500) });
    renderAt();
    await screen.findByTestId("puck-data");
    fireEvent.click(screen.getByRole("button", { name: "Stub publish" }));
    await screen.findByText("boom");
  });

  it("shows a not-found card when the slug has no matching site", async () => {
    mockApi();
    renderAt("/sites/ghost/pages/p1");
    await screen.findByText(/No site found for/);
  });

  it("renders a Back-to-site breadcrumb pointing at the site detail", async () => {
    mockApi();
    renderAt();
    const link = await screen.findByRole("link", { name: /Back to acme/ });
    expect(link.getAttribute("href")).toBe("/sites/acme/manage");
  });

  it("toggles publish status and persists it via the save endpoint (P5-T5.10)", async () => {
    mockApi();
    renderAt();
    await screen.findByTestId("puck-data");
    // PAGE starts as draft → button offers to Publish.
    const toggle = screen.getByRole("button", { name: "Publish" });
    fireEvent.click(toggle);
    await waitFor(() => expect(lastPost?.body.status).toBe("published"));
    // Status reflects the persisted value; the toggle now offers draft.
    await screen.findByRole("button", { name: "Move to draft" });
  });

  it("shows the revision history when History is opened (P5-T5.9)", async () => {
    mockApiWithRevisions();
    renderAt();
    await screen.findByTestId("puck-data");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await screen.findByRole("button", { name: "Restore" });
    expect(screen.getByText(/manual/)).toBeTruthy();
  });

  it("restoring a revision reloads the editor with the restored blocks (P5-T5.9)", async () => {
    mockApiWithRevisions();
    renderAt();
    // Initial load shows BLOCKS.
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId("puck-data").textContent ?? "null")).toEqual(
        toPuckData(BLOCKS),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    // After restore, the page re-fetch returns BLOCKS_B and Puck remounts with it.
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId("puck-data").textContent ?? "null")).toEqual(
        toPuckData(BLOCKS_B),
      ),
    );
  });

  it("Ask AI: an instruction previews the proposed change (P6-T6.6)", async () => {
    mockApiWithAi();
    renderAt();
    await screen.findByTestId("puck-data");
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
    fireEvent.change(screen.getByLabelText("AI instruction"), {
      target: { value: "add a closing section" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose" }));
    await screen.findByText("Added a section.");
    expect(screen.getByText(/1 added/)).toBeTruthy();
    await screen.findByRole("button", { name: "Apply" });
  });

  it("Ask AI: Apply saves with source:'ai' and reloads the editor with the applied blocks", async () => {
    mockApiWithAi();
    renderAt();
    await screen.findByTestId("puck-data");
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
    fireEvent.change(screen.getByLabelText("AI instruction"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose" }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));
    await waitFor(() => expect(lastPost?.body.source).toBe("ai"));
    expect(lastPost?.body.blocks).toEqual(AI_PROPOSED);
    // Editor remounted with the applied blocks (the reload path).
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId("puck-data").textContent ?? "null")).toEqual(
        toPuckData(AI_PROPOSED),
      ),
    );
  });

  it("Ask AI: Reject discards the proposal without saving", async () => {
    mockApiWithAi();
    renderAt();
    await screen.findByTestId("puck-data");
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
    fireEvent.change(screen.getByLabelText("AI instruction"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Apply" })).toBeNull());
    expect(lastPost).toBeNull();
  });

  it("Ask AI: surfaces a rejected-proposal error from the endpoint", async () => {
    mockApiWithAi({ aiStatus: 422 });
    renderAt();
    await screen.findByTestId("puck-data");
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
    fireEvent.change(screen.getByLabelText("AI instruction"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose" }));
    await screen.findByText(/Proposal rejected at the validate stage/);
  });
});
