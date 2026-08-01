// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const signOut = vi.fn(async () => {});
const signOutEverywhere = vi.fn(async () => {});
vi.mock("../lib/session.js", () => ({
  signOut: () => signOut(),
  signOutEverywhere: () => signOutEverywhere(),
}));

import { UserMenu } from "./UserMenu.js";
import { StudioSessionContext } from "../auth/useStudioSession.js";

const USER = { id: "u1", email: "jmartin@anchorcorps.com", name: "Joel Martin" };

function renderMenu(user: typeof USER | null = USER) {
  return render(
    <MemoryRouter>
      <StudioSessionContext.Provider value={{ status: user ? "authed" : "loading", user }}>
        <UserMenu />
      </StudioSessionContext.Provider>
    </MemoryRouter>,
  );
}

describe("UserMenu identity + session terminality (D813 / D805)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("[D813] renders the operator's initial in the avatar and name+email in the dropdown", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "Account menu" });
    expect(trigger.textContent).toBe("J");
    fireEvent.click(trigger);
    const identity = screen.getByTestId("user-identity");
    expect(identity.textContent).toContain("Joel Martin");
    expect(identity.textContent).toContain("jmartin@anchorcorps.com");
  });

  it("[D813] falls back to the generic icon with no resolved user (no crash, no identity row)", () => {
    renderMenu(null);
    const trigger = screen.getByRole("button", { name: "Account menu" });
    fireEvent.click(trigger);
    expect(screen.queryByTestId("user-identity")).toBeNull();
  });

  it("keeps the plain Sign out wired to signOut()", async () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOutEverywhere).not.toHaveBeenCalled();
  });

  it("[D805] offers Sign out everywhere wired to the revoke-all helper", async () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out everywhere" }));
    expect(signOutEverywhere).toHaveBeenCalledTimes(1);
  });

  // D313 — the role="menu" keyboard contract (was claimed, not implemented).
  it("[D313] moves focus into the menu on open and cycles items with arrow keys", () => {
    renderMenu();
    const menu = () => screen.getByRole("menu", { name: "Account" });
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    // Focus lands on the first item.
    const sites = screen.getByRole("menuitem", { name: "Sites" });
    expect(document.activeElement).toBe(sites);
    // ArrowDown → next item.
    fireEvent.keyDown(menu(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Sign out" }));
    // ArrowUp wraps back.
    fireEvent.keyDown(menu(), { key: "ArrowUp" });
    expect(document.activeElement).toBe(sites);
  });

  // D313 — focus is restored to the trigger when the menu closes (Escape).
  it("[D313] restores focus to the trigger on close", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "Account menu" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });
});
