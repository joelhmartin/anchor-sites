import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../accordion.js";
import { EditModeProvider } from "../../editable.js";

/**
 * D1200 — the accordion is native <details>/<summary>, not Radix. jsdom does
 * not implement the browser's summary-activation or name-exclusivity
 * behaviors, so these tests assert the CONTRACT the browser executes: real
 * details/summary elements, always-present content, and correct `name`
 * grouping. The SSR suite (blocks/__tests__/ssr.test.tsx) proves the same
 * markup needs no framework runtime.
 */

function Harness({ multiple = false }: { multiple?: boolean }) {
  return (
    <Accordion multiple={multiple}>
      <AccordionItem>
        <AccordionTrigger>Q1</AccordionTrigger>
        <AccordionContent>A1</AccordionContent>
      </AccordionItem>
      <AccordionItem>
        <AccordionTrigger>Q2</AccordionTrigger>
        <AccordionContent>A2</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

describe("Accordion (native details/summary)", () => {
  it("renders one <details> per item with a <summary> trigger", () => {
    const { container } = render(<Harness />);
    const items = container.querySelectorAll("details");
    expect(items).toHaveLength(2);
    expect(items[0].querySelector("summary")?.textContent).toContain("Q1");
    expect(items[1].querySelector("summary")?.textContent).toContain("Q2");
  });

  it("content is ALWAYS in the DOM (closed items included)", () => {
    render(<Harness />);
    expect(screen.getByText("A1")).toBeInTheDocument();
    expect(screen.getByText("A2")).toBeInTheDocument();
  });

  it("single-open mode: all items share one <details name> group", () => {
    const { container } = render(<Harness multiple={false} />);
    const items = [...container.querySelectorAll("details")];
    const names = items.map((d) => d.getAttribute("name"));
    expect(names[0]).toBeTruthy();
    expect(new Set(names).size).toBe(1);
  });

  it("multiple mode: no name attribute, items open independently", () => {
    const { container } = render(<Harness multiple />);
    for (const d of container.querySelectorAll("details")) {
      expect(d.hasAttribute("name")).toBe(false);
    }
  });

  it("items are closed by default in normal mode", () => {
    const { container } = render(<Harness />);
    for (const d of container.querySelectorAll("details")) {
      expect(d.open).toBe(false);
    }
  });

  it("setting details.open reveals content natively (no React handler involved)", () => {
    const { container } = render(<Harness />);
    const first = container.querySelector("details") as HTMLDetailsElement;
    first.open = true;
    expect(first.open).toBe(true);
    // The content was already in the DOM — open only toggles visibility.
    expect(first.textContent).toContain("A1");
  });

  it("edit mode: every item renders open and the exclusivity name is dropped", () => {
    const { container } = render(
      <EditModeProvider>
        <Harness multiple={false} />
      </EditModeProvider>,
    );
    const items = [...container.querySelectorAll("details")];
    expect(items).toHaveLength(2);
    for (const d of items) {
      expect(d.open).toBe(true);
      expect(d.hasAttribute("name")).toBe(false);
    }
  });
});
