// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MembersTab } from "./MembersTab.js";
import { setAdminToken, clearAdminToken } from "../../lib/adminToken.js";

const MEMBERS = {
  members: [
    { id: "u1", name: "Pat", email: "pat@x.test", email_verified: true, created_at: "2026-05-18T00:00:00Z" },
    { id: "u2", name: "Sam", email: "sam@x.test", email_verified: false, created_at: "2026-05-19T00:00:00Z" },
  ],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Routes members + auth-config GETs; captures PUTs to auth-config. */
function mockApi(providers: { emailPassword?: boolean }, puts: Array<{ url: string; body: unknown }>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/members") && method === "GET") return json(MEMBERS);
    if (url.endsWith("/auth-config") && method === "GET") return json({ providers });
    if (url.endsWith("/auth-config") && method === "PUT") {
      puts.push({ url, body: JSON.parse(String(init!.body)) });
      return json({ providers: JSON.parse(String(init!.body)).providers });
    }
    return json({ error: "unexpected" }, 500);
  });
}

describe("MembersTab (P8-T8.13)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("lists members with a verified badge", async () => {
    global.fetch = mockApi({ emailPassword: true }, []) as unknown as typeof fetch;
    render(<MembersTab siteId="s1" />);
    await waitFor(() => expect(screen.getByText("pat@x.test")).toBeTruthy());
    expect(screen.getByText("sam@x.test")).toBeTruthy();
    expect(screen.getByText("verified")).toBeTruthy();
    expect(screen.getByText("unverified")).toBeTruthy();
  });

  it("reflects the stored provider state in the toggle", async () => {
    global.fetch = mockApi({ emailPassword: false }, []) as unknown as typeof fetch;
    render(<MembersTab siteId="s1" />);
    const toggle = (await screen.findByLabelText("Email + password")) as HTMLInputElement;
    await waitFor(() => expect(toggle.checked).toBe(false));
  });

  it("saves the toggled provider via PUT", async () => {
    const puts: Array<{ url: string; body: unknown }> = [];
    global.fetch = mockApi({ emailPassword: true }, puts) as unknown as typeof fetch;
    render(<MembersTab siteId="s1" />);
    const toggle = (await screen.findByLabelText("Email + password")) as HTMLInputElement;
    await waitFor(() => expect(toggle.checked).toBe(true));

    fireEvent.click(toggle); // → false
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Saved.")).toBeTruthy());
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toBe("/api/sites/s1/auth-config");
    expect(puts[0].body).toEqual({ providers: { emailPassword: false } });
  });

  it("shows an empty state when there are no members", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/members")) return json({ members: [] });
      if (url.endsWith("/auth-config")) return json({ providers: { emailPassword: true } });
      return json({ error: "unexpected" }, 500);
    }) as unknown as typeof fetch;
    render(<MembersTab siteId="s1" />);
    await waitFor(() => expect(screen.getByText(/No members yet/)).toBeTruthy());
  });
});
