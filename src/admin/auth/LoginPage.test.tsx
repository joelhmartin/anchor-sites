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
});
