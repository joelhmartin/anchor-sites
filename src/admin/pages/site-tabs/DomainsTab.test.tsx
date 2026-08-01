// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { DomainsTab } from "./DomainsTab.js";
import { setAdminToken, clearAdminToken } from "../../lib/adminToken.js";

const SITE_ID = "site-abc-123";

type DomainRow = {
  id: string;
  hostname: string;
  is_primary: boolean;
  verification_status: string;
  ssl_status: string;
  last_error: string | null;
  domain_class: string;
  created_at: string;
};

const MANAGED_DOMAIN: DomainRow = {
  id: "d1",
  hostname: "acme.sites.anchorcorps.com",
  is_primary: true,
  verification_status: "pending",
  ssl_status: "pending",
  last_error: null,
  domain_class: "managed",
  created_at: "2026-06-28T00:00:00Z",
};

const CLIENT_DOMAIN: DomainRow = {
  id: "d2",
  hostname: "acme.example.com",
  is_primary: false,
  verification_status: "pending",
  ssl_status: "pending",
  last_error: null,
  domain_class: "client-owned",
  created_at: "2026-06-28T01:00:00Z",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("DomainsTab (P10-10.7, W2-DOM)", () => {
  const realFetch = global.fetch;

  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("shows a loading spinner while fetching", () => {
    global.fetch = vi.fn(() => new Promise(() => undefined)) as unknown as typeof fetch;
    render(<DomainsTab siteId={SITE_ID} />);
    // No domain rows visible while loading
    expect(screen.queryByText("acme.sites.anchorcorps.com")).toBeNull();
  });

  it("renders domain list with badges after load", async () => {
    global.fetch = vi.fn(async (url: unknown) => {
      if (String(url).includes("/domains")) {
        return json({ domains: [MANAGED_DOMAIN, CLIENT_DOMAIN] });
      }
      return json({});
    }) as unknown as typeof fetch;

    render(<DomainsTab siteId={SITE_ID} />);

    await waitFor(() => {
      expect(screen.getByText("acme.sites.anchorcorps.com")).toBeTruthy();
      expect(screen.getByText("acme.example.com")).toBeTruthy();
    });

    // Status badges rendered
    expect(screen.getAllByText(/pending/i).length).toBeGreaterThan(0);
    // domain_class labels (chips + help copy — D403 adds the explanations)
    expect(screen.getAllByText(/managed/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/client-owned/i).length).toBeGreaterThan(0);
  });

  // D403: preconditions and jargon are explained where the buttons live.
  it("explains managed/client-owned and the Search Console precondition (D403)", async () => {
    global.fetch = vi.fn(async () => json({ domains: [MANAGED_DOMAIN] })) as unknown as typeof fetch;
    render(<DomainsTab siteId={SITE_ID} />);
    await waitFor(() => screen.getByText("acme.sites.anchorcorps.com"));

    expect(screen.getByText(/one-time prerequisite/i)).toBeTruthy();
    expect(screen.getByText(/Google Search Console/i)).toBeTruthy();
    expect(screen.getByText(/records to add at the external registrar/i)).toBeTruthy();
  });

  it("shows add-domain form and POSTs a new hostname", async () => {
    const fetchMock = vi.fn(async (url: unknown, opts?: RequestInit) => {
      if (
        String(url).includes("/domains") &&
        !String(url).includes("/provision") &&
        !String(url).includes("/status")
      ) {
        if (opts?.method === "POST") return json({ domain: CLIENT_DOMAIN }, 201);
        return json({ domains: [MANAGED_DOMAIN] });
      }
      return json({});
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<DomainsTab siteId={SITE_ID} />);
    await waitFor(() => screen.getByText("acme.sites.anchorcorps.com"));

    const input = screen.getByLabelText("Add custom domain") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "acme.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /add domain/i }));

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        ([url, o]: [unknown, RequestInit?]) =>
          String(url).includes("/domains") && o?.method === "POST",
      );
      expect(posts.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("labels the hostname input and validates before the round-trip (D428)", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes("/domains")) return json({ domains: [MANAGED_DOMAIN] });
      return json({});
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<DomainsTab siteId={SITE_ID} />);
    await waitFor(() => screen.getByText("acme.sites.anchorcorps.com"));

    const input = screen.getByLabelText("Add custom domain") as HTMLInputElement;
    const addBtn = () => screen.getByRole("button", { name: /add domain/i }) as HTMLButtonElement;

    // An obviously invalid hostname (no dot) is rejected client-side.
    fireEvent.change(input, { target: { value: "notahost" } });
    expect(addBtn().disabled).toBe(true);
    expect(screen.getByText(/full hostname like/i)).toBeTruthy();
    fireEvent.click(addBtn());
    const posts = fetchMock.mock.calls.filter(
      ([, o]: [unknown, RequestInit?]) => o?.method === "POST",
    );
    expect(posts).toHaveLength(0); // no round-trip for an invalid value

    // A valid hostname enables the button.
    fireEvent.change(input, { target: { value: "www.example.com" } });
    expect(addBtn().disabled).toBe(false);
  });

  it("Provision button appears for all domains (including primary) and calls provision endpoint", async () => {
    const fetchMock = vi.fn(async (url: unknown, opts?: RequestInit) => {
      if (String(url).includes("/provision") && opts?.method === "POST") {
        return json({ steps: [{ step: "cloud_run", status: "ok" }], required_records: [] });
      }
      if (String(url).includes("/domains")) {
        return json({ domains: [MANAGED_DOMAIN, CLIENT_DOMAIN] });
      }
      return json({});
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<DomainsTab siteId={SITE_ID} />);
    await waitFor(() => screen.getByText("acme.example.com"));

    // Both domains (primary managed + non-primary client-owned) show a Provision button.
    const provisionBtns = screen.getAllByRole("button", { name: /^provision$/i });
    expect(provisionBtns.length).toBe(2);
    fireEvent.click(provisionBtns[0]);

    await waitFor(() => {
      const provCalls = fetchMock.mock.calls.filter(
        ([url, o]: [unknown, RequestInit?]) =>
          String(url).includes("/provision") && o?.method === "POST",
      );
      expect(provCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // D400: every step outcome is rendered — a failed provision paints its failure.
  it("renders the provision step results, including a cloud_run error with detail (D400)", async () => {
    const fetchMock = vi.fn(async (url: unknown, opts?: RequestInit) => {
      if (String(url).includes("/provision") && opts?.method === "POST") {
        return json({
          steps: [
            {
              step: "cloud_run",
              status: "error",
              detail:
                "Cloud Run 403: PermissionDenied — open https://search.google.com/search-console/settings and add the service account as a verified owner",
            },
          ],
          required_records: [],
        });
      }
      if (String(url).includes("/domains")) {
        return json({ domains: [MANAGED_DOMAIN] });
      }
      return json({});
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<DomainsTab siteId={SITE_ID} />);
    await waitFor(() => screen.getByText("acme.sites.anchorcorps.com"));

    fireEvent.click(screen.getByRole("button", { name: /^provision$/i }));

    await waitFor(() => {
      expect(screen.getByTestId("provision-steps")).toBeTruthy();
      expect(screen.getByText(/cloud_run/)).toBeTruthy();
      expect(screen.getAllByText(/PermissionDenied/).length).toBeGreaterThan(0);
    });
    // The known Search-Console failure links straight to the fix.
    expect(screen.getByRole("link", { name: /open google search console/i })).toBeTruthy();
  });

  // D609: a failed row renders its persisted last_error, not a bare badge.
  it("renders a domain's persisted last_error with a Search Console link (D609)", async () => {
    const failed: DomainRow = {
      ...MANAGED_DOMAIN,
      verification_status: "failed",
      ssl_status: "failed",
      last_error:
        "Cloud Run 403: PermissionDenied — add the runtime service account as a verified OWNER in Google Search Console",
    };
    global.fetch = vi.fn(async () => json({ domains: [failed] })) as unknown as typeof fetch;

    render(<DomainsTab siteId={SITE_ID} />);
    await waitFor(() => screen.getByText("acme.sites.anchorcorps.com"));

    expect(screen.getAllByText(/PermissionDenied/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /open google search console/i })).toBeTruthy();
  });

  it("shows required DNS records table after provision for client-owned domain", async () => {
    const requiredRecords = [
      { name: "acme.example.com", type: "CNAME", data: "ghs.googlehosted.com" },
    ];
    const fetchMock = vi.fn(async (url: unknown, opts?: RequestInit) => {
      if (String(url).includes("/provision") && opts?.method === "POST") {
        return json({
          steps: [{ step: "cloud_run", status: "ok" }],
          required_records: requiredRecords,
        });
      }
      if (String(url).includes("/domains")) {
        return json({ domains: [MANAGED_DOMAIN, CLIENT_DOMAIN] });
      }
      return json({});
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<DomainsTab siteId={SITE_ID} />);
    await waitFor(() => screen.getByText("acme.example.com"));

    // Two Provision buttons — click the first (primary managed domain).
    const provisionBtns = screen.getAllByRole("button", { name: /^provision$/i });
    fireEvent.click(provisionBtns[0]);

    await waitFor(() => {
      expect(screen.getByText("ghs.googlehosted.com")).toBeTruthy();
    });
  });

  // D404: a pending badge has a path to resolution — Check now → POST /verify.
  it("Check now calls the verify endpoint (D404)", async () => {
    const fetchMock = vi.fn(async (url: unknown, opts?: RequestInit) => {
      if (String(url).includes("/verify") && opts?.method === "POST") {
        return json({ domain: { ...MANAGED_DOMAIN, verification_status: "verified" } });
      }
      return json({ domains: [MANAGED_DOMAIN] });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<DomainsTab siteId={SITE_ID} />);
    await waitFor(() => screen.getByText("acme.sites.anchorcorps.com"));

    fireEvent.click(screen.getByRole("button", { name: /check now/i }));

    await waitFor(() => {
      const verifyCalls = fetchMock.mock.calls.filter(
        ([url, o]: [unknown, RequestInit?]) =>
          String(url).includes("/verify") && o?.method === "POST",
      );
      expect(verifyCalls.length).toBe(1);
    });
  });

  // D110: Make primary on non-primary domains → POST /set-primary.
  it("Make primary calls set-primary and is absent on the primary domain (D110)", async () => {
    const fetchMock = vi.fn(async (url: unknown, opts?: RequestInit) => {
      if (String(url).includes("/set-primary") && opts?.method === "POST") {
        return json({ domain: { ...CLIENT_DOMAIN, is_primary: true } });
      }
      return json({ domains: [MANAGED_DOMAIN, CLIENT_DOMAIN] });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<DomainsTab siteId={SITE_ID} />);
    await waitFor(() => screen.getByText("acme.example.com"));

    // Only the non-primary domain offers Make primary.
    const makePrimaryBtns = screen.getAllByRole("button", { name: /make primary/i });
    expect(makePrimaryBtns.length).toBe(1);
    fireEvent.click(makePrimaryBtns[0]);

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        ([url, o]: [unknown, RequestInit?]) =>
          String(url).includes(`/domains/${CLIENT_DOMAIN.id}/set-primary`) && o?.method === "POST",
      );
      expect(calls.length).toBe(1);
    });
  });

  it("Remove button is absent for primary, present for non-primary", async () => {
    global.fetch = vi.fn(async () =>
      json({ domains: [MANAGED_DOMAIN, CLIENT_DOMAIN] }),
    ) as unknown as typeof fetch;

    render(<DomainsTab siteId={SITE_ID} />);
    await waitFor(() => screen.getByText("acme.example.com"));

    // One remove button for the non-primary domain
    const removeBtns = screen.getAllByRole("button", { name: /^remove$/i });
    expect(removeBtns.length).toBe(1);
  });

  // D401: removal requires confirmation naming the hostname + consequences.
  it("Remove opens a confirm dialog naming the hostname; confirming DELETEs (D401)", async () => {
    const fetchMock = vi.fn(async (_url: unknown, opts?: RequestInit) => {
      if (opts?.method === "DELETE") {
        return json({ removed: true, warnings: [] });
      }
      return json({ domains: [MANAGED_DOMAIN, CLIENT_DOMAIN] });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<DomainsTab siteId={SITE_ID} />);
    await waitFor(() => screen.getByText("acme.example.com"));

    fireEvent.click(screen.getAllByRole("button", { name: /^remove$/i })[0]);

    // No DELETE yet — the dialog is the gate.
    expect(
      fetchMock.mock.calls.filter(([, o]: [unknown, RequestInit?]) => o?.method === "DELETE"),
    ).toHaveLength(0);
    expect(screen.getByText(/remove acme\.example\.com\?/i)).toBeTruthy();
    expect(screen.getByText(/stops serving this site/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /remove domain/i }));

    await waitFor(() => {
      const delCalls = fetchMock.mock.calls.filter(
        ([, o]: [unknown, RequestInit?]) => o?.method === "DELETE",
      );
      expect(delCalls.length).toBe(1);
    });
    // Success notice for the removed hostname.
    await waitFor(() => {
      expect(screen.getByText(/removed acme\.example\.com/i)).toBeTruthy();
    });
  });

  it("Cancel closes the dialog without deleting (D401)", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _opts?: RequestInit) =>
      json({ domains: [MANAGED_DOMAIN, CLIENT_DOMAIN] }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<DomainsTab siteId={SITE_ID} />);
    await waitFor(() => screen.getByText("acme.example.com"));

    fireEvent.click(screen.getAllByRole("button", { name: /^remove$/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.queryByText(/remove acme\.example\.com\?/i)).toBeNull();
    });
    expect(
      fetchMock.mock.calls.filter(([, o]: [unknown, RequestInit?]) => o?.method === "DELETE"),
    ).toHaveLength(0);
  });

  // D402: a failed removal must be surfaced, not swallowed.
  it("surfaces a removal failure inside the dialog (D402)", async () => {
    const fetchMock = vi.fn(async (_url: unknown, opts?: RequestInit) => {
      if (opts?.method === "DELETE") {
        return json(
          {
            error: "unprovision failed — acme.example.com was not removed",
            removed: false,
            warnings: ["Cloud Run unmap failed for acme.example.com: Cloud Run 500"],
          },
          502,
        );
      }
      return json({ domains: [MANAGED_DOMAIN, CLIENT_DOMAIN] });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<DomainsTab siteId={SITE_ID} />);
    await waitFor(() => screen.getByText("acme.example.com"));

    fireEvent.click(screen.getAllByRole("button", { name: /^remove$/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /remove domain/i }));

    await waitFor(() => {
      expect(screen.getByText(/unprovision failed/i)).toBeTruthy();
      expect(screen.getByText(/Cloud Run 500/)).toBeTruthy();
    });
    // Dialog stays open (retry surface); the row was not removed.
    expect(screen.getByText(/remove acme\.example\.com\?/i)).toBeTruthy();
  });

  // D119: partial cleanup warnings are shown after a successful removal.
  it("shows partial-cleanup warnings after removal (D119)", async () => {
    const fetchMock = vi.fn(async (_url: unknown, opts?: RequestInit) => {
      if (opts?.method === "DELETE") {
        return json({
          removed: true,
          warnings: [
            "DNS record not removed (CNAME acme.example.com → ghs.googlehosted.com): Kinsta 500 — remove it manually at the DNS provider",
          ],
        });
      }
      return json({ domains: [MANAGED_DOMAIN, CLIENT_DOMAIN] });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<DomainsTab siteId={SITE_ID} />);
    await waitFor(() => screen.getByText("acme.example.com"));

    fireEvent.click(screen.getAllByRole("button", { name: /^remove$/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /remove domain/i }));

    await waitFor(() => {
      expect(screen.getByText(/removed acme\.example\.com/i)).toBeTruthy();
      expect(screen.getByText(/DNS record not removed/i)).toBeTruthy();
      expect(screen.getByText(/remove it manually/i)).toBeTruthy();
    });
  });

  it("shows an error message if the list fetch fails", async () => {
    global.fetch = vi.fn(async () =>
      json({ error: "server error" }, 500),
    ) as unknown as typeof fetch;
    render(<DomainsTab siteId={SITE_ID} />);
    await waitFor(() => {
      expect(screen.getByText(/server error|couldn't load/i)).toBeTruthy();
    });
  });
});
