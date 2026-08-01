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
  last_export_error: null,
  last_import_error: null,
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

  it("renders export/import shas, a repo link, and a Last synced line (not tied to export) when configured + enabled", async () => {
    global.fetch = vi.fn(async () => json(CONFIGURED_ENABLED)) as unknown as typeof fetch;
    render(<GitCard siteId="s1" slug="acme" />);

    await waitFor(() => expect(screen.getByText(/Exported abcdef1/)).toBeTruthy());
    expect(screen.getByText(/Imported 1234567/)).toBeTruthy();
    expect(screen.getByText(/Last synced/)).toBeTruthy();
    expect(screen.getByText("enabled")).toBeTruthy();

    const link = screen.getByRole("link", { name: "acme/content" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://github.com/acme/content/tree/main/sites/acme");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("labels the relative time 'Last synced' rather than implying it's specifically export time (fix round 2, Minor)", async () => {
    // last_export_sha is null (no export has ever run), but last_synced_at
    // is set because an IMPORT bumps the same column (state-repo.ts's
    // recordImport). The old copy read "Exported <sha> · <time>" only when
    // last_export_sha existed, but the reverse bug — an import's timestamp
    // being the only one available and getting attributed to "Exported" —
    // is what this line must not do: "Exported" must never appear without
    // an export sha, and the timestamp must be labeled on its own.
    global.fetch = vi.fn(async () =>
      json({
        configured: true,
        repo: "acme/content",
        state: { ...ENABLED_STATE, last_export_sha: null },
      }),
    ) as unknown as typeof fetch;
    render(<GitCard siteId="s1" slug="acme" />);

    await waitFor(() => expect(screen.getByText(/Last synced/)).toBeTruthy());
    expect(screen.getByText(/Imported 1234567/)).toBeTruthy();
    expect(screen.queryByText(/Exported/)).toBeNull();
  });

  it("D616/D415: labels an export failure on its own red line", async () => {
    global.fetch = vi.fn(async () =>
      json({
        ...CONFIGURED_ENABLED,
        state: { ...ENABLED_STATE, last_export_error: "non-fast-forward" },
      }),
    ) as unknown as typeof fetch;
    render(<GitCard siteId="s1" slug="acme" />);
    const line = await screen.findByText(/Export failed/);
    expect(line.textContent).toContain("non-fast-forward");
    expect(line.className).toContain("text-red-600");
  });

  it("D616/D416: an import failure is labeled AND offers a re-run import trigger", async () => {
    global.fetch = vi.fn(async () =>
      json({
        ...CONFIGURED_ENABLED,
        state: { ...ENABLED_STATE, last_import_error: "home.json: unknown block type" },
      }),
    ) as unknown as typeof fetch;
    render(<GitCard siteId="s1" slug="acme" />);
    const line = await screen.findByText(/Import failed/);
    expect(line.textContent).toContain("unknown block type");
    expect(screen.getByRole("button", { name: "Re-run import" })).toBeTruthy();
  });

  it("D616: a successful export shown alongside an unresolved import error renders BOTH", async () => {
    global.fetch = vi.fn(async () =>
      json({
        ...CONFIGURED_ENABLED,
        state: {
          ...ENABLED_STATE,
          last_export_error: null,
          last_import_error: "home.json: bad blocks",
        },
      }),
    ) as unknown as typeof fetch;
    render(<GitCard siteId="s1" slug="acme" />);
    // Export sha still renders (success), and the import error is NOT erased.
    await waitFor(() => expect(screen.getByText(/Exported abcdef1/)).toBeTruthy());
    expect(screen.getByText(/Import failed/)).toBeTruthy();
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

    render(<GitCard siteId="s1" slug="acme" exportPollIntervalMs={5} exportPollMaxTries={2} />);
    await waitFor(() => expect(screen.getByText(/Exported abcdef1/)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Export now" }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (c) => String(c[0]) === "/api/sites/s1/git/export" && (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeTruthy();
    });
  });

  it("D415: after export, polls the git endpoint and reflects the job outcome (new export sha)", async () => {
    let getCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/git/export" && method === "POST") {
        return json({ queued: true }, 202);
      }
      // First GET = pre-export state; subsequent GETs = the job has landed a
      // NEW export sha, which the bounded poll must pick up.
      getCount += 1;
      return json(
        getCount === 1
          ? CONFIGURED_ENABLED
          : { ...CONFIGURED_ENABLED, state: { ...ENABLED_STATE, last_export_sha: "newsha99999999" } },
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<GitCard siteId="s1" slug="acme" exportPollIntervalMs={5} exportPollMaxTries={5} />);
    await waitFor(() => expect(screen.getByText(/Exported abcdef1/)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Export now" }));

    // The poll picks up the new sha and the card re-renders with it.
    await waitFor(() => expect(screen.getByText(/Exported newsha9/)).toBeTruthy());
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

  it("announces that enabling runs a first export, before and after (D435)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/git/enable" && method === "POST") {
        return json({ state: { ...ENABLED_STATE, enabled: true }, queued: true });
      }
      // Start disabled so the Enable button + pre-note render.
      return json({ configured: true, repo: "acme/content", state: { ...ENABLED_STATE, enabled: false } });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<GitCard siteId="s1" slug="acme" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Enable" })).toBeTruthy());
    // Pre-note tells the operator the side effect before they click.
    expect(screen.getByText(/Enabling also runs a first export/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() => expect(screen.getByText(/a first export to the repo was queued/)).toBeTruthy());
  });
});
