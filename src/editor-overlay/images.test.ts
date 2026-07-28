// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boot, type EditBootData } from "./main.js";
import { IMAGE_CHIP_CLASS } from "./images.js";
import { LINK_CHIP_CLASS } from "./links.js";

/**
 * Overlay image swap + link chip tests (Inline Editing Task 7).
 *
 * Fixture markup mirrors the REAL renderer output (verified by reading
 * packages/components/src/blocks/image/component.tsx and
 * packages/components/src/blocks/hero/component.tsx, plus
 * src/components/BlockRenderer.tsx's `Wrap`):
 *   - image block, normal branch: `<picture data-field="asset_id" class="ac-image">`
 *   - image block, missing-variants branch: `<picture class="ac-image--missing-variants">`
 *     with NO `data-field` at all (the I2-review parity gap this task papers
 *     over from the overlay side).
 *   - hero block: `<a href={cta_href}>` with NO `data-field` — url fields
 *     aren't rendered through `Editable`, so the link chip lives on the
 *     block wrapper, not the anchor.
 */

const TOKEN = "tok_abc123";

const FIELDS: EditBootData["fields"] = {
  image: { asset_id: "image", alt: "text" },
  hero: { title: "text", cta_href: "url" },
};

const URLS: NonNullable<EditBootData["urls"]> = {
  h1: { cta_href: "https://example.com/current" },
};

function fixture(): void {
  document.body.innerHTML = `
    <div data-block-id="img1" data-block-type="image">
      <picture data-field="asset_id" class="ac-image">
        <img class="ac-image__img" src="/old.jpg" alt="old" />
      </picture>
    </div>
    <div data-block-id="img2" data-block-type="image">
      <picture class="ac-image--missing-variants"></picture>
    </div>
    <div data-block-id="h1" data-block-type="hero">
      <span data-field="title">Welcome</span>
      <a href="https://example.com/current">Learn more</a>
    </div>
  `;
}

function bootWith(overrides: Partial<EditBootData> = {}): { teardown: () => void } {
  window.__AC_EDIT_BOOT__ = {
    token: TOKEN,
    siteId: "site-1",
    pageId: "page-1",
    fields: FIELDS,
    urls: URLS,
    readonly: false,
    ...overrides,
  };
  const teardown = boot();
  return { teardown: teardown ?? (() => {}) };
}

describe("image swap + link chip overlay (Inline Editing Task 7)", () => {
  let postMessageSpy: ReturnType<typeof vi.fn>;
  let teardown: () => void;

  beforeEach(() => {
    fixture();
    postMessageSpy = vi.fn();
    Object.defineProperty(window, "parent", {
      value: { postMessage: postMessageSpy },
      configurable: true,
    });
  });

  afterEach(() => {
    teardown?.();
    delete (window as { __AC_EDIT_BOOT__?: unknown }).__AC_EDIT_BOOT__;
  });

  it("clicking the picture (normal branch) sends image-pick-request", () => {
    ({ teardown } = bootWith());
    postMessageSpy.mockClear();
    const picture = document.querySelector('[data-field="asset_id"]') as HTMLElement;

    picture.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(postMessageSpy).toHaveBeenCalledWith(
      { ac: "edit", token: TOKEN, type: "image-pick-request", blockId: "img1", field: "asset_id" },
      "*",
    );
  });

  it("clicking the swap chip sends image-pick-request", () => {
    ({ teardown } = bootWith());
    postMessageSpy.mockClear();
    const chip = document.querySelector(`.${IMAGE_CHIP_CLASS}`) as HTMLButtonElement;
    expect(chip).not.toBeNull();

    chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(postMessageSpy).toHaveBeenCalledWith(
      { ac: "edit", token: TOKEN, type: "image-pick-request", blockId: "img1", field: "asset_id" },
      "*",
    );
  });

  it("the missing-variants branch (no data-field) also gets a swap chip and emits image-pick-request", () => {
    ({ teardown } = bootWith());
    postMessageSpy.mockClear();
    const picture = document.querySelector(".ac-image--missing-variants") as HTMLElement;
    expect(picture.parentElement?.querySelector(`.${IMAGE_CHIP_CLASS}`)).not.toBeNull();

    picture.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(postMessageSpy).toHaveBeenCalledWith(
      { ac: "edit", token: TOKEN, type: "image-pick-request", blockId: "img2", field: "asset_id" },
      "*",
    );
  });

  it("apply-image replaces the picture's children with a single <img>", () => {
    ({ teardown } = bootWith());
    const picture = document.querySelector('[data-field="asset_id"]') as HTMLElement;

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          ac: "edit",
          token: TOKEN,
          type: "apply-image",
          blockId: "img1",
          field: "asset_id",
          src: "/new.jpg",
          alt: "new alt",
        },
      }),
    );

    expect(picture.children.length).toBe(1);
    const img = picture.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/new.jpg");
    expect(img.getAttribute("alt")).toBe("new alt");
    expect(img.className).toBe("ac-image__img");
  });

  it("apply-image with the wrong token is ignored", () => {
    ({ teardown } = bootWith());
    const picture = document.querySelector('[data-field="asset_id"]') as HTMLElement;
    const before = picture.innerHTML;

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          ac: "edit",
          token: "wrong-token",
          type: "apply-image",
          blockId: "img1",
          field: "asset_id",
          src: "/new.jpg",
          alt: "new alt",
        },
      }),
    );

    expect(picture.innerHTML).toBe(before);
  });

  it("a block with a url-classified field gets a link chip that sends link-edit-request with the bootData value", () => {
    ({ teardown } = bootWith());
    postMessageSpy.mockClear();
    const chip = document.querySelector(`.${LINK_CHIP_CLASS}`) as HTMLButtonElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain("cta_href");

    chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        ac: "edit",
        token: TOKEN,
        type: "link-edit-request",
        blockId: "h1",
        field: "cta_href",
        value: "https://example.com/current",
      },
      "*",
    );
  });

  it("link chip falls back to an empty value when bootData.urls has no entry for the block", () => {
    ({ teardown } = bootWith({ urls: {} }));
    postMessageSpy.mockClear();
    const chip = document.querySelector(`.${LINK_CHIP_CLASS}`) as HTMLButtonElement;

    chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "link-edit-request", blockId: "h1", field: "cta_href", value: "" }),
      "*",
    );
  });

  it("apply-field for a url updates the block's anchor href (best-effort)", () => {
    ({ teardown } = bootWith());
    const anchor = document.querySelector("#body a") ?? (document.querySelectorAll("a")[0] as HTMLAnchorElement);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          ac: "edit",
          token: TOKEN,
          type: "apply-field",
          blockId: "h1",
          field: "cta_href",
          value: "https://example.com/new",
        },
      }),
    );

    expect((anchor as HTMLAnchorElement).getAttribute("href")).toBe("https://example.com/new");
  });

  it("readonly disables the image swap and link-edit requests", () => {
    ({ teardown } = bootWith({ readonly: true }));
    postMessageSpy.mockClear();
    const picture = document.querySelector('[data-field="asset_id"]') as HTMLElement;
    const linkChip = document.querySelector(`.${LINK_CHIP_CLASS}`) as HTMLButtonElement;

    picture.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    linkChip.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(postMessageSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "image-pick-request" }),
      "*",
    );
    expect(postMessageSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "link-edit-request" }),
      "*",
    );
  });
});
