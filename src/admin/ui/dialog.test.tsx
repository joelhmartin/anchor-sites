// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogDescription } from "./dialog.js";

describe("ui/Dialog (D218 — built-in close X + required title)", () => {
  afterEach(() => cleanup());

  it("renders the required title as the dialog's accessible name", () => {
    render(
      <Dialog open onOpenChange={() => undefined}>
        <DialogContent title="Template details">
          <DialogDescription>About this template.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Template details" })).toBeTruthy();
  });

  it("ships its own close (X) button that closes via onOpenChange", () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent title="Template details">
          <p>body</p>
        </DialogContent>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
