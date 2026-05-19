import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../accordion.js";

function Harness() {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="a">
        <AccordionTrigger>Q1</AccordionTrigger>
        <AccordionContent>A1</AccordionContent>
      </AccordionItem>
      <AccordionItem value="b">
        <AccordionTrigger>Q2</AccordionTrigger>
        <AccordionContent>A2</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

describe("Accordion", () => {
  it("renders triggers with aria-expanded=false initially", () => {
    render(<Harness />);
    const q1 = screen.getByRole("button", { name: /Q1/ });
    expect(q1).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles aria-expanded on click", () => {
    render(<Harness />);
    const q1 = screen.getByRole("button", { name: /Q1/ });
    fireEvent.click(q1);
    expect(q1).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses on a second click (collapsible=true)", () => {
    render(<Harness />);
    const q1 = screen.getByRole("button", { name: /Q1/ });
    fireEvent.click(q1);
    fireEvent.click(q1);
    expect(q1).toHaveAttribute("aria-expanded", "false");
  });

  it("only one item open at a time when type=single", () => {
    render(<Harness />);
    const q1 = screen.getByRole("button", { name: /Q1/ });
    const q2 = screen.getByRole("button", { name: /Q2/ });
    fireEvent.click(q1);
    fireEvent.click(q2);
    expect(q1).toHaveAttribute("aria-expanded", "false");
    expect(q2).toHaveAttribute("aria-expanded", "true");
  });
});
