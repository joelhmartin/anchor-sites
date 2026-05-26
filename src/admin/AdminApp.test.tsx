// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Stub Puck so the routing test doesn't pull the real (heavy, browser-only)
// editor — it only verifies route → component wiring, not the editor itself.
vi.mock("../editor/index.js", () => ({ Puck: () => null }));

// Control the auth probe so routing tests are deterministic + synchronous
// (the real hook is exercised in RequireAdmin.test.tsx).
const session: { status: "loading" | "authed" | "unauthed"; user: unknown } = {
  status: "authed",
  user: { id: "dev", email: "dev@studio.localhost" },
};
vi.mock("./auth/useStudioSession.js", () => ({ useStudioSession: () => session }));

import { AdminApp } from "./AdminApp.js";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminApp />
    </MemoryRouter>,
  );
}

describe("AdminApp routing (P4-T4.9; P8-T8.5)", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    session.status = "authed";
  });
  afterEach(() => {
    cleanup();
    global.fetch = realFetch;
  });

  it("redirects to /login when the session is unauthed", () => {
    session.status = "unauthed";
    renderAt("/");
    expect(screen.getByText("AnchorCorps Studio")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sign in with Google/i })).toBeTruthy();
  });

  it("renders the sites list + layout chrome when authenticated", () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: /Studio/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sites" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sites" })).toBeTruthy();
  });

  it("renders the page editor on the page-edit route", () => {
    // Never-resolving fetch keeps EditorPage in its loading state (no async
    // state update after mount) — we only assert the route → editor wiring.
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    renderAt("/sites/muldoon-dental/pages/abc-123");
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("renders NotFound for an unknown admin route", () => {
    renderAt("/totally/unknown");
    expect(screen.getByRole("heading", { name: "Not found" })).toBeTruthy();
  });

  it("shows the Google sign-in screen at /login", () => {
    renderAt("/login");
    expect(screen.getByRole("button", { name: /Sign in with Google/i })).toBeTruthy();
  });
});
