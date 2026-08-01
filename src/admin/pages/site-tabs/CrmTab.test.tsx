// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CrmTab } from "./CrmTab.js";
import type { SiteDetail } from "../../lib/siteTypes.js";
import { setAdminToken, clearAdminToken } from "../../lib/adminToken.js";

const BASE_SITE: SiteDetail = {
  id: "site-crm-test",
  slug: "crm-test",
  display_name: "CRM Test Site",
  status: "active",
  default_brand_tokens: {},
  crm_site_id: null,
  ctm_account_id: null,
  created_at: "2026-06-29T00:00:00Z",
  pages_count: 0,
  media_count: 0,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// D427 — CrmTab now also renders the GitCard, which fetches `/git` on mount.
// Keep it unconfigured (a muted note, no loading spinner) so these CRM-focused
// tests aren't perturbed by it.
const GIT_UNCONFIGURED = { configured: false, repo: null, state: null };
function isGit(input: RequestInfo | URL) {
  return String(input).endsWith("/git");
}

describe("CrmTab (P11-T11.8)", () => {
  const realFetch = global.fetch;

  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
  });

  it("shows an operator-appropriate unprovisioned state with a retry action (D425)", () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) =>
      isGit(input) ? json(GIT_UNCONFIGURED) : json({ phone_numbers: [] }),
    ) as unknown as typeof fetch;
    render(<CrmTab site={BASE_SITE} />);
    expect(screen.getByText(/isn't connected to anchor-hub yet/i)).toBeTruthy();
    // No infrastructure secret names leak into the product surface.
    expect(screen.queryByText(/CRM_BASE_URL/)).toBeNull();
    expect(screen.queryByText(/CRM_API_KEY/)).toBeNull();
    expect(screen.getByRole("button", { name: /retry crm connection/i })).toBeTruthy();
  });

  it("posts to the CRM provision route when retry is clicked (D425)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      isGit(input) ? json(GIT_UNCONFIGURED) : json({ crm_site_id: "crm-new" }, 200),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<CrmTab site={BASE_SITE} />);
    fireEvent.click(screen.getByRole("button", { name: /retry crm connection/i }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.find(
          (c) => String(c[0]) === `/api/sites/${BASE_SITE.id}/crm/provision` &&
            (c[1] as RequestInit | undefined)?.method === "POST",
        ),
      ).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getByText(/connection requested/i)).toBeTruthy());
  });

  it("gives feedback when a tracking number is copied (D437)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const site = { ...BASE_SITE, crm_site_id: "crm-xyz" };
    global.fetch = vi.fn(async (input: RequestInfo | URL) =>
      isGit(input)
        ? json(GIT_UNCONFIGURED)
        : json({ phone_numbers: [{ id: "p1", number: "+15550001111", display: "(555) 000-1111" }] }),
    ) as unknown as typeof fetch;
    render(<CrmTab site={site} />);
    await waitFor(() => expect(screen.getByText("(555) 000-1111")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("+15550001111");
    await waitFor(() => expect(screen.getByText("Copied")).toBeTruthy());
  });

  it("shows crm_site_id when set", () => {
    const site = { ...BASE_SITE, crm_site_id: "crm-abc-123" };
    global.fetch = vi.fn(async (input: RequestInfo | URL) =>
      isGit(input) ? json(GIT_UNCONFIGURED) : json({ phone_numbers: [] }),
    ) as unknown as typeof fetch;
    render(<CrmTab site={site} />);
    expect(screen.getByText("crm-abc-123")).toBeTruthy();
  });

  it("shows loading state while fetching phone numbers", async () => {
    const site = { ...BASE_SITE, crm_site_id: "crm-xyz" };
    let resolve: (v: Response) => void;
    global.fetch = vi.fn((input: RequestInfo | URL) =>
      isGit(input)
        ? Promise.resolve(json(GIT_UNCONFIGURED))
        : new Promise<Response>((r) => { resolve = r; }),
    ) as unknown as typeof fetch;
    render(<CrmTab site={site} />);
    expect(screen.getByText(/loading…/i)).toBeTruthy();
    resolve!(json({ phone_numbers: [] }));
  });

  it("shows phone numbers when loaded", async () => {
    const site = { ...BASE_SITE, crm_site_id: "crm-xyz" };
    global.fetch = vi.fn(async (input: RequestInfo | URL) =>
      isGit(input)
        ? json(GIT_UNCONFIGURED)
        : json({ phone_numbers: [{ id: "p1", number: "+15550001111", display: "(555) 000-1111" }] }),
    ) as unknown as typeof fetch;
    render(<CrmTab site={site} />);
    await waitFor(() => expect(screen.getByText("(555) 000-1111")).toBeTruthy());
  });

  it("shows 'No tracking numbers' when list is empty", async () => {
    const site = { ...BASE_SITE, crm_site_id: "crm-xyz" };
    global.fetch = vi.fn(async (input: RequestInfo | URL) =>
      isGit(input) ? json(GIT_UNCONFIGURED) : json({ phone_numbers: [] }),
    ) as unknown as typeof fetch;
    render(<CrmTab site={site} />);
    await waitFor(() => expect(screen.getByText(/no tracking numbers/i)).toBeTruthy());
  });

  it("shows error state on fetch failure", async () => {
    const site = { ...BASE_SITE, crm_site_id: "crm-xyz" };
    global.fetch = vi.fn(async (input: RequestInfo | URL) =>
      isGit(input) ? json(GIT_UNCONFIGURED) : json({ error: "forbidden" }, 403),
    ) as unknown as typeof fetch;
    render(<CrmTab site={site} />);
    await waitFor(() => expect(screen.getByText(/couldn't load phone numbers/i)).toBeTruthy());
  });

  it("shows block usage notes always", () => {
    global.fetch = vi.fn(async () => json(GIT_UNCONFIGURED)) as unknown as typeof fetch;
    render(<CrmTab site={BASE_SITE} />);
    expect(screen.getByText(/PhoneNumber block/i)).toBeTruthy();
    expect(screen.getByText(/CRM Form block/i)).toBeTruthy();
  });

  it("hosts the CTM account ID field and GitHub sync in Integrations (D427)", async () => {
    const site = { ...BASE_SITE, ctm_account_id: "12345" };
    global.fetch = vi.fn(async (input: RequestInfo | URL) =>
      isGit(input) ? json(GIT_UNCONFIGURED) : json({ phone_numbers: [] }),
    ) as unknown as typeof fetch;
    render(<CrmTab site={site} />);
    // CTM field moved here from Settings.
    expect((screen.getByLabelText("CTM account ID") as HTMLInputElement).value).toBe("12345");
    // GitHub sync card is here too.
    await waitFor(() => expect(screen.getByText(/GitHub sync/)).toBeTruthy());
  });
});
