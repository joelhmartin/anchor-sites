import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FeatureGrid } from "./component.js";
import { featureGridSchema } from "./schema.js";
import { EditModeProvider } from "../../editable.js";

describe("ac-feature-grid", () => {
  it("renders the ac-feature-grid root class + brand tokens", () => {
    const props = featureGridSchema.parse({});
    const { container } = render(<FeatureGrid {...props} />);
    const section = container.querySelector("section.ac-feature-grid");
    expect(section).not.toBeNull();
    expect(section?.className).toMatch(/bg-theme-surface/);
  });

  it("defaults to 3 items and renders one card per item, in a responsive grid", () => {
    const props = featureGridSchema.parse({});
    const { container } = render(<FeatureGrid {...props} />);
    expect(container.querySelectorAll(".ac-feature-grid__item")).toHaveLength(3);
    const grid = container.querySelector(".ac-feature-grid__items");
    expect(grid?.className).toMatch(/grid-cols-1/);
    expect(grid?.className).toMatch(/sm:grid-cols-2/);
    expect(grid?.className).toMatch(/lg:grid-cols-3/);
  });

  it("renders up to 6 items", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      icon: "star",
      title: `Feature ${i}`,
      body: "",
    }));
    const props = featureGridSchema.parse({ items });
    const { container } = render(<FeatureGrid {...props} />);
    expect(container.querySelectorAll(".ac-feature-grid__item")).toHaveLength(6);
  });

  it("renders a curated icon as an SVG when the icon name matches", () => {
    const props = featureGridSchema.parse({
      items: [
        { icon: "shield", title: "A" },
        { icon: "bolt", title: "B" },
        { icon: "sparkles", title: "C" },
      ],
    });
    const { container } = render(<FeatureGrid {...props} />);
    expect(container.querySelectorAll(".ac-feature-grid__icon svg")).toHaveLength(3);
  });

  it("falls back to rendering the raw string (emoji) when the icon name isn't curated", () => {
    const props = featureGridSchema.parse({
      items: [
        { icon: "🚀", title: "A" },
        { icon: "shield", title: "B" },
        { icon: "heart", title: "C" },
      ],
    });
    const { container } = render(<FeatureGrid {...props} />);
    expect(screen.getByText("🚀")).toBeInTheDocument();
  });

  it("marks eyebrow/heading with data-field; item title/body render as plain text (array items aren't top-level editable)", () => {
    const props = featureGridSchema.parse({
      eyebrow: "Why us",
      heading: "Everything you need",
      items: [
        { icon: "star", title: "Title A", body: "Body A" },
        { icon: "star", title: "Title B", body: "Body B" },
        { icon: "star", title: "Title C", body: "Body C" },
      ],
    });
    const { container } = render(<FeatureGrid {...props} />);
    expect(container.querySelector('[data-field="eyebrow"]')?.textContent).toBe("Why us");
    expect(container.querySelector('[data-field="heading"]')?.textContent).toBe(
      "Everything you need",
    );
    expect(screen.getByText("Title A")).toBeInTheDocument();
    expect(screen.getByText("Body A")).toBeInTheDocument();
  });

  it("regression: no header renders when eyebrow/heading are both empty in normal mode", () => {
    const props = featureGridSchema.parse({ eyebrow: "", heading: "" });
    const { container } = render(<FeatureGrid {...props} />);
    expect(container.querySelector(".ac-feature-grid__header")).toBeNull();
  });

  it("edit mode: header renders even with empty eyebrow/heading, with clickable data-empty markers", () => {
    const props = featureGridSchema.parse({ eyebrow: "", heading: "" });
    const { container } = render(
      <EditModeProvider>
        <FeatureGrid {...props} />
      </EditModeProvider>,
    );
    expect(container.querySelector(".ac-feature-grid__header")).not.toBeNull();
    expect(container.querySelector('[data-field="eyebrow"][data-empty="true"]')).not.toBeNull();
    expect(container.querySelector('[data-field="heading"][data-empty="true"]')).not.toBeNull();
  });

  it("omits the item body paragraph when body is empty", () => {
    const props = featureGridSchema.parse({
      items: [
        { icon: "star", title: "A", body: "" },
        { icon: "star", title: "B", body: "" },
        { icon: "star", title: "C", body: "" },
      ],
    });
    const { container } = render(<FeatureGrid {...props} />);
    expect(container.querySelectorAll(".ac-feature-grid__item-body")).toHaveLength(0);
  });
});
