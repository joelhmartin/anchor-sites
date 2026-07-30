// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import { NewSitePage } from "./NewSitePage.js";
import { setAdminToken, clearAdminToken } from "../lib/adminToken.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type TemplateOpt = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  cover_image_url?: string | null;
  pages_count?: number;
};

/** URL-routing fetch mock — the page fetches /api/templates on mount, so a
 * blanket mock that returns the create response for everything would corrupt
 * the templates list — route by url + method instead. */
function routeFetch(
  overrides: Partial<{
    fromTemplate: () => Response;
    createSite: () => Response;
    aiConversation: () => Response;
    templates: TemplateOpt[];
  }> = {},
) {
  const templates =
    overrides.templates ?? [
      { id: "tpl-starter", name: "Starter", description: "A simple starter site.", category: "General" },
    ];
  return vi.fn(async (url: string, opts?: RequestInit) => {
    const method = (opts?.method ?? "GET").toUpperCase();
    if (url.startsWith("/api/templates")) return json({ templates });
    if (url === "/api/sites" && method === "POST")
      return overrides.createSite ? overrides.createSite() : json({ site: { id: "s1", slug: "x" } }, 201);
    if (url === "/api/sites/from-template" && method === "POST")
      return overrides.fromTemplate ? overrides.fromTemplate() : json({ site: { id: "s9" }, job: { queued: true } }, 201);
    // Checked before the generic "/api/sites/" fallback below, which would
    // otherwise swallow this route too.
    if (url.endsWith("/agent/conversations") && method === "POST")
      return overrides.aiConversation ? overrides.aiConversation() : json({ conversation: { id: "conv1" } }, 201);
    if (url.startsWith("/api/sites/")) return json({ site: { pages_count: 2 } });
    return json({});
  });
}

