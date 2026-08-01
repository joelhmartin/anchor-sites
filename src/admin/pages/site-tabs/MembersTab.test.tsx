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

/** Routes members + auth-config GETs; captures PUTs to auth-config + member DELETEs. */
function mockApi(
  providers: { emailPassword?: boolean },
  puts: Array<{ url: string; body: unknown }>,
  deletes: string[] = [],
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/members") && method === "GET") return json(MEMBERS);
    if (url.includes("/members/") && method === "DELETE") {
      deletes.push(url);
      return new Response(null, { status: 204 });
    }
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

  it("saves an ENABLED provider via PUT without a warning", async () => {
    const puts: Array<{ url: string; body: unknown }> = [];
    // Stored as disabled → re-enabling doesn't lock anyone out, no confirm.
    global.fetch = mockApi({ emailPassword: false }, puts) as unknown as typeof fetch;
    render(<MembersTab siteId="s1" />);
    const toggle = (await screen.findByLabelText("Email + password")) as HTMLInputElement;
    await waitFor(() => expect(toggle.checked).toBe(false));

    fireEvent.click(toggle); // → true
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Saved.")).toBeTruthy());
    expect(puts).toHaveLength(1);
    expect(puts[0].body).toEqual({ providers: { emailPassword: true } });
  });

  it("warns with the member count before disabling the only provider, then saves (D424)", async () => {
    const puts: Array<{ url: string; body: unknown }> = [];
    global.fetch = mockApi({ emailPassword: true }, puts) as unknown as typeof fetch;
    render(<MembersTab siteId="s1" />);
    const toggle = (await screen.findByLabelText("Email + password")) as HTMLInputElement;
    await waitFor(() => expect(toggle.checked).toBe(true));

    fireEvent.click(toggle); // → false
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Confirm dialog appears with the member count; no PUT yet.
    await screen.findByText(/only way members sign in/i);
    expect(screen.getByText(/2 members/)).toBeTruthy();
    expect(puts).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Disable anyway" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body).toEqual({ providers: { emailPassword: false } });
  });

  it("removes a member after confirmation (D423)", async () => {
    const deletes: string[] = [];
    global.fetch = mockApi({ emailPassword: true }, [], deletes) as unknown as typeof fetch;
    render(<MembersTab siteId="s1" />);
    await waitFor(() => expect(screen.getByText("pat@x.test")).toBeTruthy());

    // Click the Remove on Pat's row.
    const patRow = screen.getByText("pat@x.test").closest("tr")!;
    fireEvent.click(patRow.querySelector("button")!);

    await screen.findByText(/permanently deletes/i);
    fireEvent.click(screen.getByRole("button", { name: "Remove member" }));

    await waitFor(() => expect(deletes).toContain("/api/sites/s1/members/u1"));
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
