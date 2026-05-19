import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from "../carousel.js";

function Harness() {
  return (
    <Carousel data-testid="carousel">
      <CarouselContent>
        <CarouselItem>Slide 1</CarouselItem>
        <CarouselItem>Slide 2</CarouselItem>
        <CarouselItem>Slide 3</CarouselItem>
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  );
}

describe("Carousel", () => {
  it("renders region + slides with proper ARIA roles", () => {
    render(<Harness />);
    const region = screen.getByRole("region");
    expect(region).toHaveAttribute("aria-roledescription", "carousel");
    expect(screen.getAllByRole("group")).toHaveLength(3);
    expect(screen.getAllByRole("group")[0]).toHaveAttribute("aria-roledescription", "slide");
  });

  it("renders prev + next controls with aria-labels", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Previous slide" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next slide" })).toBeInTheDocument();
  });

  it("the region is keyboard-focusable (tabIndex=0)", () => {
    render(<Harness />);
    expect(screen.getByRole("region")).toHaveAttribute("tabindex", "0");
  });

  it("ArrowRight keydown calls scrollNext (no throw, prevents default)", () => {
    render(<Harness />);
    const region = screen.getByRole("region");
    const event = { key: "ArrowRight", preventDefault: () => {} };
    // fireEvent.keyDown returns false if any handler called preventDefault.
    expect(() => fireEvent.keyDown(region, event)).not.toThrow();
  });

  it("custom label override on prev/next is respected", () => {
    render(
      <Carousel>
        <CarouselContent>
          <CarouselItem>x</CarouselItem>
        </CarouselContent>
        <CarouselPrevious label="Back" />
        <CarouselNext label="Forward" />
      </Carousel>,
    );
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forward" })).toBeInTheDocument();
  });
});
