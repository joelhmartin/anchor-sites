// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const fetchMe = vi.fn();
vi.mock("../lib/session.js", () => ({ fetchMe: (...args: unknown[]) => fetchMe(...args) }));

import { RequireAdmin } from "./RequireAdmin.js";

/** Echo target so tests can assert exactly what reached /login. */
function LoginEcho() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "";
  return <div data-testid="login-echo" data-search={location.search} data-from={from}>LOGIN</div>;
}

function renderGuard(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<LoginEcho />} />
        <Route element={<RequireAdmin />}>
          <Route path="/" element={<div>PROTECTED</div>} />
          <Route path="/sites/:slug" element={<div>PROTECTED</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireAdmin (P8-T8.5) — async session probe", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the outlet when /api/me resolves to a user", async () => {
    fetchMe.mockResolvedValue({ id: "u1", email: "a@b" });
    renderGuard();
    expect(await screen.findByText("PROTECTED")).toBeTruthy();
  });

  it("redirects to /login when /api/me resolves null", async () => {
    fetchMe.mockResolvedValue(null);
    renderGuard();
    expect(await screen.findByText("LOGIN")).toBeTruthy();
  });

  it("redirects to /login when /api/me throws (401/network)", async () => {
    fetchMe.mockRejectedValue(new Error("unauthorized"));
    renderGuard();
    expect(await screen.findByText("LOGIN")).toBeTruthy();
  });

  // D214 — the bounce must preserve the FULL attempted location, query
  // included: deep links like /sites/x?page=… are the very contract
  // PageEditRedirect mints.
  it("[D214] preserves path + query in the redirect state", async () => {
    fetchMe.mockResolvedValue(null);
    renderGuard("/sites/acme?page=p1&ai=1");
    const echo = await screen.findByTestId("login-echo");
    expect(echo.getAttribute("data-from")).toBe("/sites/acme?page=p1&ai=1");
  });

  // D800 — a rejected Google sign-in 302s to `/?error=…`; the guard must
  // carry that error THROUGH to /login (where LoginPage explains it) instead
  // of dropping the query — and must NOT bake the error into the post-login
  // destination.
  it("[D800] forwards ?error= to /login and strips it from `from`", async () => {
    fetchMe.mockResolvedValue(null);
    renderGuard("/?error=access_denied");
    const echo = await screen.findByTestId("login-echo");
    expect(echo.getAttribute("data-search")).toBe("?error=access_denied");
    expect(echo.getAttribute("data-from")).toBe("/");
  });
});
