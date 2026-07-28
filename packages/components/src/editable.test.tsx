import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Editable, EditModeProvider } from "./editable.js";

describe("Editable (inline-editing marker helper)", () => {
  it("normal mode + empty value renders nothing (preserves today's conditional-render behavior)", () => {
    const { container } = render(<Editable field="eyebrow" value="" />);
    expect(container.innerHTML).toBe("");
  });

  it("normal mode + non-empty value renders the element with data-field, no data-empty", () => {
    const { container } = render(<Editable field="eyebrow" as="p" value="We do dentistry" />);
    const el = container.querySelector('p[data-field="eyebrow"]');
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe("We do dentistry");
    expect(el!.hasAttribute("data-empty")).toBe(false);
  });

  it("edit mode + empty value renders the placeholder with data-empty", () => {
    const { container } = render(
      <EditModeProvider>
        <Editable field="eyebrow" as="p" value="" />
      </EditModeProvider>,
    );
    const el = container.querySelector('p[data-field="eyebrow"]');
    expect(el).not.toBeNull();
    expect(el!.getAttribute("data-empty")).toBe("true");
    expect(el!.textContent).toBe("Add eyebrow…");
  });

  it("edit mode + empty value uses a custom placeholder when provided", () => {
    const { container } = render(
      <EditModeProvider>
        <Editable field="cta_label" value="" placeholder="Add a button label…" />
      </EditModeProvider>,
    );
    expect(container.querySelector('[data-field="cta_label"]')!.textContent).toBe(
      "Add a button label…",
    );
  });

  it("edit mode + non-empty value renders the value (no data-empty)", () => {
    const { container } = render(
      <EditModeProvider>
        <Editable field="eyebrow" as="p" value="We do dentistry" />
      </EditModeProvider>,
    );
    const el = container.querySelector('p[data-field="eyebrow"]');
    expect(el!.hasAttribute("data-empty")).toBe(false);
    expect(el!.textContent).toBe("We do dentistry");
  });

  it("defaults to a <span> when `as` is omitted", () => {
    const { container } = render(<Editable field="x" value="hi" />);
    expect(container.querySelector('span[data-field="x"]')).not.toBeNull();
  });

  it("applies className", () => {
    const { container } = render(<Editable field="x" value="hi" className="foo bar" />);
    expect(container.querySelector(".foo.bar")).not.toBeNull();
  });

  it("supports custom children rendering instead of the raw value", () => {
    const { container } = render(
      <Editable field="x" value="raw" as="div">
        <strong>custom</strong>
      </Editable>,
    );
    const el = container.querySelector('div[data-field="x"]')!;
    expect(el.querySelector("strong")).not.toBeNull();
    expect(el.textContent).toBe("custom");
  });
});