function RouteProbe() {
  const { slug } = useParams();
  const location = useLocation();
  return (
    <div>
      site route reached: {slug} path={location.pathname} search={location.search}
    </div>
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/new"]}>
      <Routes>
        <Route path="/new" element={<NewSitePage />} />
        <Route path="/sites/:slug" element={<RouteProbe />} />
        <Route path="/sites/:slug/manage" element={<RouteProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const postCalls = (m: ReturnType<typeof routeFetch>, path: string) =>
  m.mock.calls.filter(([u, o]) => u === path && (o?.method ?? "").toUpperCase() === "POST");

function typePrompt(text: string) {
  fireEvent.change(screen.getByPlaceholderText("Describe the site you want to build…"), {
    target: { value: text },
  });
}

function openDetails() {
  fireEvent.click(screen.getByRole("button", { name: /Details/ }));
}

describe("NewSitePage (Task B4, 2026-07-30 lovable-workspace SDD)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("renders the hero prompt and a template gallery with a cover-fallback, category chip, and a trailing 'Start blank' card", async () => {
    global.fetch = routeFetch({
      templates: [
        { id: "tpl-a", name: "Dental Practice", description: "Warm, modern dental site.", category: "Healthcare" },
      ],
    }) as unknown as typeof fetch;
    renderPage();

    expect(screen.getByText("What do you want to build?")).toBeTruthy();
    expect(screen.getByPlaceholderText("Describe the site you want to build…")).toBeTruthy();

    await waitFor(() => expect(screen.getByText("Dental Practice")).toBeTruthy());
    expect(screen.getByText("Warm, modern dental site.")).toBeTruthy();
    expect(screen.getByText("Healthcare")).toBeTruthy();

    // Cover-fallback branch: no cover_image_url, so a branded placeholder
    // renders instead of an <img> — initials of the template name.
    const cards = screen.getAllByRole("button");
    const templateCard = cards.find((c) => c.textContent?.includes("Dental Practice"));
    expect(templateCard?.querySelector("img")).toBeNull();
    expect(templateCard?.textContent).toContain("DP");

    // "Start blank" card renders last, after every fetched template.
    const allButtons = screen.getAllByRole("button");
    const dentalIdx = allButtons.findIndex((c) => c.textContent?.includes("Dental Practice"));
    const blankIdx = allButtons.findIndex((c) => c.textContent?.includes("Start blank"));
    expect(dentalIdx).toBeGreaterThanOrEqual(0);
    expect(blankIdx).toBeGreaterThan(dentalIdx);
  });

  it("keeps the primary action disabled until a name/slug is available, and validates the slug in Details", async () => {
    global.fetch = routeFetch() as unknown as typeof fetch;
    renderPage();

    const primary = screen.getByRole("button", { name: "Create site" }) as HTMLButtonElement;
    expect(primary.disabled).toBe(true);

    openDetails();
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "Not A Slug" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Acme Co" } });
    expect(screen.getByText(/Lowercase letters, numbers, and hyphens only/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create site" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "acme-co" } });
    expect((screen.getByRole("button", { name: "Create site" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("blank: 'Start blank' + Details name/slug submits POST /api/sites with brand-token defaults and navigates to /manage", async () => {
    const fetchMock = routeFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    renderPage();

    fireEvent.click(screen.getByText("Start blank"));
    openDetails();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Muldoon Dental" } });

    fireEvent.click(screen.getByRole("button", { name: "Create site" }));

    await waitFor(() => expect(postCalls(fetchMock, "/api/sites").length).toBe(1));
    const [, opts] = postCalls(fetchMock, "/api/sites")[0];
    const body = JSON.parse(opts!.body as string);
    expect(body.slug).toBe("muldoon-dental");
    expect(body.display_name).toBe("Muldoon Dental");
    expect(body.default_brand_tokens["--theme-main"]).toMatch(/^#[0-9a-f]{6}$/i);

    await waitFor(() =>
      expect(screen.getByText(/path=\/sites\/muldoon-dental\/manage/)).toBeTruthy(),
    );
  });

  it("template-only: selecting a template card (no prompt) creates from-template, polls for pages, and navigates to /manage", async () => {
    const fetchMock = routeFetch({ templates: [{ id: "tpl-starter", name: "Starter", description: "x", category: "General" }] });
    global.fetch = fetchMock as unknown as typeof fetch;
    renderPage();

    await waitFor(() => expect(screen.getByText("Starter")).toBeTruthy());
    fireEvent.click(screen.getByText("Starter"));

    const primary = await screen.findByRole("button", { name: "Create site" });
    expect((primary as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(primary);

    await waitFor(() => expect(postCalls(fetchMock, "/api/sites/from-template").length).toBe(1));
    const [, opts] = postCalls(fetchMock, "/api/sites/from-template")[0];
    const body = JSON.parse(opts!.body as string);
    expect(body).toMatchObject({ slug: "starter", display_name: "Starter", template_id: "tpl-starter" });

    // Polls site detail (pages_count) before navigating.
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === "/api/sites/s9")).toBe(true));
    await waitFor(() => expect(screen.getByText(/path=\/sites\/starter\/manage/)).toBeTruthy());
  });

  it("ai-only: typing a prompt with no template creates a blank site (no brand tokens), starts a job-run conversation, and navigates to ?ai=1", async () => {
    const fetchMock = routeFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    renderPage();

    typePrompt("A dental clinic site with services and contact page.");
    const primary = await screen.findByRole("button", { name: "Build with AI" });
    fireEvent.click(primary);

    await waitFor(() => expect(screen.getByText(/site route reached: a-dental-clinic-site-with-services-and-contact-page/)).toBeTruthy());
    expect(screen.getByText(/search=\?ai=1/)).toBeTruthy();

    const siteCalls = postCalls(fetchMock, "/api/sites");
    expect(siteCalls.length).toBe(1);
    const siteBody = JSON.parse(siteCalls[0][1]!.body as string);
    expect(siteBody.default_brand_tokens).toBeUndefined();

    const convCalls = postCalls(fetchMock, "/api/sites/s1/agent/conversations");
    expect(convCalls.length).toBe(1);
    expect(JSON.parse(convCalls[0][1]!.body as string)).toEqual({
      title: "Initial build",
      message: "A dental clinic site with services and contact page.",
      run: "job",
    });
  });

  it("template + prompt (compose): creates from-template, polls for pages, THEN starts a conversation with the prompt, and navigates to ?ai=1", async () => {
    const fetchMock = routeFetch({ templates: [{ id: "tpl-starter", name: "Starter" }] });
    global.fetch = fetchMock as unknown as typeof fetch;
    renderPage();

    await waitFor(() => expect(screen.getByText("Starter")).toBeTruthy());
    typePrompt("A warm family dental practice — home, services, contact.");
    fireEvent.click(screen.getByText("Starter"));

    const primary = await screen.findByRole("button", { name: "Build with AI" });
    fireEvent.click(primary);

    await waitFor(() => expect(postCalls(fetchMock, "/api/sites/from-template").length).toBe(1));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === "/api/sites/s9")).toBe(true));

    await waitFor(() => expect(postCalls(fetchMock, "/api/sites/s9/agent/conversations").length).toBe(1));
    expect(JSON.parse(postCalls(fetchMock, "/api/sites/s9/agent/conversations")[0][1]!.body as string)).toEqual({
      title: "Initial build",
      message: "A warm family dental practice — home, services, contact.",
      run: "job",
    });

    // template-create must precede conversation-create.
    const fromTplIdx = fetchMock.mock.calls.findIndex(([u, o]) => u === "/api/sites/from-template" && ((o as RequestInit | undefined)?.method ?? "").toUpperCase() === "POST");
    const convIdx = fetchMock.mock.calls.findIndex(([u, o]) => u === "/api/sites/s9/agent/conversations" && ((o as RequestInit | undefined)?.method ?? "").toUpperCase() === "POST");
    expect(fromTplIdx).toBeGreaterThanOrEqual(0);
    expect(fromTplIdx).toBeLessThan(convIdx);

    await waitFor(() => expect(screen.getByText(/search=\?ai=1/)).toBeTruthy());
  });

  it("template + prompt: keeps the site and navigates with ?ai_error=1 when the conversation POST fails", async () => {
    const fetchMock = routeFetch({
      templates: [{ id: "tpl-starter", name: "Starter" }],
      aiConversation: () => json({ error: "job queue unavailable" }, 503),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    renderPage();

    await waitFor(() => expect(screen.getByText("Starter")).toBeTruthy());
    typePrompt("A warm family dental practice.");
    fireEvent.click(screen.getByText("Starter"));
    fireEvent.click(await screen.findByRole("button", { name: "Build with AI" }));

    await waitFor(() => expect(screen.getByText(/search=\?ai=1&ai_error=1/)).toBeTruthy());
    expect(screen.queryByText(/already in use/)).toBeNull();
  });

  it("surfaces a duplicate-slug 409 inline instead of navigating", async () => {
    global.fetch = routeFetch({ createSite: () => json({ error: "slug already in use" }, 409) }) as unknown as typeof fetch;
    renderPage();

    fireEvent.click(screen.getByText("Start blank"));
    openDetails();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Acme Co" } });
    fireEvent.click(screen.getByRole("button", { name: "Create site" }));

    await waitFor(() => expect(screen.getByText(/already in use/)).toBeTruthy());
  });
});
