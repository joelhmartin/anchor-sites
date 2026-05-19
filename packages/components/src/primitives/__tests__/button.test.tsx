import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "../button.js";

describe("Button", () => {
  it("renders a button element with the primary variant by default", () => {
    render(<Button>Click me</Button>);
    const el = screen.getByRole("button", { name: "Click me" });
    expect(el.tagName).toBe("BUTTON");
    expect(el.className).toMatch(/bg-theme-accent/);
  });

  it("applies size + variant classes", () => {
    render(
      <Button variant="outline" size="lg">
        Outline
      </Button>,
    );
    const el = screen.getByRole("button");
    expect(el.className).toMatch(/border-theme-border/);
    expect(el.className).toMatch(/h-12/);
  });

  it("renders as the child element when asChild is true (Slot)", () => {
    render(
      <Button asChild>
        <a href="/x">Go</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Go" });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/x");
    expect(link.className).toMatch(/bg-theme-accent/);
  });

  it("forwards disabled state", () => {
    render(<Button disabled>Nope</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
