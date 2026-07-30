// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import { NewSiteWizard } from "./NewSiteWizard.js";
import { setAdminToken, clearAdminToken } from "../lib/adminToken.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** URL-routing fetch mock. The wizard fetches /api/templates on mount, so a
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
  type TemplateOpt = { id: string; name: string; pages_count: number };
  const templates = overrides.templates ?? [{ id: "t1", name: "Starter", pages_count: 2 }];
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
type TemplateOpt = { id: string; name: string; pages_count: number };

/** Renders at /new (the wizard) with stubbed /sites/:slug and
 * /sites/:slug/manage destinations so navigation can be asserted the same
 * way PagesTab.test.tsx probes routes. `location.pathname` distinguishes
 * which of the two the wizard actually landed on (Task B2 — blank/template
 * flows now land on /manage, AI flows land on the plain workspace route). */
function RouteProbe() {
  const { slug } = useParams();
  const location = useLocation();
  return (
    <div>
      site route reached: {slug} path={location.pathname} search={location.search}
    </div>
  );
}

function renderWizard() {
  return render(
    <MemoryRouter initialEntries={["/new"]}>
      <Routes>
        <Route path="/new" element={<NewSiteWizard />} />
        <Route path="/sites/:slug" element={<RouteProbe />} />
        <Route path="/sites/:slug/manage" element={<RouteProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillStep1(displayName: string, slug: string) {
  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: displayName } });
  fireEvent.change(screen.getByLabelText("Slug"), { target: { value: slug } });
}

const postCalls = (m: ReturnType<typeof routeFetch>, path: string) =>
  m.mock.calls.filter(([u, o]) => u === path && (o?.method ?? "").toUpperCase() === "POST");

