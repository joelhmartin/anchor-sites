// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
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

describe("CrmTab (P11-T11.8)", () => {
  const realFetch = global.fetch;

  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
  });

  it("shows 'not provisioned' when crm_site_id is null", () => {
    render(<CrmTab site={BASE_SITE} />);
    expect(screen.getByText(/not been provisioned/i)).toBeTruthy();
  });

  it("shows crm_site_id when set", () => {
    const site = { ...BASE_SITE, crm_site_id: "crm-abc-123" };
    global.fetch = vi.fn().mockResolvedValue(json({ phone_numbers: [] }));
    render(<CrmTab site={site} />);
    expect(screen.getByText("crm-abc-123")).toBeTruthy();
  });

  it("shows loading state while fetching phone numbers", async () => {
    const site = { ...BASE_SITE, crm_site_id: "crm-xyz" };
    let resolve: (v: Response) => void;
    global.fetch = vi.fn().mockReturnValue(new Promise<Response>((r) => { resolve = r; }));
    render(<CrmTab site={site} />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
    resolve!(json({ phone_numbers: [] }));
  });

  it("shows phone numbers when loaded", async () => {
    const site = { ...BASE_SITE, crm_site_id: "crm-xyz" };
    global.fetch = vi.fn().mockResolvedValue(
      json({ phone_numbers: [{ id: "p1", number: "+15550001111", display: "(555) 000-1111" }] }),
    );
    render(<CrmTab site={site} />);
    await waitFor(() => expect(screen.getByText("(555) 000-1111")).toBeTruthy());
  });

  it("shows 'No tracking numbers' when list is empty", async () => {
    const site = { ...BASE_SITE, crm_site_id: "crm-xyz" };
    global.fetch = vi.fn().mockResolvedValue(json({ phone_numbers: [] }));
    render(<CrmTab site={site} />);
    await waitFor(() => expect(screen.getByText(/no tracking numbers/i)).toBeTruthy());
  });

  it("shows error state on fetch failure", async () => {
    const site = { ...BASE_SITE, crm_site_id: "crm-xyz" };
    global.fetch = vi.fn().mockResolvedValue(json({ error: "forbidden" }, 403));
    render(<CrmTab site={site} />);
    await waitFor(() => expect(screen.getByText(/couldn't load/i)).toBeTruthy());
  });

  it("shows block usage notes always", () => {
    render(<CrmTab site={BASE_SITE} />);
    expect(screen.getByText(/PhoneNumber block/i)).toBeTruthy();
    expect(screen.getByText(/CRM Form block/i)).toBeTruthy();
  });
});
