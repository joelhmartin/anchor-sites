// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NewSiteWizard } from "./NewSiteWizard.js";
import { setAdminToken, clearAdminToken } from "../lib/adminToken.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** URL-routing fetch mock. The wizard fetches /api/templates on mount, so a
 * blanket mock that returns the create response for everything would corrupt
 * the templates list — route by url + method instead. */
function routeFetch(overrides: Partial<{ fromTemplate: () => Response; createSite: () => Response; templates: TemplateOpt[] }> = {}) {
  type TemplateOpt = { id: string; name: string; pages_count: number };
  const templates = overrides.templates ?? [{ id: "t1", name: "Starter", pages_count: 2 }];
  return vi.fn(async (url: string, opts?: RequestInit) => {
    const method = (opts?.method ?? "GET").toUpperCase();
    if (url.startsWith("/api/templates")) return json({ templates });
    if (url === "/api/sites" && method === "POST")
      return overrides.createSite ? overrides.createSite() : json({ site: { id: "s1", slug: "x" } }, 201);
    if (url === "/api/sites/from-template" && method === "POST")
      return overrides.fromTemplate ? overrides.fromTemplate() : json({ site: { id: "s9" }, job: { queued: true } }, 201);
    if (url.startsWith("/api/sites/")) return json({ site: { pages_count: 2 } });
    return json({});
  });
}
type TemplateOpt = { id: string; name: string; pages_count: number };

function renderWizard() {
  return render(
    <MemoryRouter>
      <NewSiteWizard />
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
});
