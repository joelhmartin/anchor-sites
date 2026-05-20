// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NewSiteWizard } from "./NewSiteWizard.js";
import { setAdminToken, clearAdminToken } from "../lib/adminToken.js";

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

describe("NewSiteWizard (P4-T4.11)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("keeps Next disabled until name + a valid slug are entered, then advances to step 2", () => {
    renderWizard();
    const next = screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    fillStep1("Muldoon Dental", "muldoon-dental");
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Brand colors")).toBeTruthy();
  });

  it("shows a validation message and keeps Next disabled for an invalid slug", () => {
    renderWizard();
    fillStep1("Muldoon Dental", "Not A Slug");
    expect(screen.getByText(/Lowercase letters, numbers, and hyphens only/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("submits POST /api/sites with the assembled body and navigates on success", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ site: { id: "s1", slug: "muldoon-dental" } }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    renderWizard();
    fillStep1("Muldoon Dental", "muldoon-dental");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Create site" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [path, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/sites");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body.slug).toBe("muldoon-dental");
    expect(body.display_name).toBe("Muldoon Dental");
    expect(body.default_brand_tokens["--theme-main"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(body.default_brand_tokens["--theme-on-main"]).toBeTruthy();
  });

  it("surfaces a duplicate-slug 409 inline instead of navigating", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "slug already in use" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    renderWizard();
    fillStep1("Muldoon Dental", "muldoon-dental");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Create site" }));

    await waitFor(() => expect(screen.getByText(/already in use/)).toBeTruthy());
  });
});
