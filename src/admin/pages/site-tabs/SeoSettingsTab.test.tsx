// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { SeoSettingsTab } from "./SeoSettingsTab.js";
import { setAdminToken, clearAdminToken } from "../../lib/adminToken.js";
import type { SiteDetail } from "../../lib/siteTypes.js";

const baseSite: SiteDetail = {
  id: "s1",
  slug: "acme",
  display_name: "Acme Dental",
  status: "active",
  default_brand_tokens: {},
  seo_defaults: {},
  created_at: "2026-06-01T00:00:00Z",
  pages_count: 1,
  media_count: 0,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("SeoSettingsTab (P9-T9.8)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("renders fields seeded from seo_defaults", () => {
    render(
      <SeoSettingsTab
        site={{ ...baseSite, seo_defaults: { titleTemplate: "%s — Acme", twitterHandle: "@acme" } }}
      />,
    );
    expect((screen.getByLabelText("Title template") as HTMLInputElement).value).toBe("%s — Acme");
    expect((screen.getByLabelText("Twitter handle") as HTMLInputElement).value).toBe("@acme");
  });

  it("Save is disabled until something changes", () => {
    render(<SeoSettingsTab site={baseSite} />);
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Title template"), { target: { value: "%s | Acme" } });
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("PATCHes only the populated seo_defaults fields", async () => {
    const fetchMock = vi.fn(async () => json({ site: { id: "s1" } }));
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<SeoSettingsTab site={baseSite} />);
    fireEvent.change(screen.getByLabelText("Title template"), { target: { value: "%s — Acme" } });
    fireEvent.change(screen.getByLabelText("Twitter handle"), { target: { value: "@acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/sites/s1");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body as string)).toEqual({
      seo_defaults: { titleTemplate: "%s — Acme", twitterHandle: "@acme" },
    });
    await screen.findByText("Saved.");
  });

  it("disarms Save after a successful save — no forever re-send (D422)", async () => {
    const fetchMock = vi.fn(async () => json({ site: { id: "s1" } }));
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<SeoSettingsTab site={baseSite} />);
    fireEvent.change(screen.getByLabelText("Title template"), { target: { value: "%s — Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved.");
    // Baseline advanced to the saved value → Save is disabled again, so a
    // second click can't re-send the same PATCH.
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
