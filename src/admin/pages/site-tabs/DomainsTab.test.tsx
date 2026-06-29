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
  domain_class: string;
  created_at: string;
};

const MANAGED_DOMAIN: DomainRow = {
  id: "d1",
  hostname: "acme.sites.anchorcorps.com",
  is_primary: true,
  verification_status: "pending",
  ssl_status: "pending",
  domain_class: "managed",
  created_at: "2026-06-28T00:00:00Z",
};

const CLIENT_DOMAIN: DomainRow = {
  id: "d2",
  hostname: "acme.example.com",
  is_primary: false,
  verification_status: "pending",
  ssl_status: "pending",
  domain_class: "client-owned",
  created_at: "2026-06-28T01:00:00Z",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("DomainsTab (P10-10.7)", () => {
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
    // domain_class labels
    expect(screen.getByText(/managed/i)).toBeTruthy();
    expect(screen.getByText(/client-owned/i)).toBeTruthy();
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

    const input = screen.getByPlaceholderText(/hostname/i) as HTMLInputElement;
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
    const provisionBtns = screen.getAllByRole("button", { name: /provision/i });
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
    const provisionBtns = screen.getAllByRole("button", { name: /provision/i });
    fireEvent.click(provisionBtns[0]);

    await waitFor(() => {
      expect(screen.getByText("ghs.googlehosted.com")).toBeTruthy();
    });
  });

  it("Delete button is absent for primary, present for non-primary", async () => {
    global.fetch = vi.fn(async () =>
      json({ domains: [MANAGED_DOMAIN, CLIENT_DOMAIN] }),
    ) as unknown as typeof fetch;

    render(<DomainsTab siteId={SITE_ID} />);
    await waitFor(() => screen.getByText("acme.example.com"));

    // One remove button for the non-primary domain
    const removeBtns = screen.getAllByRole("button", { name: /remove/i });
    expect(removeBtns.length).toBe(1);
  });

  it("Remove button DELETEs and reloads the list", async () => {
    const fetchMock = vi.fn(async (_url: unknown, opts?: RequestInit) => {
      if (opts?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return json({ domains: [MANAGED_DOMAIN, CLIENT_DOMAIN] });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<DomainsTab siteId={SITE_ID} />);
    await waitFor(() => screen.getByText("acme.example.com"));

    fireEvent.click(screen.getAllByRole("button", { name: /remove/i })[0]);

    await waitFor(() => {
      const delCalls = fetchMock.mock.calls.filter(
        ([, o]: [unknown, RequestInit?]) => o?.method === "DELETE",
      );
      expect(delCalls.length).toBeGreaterThanOrEqual(1);
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
