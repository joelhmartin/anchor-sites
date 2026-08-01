// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState.js";

describe("EmptyState", () => {
  afterEach(() => cleanup());

  // D307 — must not promise reversibility the product doesn't have.
  it("does not claim every change is revertible", () => {
    render(<EmptyState onPreset={() => {}} />);
    expect(screen.queryByText(/every change is revertible/i)).toBeNull();
    // It should still tell the truth about what IS revertible.
    expect(screen.getByText(/page edits can be reverted/i)).toBeTruthy();
  });

  // D325 — direct-manipulation editing must be discoverable.
  it("points first-run users at the in-place Edit affordance", () => {
    render(<EmptyState onPreset={() => {}} />);
    expect(screen.getByText(/change text and images in place/i)).toBeTruthy();
  });

  it("fires onPreset for a preset chip", () => {
    const onPreset = vi.fn();
    render(<EmptyState onPreset={onPreset} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a services page" }));
    expect(onPreset).toHaveBeenCalledWith("Add a services page");
  });
});
