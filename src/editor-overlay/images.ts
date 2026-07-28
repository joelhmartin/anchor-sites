/**
 * Image swap affordance (Inline Editing Task 7).
 *
 * The `image` block renders a `<picture data-field="asset_id">` (normal +
 * `.ac-image--missing` branches — see
 * packages/components/src/blocks/image/component.tsx). Every one of those
 * elements gets a small "Swap image" chip, absolutely positioned over it;
 * clicking the chip OR the picture itself sends `image-pick-request`.
 * Inbound `apply-image` replaces the `<picture>`'s children with a single
 * `<img>` so the preview shows the new pick immediately (real variants
 * regenerate server-side on next render).
 *
 * PARITY NOTE (I2 review): the block has a THIRD branch,
 * `.ac-image--missing-variants` (asset present, derived sizes not ready
 * yet), which renders with NO `data-field` at all — a components-package
 * gap out of this task's scope to fix at the source. It's cheap to paper
 * over from here though: the field classifier already tells us which field
 * on the "image" blockType is image-kind ("asset_id"), so `findImageFields`
 * locates that branch by class name within its block wrapper and reuses
 * that field name instead of requiring a `data-field` marker.
 */

import type { Bridge } from "./bridge.js";
import { blockIdFor, blockTypeFor, kindFor, type EditableFieldMap } from "./dom.js";

export const IMAGE_CHIP_CLASS = "ac-edit-image-chip";
export const IMAGE_CHIP_VISIBLE_CLASS = "ac-edit-image-chip--visible";
export const IMAGE_MISSING_VARIANTS_SELECTOR = ".ac-image--missing-variants";

interface ImageFieldTarget {
  el: HTMLElement;
  field: string;
}

interface ImageFieldState extends ImageFieldTarget {
  blockId: string;
  chip: HTMLButtonElement;
}

export interface ImageOverlay {
  /** Wire hover/click affordances on every image-kind field found under `root`. */
  activate(root: ParentNode, fields: EditableFieldMap, bridge: Bridge, token: string): void;
  /** Inbound `apply-image` (Studio → overlay): swap the `<picture>`'s content. */
  applyImage(blockId: string, field: string, src: string, alt: string): void;
  /** Inbound `set-readonly`: disable the swap affordance. */
  setReadonly(on: boolean): void;
}

function findImageFields(root: ParentNode, fields: EditableFieldMap): ImageFieldTarget[] {
  const out: ImageFieldTarget[] = [];
  const seen = new Set<HTMLElement>();

  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-block-id] [data-field]"))) {
    if (kindFor(el, fields) !== "image") continue;
    const field = el.getAttribute("data-field");
    if (!field) continue;
    seen.add(el);
    out.push({ el, field });
  }

  for (const el of Array.from(
    root.querySelectorAll<HTMLElement>(`[data-block-id] ${IMAGE_MISSING_VARIANTS_SELECTOR}`),
  )) {
    if (seen.has(el) || el.hasAttribute("data-field")) continue;
    const blockType = blockTypeFor(el);
    const field = blockType
      ? Object.entries(fields[blockType] ?? {}).find(([, kind]) => kind === "image")?.[0]
      : undefined;
    if (field) out.push({ el, field });
  }

  return out;
}

function ensureChip(el: HTMLElement): HTMLButtonElement {
  const wrapper = el.parentElement;
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = IMAGE_CHIP_CLASS;
  chip.textContent = "Swap image";
  chip.style.position = "absolute";
  chip.style.top = `${el.offsetTop + 4}px`;
  chip.style.right = "4px";
  if (wrapper) {
    if (getComputedStyle(wrapper).position === "static") wrapper.style.position = "relative";
    wrapper.appendChild(chip);
  } else {
    document.body.appendChild(chip);
  }
  return chip;
}

export function createImageOverlay(): ImageOverlay {
  const states: ImageFieldState[] = [];
  let readonly = false;

  return {
    activate(root, fields, bridge, token) {
      for (const { el, field } of findImageFields(root, fields)) {
        const blockId = blockIdFor(el);
        if (!blockId) continue;

        const chip = ensureChip(el);
        const state: ImageFieldState = { el, blockId, field, chip };
        states.push(state);

        const request = (): void => {
          if (readonly) return;
          bridge.send({ ac: "edit", token, type: "image-pick-request", blockId, field });
        };

        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          request();
        });
        el.addEventListener("click", request);

        el.addEventListener("mouseenter", () => chip.classList.add(IMAGE_CHIP_VISIBLE_CLASS));
        el.addEventListener("mouseleave", () => chip.classList.remove(IMAGE_CHIP_VISIBLE_CLASS));
      }
    },

    applyImage(blockId, field, src, alt) {
      for (const state of states) {
        if (state.blockId !== blockId || state.field !== field) continue;
        state.el.innerHTML = "";
        const img = document.createElement("img");
        img.src = src;
        img.alt = alt;
        img.className = "ac-image__img";
        state.el.appendChild(img);
        state.el.classList.remove("ac-image--missing", "ac-image--missing-variants");
        if (!state.el.classList.contains("ac-image")) state.el.classList.add("ac-image");
      }
    },

    setReadonly(on) {
      readonly = on;
      for (const state of states) {
        state.chip.classList.toggle(IMAGE_CHIP_VISIBLE_CLASS, false);
      }
    },
  };
}
