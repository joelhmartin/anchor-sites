// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { SettingsTab } from "./SettingsTab.js";
import { setAdminToken, clearAdminToken } from "../../lib/adminToken.js";
import type { SiteDetail } from "../../lib/siteTypes.js";

const SITE: SiteDetail = {
  id: "s1",
  slug: "acme",
  display_name: "Acme Dental",
  status: "active",
  default_brand_tokens: { "--theme-main": "#0a3d62" },
  created_at: "2026-05-18T00:00:00Z",
  pages_count: 2,
  media_count: 0,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("SettingsTab (P4-T4.15)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("loads the current display name and the site's brand-color value", () => {
    render(<SettingsTab site={SITE} />);
    expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe("Acme Dental");
    // The site's --theme-main overrides the default in the Main color picker.
    expect((screen.getByLabelText("Main") as HTMLInputElement).value).toBe("#0a3d62");
    // Read-only hostname shown.
    expect(screen.getByText("acme.sites.anchorcorps.com")).toBeTruthy();
  });

  it("Save is disabled until something changes, then PATCHes only the diff", async () => {
    const fetchMock = vi.fn(async () => json({ site: { ...SITE, display_name: "Acme Dental Group" } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<SettingsTab site={SITE} />);
    const save = () => screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Acme Dental Group" } });
    expect(save().disabled).toBe(false);
    fireEvent.click(save());

    await waitFor(() => expect(screen.getByText("Saved.")).toBeTruthy());
    const [path, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/sites/s1");
    expect(opts.method).toBe("PATCH");
    // Only the changed field is sent — colors weren't touched.
    expect(JSON.parse(opts.body as string)).toEqual({ display_name: "Acme Dental Group" });
  });

  it("includes brand tokens in the diff when a color changes", async () => {
    const fetchMock = vi.fn(async () => json({ site: SITE }));
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<SettingsTab site={SITE} />);
    fireEvent.change(screen.getByLabelText("Main"), { target: { value: "#112233" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.display_name).toBeUndefined();
    expect(body.default_brand_tokens["--theme-main"]).toBe("#112233");
  });

  it("surfaces a save validation error", async () => {
    global.fetch = vi.fn(async () => json({ error: "invalid payload" }, 400)) as unknown as typeof fetch;
    render(<SettingsTab site={SITE} />);
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText(/invalid payload/)).toBeTruthy());
  });
});