describe("NewSiteWizard (P4-T4.11 + P7-T7.8)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("keeps Next disabled until name + a valid slug are entered, then advances to step 2", () => {
    global.fetch = routeFetch() as unknown as typeof fetch;
    renderWizard();
    const next = screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    fillStep1("Muldoon Dental", "muldoon-dental");
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Brand colors")).toBeTruthy();
  });

  it("shows a validation message and keeps Next disabled for an invalid slug", () => {
    global.fetch = routeFetch() as unknown as typeof fetch;
    renderWizard();
    fillStep1("Muldoon Dental", "Not A Slug");
    expect(screen.getByText(/Lowercase letters, numbers, and hyphens only/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("blank site: submits POST /api/sites with the assembled body and navigates on success", async () => {
    const fetchMock = routeFetch();
    global.fetch = fetchMock as unknown as typeof fetch;

    renderWizard();
    fillStep1("Muldoon Dental", "muldoon-dental");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Create site" }));

    await waitFor(() => expect(postCalls(fetchMock, "/api/sites").length).toBe(1));
    const [, opts] = postCalls(fetchMock, "/api/sites")[0];
    const body = JSON.parse(opts!.body as string);
    expect(body.slug).toBe("muldoon-dental");
    expect(body.display_name).toBe("Muldoon Dental");
    expect(body.default_brand_tokens["--theme-main"]).toMatch(/^#[0-9a-f]{6}$/i);

    // Task B2: a blank site has no AI conversation to land in — goes
    // straight to the tab-based management shell, not the workspace.
    await waitFor(() =>
      expect(screen.getByText(/path=\/sites\/muldoon-dental\/manage/)).toBeTruthy(),
    );
  });

  it("blank site: surfaces a duplicate-slug 409 inline instead of navigating", async () => {
    global.fetch = routeFetch({ createSite: () => json({ error: "slug already in use" }, 409) }) as unknown as typeof fetch;

    renderWizard();
    fillStep1("Muldoon Dental", "muldoon-dental");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Create site" }));

    await waitFor(() => expect(screen.getByText(/already in use/)).toBeTruthy());
  });

  it("template: lists fetched templates and creates via /api/sites/from-template (no brand-colors step)", async () => {
    const fetchMock = routeFetch({ templates: [{ id: "tpl-starter", name: "Starter", pages_count: 2 }] });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderWizard();
    fillStep1("Acme Co", "acme-co");

    // The fetched template appears as an option; select it.
    await waitFor(() => expect(screen.getByRole("option", { name: /Starter/ })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Start from"), { target: { value: "tpl-starter" } });

    // No brand-colors step — create directly from step 1.
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create from template" }));

    await waitFor(() => expect(postCalls(fetchMock, "/api/sites/from-template").length).toBe(1));
    const [, opts] = postCalls(fetchMock, "/api/sites/from-template")[0];
    const body = JSON.parse(opts!.body as string);
    expect(body).toMatchObject({ slug: "acme-co", display_name: "Acme Co", template_id: "tpl-starter" });
    // It also polls site detail (pages_count) before navigating.
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === "/api/sites/s9")).toBe(true));
    // Task B2: same reasoning as the blank-site flow — lands on the
    // populated Pages tab (/manage), not the workspace.
    await waitFor(() => expect(screen.getByText(/path=\/sites\/acme-co\/manage/)).toBeTruthy());
  });

  it("template: surfaces a duplicate-slug 409 inline", async () => {
    global.fetch = routeFetch({ fromTemplate: () => json({ error: "slug already in use" }, 409) }) as unknown as typeof fetch;

    renderWizard();
    fillStep1("Acme Co", "acme-co");
    await waitFor(() => expect(screen.getByRole("option", { name: /Starter/ })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Start from"), { target: { value: "t1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create from template" }));

    await waitFor(() => expect(screen.getByText(/already in use/)).toBeTruthy());
  });

  it("ai: reveals a required description field and disables submit until filled", () => {
    global.fetch = routeFetch() as unknown as typeof fetch;
    renderWizard();
    fillStep1("Acme Co", "acme-co");
    fireEvent.change(screen.getByLabelText("Start from"), { target: { value: "ai" } });

    // No brand-colors step for AI mode either.
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    const create = screen.getByRole("button", { name: "Create with AI" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Describe the business/), {
      target: { value: "A dental clinic site with services and contact page." },
    });
    expect((screen.getByRole("button", { name: "Create with AI" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("ai: creates the site, kicks off a job-run conversation, and navigates to ?ai=1", async () => {
    const fetchMock = routeFetch();
    global.fetch = fetchMock as unknown as typeof fetch;

    renderWizard();
    fillStep1("Acme Co", "acme-co");
    fireEvent.change(screen.getByLabelText("Start from"), { target: { value: "ai" } });
    fireEvent.change(screen.getByLabelText(/Describe the business/), {
      target: { value: "A dental clinic site with services and contact page." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create with AI" }));

    await waitFor(() => expect(screen.getByText(/site route reached: acme-co/)).toBeTruthy());
    expect(screen.getByText(/search=\?ai=1/)).toBeTruthy();

    const siteCalls = postCalls(fetchMock, "/api/sites");
    expect(siteCalls.length).toBe(1);
    expect(JSON.parse(siteCalls[0][1]!.body as string)).toEqual({
      slug: "acme-co",
      display_name: "Acme Co",
    });

    const convCalls = postCalls(fetchMock, "/api/sites/s1/agent/conversations");
    expect(convCalls.length).toBe(1);
    expect(JSON.parse(convCalls[0][1]!.body as string)).toEqual({
      title: "Initial build",
      message: "A dental clinic site with services and contact page.",
      run: "job",
    });

    // Order matters: the site must exist before the conversation is created.
    const siteIdx = fetchMock.mock.calls.findIndex(
      ([u, o]) => u === "/api/sites" && ((o as RequestInit | undefined)?.method ?? "").toUpperCase() === "POST",
    );
    const convIdx = fetchMock.mock.calls.findIndex(
      ([u, o]) =>
        u === "/api/sites/s1/agent/conversations" &&
        ((o as RequestInit | undefined)?.method ?? "").toUpperCase() === "POST",
    );
    expect(siteIdx).toBeGreaterThanOrEqual(0);
    expect(siteIdx).toBeLessThan(convIdx);
  });

  it("ai: surfaces a duplicate-slug 409 inline instead of navigating", async () => {
    global.fetch = routeFetch({ createSite: () => json({ error: "slug already in use" }, 409) }) as unknown as typeof fetch;

    renderWizard();
    fillStep1("Acme Co", "acme-co");
    fireEvent.change(screen.getByLabelText("Start from"), { target: { value: "ai" } });
    fireEvent.change(screen.getByLabelText(/Describe the business/), {
      target: { value: "A dental clinic site." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create with AI" }));

    await waitFor(() => expect(screen.getByText(/already in use/)).toBeTruthy());
  });

  it("ai: navigates to ?ai=1&ai_error=1 instead of stranding the operator when the site was created but the conversation/job POST fails (item 8)", async () => {
    const fetchMock = routeFetch({ aiConversation: () => json({ error: "job queue unavailable" }, 503) });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderWizard();
    fillStep1("Acme Co", "acme-co");
    fireEvent.change(screen.getByLabelText("Start from"), { target: { value: "ai" } });
    fireEvent.change(screen.getByLabelText(/Describe the business/), {
      target: { value: "A dental clinic site with services and contact page." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create with AI" }));

    // Navigated anyway — the site exists — rather than showing a form error.
    await waitFor(() => expect(screen.getByText(/site route reached: acme-co/)).toBeTruthy());
    expect(screen.getByText(/search=\?ai=1&ai_error=1/)).toBeTruthy();
    expect(screen.queryByText(/already in use/)).toBeNull();

    // The site POST itself still only fired once — no retry loop.
    expect(postCalls(fetchMock, "/api/sites").length).toBe(1);
  });
});
