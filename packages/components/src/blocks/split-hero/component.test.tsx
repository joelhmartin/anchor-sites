import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SplitHero } from "./component.js";
import { splitHeroSchema } from "./schema.js";
import { MediaProvider, type MediaAssetData } from "../../media-context.js";
import { EditModeProvider } from "../../editable.js";

function makeAsset(overrides: Partial<MediaAssetData> = {}): MediaAssetData {
  return {
    id: "asset-1",
    alt: "Asset alt",
    width: 1200,
    height: 900,
    variants: [
      { name: "md", format: "webp", width: 768, height: 576, url: "https://x/md.webp" },
      { name: "md", format: "jpg", width: 768, height: 576, url: "https://x/md.jpg" },
    ],
    ...overrides,
  };
}

describe("ac-split-hero", () => {
  it("renders the ac-split-hero root class + brand tokens", () => {
    const props = splitHeroSchema.parse({ heading: "Hello" });
    const { container } = render(<SplitHero {...props} />);
    const section = container.querySelector("section.ac-split-hero");
    expect(section).not.toBeNull();
    expect(section?.className).toMatch(/bg-theme-main/);
  });

  it("defaults to image-right: media column ordered after copy on large screens", () => {
    const props = splitHeroSchema.parse({});
    const { container } = render(<SplitHero {...props} />);
    const media = container.querySelector(".ac-split-hero__media");
    const copy = container.querySelector(".ac-split-hero__copy");
    expect(media?.className).toMatch(/lg:order-2/);
    expect(copy?.className).toMatch(/lg:order-1/);
  });

  it("image-left variant flips the order classes", () => {
    const props = splitHeroSchema.parse({ variant: "image-left" });
    const { container } = render(<SplitHero {...props} />);
    const media = container.querySelector(".ac-split-hero__media");
    const copy = container.querySelector(".ac-split-hero__copy");
    expect(media?.className).toMatch(/lg:order-1/);
    expect(copy?.className).toMatch(/lg:order-2/);
  });

  it("marks eyebrow/heading/body/CTAs with data-field", () => {
    const props = splitHeroSchema.parse({
      eyebrow: "Eye",
      heading: "Head",
      body: "Body",
      primary_cta_label: "Go",
      secondary_cta_label: "Learn more",
    });
    const { container } = render(<SplitHero {...props} />);
    expect(container.querySelector('[data-field="eyebrow"]')?.textContent).toBe("Eye");
    expect(container.querySelector('[data-field="heading"]')?.textContent).toBe("Head");
    expect(container.querySelector('[data-field="body"]')?.textContent).toBe("Body");
    expect(container.querySelector('[data-field="primary_cta_label"]')?.textContent).toBe("Go");
    expect(container.querySelector('[data-field="secondary_cta_label"]')?.textContent).toBe(
      "Learn more",
    );
  });

  it("regression: empty eyebrow/body render nothing in normal mode; no CTAs render when both labels are empty", () => {
    const props = splitHeroSchema.parse({
      eyebrow: "",
      body: "",
      primary_cta_label: "",
      secondary_cta_label: "",
    });
    const { container } = render(<SplitHero {...props} />);
    expect(container.querySelector('[data-field="eyebrow"]')).toBeNull();
    expect(container.querySelector('[data-field="body"]')).toBeNull();
    expect(container.querySelector(".ac-split-hero__ctas")).toBeNull();
  });

  it("edit mode: empty fields become clickable data-empty markers and the CTAs row still renders", () => {
    const props = splitHeroSchema.parse({
      eyebrow: "",
      body: "",
      primary_cta_label: "",
      secondary_cta_label: "",
    });
    const { container } = render(
      <EditModeProvider>
        <SplitHero {...props} />
      </EditModeProvider>,
    );
    expect(container.querySelector('[data-field="eyebrow"][data-empty="true"]')).not.toBeNull();
    expect(container.querySelector('[data-field="body"][data-empty="true"]')).not.toBeNull();
    expect(container.querySelector(".ac-split-hero__ctas")).not.toBeNull();
  });

  it("renders a placeholder with data-field=\"image_asset_id\" when no asset is provided", () => {
    const props = splitHeroSchema.parse({});
    const { container } = render(<SplitHero {...props} />);
    expect(
      container.querySelector('.ac-split-hero__image--missing[data-field="image_asset_id"]'),
    ).not.toBeNull();
  });

  it("resolves image_asset_id via MediaContext to a <picture> with webp source + jpg <img>", () => {
    const props = splitHeroSchema.parse({ image_asset_id: "asset-1", image_alt: "A photo" });
    const { container } = render(
      <MediaProvider assets={[makeAsset()]}>
        <SplitHero {...props} />
      </MediaProvider>,
    );
    const picture = container.querySelector('picture[data-field="image_asset_id"]');
    expect(picture).not.toBeNull();
    expect(picture!.querySelector('source[type="image/webp"]')).not.toBeNull();
    const img = picture!.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("alt")).toBe("A photo");
    expect(img.src).toContain("md.jpg");
  });

  it("renders CTA hrefs as anchors", () => {
    const props = splitHeroSchema.parse({
      primary_cta_label: "Book now",
      primary_cta_href: "/contact",
    });
    render(<SplitHero {...props} />);
    const link = screen.getByRole("link", { name: "Book now" });
    expect(link.getAttribute("href")).toBe("/contact");
  });
});
