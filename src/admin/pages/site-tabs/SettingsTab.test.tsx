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

// GitCard (GitHub sync Task 7) fetches `GET /api/sites/:siteId/git` on mount
// alongside every SettingsTab render — every fetch mock below has to answer
// that call too, or GitCard's useApi hook logs an unhandled "unconfigured"
// error state instead of the intended muted copy. Kept minimal (git sync
// disabled) since these tests aren't about GitCard's own behavior (see
// GitCard.test.tsx for that).
const GIT_UNCONFIGURED = { configured: false, repo: null, state: null };

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
    global.fetch = vi.fn(async () => json(GIT_UNCONFIGURED)) as unknown as typeof fetch;
    render(<SettingsTab site={SITE} />);
    expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe("Acme Dental");
    // The site's --theme-main overrides the default in the Main color picker.
    expect((screen.getByLabelText("Main") as HTMLInputElement).value).toBe("#0a3d62");
    // Read-only hostname shown.
    expect(screen.getByText("acme.sites.anchorcorps.com")).toBeTruthy();
  });

  it("Save is disabled until something changes, then PATCHes only the diff", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === "/api/sites/s1/git") return json(GIT_UNCONFIGURED);
      return json({ site: { ...SITE, display_name: "Acme Dental Group" } });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<SettingsTab site={SITE} />);
    const save = () => screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Acme Dental Group" } });
    expect(save().disabled).toBe(false);
    fireEvent.click(save());

    await waitFor(() => expect(screen.getByText("Saved.")).toBeTruthy());
    const patchCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")!;
    const [path, opts] = patchCall as unknown as [string, RequestInit];
    expect(path).toBe("/api/sites/s1");
    expect(opts.method).toBe("PATCH");
    // Only the changed field is sent — colors weren't touched.
    expect(JSON.parse(opts.body as string)).toEqual({ display_name: "Acme Dental Group" });
  });

  it("includes brand tokens in the diff when a color changes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === "/api/sites/s1/git") return json(GIT_UNCONFIGURED);
      return json({ site: SITE });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<SettingsTab site={SITE} />);
    fireEvent.change(screen.getByLabelText("Main"), { target: { value: "#112233" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sites/s1", expect.anything()));
    const patchCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")!;
    const body = JSON.parse((patchCall[1] as RequestInit).body as string);
    expect(body.display_name).toBeUndefined();
    expect(body.default_brand_tokens["--theme-main"]).toBe("#112233");
  });

  it("disarms Save after a successful save — no forever re-send (D422)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === "/api/sites/s1/git") return json(GIT_UNCONFIGURED);
      return json({ site: { ...SITE, display_name: "Renamed" } });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<SettingsTab site={SITE} />);
    const save = () => screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Renamed" } });
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText("Saved.")).toBeTruthy());
    // Baseline advanced → Save disarms; it can't keep re-sending the PATCH.
    expect(save().disabled).toBe(true);
    const patchCalls = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "PATCH");
    expect(patchCalls).toHaveLength(1);
  });

  it("D500/D409: Danger zone archives the site (confirm-gated) and calls onSiteChanged", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onSiteChanged = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === "/api/sites/s1/git") return json(GIT_UNCONFIGURED);
      return json({ site: { ...SITE, status: "archived" } });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<SettingsTab site={SITE} onSiteChanged={onSiteChanged} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive site" }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(onSiteChanged).toHaveBeenCalled());
    const patchCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/sites/s1" && (c[1] as RequestInit | undefined)?.method === "PATCH",
    )!;
    expect(JSON.parse((patchCall[1] as RequestInit).body as string)).toEqual({ status: "archived" });
  });

  it("D500/D409: an archived site shows Restore, not Archive", () => {
    global.fetch = vi.fn(async () => json(GIT_UNCONFIGURED)) as unknown as typeof fetch;
    render(<SettingsTab site={{ ...SITE, status: "archived" }} />);
    expect(screen.getByRole("button", { name: "Restore site" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Archive site" })).toBeNull();
  });

  it("surfaces a save validation error", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === "/api/sites/s1/git") return json(GIT_UNCONFIGURED);
      return json({ error: "invalid payload" }, 400);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<SettingsTab site={SITE} />);
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText(/invalid payload/)).toBeTruthy());
  });
});
