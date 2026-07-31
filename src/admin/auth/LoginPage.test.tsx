// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const signInWithGoogle = vi.fn();
const fetchMe = vi.fn();
vi.mock("../lib/session.js", () => ({
  signInWithGoogle: (...a: unknown[]) => signInWithGoogle(...a),
  fetchMe: (...a: unknown[]) => fetchMe(...a),
}));

import { LoginPage } from "./LoginPage.js";

function renderLogin(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/login${search}`]}>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe("LoginPage (P8-T8.5)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows Google sign-in and hides the token form by default", () => {
    renderLogin();
    expect(screen.getByRole("button", { name: /Sign in with Google/i })).toBeTruthy();
    expect(screen.queryByLabelText("Admin token")).toBeNull();
  });

  it("starts Google OAuth on click", async () => {
    signInWithGoogle.mockResolvedValue(undefined);
    renderLogin();
    fireEvent.click(screen.getByRole("button", { name: /Sign in with Google/i }));
    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledWith("/"));
  });

  it("surfaces an error when Google sign-in fails", async () => {
    signInWithGoogle.mockRejectedValue(new Error("OAuth not configured"));
    renderLogin();
    fireEvent.click(screen.getByRole("button", { name: /Sign in with Google/i }));
    expect(await screen.findByText(/OAuth not configured/)).toBeTruthy();
  });

  it("reveals the break-glass token form via ?mode=token and verifies it", async () => {
    fetchMe.mockResolvedValue({ id: "service-token", email: "x@y" });
    renderLogin("?mode=token");
    fireEvent.change(screen.getByLabelText("Admin token"), { target: { value: "tok" } });
    fireEvent.click(screen.getByRole("button", { name: "Use token" }));
    await waitFor(() => expect(fetchMe).toHaveBeenCalled());
    expect(localStorage.getItem("anchorcorps.admin_token")).toBe("tok");
  });

  // D800 — a rejected sign-in must land on a screen that SAYS WHAT HAPPENED.
  describe("[D800] rejected sign-in explanations (?error=)", () => {
    it("explains a cancelled/denied Google consent", () => {
      renderLogin("?error=access_denied");
      expect(screen.getByText(/cancelled or didn't finish/i)).toBeTruthy();
    });

    it("explains an allowlist rejection at session creation (D804's code)", () => {
      renderLogin("?error=unable_to_create_session");
      expect(screen.getByText(/isn't authorized for Studio/i)).toBeTruthy();
      expect(screen.getByText(/allowlist/i)).toBeTruthy();
    });

    it("explains the user-create rejection (underscored hook message)", () => {
      renderLogin("?error=This_Google_account_is_not_authorized_for_Studio.");
      expect(screen.getByText(/isn't authorized for Studio/i)).toBeTruthy();
    });

    it("falls back to a decoded generic message for unknown codes", () => {
      renderLogin("?error=some_weird_thing");
      expect(screen.getByText(/some weird thing/i)).toBeTruthy();
    });

    it("renders no error box without an error param", () => {
      renderLogin();
      expect(screen.queryByTestId("auth-error")).toBeNull();
    });
  });
});
