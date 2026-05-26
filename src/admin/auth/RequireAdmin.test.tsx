// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const fetchMe = vi.fn();
vi.mock("../lib/session.js", () => ({ fetchMe: (...args: unknown[]) => fetchMe(...args) }));

import { RequireAdmin } from "./RequireAdmin.js";

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/login" element={<div>LOGIN</div>} />
        <Route element={<RequireAdmin />}>
          <Route path="/" element={<div>PROTECTED</div>} />
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
});
