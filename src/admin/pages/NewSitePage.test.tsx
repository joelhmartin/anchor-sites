// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import { NewSitePage, composeSeedMessage } from "./NewSitePage.js";
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

const DETAIL_PAGES = [
  { slug: "home", title: "Home" },
  { slug: "about", title: "About" },
];

/** URL-routing fetch mock — the page fetches /api/templates on mount, so a
 * blanket mock that returns the create response for everything would corrupt
 * the templates list — route by url + method instead. */
function routeFetch(
  overrides: Partial<{
    fromTemplate: () => Response | Promise<Response>;
    createSite: () => Response;
    aiConversation: () => Response;
    retryMaterialize: () => Response;
    templates: TemplateOpt[];
  }> = {},
) {
  const templates =
    overrides.templates ?? [
      { id: "tpl-starter", name: "Starter", description: "A simple starter site.", category: "General", pages_count: 2 },
    ];
  return vi.fn(async (url: string, opts?: RequestInit) => {
    const method = (opts?.method ?? "GET").toUpperCase();
    if (url.startsWith("/api/templates?")) return json({ templates });
    if (/^\/api\/templates\/[^/]+\/preview-token$/.test(url) && method === "POST")
      return json({ token: "ptv1.x.9999999999.sig", expires_at: new Date(Date.now() + 900_000).toISOString() });
    if (url.startsWith("/api/templates/")) {
      const id = url.split("/")[3];
      const tpl = templates.find((t) => t.id === id);
      return tpl ? json({ template: tpl, pages: DETAIL_PAGES }) : json({ error: "not found" }, 404);
    }
    if (url === "/api/sites" && method === "POST")
      return overrides.createSite ? overrides.createSite() : json({ site: { id: "s1", slug: "x" } }, 201);
    if (url === "/api/sites/from-template" && method === "POST")
      return overrides.fromTemplate ? overrides.fromTemplate() : json({ site: { id: "s9" }, job: { queued: true } }, 201);
    if (/\/materialize-template$/.test(url) && method === "POST")
      return overrides.retryMaterialize ? overrides.retryMaterialize() : json({ job: { queued: true } }, 202);
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
  fireEvent.change(screen.getByLabelText("Describe the site to build"), {
    target: { value: text },
  });
}

const actionBar = () => screen.getByTestId("new-site-action-bar");

/** Arm a template via the per-card "Use" fast path (no dialog). */
async function useTemplate(name: string) {
  await waitFor(() => expect(screen.getByRole("button", { name: `Use ${name}` })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: `Use ${name}` }));
}

describe("NewSitePage (W1.1, 2026-07-30 product-audit remediation)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("renders the hero prompt (with an accessible name, D212) and a gallery with cover fallback, category chip, pages count, and a trailing 'Start blank' card", async () => {
    global.fetch = routeFetch({
      templates: [
        { id: "tpl-a", name: "Dental Practice", description: "Warm, modern dental site.", category: "Healthcare", pages_count: 5 },
      ],
    }) as unknown as typeof fetch;
    renderPage();

    expect(screen.getByText("What do you want to build?")).toBeTruthy();
    expect(screen.getByLabelText("Describe the site to build")).toBeTruthy();

    await waitFor(() => expect(screen.getByText("Dental Practice")).toBeTruthy());
    expect(screen.getByText("Warm, modern dental site.")).toBeTruthy();
    expect(screen.getByText("Healthcare")).toBeTruthy();
    // D714/D205 — pages_count reaches the card.
    expect(screen.getByText("5 pages")).toBeTruthy();

    // Cover-fallback branch: no cover_image_url → branded initials block with
    // real alt text (D714), not a broken <img>.
    expect(screen.getByRole("img", { name: "Dental Practice template cover" })).toBeTruthy();

    const allButtons = screen.getAllByRole("button");
    const dentalIdx = allButtons.findIndex((c) => c.textContent?.includes("Dental Practice"));
    const blankIdx = allButtons.findIndex((c) => c.textContent?.includes("Start blank"));
    expect(dentalIdx).toBeGreaterThanOrEqual(0);
    expect(blankIdx).toBeGreaterThan(dentalIdx);
  });

  it("keeps the primary action disabled (with a stated reason, D202) until a name/slug is available, and validates the slug in Details", async () => {
    global.fetch = routeFetch() as unknown as typeof fetch;
    renderPage();

    const primary = screen.getByRole("button", { name: "Create site" }) as HTMLButtonElement;
    expect(primary.disabled).toBe(true);
    expect(screen.getByText("Describe the site, pick a template, or start blank")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "Not A Slug" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Acme Co" } });
    expect(screen.getByText(/Lowercase letters, numbers, and hyphens only/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create site" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "acme-co" } });
    expect((screen.getByRole("button", { name: "Create site" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("hides the Details echo until there is a name to echo (D219)", async () => {
    global.fetch = routeFetch() as unknown as typeof fetch;
    renderPage();
    const toggle = screen.getByRole("button", { name: /Details/ });
    expect(toggle.textContent).not.toContain("Untitled");
    expect(toggle.textContent).not.toContain("—");
    typePrompt("Acme Co");
    expect(screen.getByRole("button", { name: /Details/ }).textContent).toContain("Acme Co · acme-co");
  });

  it("blank (D203/D204): 'Start blank' auto-opens Details and focuses the name; submit POSTs /api/sites with brand-token defaults and navigates to the workspace", async () => {
    const fetchMock = routeFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    renderPage();

    await waitFor(() => expect(screen.getByText("Start blank")).toBeTruthy());
    fireEvent.click(screen.getByText("Start blank"));
    // D203 — details opened + name focused without hunting for the toggle.
    const nameInput = await screen.findByLabelText("Display name");
    await waitFor(() => expect(document.activeElement).toBe(nameInput));

    fireEvent.change(nameInput, { target: { value: "Muldoon Dental" } });

    // D200 — the armed state is a sticky bar; its create button submits.
    const bar = actionBar();
    expect(bar.textContent).toContain("Start blank selected");
    fireEvent.click(within(bar).getByRole("button", { name: "Create site" }));

    await waitFor(() => expect(postCalls(fetchMock, "/api/sites").length).toBe(1));
    const [, opts] = postCalls(fetchMock, "/api/sites")[0];
    const body = JSON.parse(opts!.body as string);
    expect(body.slug).toBe("muldoon-dental");
    expect(body.display_name).toBe("Muldoon Dental");
    expect(body.default_brand_tokens["--theme-main"]).toMatch(/^#[0-9a-f]{6}$/i);

    await waitFor(() =>
      expect(screen.getByText(/path=\/sites\/muldoon-dental(?!\/manage)/)).toBeTruthy(),
    );
  });

  it("card click selects (aria-pressed, D211) and opens the detail dialog with the page manifest (D205)", async () => {
    global.fetch = routeFetch() as unknown as typeof fetch;
    renderPage();

    await waitFor(() => expect(screen.getByText("Starter")).toBeTruthy());
    fireEvent.click(screen.getByText("Starter"));

    // Detail dialog: title, manifest from GET /api/templates/:id.
    expect(screen.getByRole("dialog", { name: "Starter" })).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByText("About")).toBeTruthy());
    expect(within(screen.getByRole("dialog")).getByText("2 pages")).toBeTruthy();

    // Selected state is programmatic (checked after closing the modal —
    // Radix aria-hides the background while it's open).
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const card = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("A simple starter site.") && b.getAttribute("aria-pressed") !== null);
    expect(card?.getAttribute("aria-pressed")).toBe("true");
  });

  it("dialog 'Use this template' closes the dialog and arms the sticky action bar with a selection echo (D200/D202)", async () => {
    global.fetch = routeFetch() as unknown as typeof fetch;
    renderPage();

    await waitFor(() => expect(screen.getByText("Starter")).toBeTruthy());
    fireEvent.click(screen.getByText("Starter"));
    fireEvent.click(await screen.findByRole("button", { name: "Use this template" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const bar = actionBar();
    expect(bar.textContent).toContain("“Starter” selected");
    const create = within(bar).getByRole("button", { name: "Create from Starter" }) as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(create));
  });

  it("template-only (D213): creating navigates to the workspace IMMEDIATELY with a materializing hand-off — no blind poll", async () => {
    const fetchMock = routeFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    renderPage();

    await useTemplate("Starter");
    fireEvent.click(within(actionBar()).getByRole("button", { name: "Create from Starter" }));

    await waitFor(() => expect(postCalls(fetchMock, "/api/sites/from-template").length).toBe(1));
    const [, opts] = postCalls(fetchMock, "/api/sites/from-template")[0];
    expect(JSON.parse(opts!.body as string)).toMatchObject({
      slug: "starter",
      display_name: "Starter",
      template_id: "tpl-starter",
    });

    await waitFor(() => expect(screen.getByText(/path=\/sites\/starter(?!\/manage)/)).toBeTruthy());
    expect(screen.getByText(/search=\?materializing=2&template=Starter/)).toBeTruthy();
    // No client-side pages poll on this path anymore.
    expect(fetchMock.mock.calls.some(([u]) => u === "/api/sites/s9")).toBe(false);
  });

  it("double-click fires exactly one create POST (D207)", async () => {
    let resolveCreate!: (r: Response) => void;
    const fetchMock = routeFetch({
      fromTemplate: () => new Promise<Response>((r) => (resolveCreate = r)),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    renderPage();

    await useTemplate("Starter");
    const create = within(actionBar()).getByRole("button", { name: "Create from Starter" });
    fireEvent.click(create);
    fireEvent.click(create);
    fireEvent.click(create);

    resolveCreate(json({ site: { id: "s9" }, job: { queued: true } }, 201));
    await waitFor(() => expect(screen.getByText(/path=\/sites\/starter/)).toBeTruthy());
    expect(postCalls(fetchMock, "/api/sites/from-template").length).toBe(1);
  });

  it("enqueue failure (D208/D703): surfaces the error with a Retry that re-enqueues and then navigates", async () => {
    const fetchMock = routeFetch({
      fromTemplate: () => json({ site: { id: "s9" }, job: { queued: false, error: "queue down" } }, 201),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    renderPage();

    await useTemplate("Starter");
    fireEvent.click(within(actionBar()).getByRole("button", { name: "Create from Starter" }));

    await waitFor(() => expect(screen.getByText(/pages failed to queue/)).toBeTruthy());
    expect(screen.getByText("queue down")).toBeTruthy();
    // Did NOT navigate as if everything worked.
    expect(screen.queryByText(/site route reached/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, o]) => u === "/api/sites/s9/materialize-template" && (o as RequestInit)?.method === "POST")).toBe(true),
    );
    await waitFor(() => expect(screen.getByText(/path=\/sites\/starter/)).toBeTruthy());
    expect(screen.getByText(/search=\?materializing=2&template=Starter/)).toBeTruthy();
  });

  it("ai-only: typing a prompt with no selection creates a blank site WITH the default brand-token baseline (D1100), starts a job-run conversation, and navigates to ?ai=1", async () => {
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
    // W1.5 / D1100: a prompt-only build used to withhold the tokens entirely
    // (leaving the site unthemed unless the model volunteered a palette) —
    // now the default baseline always ships and the agent adapts it.
    expect(siteBody.default_brand_tokens["--theme-main"]).toMatch(/^#[0-9a-f]{6}$/i);

    const convCalls = postCalls(fetchMock, "/api/sites/s1/agent/conversations");
    expect(convCalls.length).toBe(1);
    expect(JSON.parse(convCalls[0][1]!.body as string)).toEqual({
      title: "Initial build",
      message: "A dental clinic site with services and contact page.",
      run: "job",
    });
  });

  it("compose (D1107): waits for pages to land, THEN starts a conversation whose seed message says the template was already applied", async () => {
    const fetchMock = routeFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    renderPage();

    typePrompt("A warm family dental practice — home, services, contact.");
    await useTemplate("Starter");

    fireEvent.click(within(actionBar()).getByRole("button", { name: "Build with AI" }));

    await waitFor(() => expect(postCalls(fetchMock, "/api/sites/from-template").length).toBe(1));
    // Materialization poll happens on the compose path.
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === "/api/sites/s9")).toBe(true));

    await waitFor(() => expect(postCalls(fetchMock, "/api/sites/s9/agent/conversations").length).toBe(1));
    const convBody = JSON.parse(postCalls(fetchMock, "/api/sites/s9/agent/conversations")[0][1]!.body as string);
    expect(convBody.message).toBe(
      composeSeedMessage("Starter", "A warm family dental practice — home, services, contact."),
    );
    expect(convBody.message).toContain('The template "Starter" was already applied');

    // template-create must precede conversation-create.
    const fromTplIdx = fetchMock.mock.calls.findIndex(([u, o]) => u === "/api/sites/from-template" && ((o as RequestInit | undefined)?.method ?? "").toUpperCase() === "POST");
    const convIdx = fetchMock.mock.calls.findIndex(([u, o]) => u === "/api/sites/s9/agent/conversations" && ((o as RequestInit | undefined)?.method ?? "").toUpperCase() === "POST");
    expect(fromTplIdx).toBeGreaterThanOrEqual(0);
    expect(fromTplIdx).toBeLessThan(convIdx);

    await waitFor(() => expect(screen.getByText(/search=\?ai=1/)).toBeTruthy());
  });

  it("compose: keeps the site and navigates with ?ai_error=1 when the conversation POST fails", async () => {
    const fetchMock = routeFetch({
      aiConversation: () => json({ error: "job queue unavailable" }, 503),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    renderPage();

    typePrompt("A warm family dental practice.");
    await useTemplate("Starter");
    fireEvent.click(within(actionBar()).getByRole("button", { name: "Build with AI" }));

    await waitFor(() => expect(screen.getByText(/search=\?ai=1&ai_error=1/)).toBeTruthy());
    expect(screen.queryByText(/already in use/)).toBeNull();
  });

  it("surfaces a duplicate-slug 409 inline AND opens Details with the slug focused (D209)", async () => {
    global.fetch = routeFetch({ createSite: () => json({ error: "slug already in use" }, 409) }) as unknown as typeof fetch;
    renderPage();

    await waitFor(() => expect(screen.getByText("Start blank")).toBeTruthy());
    fireEvent.click(screen.getByText("Start blank"));
    const nameInput = await screen.findByLabelText("Display name");
    fireEvent.change(nameInput, { target: { value: "Acme Co" } });
    fireEvent.click(within(actionBar()).getByRole("button", { name: "Create site" }));

    await waitFor(() => expect(screen.getByText(/already in use/)).toBeTruthy());
    const slugInput = screen.getByLabelText("Slug");
    await waitFor(() => expect(document.activeElement).toBe(slugInput));
  });

  it("gallery states (D210): loading skeletons, then error-with-retry, then content", async () => {
    let call = 0;
    let resolveFirst!: (r: Response) => void;
    global.fetch = vi.fn((url: string) => {
      if (url.startsWith("/api/templates?")) {
        call++;
        if (call === 1) return new Promise<Response>((r) => (resolveFirst = r));
        return Promise.resolve(json({ templates: [{ id: "t1", name: "Starter", pages_count: 1 }] }));
      }
      return Promise.resolve(json({}));
    }) as unknown as typeof fetch;
    renderPage();

    // Loading → skeletons.
    expect(screen.getByTestId("template-skeletons")).toBeTruthy();

    // Error → message + Retry.
    resolveFirst(json({ error: "boom" }, 500));
    await waitFor(() => expect(screen.getByText(/Couldn't load templates/)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Starter")).toBeTruthy());
  });

  it("gallery empty state (D210): loaded-and-empty is stated, not blank", async () => {
    global.fetch = routeFetch({ templates: [] }) as unknown as typeof fetch;
    renderPage();
    await waitFor(() => expect(screen.getByText(/No templates yet/)).toBeTruthy());
  });

  it("category filter row (D222/D715): counts, 'All' default, filtering", async () => {
    global.fetch = routeFetch({
      templates: [
        { id: "t1", name: "Dental", category: "Medical", pages_count: 1 },
        { id: "t2", name: "Ortho", category: "Medical", pages_count: 1 },
        { id: "t3", name: "Bistro", category: "Restaurant", pages_count: 1 },
      ],
    }) as unknown as typeof fetch;
    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: "All (3)" })).toBeTruthy());
    expect((screen.getByRole("button", { name: "All (3)" }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Medical (2)" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Restaurant (1)" }));
    expect(screen.queryByText("Dental")).toBeNull();
    expect(screen.getByText("Bistro")).toBeTruthy();
  });

  it("no filter row when every template shares one category", async () => {
    global.fetch = routeFetch({
      templates: [
        { id: "t1", name: "Dental", category: "Medical", pages_count: 1 },
        { id: "t2", name: "Ortho", category: "Medical", pages_count: 1 },
      ],
    }) as unknown as typeof fetch;
    renderPage();
    await waitFor(() => expect(screen.getByText("Dental")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "All (2)" })).toBeNull();
  });

  it("dialog 'Preview' opens the full-screen overlay; its 'Use this template' arms the selection", async () => {
    global.fetch = routeFetch() as unknown as typeof fetch;
    renderPage();

    await waitFor(() => expect(screen.getByText("Starter")).toBeTruthy());
    fireEvent.click(screen.getByText("Starter"));
    const dialog = await screen.findByRole("dialog", { name: "Starter" });
    await waitFor(() =>
      expect((within(dialog).getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview" }));

    const overlay = await screen.findByRole("dialog", { name: "Preview of Starter" });
    await waitFor(() => {
      const iframe = within(overlay).getByTitle("Starter preview") as HTMLIFrameElement;
      expect(iframe.getAttribute("src")).toContain("/api/templates/tpl-starter/preview/home?token=");
    });

    fireEvent.click(within(overlay).getByRole("button", { name: "Use this template" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Preview of Starter" })).toBeNull());
    expect(actionBar().textContent).toContain("“Starter” selected");
  });
});
