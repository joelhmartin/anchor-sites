// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./button.js";

afterEach(cleanup);
import { Card, CardTitle } from "./card.js";
import { Badge } from "./badge.js";
import { Spinner } from "./spinner.js";

describe("admin UI primitives (P4-T4.7)", () => {
  it("Button renders a real <button> with type=button by default", () => {
    render(<Button>Save</Button>);
    const el = screen.getByRole("button", { name: "Save" });
    expect(el.tagName).toBe("BUTTON");
    expect(el.getAttribute("type")).toBe("button");
    expect(el.className).toMatch(/bg-indigo-600/);
  });

  it("Button danger variant applies danger classes", () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole("button").className).toMatch(/bg-red-600/);
  });

  it("Card + CardTitle compose", () => {
    render(
      <Card data-testid="c">
        <CardTitle>Hello</CardTitle>
      </Card>,
    );
    expect(screen.getByTestId("c")).toBeTruthy();
    expect(screen.getByText("Hello").tagName).toBe("H3");
  });

  it("Badge tone maps to the right class", () => {
    render(<Badge tone="success">Live</Badge>);
    expect(screen.getByText("Live").className).toMatch(/bg-green-100/);
  });

  it("Spinner exposes a loading status role", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
