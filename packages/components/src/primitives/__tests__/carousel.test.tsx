import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from "../carousel.js";
import { CAROUSEL_ISLAND_JS } from "../carousel-island.js";

/**
 * D1200 — the carousel is a CSS scroll-snap strip enhanced by a tiny inline
 * vanilla-JS island (no Embla, no React state). Swiping/scrolling works with
 * zero JS; the island adds arrows, loop wrap-around, and autoplay where
 * scripts run. jsdom has no layout, so island tests assert wiring
 * (data-ac-ready, disabled sync, idempotence) rather than pixel movement.
 */

function Harness({ loop = false, autoplayMs }: { loop?: boolean; autoplayMs?: number }) {
  return (
    <Carousel loop={loop} autoplayMs={autoplayMs} data-testid="carousel">
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

/** Execute the island against the current document (idempotent by design). */
function runIsland() {
  // eslint-disable-next-line no-new-func
  new Function(CAROUSEL_ISLAND_JS)();
}

describe("Carousel (scroll-snap + inline island)", () => {
  it("renders region + slides with proper ARIA roles", () => {
    render(<Harness />);
    const region = screen.getByRole("region");
    expect(region).toHaveAttribute("aria-roledescription", "carousel");
    expect(screen.getAllByRole("group")).toHaveLength(3);
    expect(screen.getAllByRole("group")[0]).toHaveAttribute("aria-roledescription", "slide");
  });

  it("the viewport is a keyboard-focusable scroll-snap container", () => {
    const { container } = render(<Harness />);
    const vp = container.querySelector("[data-ac-viewport]") as HTMLElement;
    expect(vp).not.toBeNull();
    expect(vp.getAttribute("tabindex")).toBe("0");
    expect(vp.className).toMatch(/overflow-x-auto/);
    expect(vp.className).toMatch(/snap-x/);
    const slide = container.querySelector('[aria-roledescription="slide"]') as HTMLElement;
    expect(slide.className).toMatch(/snap-start/);
    expect(slide.className).toMatch(/basis-full/);
  });

  it("arrows render enabled at SSR time (never dead-disabled) with aria-labels", () => {
    render(<Harness />);
    const prev = screen.getByRole("button", { name: "Previous slide" });
    const next = screen.getByRole("button", { name: "Next slide" });
    // The island manages disabled state; SSR must not ship frozen controls.
    expect(prev.hasAttribute("disabled")).toBe(false);
    expect(next.hasAttribute("disabled")).toBe(false);
    expect(prev.className).toMatch(/ac-carousel__arrow/);
  });

  it("emits the enhancement island inline in its own markup", () => {
    const { container } = render(<Harness />);
    const scripts = container.querySelectorAll("script");
    expect(scripts).toHaveLength(1);
    expect(scripts[0].textContent).toBe(CAROUSEL_ISLAND_JS);
  });

  it("island marks the root ready and syncs arrow disabled state (non-loop: prev disabled at slide 1)", () => {
    const { container } = render(<Harness loop={false} />);
    runIsland();
    const root = container.querySelector("[data-ac-carousel]") as HTMLElement;
    expect(root.hasAttribute("data-ac-ready")).toBe(true);
    const prev = screen.getByRole("button", { name: "Previous slide" }) as HTMLButtonElement;
    const next = screen.getByRole("button", { name: "Next slide" }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
  });

  it("island never disables arrows in loop mode", () => {
    render(<Harness loop />);
    runIsland();
    const prev = screen.getByRole("button", { name: "Previous slide" }) as HTMLButtonElement;
    const next = screen.getByRole("button", { name: "Next slide" }) as HTMLButtonElement;
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);
  });

  it("island is idempotent — re-running never re-initializes a ready carousel", () => {
    const { container } = render(<Harness />);
    runIsland();
    expect(() => runIsland()).not.toThrow();
    // Still exactly one ready root, still marked.
    expect(container.querySelectorAll("[data-ac-ready]")).toHaveLength(1);
  });

  it("loop/autoplay knobs surface as data attributes for the island", () => {
    const { container } = render(<Harness loop autoplayMs={6000} />);
    const root = container.querySelector("[data-ac-carousel]") as HTMLElement;
    expect(root.hasAttribute("data-loop")).toBe(true);
    expect(root.getAttribute("data-autoplay")).toBe("6000");
  });

  it("no autoplay attribute when autoplayMs is absent", () => {
    const { container } = render(<Harness />);
    const root = container.querySelector("[data-ac-carousel]") as HTMLElement;
    expect(root.hasAttribute("data-autoplay")).toBe(false);
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

  it("the island stays honest to its spec budget: <2KB, framework-free, CSP-hashable", () => {
    expect(Buffer.byteLength(CAROUSEL_ISLAND_JS, "utf8")).toBeLessThan(2048);
    // No sequences that would break inline embedding.
    expect(CAROUSEL_ISLAND_JS).not.toContain("</script");
    // Framework-free: no React/Embla references.
    expect(CAROUSEL_ISLAND_JS).not.toMatch(/react|embla/i);
  });
});
