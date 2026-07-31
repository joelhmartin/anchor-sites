// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const signInWithGoogle = vi.fn();
vi.mock("../lib/session.js", () => ({
  signInWithGoogle: (...a: unknown[]) => signInWithGoogle(...a),
}));

import { SessionExpiredDialog } from "./SessionExpiredDialog.js";
import { clearSessionExpired, notifySessionExpired } from "../lib/sessionExpiry.js";

function LoginEcho() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "";
  return <div data-testid="login-echo" data-search={location.search} data-from={from}>LOGIN</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginEcho />} />
        <Route
          path="*"
          element={
            <>
              <div>APP CONTENT</div>
              <SessionExpiredDialog />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SessionExpiredDialog (D801)", () => {
  afterEach(() => {
    cleanup();
    clearSessionExpired();
    vi.clearAllMocks();
  });

  it("renders nothing until the shared 401 signal fires, then overlays WITHOUT unmounting the app", async () => {
    renderAt("/sites/acme?page=p1");
    expect(screen.queryByTestId("session-expired-dialog")).toBeNull();
    act(() => notifySessionExpired());
    expect(await screen.findByTestId("session-expired-dialog")).toBeTruthy();
    expect(screen.getByText(/Session expired/i)).toBeTruthy();
    // The SPA under it is still mounted — that's the whole point.
    expect(screen.getByText("APP CONTENT")).toBeTruthy();
  });

  it("restarts Google sign-in with the CURRENT path+query as the callback", async () => {
    signInWithGoogle.mockResolvedValue(undefined);
    renderAt("/sites/acme?page=p1");
    act(() => notifySessionExpired());
    fireEvent.click(await screen.findByRole("button", { name: /Sign in with Google/i }));
    expect(signInWithGoogle).toHaveBeenCalledWith("/sites/acme?page=p1");
  });

  it("offers the token path, preserving `from` (D214 contract)", async () => {
    renderAt("/sites/acme?page=p1");
    act(() => notifySessionExpired());
    fireEvent.click(await screen.findByRole("button", { name: /Use an admin token instead/i }));
    const echo = await screen.findByTestId("login-echo");
    expect(echo.getAttribute("data-search")).toBe("?mode=token");
    expect(echo.getAttribute("data-from")).toBe("/sites/acme?page=p1");
  });

  it("clears when the signal clears (successful re-auth path)", async () => {
    renderAt("/");
    act(() => notifySessionExpired());
    expect(await screen.findByTestId("session-expired-dialog")).toBeTruthy();
    act(() => clearSessionExpired());
    expect(screen.queryByTestId("session-expired-dialog")).toBeNull();
  });
});
