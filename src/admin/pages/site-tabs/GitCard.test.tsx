// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { GitCard } from "./GitCard.js";
import { setAdminToken, clearAdminToken } from "../../lib/adminToken.js";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const UNCONFIGURED = { configured: false, repo: null, state: null };

const ENABLED_STATE = {
  site_id: "s1",
  enabled: true,
  last_export_sha: "abcdef1234567890",
  last_import_sha: "1234567abcdef000",
  last_synced_at: new Date().toISOString(),
  last_error: null,
  updated_at: new Date().toISOString(),
};

const CONFIGURED_ENABLED = { configured: true, repo: "acme/content", state: ENABLED_STATE };

describe("GitCard (GitHub sync Task 7)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("shows a muted note when git sync isn't configured server-side", async () => {
    global.fetch = vi.fn(async () => json(UNCONFIGURED)) as unknown as typeof fetch;
    render(<GitCard siteId="s1" slug="acme" />);
    await waitFor(() =>
      expect(screen.getByText(/GitHub sync isn't configured/)).toBeTruthy(),
    );
    expect(screen.getByText(/docs\/github-sync\.md/)).toBeTruthy();
    // No enable/export affordances when there's nothing they could do.
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Export now" })).toBeNull();
  });

  it("renders export/import shas, relative time, and a repo link when configured + enabled", async () => {
    global.fetch = vi.fn(async () => json(CONFIGURED_ENABLED)) as unknown as typeof fetch;
    render(<GitCard siteId="s1" slug="acme" />);

    await waitFor(() => expect(screen.getByText(/Exported abcdef1/)).toBeTruthy());
    expect(screen.getByText(/Imported 1234567/)).toBeTruthy();
    expect(screen.getByText("enabled")).toBeTruthy();

    const link = screen.getByRole("link", { name: "acme/content" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://github.com/acme/content/tree/main/sites/acme");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("shows a last_error line in red when present", async () => {
    global.fetch = vi.fn(async () =>
      json({
        ...CONFIGURED_ENABLED,
        state: { ...ENABLED_STATE, last_error: "github export failed: 500" },
      }),
    ) as unknown as typeof fetch;
    render(<GitCard siteId="s1" slug="acme" />);
    await waitFor(() => expect(screen.getByText("github export failed: 500")).toBeTruthy());
    expect(screen.getByText("github export failed: 500").className).toContain("text-red-600");
  });

  it("Export now fires a POST to the export endpoint", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/git/export" && method === "POST") {
        return json({ queued: true }, 202);
      }
      return json(CONFIGURED_ENABLED);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<GitCard siteId="s1" slug="acme" />);
    await waitFor(() => expect(screen.getByText(/Exported abcdef1/)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Export now" }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (c) => String(c[0]) === "/api/sites/s1/git/export" && (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeTruthy();
    });
  });

  it("Enable/Disable toggle fires a POST with the flipped enabled value", async () => {
    let getCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/git/enable" && method === "POST") {
        return json({ state: { ...ENABLED_STATE, enabled: false } });
      }
      getCount += 1;
      return json(
        getCount === 1
          ? CONFIGURED_ENABLED
          : { ...CONFIGURED_ENABLED, state: { ...ENABLED_STATE, enabled: false } },
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<GitCard siteId="s1" slug="acme" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Disable" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (c) => String(c[0]) === "/api/sites/s1/git/enable" && (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      const body = JSON.parse((postCall![1] as RequestInit).body as string);
      expect(body).toEqual({ enabled: false });
    });
  });

  it("disables Export now while sync is configured but not yet enabled", async () => {
    global.fetch = vi.fn(async () =>
      json({ configured: true, repo: "acme/content", state: null }),
    ) as unknown as typeof fetch;
    render(<GitCard siteId="s1" slug="acme" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Enable" })).toBeTruthy());
    expect((screen.getByRole("button", { name: "Export now" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
