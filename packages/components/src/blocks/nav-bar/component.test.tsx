import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NavBar } from "./component.js";
import { navBarSchema } from "./schema.js";
import { MediaProvider, type MediaAssetData } from "../../media-context.js";
import { EditModeProvider } from "../../editable.js";

function makeAsset(overrides: Partial<MediaAssetData> = {}): MediaAssetData {
  return {
    id: "logo-1",
    alt: "Logo alt",
    variants: [{ name: "sm", format: "webp", width: 200, height: 60, url: "https://x/logo.webp" }],
    ...overrides,
  };
}

function makeMultiVariantAsset(): MediaAssetData {
  return {
    id: "logo-2",
    alt: "Multi logo",
    variants: [
      { name: "sm", format: "webp", width: 200, height: 60, url: "https://x/sm.webp" },
      { name: "lg", format: "webp", width: 800, height: 240, url: "https://x/lg.webp" },
      { name: "sm", format: "jpg", width: 200, height: 60, url: "https://x/sm.jpg" },
    ],
  };
}

describe("ac-nav-bar", () => {
  it("renders as a <header> with a <nav aria-label='Primary'> landmark", () => {
    const props = navBarSchema.parse({});
    const { container } = render(<NavBar {...props} />);
    const header = container.querySelector("header.ac-nav-bar");
    expect(header).not.toBeNull();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toBeInTheDocument();
  });

  it("defaults to the 'default' variant with brand + 3 links, no CTA button", () => {
    const props = navBarSchema.parse({});
    const { container } = render(<NavBar {...props} />);
    expect(container.querySelector(".ac-nav-bar--default")).not.toBeNull();
    expect(container.querySelectorAll(".ac-nav-bar__links li")).toHaveLength(3);
    expect(container.querySelector(".ac-nav-bar__cta")).toBeNull();
  });

  it("'centered' variant stacks brand above a centered link row", () => {
    const props = navBarSchema.parse({ variant: "centered" });
    const { container } = render(<NavBar {...props} />);
    expect(container.querySelector(".ac-nav-bar--centered")).not.toBeNull();
    expect(container.querySelector(".ac-nav-bar__inner")?.className).toMatch(/flex-col/);
    expect(container.querySelector(".ac-nav-bar__links")?.className).toMatch(/justify-center/);
  });

  it("'cta' variant renders an accent CTA button alongside the links", () => {
    const props = navBarSchema.parse({ variant: "cta", cta_label: "Book now", cta_href: "/book" });
    render(<NavBar {...props} />);
    const link = screen.getByRole("link", { name: "Book now" });
    expect(link.getAttribute("href")).toBe("/book");
  });

  it("regression: 'default' and 'centered' variants never render a CTA button even if cta_label is set", () => {
    const propsDefault = navBarSchema.parse({ variant: "default", cta_label: "Hidden" });
    const { container: c1 } = render(<NavBar {...propsDefault} />);
    expect(c1.querySelector(".ac-nav-bar__cta")).toBeNull();

    const propsCentered = navBarSchema.parse({ variant: "centered", cta_label: "Hidden" });
    const { container: c2 } = render(<NavBar {...propsCentered} />);
    expect(c2.querySelector(".ac-nav-bar__cta")).toBeNull();
  });

  it("edit mode: 'cta' variant with empty cta_label still renders a clickable button", () => {
    const props = navBarSchema.parse({ variant: "cta", cta_label: "" });
    const { container } = render(
      <EditModeProvider>
        <NavBar {...props} />
      </EditModeProvider>,
    );
    expect(container.querySelector(".ac-nav-bar__cta")).not.toBeNull();
    expect(
      container.querySelector('.ac-nav-bar__cta [data-field="cta_label"][data-empty="true"]'),
    ).not.toBeNull();
  });

  it("regression: 'cta' variant with empty cta_label renders no button in normal mode", () => {
    const props = navBarSchema.parse({ variant: "cta", cta_label: "" });
    const { container } = render(<NavBar {...props} />);
    expect(container.querySelector(".ac-nav-bar__cta")).toBeNull();
  });

  it("renders brand_name as text when no logo_asset_id is set", () => {
    const props = navBarSchema.parse({ brand_name: "Acme" });
    const { container } = render(<NavBar {...props} />);
    expect(container.querySelector(".ac-nav-bar__brand")?.textContent).toBe("Acme");
    expect(container.querySelector(".ac-nav-bar__logo")).toBeNull();
  });

  it("resolves logo_asset_id via MediaContext into an <img>, using asset.alt over brand_name", () => {
    const props = navBarSchema.parse({ brand_name: "Acme", logo_asset_id: "logo-1" });
    const { container } = render(
      <MediaProvider assets={[makeAsset()]}>
        <NavBar {...props} />
      </MediaProvider>,
    );
    const img = container.querySelector(".ac-nav-bar__logo") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toContain("logo.webp");
    expect(img.getAttribute("alt")).toBe("Logo alt");
  });

  it("renders link hrefs", () => {
    const props = navBarSchema.parse({
      links: [{ label: "Pricing", href: "/pricing" }],
    });
    render(<NavBar {...props} />);
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/pricing");
  });

  // ---- Fix round 1 (review): mobile collapse, no overflow at 390px ----

  it("'default' variant: outer row stacks on mobile and goes horizontal from sm:, matching the batch's breakpoint convention", () => {
    const props = navBarSchema.parse({ variant: "default" });
    const { container } = render(<NavBar {...props} />);
    const inner = container.querySelector(".ac-nav-bar__inner");
    expect(inner?.className).toMatch(/flex-col/);
    expect(inner?.className).toMatch(/sm:flex-row/);
  });

  it("'default' variant: the links+CTA group wraps instead of overflowing", () => {
    const props = navBarSchema.parse({
      variant: "default",
      links: Array.from({ length: 7 }, (_, i) => ({ label: `Link ${i}`, href: `#${i}` })),
    });
    const { container } = render(<NavBar {...props} />);
    expect(container.querySelector(".ac-nav-bar__right")?.className).toMatch(/flex-wrap/);
  });

  it("'cta' variant: outer row stacks on mobile and goes horizontal from sm:", () => {
    const props = navBarSchema.parse({ variant: "cta", cta_label: "Book now" });
    const { container } = render(<NavBar {...props} />);
    const inner = container.querySelector(".ac-nav-bar__inner");
    expect(inner?.className).toMatch(/flex-col/);
    expect(inner?.className).toMatch(/sm:flex-row/);
  });

  it("'cta' variant: the links+CTA group wraps and the CTA is full-width on mobile, auto width from sm:", () => {
    const props = navBarSchema.parse({
      variant: "cta",
      cta_label: "Book now",
      links: Array.from({ length: 7 }, (_, i) => ({ label: `Link ${i}`, href: `#${i}` })),
    });
    const { container } = render(<NavBar {...props} />);
    expect(container.querySelector(".ac-nav-bar__right")?.className).toMatch(/flex-wrap/);
    expect(container.querySelector(".ac-nav-bar__cta")?.className).toMatch(/w-full/);
    expect(container.querySelector(".ac-nav-bar__cta")?.className).toMatch(/sm:w-auto/);
  });

  it("'centered' variant: link row wraps sanely with many links (no overflow)", () => {
    const props = navBarSchema.parse({
      variant: "centered",
      links: Array.from({ length: 7 }, (_, i) => ({ label: `Link ${i}`, href: `#${i}` })),
    });
    const { container } = render(<NavBar {...props} />);
    const links = container.querySelector(".ac-nav-bar__links");
    expect(links?.className).toMatch(/flex-wrap/);
    expect(links?.className).toMatch(/justify-center/);
    expect(container.querySelectorAll(".ac-nav-bar__links li")).toHaveLength(7);
  });

  // ---- Fix round 1 (review): retina logo ----

  it("picks the LARGEST webp variant for the logo src (regression: previously picked the smallest)", () => {
    const props = navBarSchema.parse({ brand_name: "Acme", logo_asset_id: "logo-2" });
    const { container } = render(
      <MediaProvider assets={[makeMultiVariantAsset()]}>
        <NavBar {...props} />
      </MediaProvider>,
    );
    const img = container.querySelector(".ac-nav-bar__logo") as HTMLImageElement;
    expect(img.src).toContain("lg.webp");
  });

  it("builds a webp srcSet across all available widths so the browser can pick a sharper image", () => {
    const props = navBarSchema.parse({ brand_name: "Acme", logo_asset_id: "logo-2" });
    const { container } = render(
      <MediaProvider assets={[makeMultiVariantAsset()]}>
        <NavBar {...props} />
      </MediaProvider>,
    );
    const img = container.querySelector(".ac-nav-bar__logo") as HTMLImageElement;
    expect(img.srcset).toBe("https://x/sm.webp 200w, https://x/lg.webp 800w");
  });

  it("single-variant assets (no srcSet possible) still resolve a src without throwing", () => {
    const props = navBarSchema.parse({ brand_name: "Acme", logo_asset_id: "logo-1" });
    const { container } = render(
      <MediaProvider assets={[makeAsset()]}>
        <NavBar {...props} />
      </MediaProvider>,
    );
    const img = container.querySelector(".ac-nav-bar__logo") as HTMLImageElement;
    expect(img.src).toContain("logo.webp");
  });
});
