// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdminApp } from "./AdminApp.js";
import { clearAdminToken, setAdminToken } from "./lib/adminToken.js";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminApp />
    </MemoryRouter>,
  );
}

describe("AdminApp routing (P4-T4.9)", () => {
  beforeEach(() => clearAdminToken());
  afterEach(() => {
    cleanup();
    clearAdminToken();
  });

  it("redirects to /login when no token is stored", () => {
    renderAt("/");
    // LoginPage heading.
    expect(screen.getByText("AnchorCorps Studio")).toBeTruthy();
    expect(screen.getByLabelText("Admin token")).toBeTruthy();
  });

  it("renders the sites list + layout chrome when authenticated", () => {
    setAdminToken("tok");
    renderAt("/");
    // Sidebar brand + Sites nav + page heading.
    expect(screen.getByRole("link", { name: /Studio/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sites" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sites" })).toBeTruthy();
  });

  it("renders the editor placeholder on the page-edit route", () => {
    setAdminToken("tok");
    renderAt("/sites/muldoon-dental/pages/abc-123");
    expect(screen.getByText(/Visual editor — coming in Phase 5/)).toBeTruthy();
  });

  it("renders NotFound for an unknown admin route", () => {
    setAdminToken("tok");
    renderAt("/totally/unknown");
    expect(screen.getByRole("heading", { name: "Not found" })).toBeTruthy();
  });

  it("shows the login screen at /login regardless of token", () => {
    renderAt("/login");
    expect(screen.getByLabelText("Admin token")).toBeTruthy();
  });
});
