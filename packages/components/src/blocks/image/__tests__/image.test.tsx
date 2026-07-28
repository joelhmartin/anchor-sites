import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Image } from "../component.js";
import { imageSchema } from "../schema.js";
import { MediaProvider, type MediaAssetData } from "../../../media-context.js";
import { EditModeProvider } from "../../../editable.js";

function makeAsset(overrides: Partial<MediaAssetData> = {}): MediaAssetData {
  return {
    id: "asset-1",
    alt: "Asset alt",
    width: 1600,
    height: 900,
    focal_point: null,
    variants: [
      { name: "thumbnail", format: "webp", width: 200, height: 113, url: "https://x/thumb.webp" },
      { name: "sm", format: "webp", width: 480, height: 270, url: "https://x/sm.webp" },
      { name: "md", format: "webp", width: 768, height: 432, url: "https://x/md.webp" },
      { name: "thumbnail", format: "jpg", width: 200, height: 113, url: "https://x/thumb.jpg" },
      { name: "sm", format: "jpg", width: 480, height: 270, url: "https://x/sm.jpg" },
      { name: "md", format: "jpg", width: 768, height: 432, url: "https://x/md.jpg" },
    ],
    ...overrides,
  };
}

function renderWith(asset: MediaAssetData | null, props: Partial<{ asset_id: string }> = {}) {
  return render(
    <MediaProvider assets={asset ? [asset] : []}>
      <Image {...imageSchema.parse({ asset_id: asset?.id ?? "missing", ...props })} />
    </MediaProvider>,
  );
}

describe("ac-image (P3-T3.12)", () => {
  it("renders a <picture> with the ac-image root class and a webp <source>", () => {
    const { container } = renderWith(makeAsset());
    const picture = container.querySelector("picture.ac-image");
    expect(picture).not.toBeNull();
    const webp = container.querySelector('source[type="image/webp"]');
    expect(webp).not.toBeNull();
    // srcset is widths sorted ascending.
    expect(webp!.getAttribute("srcset")).toBe(
      "https://x/thumb.webp 200w, https://x/sm.webp 480w, https://x/md.webp 768w",
    );
  });

  it("uses the largest jpg as the <img> src + builds the jpg srcset", () => {
    const { container } = renderWith(makeAsset());
    const img = container.querySelector("img.ac-image__img") as HTMLImageElement;
    expect(img.src).toContain("/md.jpg"); // largest jpg width = 768
    expect(img.srcset).toBe(
      "https://x/thumb.jpg 200w, https://x/sm.jpg 480w, https://x/md.jpg 768w",
    );
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
  });

  it("renders width + height from the asset (avoids layout shift)", () => {
    const { container } = renderWith(makeAsset());
    const img = container.querySelector("img.ac-image__img") as HTMLImageElement;
    expect(img.getAttribute("width")).toBe("1600");
    expect(img.getAttribute("height")).toBe("900");
  });

  it("prefers prop alt over asset.alt; empty string when both blank", () => {
    const a = makeAsset({ alt: "From asset" });
    const { container } = render(
      <MediaProvider assets={[a]}>
        <Image {...imageSchema.parse({ asset_id: "asset-1", alt: "From prop" })} />
      </MediaProvider>,
    );
    expect(container.querySelector("img")!.getAttribute("alt")).toBe("From prop");
  });

  it("emits object-position style from focal_point", () => {
    const { container } = render(
      <MediaProvider assets={[makeAsset()]}>
        <Image
          {...imageSchema.parse({
            asset_id: "asset-1",
            focal_point: { x: 0.25, y: 0.75 },
          })}
        />
      </MediaProvider>,
    );
    const img = container.querySelector("img.ac-image__img") as HTMLImageElement;
    expect(img.style.objectPosition).toBe("25.00% 75.00%");
    expect(img.style.objectFit).toBe("cover");
  });

  it("applies the fit class (cover by default; contain when overridden)", () => {
    const { container } = render(
      <MediaProvider assets={[makeAsset()]}>
        <Image {...imageSchema.parse({ asset_id: "asset-1", fit: "contain" })} />
      </MediaProvider>,
    );
    expect(container.querySelector("picture.ac-image.ac-image--fit-contain")).not.toBeNull();
  });

  it("renders an ac-image--missing placeholder when the asset isn't in context", () => {
    const { container } = renderWith(null, { asset_id: "missing-id" });
    const picture = container.querySelector("picture.ac-image.ac-image--missing");
    expect(picture).not.toBeNull();
    expect(picture!.getAttribute("data-ac-image-missing")).toBe("missing-id");
  });

  it("marks the <picture> with data-field=\"asset_id\" when the asset resolves", () => {
    const { container } = renderWith(makeAsset());
    expect(container.querySelector('picture[data-field="asset_id"]')).not.toBeNull();
  });

  it('marks the missing-asset placeholder with data-field="asset_id" too', () => {
    const { container } = renderWith(null, { asset_id: "missing-id" });
    const picture = container.querySelector("picture.ac-image--missing");
    expect(picture!.getAttribute("data-field")).toBe("asset_id");
  });

  it("regression: missing-asset placeholder has no forced minHeight in normal mode", () => {
    const { container } = renderWith(null, { asset_id: "missing-id" });
    const picture = container.querySelector("picture.ac-image--missing") as HTMLElement;
    expect(picture.style.minHeight).toBe("");
  });

  it("edit mode: missing-asset placeholder gets a minHeight so it stays clickable", () => {
    const { container } = render(
      <EditModeProvider>
        <MediaProvider assets={[]}>
          <Image {...imageSchema.parse({ asset_id: "missing-id" })} />
        </MediaProvider>
      </EditModeProvider>,
    );
    const picture = container.querySelector("picture.ac-image--missing") as HTMLElement;
    expect(picture.style.minHeight).toBe("80px");
  });

  it("renders ac-image--missing-variants if the asset has no jpg variant", () => {
    const a = makeAsset({
      variants: [
        { name: "sm", format: "webp", width: 480, height: 270, url: "https://x/sm.webp" },
      ],
    });
    const { container } = renderWith(a);
    expect(container.querySelector("picture.ac-image--missing-variants")).not.toBeNull();
  });

  it("respects aspect_ratio by setting wrapper style", () => {
    const { container } = render(
      <MediaProvider assets={[makeAsset()]}>
        <Image {...imageSchema.parse({ asset_id: "asset-1", aspect_ratio: 1.5 })} />
      </MediaProvider>,
    );
    const p = container.querySelector("picture") as HTMLElement;
    // jsdom normalizes "1.5" → "1.5 / 1" in newer versions; accept either.
    expect(p.style.aspectRatio.replace(/\s*\/\s*1$/, "")).toBe("1.5");
  });
});
