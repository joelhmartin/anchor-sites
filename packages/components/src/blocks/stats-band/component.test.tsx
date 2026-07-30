import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatsBand } from "./component.js";
import { statsBandSchema } from "./schema.js";
import { EditModeProvider } from "../../editable.js";

describe("ac-stats-band", () => {
  it("renders the ac-stats-band root class + brand accent tokens (full-bleed)", () => {
    const props = statsBandSchema.parse({});
    const { container } = render(<StatsBand {...props} />);
    const section = container.querySelector("section.ac-stats-band");
    expect(section).not.toBeNull();
    expect(section?.className).toMatch(/bg-theme-accent/);
    expect(section?.className).toMatch(/text-theme-on-accent/);
  });

  it("defaults to 2 stats", () => {
    const props = statsBandSchema.parse({});
    const { container } = render(<StatsBand {...props} />);
    expect(container.querySelectorAll(".ac-stats-band__stat")).toHaveLength(2);
  });

  it.each([2, 3, 4, 5])("renders exactly %d stats with a matching grid-cols class", (n) => {
    const stats = Array.from({ length: n }, (_, i) => ({ value: `${i}`, label: `Stat ${i}` }));
    const props = statsBandSchema.parse({ stats });
    const { container } = render(<StatsBand {...props} />);
    expect(container.querySelectorAll(".ac-stats-band__stat")).toHaveLength(n);
    const grid = container.querySelector(".ac-stats-band__stats");
    expect(grid?.className).toMatch(/grid-cols-2/);
  });

  it("renders value + label text for each stat", () => {
    const props = statsBandSchema.parse({
      stats: [
        { value: "42", label: "Answers found" },
        { value: "7", label: "Days a week" },
      ],
    });
    const { container } = render(<StatsBand {...props} />);
    const values = [...container.querySelectorAll(".ac-stats-band__value")].map((n) => n.textContent);
    const labels = [...container.querySelectorAll(".ac-stats-band__label")].map((n) => n.textContent);
    expect(values).toEqual(["42", "7"]);
    expect(labels).toEqual(["Answers found", "Days a week"]);
  });

  it("marks heading with data-field", () => {
    const props = statsBandSchema.parse({ heading: "By the numbers" });
    const { container } = render(<StatsBand {...props} />);
    expect(container.querySelector('[data-field="heading"]')?.textContent).toBe(
      "By the numbers",
    );
  });

  it("regression: empty heading renders nothing in normal mode", () => {
    const props = statsBandSchema.parse({ heading: "" });
    const { container } = render(<StatsBand {...props} />);
    expect(container.querySelector('[data-field="heading"]')).toBeNull();
  });

  it("edit mode: empty heading becomes a clickable data-empty marker", () => {
    const props = statsBandSchema.parse({ heading: "" });
    const { container } = render(
      <EditModeProvider>
        <StatsBand {...props} />
      </EditModeProvider>,
    );
    expect(container.querySelector('[data-field="heading"][data-empty="true"]')).not.toBeNull();
  });
});
