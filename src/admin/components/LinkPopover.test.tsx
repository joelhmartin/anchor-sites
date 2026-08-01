// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LinkPopover } from "./LinkPopover.js";

// D330 — the inline link editor must accept the link kinds templates and the
// agent actually author (site-relative, mailto:, tel:, #anchor), not just
// absolute http(s) URLs. preview-links.ts exists precisely because those
// relative/scheme links are everywhere; rejecting them meant an operator
// couldn't point a button at their own About page.
describe("LinkPopover (D330 — accepts the link kinds the product authors)", () => {
  afterEach(() => cleanup());

  function setup(initial = "") {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<LinkPopover open initialValue={initial} onSave={onSave} onClose={onClose} />);
    return { onSave, onClose };
  }

  function type(value: string) {
    fireEvent.change(screen.getByLabelText("URL"), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  }

  it.each([
    "https://example.com",
    "http://example.com/x",
    "/about",
    "/services/dental",
    "mailto:hi@example.com",
    "tel:+15551234567",
    "#section",
  ])("accepts %s", (value) => {
    const { onSave } = setup();
    type(value);
    expect(onSave).toHaveBeenCalledWith(value);
  });

  it("trims surrounding whitespace before saving", () => {
    const { onSave } = setup();
    type("  /about  ");
    expect(onSave).toHaveBeenCalledWith("/about");
  });

  it.each(["", "   ", "notaurl", "javascript:alert(1)", "ftp://host/x"])(
    "rejects %s with an inline error and does not save",
    (value) => {
      const { onSave } = setup();
      type(value);
      expect(onSave).not.toHaveBeenCalled();
      expect(screen.getByText(/enter a/i)).toBeTruthy();
    },
  );
});
