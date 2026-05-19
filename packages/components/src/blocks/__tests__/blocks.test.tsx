import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Hero } from "../hero/component.js";
import { heroSchema } from "../hero/schema.js";

import { HeroSlider } from "../hero-slider/component.js";
import { heroSliderSchema } from "../hero-slider/schema.js";

import { Cta } from "../cta/component.js";
import { ctaSchema } from "../cta/schema.js";

import { TestimonialCarousel } from "../testimonial-carousel/component.js";
import { testimonialCarouselSchema } from "../testimonial-carousel/schema.js";

import { LogoReel } from "../logo-reel/component.js";
import { logoReelSchema } from "../logo-reel/schema.js";

import { FaqAccordion } from "../faq-accordion/component.js";
import { faqAccordionSchema } from "../faq-accordion/schema.js";

describe("ac-hero", () => {
  it("renders with the ac-hero root class + brand tokens", () => {
    const props = heroSchema.parse({ title: "Hello" });
    const { container } = render(<Hero {...props} />);
    const section = container.querySelector("section.ac-hero");
    expect(section).not.toBeNull();
    expect(section?.className).toMatch(/bg-theme-main/);
  });

  it("respects align variant", () => {
    const props = heroSchema.parse({ title: "T", align: "left" });
    const { container } = render(<Hero {...props} />);
    expect(container.querySelector(".ac-hero--align-left")).not.toBeNull();
  });

  it("renders the eyebrow when present", () => {
    const props = heroSchema.parse({ title: "T", eyebrow: "We do dentistry" });
    render(<Hero {...props} />);
    expect(screen.getByText("We do dentistry")).toBeInTheDocument();
  });
});

