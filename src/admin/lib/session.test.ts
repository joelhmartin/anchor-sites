// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMe, signInWithGoogle, signOut } from "./session.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("session helpers (P8-T8.5)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("fetchMe returns the user from /api/me", async () => {
    global.fetch = vi.fn(async () => json({ user: { id: "u1", email: "a@b" } })) as typeof fetch;
    expect(await fetchMe()).toMatchObject({ id: "u1" });
  });

  it("fetchMe throws on 401", async () => {
    global.fetch = vi.fn(async () => json({ error: "unauthorized" }, 401)) as typeof fetch;
    await expect(fetchMe()).rejects.toThrow();
  });

  it("signInWithGoogle navigates to the returned authorization url", async () => {
    global.fetch = vi.fn(async () => json({ url: "https://accounts.google.com/o/oauth2/x" })) as typeof fetch;
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { assign } });
    try {
      await signInWithGoogle("/");
      expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/x");
      // D800: rejected callbacks must land on /login (where the error is
      // explained), not the default `/?error=…` bounce.
      const body = JSON.parse(
        (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
      );
      expect(body.errorCallbackURL).toBe("/login");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });

  it("signInWithGoogle throws when no url comes back (OAuth not configured)", async () => {
    global.fetch = vi.fn(async () => json({}, 200)) as typeof fetch;
    await expect(signInWithGoogle()).rejects.toThrow(/OAuth/);
  });

  it("signOut posts to sign-out and clears the break-glass token", async () => {
    localStorage.setItem("anchorcorps.admin_token", "tok");
    const f = vi.fn(async () => new Response(null, { status: 200 }));
    global.fetch = f as unknown as typeof fetch;
    await signOut();
    expect(f).toHaveBeenCalledWith("/api/auth/sign-out", expect.objectContaining({ method: "POST" }));
    expect(localStorage.getItem("anchorcorps.admin_token")).toBeNull();
  });
});