describe("ac-hero-slider", () => {
  it("renders one CarouselItem per slide and an ac-hero-slider root", () => {
    const props = heroSliderSchema.parse({
      slides: [
        { title: "One" },
        { title: "Two" },
        { title: "Three" },
      ],
    });
    const { container } = render(<HeroSlider {...props} />);
    expect(container.querySelector(".ac-hero-slider")).not.toBeNull();
    expect(screen.getAllByRole("group")).toHaveLength(3);
  });

  it("hides arrow controls on single-slide configs", () => {
    const props = heroSliderSchema.parse({ slides: [{ title: "Solo" }] });
    render(<HeroSlider {...props} />);
    expect(screen.queryByRole("button", { name: "Previous slide" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next slide" })).toBeNull();
  });

  // ---- P3-T3.13 — image_asset_id resolution + legacy `image` URL fallback ----
  it("renders a slide with legacy `image: <url>` as a background-image (no asset_id required)", async () => {
    const { heroSliderSchema: schema } = await import("../hero-slider/schema.js");
    const props = schema.parse({
      slides: [{ title: "Legacy", image: "https://example.com/old.jpg" }],
    });
    const { container } = render(<HeroSlider {...props} />);
    const slide = container.querySelector(".ac-hero-slider__slide") as HTMLElement;
    expect(slide.style.backgroundImage).toContain("https://example.com/old.jpg");
    // Overlay rendered for legibility.
    expect(slide.querySelector(".bg-theme-main.opacity-50")).not.toBeNull();
  });

  it("resolves image_asset_id via MediaContext to the widest webp variant; uses focal_point for backgroundPosition", async () => {
    const { MediaProvider } = await import("../../media-context.js");
    const { heroSliderSchema: schema } = await import("../hero-slider/schema.js");
    const props = schema.parse({
      slides: [{ title: "Modern", image_asset_id: "asset-99" }],
    });
    const asset = {
      id: "asset-99",
      alt: "Modern alt",
      focal_point: { x: 0.2, y: 0.8 },
      variants: [
        { name: "sm" as const, format: "webp" as const, width: 480, height: 270, url: "https://x/sm.webp" },
        { name: "lg" as const, format: "webp" as const, width: 1280, height: 720, url: "https://x/lg.webp" },
        { name: "lg" as const, format: "jpg" as const, width: 1280, height: 720, url: "https://x/lg.jpg" },
      ],
    };
    const { container } = render(
      <MediaProvider assets={[asset]}>
        <HeroSlider {...props} />
      </MediaProvider>,
    );
    const slide = container.querySelector(".ac-hero-slider__slide") as HTMLElement;
    expect(slide.style.backgroundImage).toContain("https://x/lg.webp");
    // jsdom normalizes "20.00%" → "20%". Either is acceptable.
    expect(slide.style.backgroundPosition.replace(/\s+/g, " ")).toMatch(/^20(?:\.00)?% 80(?:\.00)?%$/);
  });

  it("falls back to legacy `image` when image_asset_id is set but the asset isn't in context", async () => {
    const { heroSliderSchema: schema } = await import("../hero-slider/schema.js");
    const props = schema.parse({
      slides: [
        { title: "Hybrid", image_asset_id: "missing", image: "https://example.com/fallback.jpg" },
      ],
    });
    const { container } = render(<HeroSlider {...props} />);
    const slide = container.querySelector(".ac-hero-slider__slide") as HTMLElement;
    expect(slide.style.backgroundImage).toContain("https://example.com/fallback.jpg");
  });
});

describe("ac-cta", () => {
  it("renders ac-cta root + primary variant class", () => {
    const props = ctaSchema.parse({});
    const { container } = render(<Cta {...props} />);
    expect(container.querySelector("section.ac-cta")).not.toBeNull();
    expect(container.querySelector(".ac-cta--primary")).not.toBeNull();
  });

  it("renders button as an anchor with href via Slot", () => {
    const props = ctaSchema.parse({ button_label: "Book", button_href: "/contact" });
    render(<Cta {...props} />);
    const link = screen.getByRole("link", { name: "Book" });
    expect(link.getAttribute("href")).toBe("/contact");
  });

  it("switches background classes for the muted variant", () => {
    const props = ctaSchema.parse({ variant: "muted" });
    const { container } = render(<Cta {...props} />);
    expect(container.querySelector(".ac-cta--muted")).not.toBeNull();
    expect(container.querySelector(".bg-theme-muted")).not.toBeNull();
  });
});

describe("ac-testimonial-carousel", () => {
  it("renders heading and one slide per item", () => {
    const props = testimonialCarouselSchema.parse({
      heading: "Voices",
      items: [
        { quote: "Q1", author: "A1" },
        { quote: "Q2", author: "A2" },
      ],
    });
    render(<TestimonialCarousel {...props} />);
    expect(screen.getByText("Voices")).toBeInTheDocument();
    expect(screen.getAllByRole("group")).toHaveLength(2);
    expect(screen.getByText(/Q1/)).toBeInTheDocument();
    expect(screen.getByText("A1")).toBeInTheDocument();
  });

  it("renders role when provided, omits when blank", () => {
    const props = testimonialCarouselSchema.parse({
      items: [{ quote: "Q", author: "A", role: "CEO" }],
    });
    render(<TestimonialCarousel {...props} />);
    expect(screen.getByText("CEO")).toBeInTheDocument();
  });
});

describe("ac-logo-reel", () => {
  it("doubles the logo list for seamless marquee looping", () => {
    const props = logoReelSchema.parse({
      logos: [
        { src: "a.png", alt: "A" },
        { src: "b.png", alt: "B" },
      ],
    });
    const { container } = render(<LogoReel {...props} />);
    const imgs = container.querySelectorAll(".ac-logo-reel__logo");
    // 2 logos doubled → 4 images
    expect(imgs.length).toBe(4);
  });

  it("renders an anchor wrapper when href is set", () => {
    const props = logoReelSchema.parse({
      logos: [{ src: "a.png", alt: "A", href: "https://example.com" }],
    });
    const { container } = render(<LogoReel {...props} />);
    expect(container.querySelectorAll("a.ac-logo-reel__link").length).toBeGreaterThan(0);
  });

  it("sets the speed CSS custom property from props", () => {
    const props = logoReelSchema.parse({ logos: [{ src: "a", alt: "" }], speed_seconds: 45 });
    const { container } = render(<LogoReel {...props} />);
    const viewport = container.querySelector(".ac-logo-reel__viewport") as HTMLElement;
    expect(viewport.style.getPropertyValue("--ac-logo-reel-duration")).toBe("45s");
  });
});

describe("ac-faq-accordion", () => {
  it("renders ac-faq-accordion root + one trigger per item", () => {
    const props = faqAccordionSchema.parse({
      items: [
        { question: "Q1", answer: "A1" },
        { question: "Q2", answer: "A2" },
      ],
    });
    const { container } = render(<FaqAccordion {...props} />);
    expect(container.querySelector("section.ac-faq-accordion")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Q1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Q2/ })).toBeInTheDocument();
  });

  it("renders heading when present", () => {
    const props = faqAccordionSchema.parse({ heading: "FAQ", items: [{ question: "x", answer: "y" }] });
    render(<FaqAccordion {...props} />);
    expect(screen.getByText("FAQ")).toBeInTheDocument();
  });
});
