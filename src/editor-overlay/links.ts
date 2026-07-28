/**
 * Link-chip affordance for url-classified fields (Inline Editing Task 7).
 *
 * `url`-kind fields (e.g. hero's `cta_href`, cta's `button_href`) drive an
 * `<a href>` somewhere inside the block's markup, but — unlike text fields —
 * they aren't necessarily rendered through `Editable`, so there's often no
 * `[data-field]` marker to click (see `packages/components/src/blocks/hero/
 * component.tsx`'s `<a href={cta_href}>`, which has none). Every block
 * wrapper that has at least one url-classified field for its blockType gets
 * a small "Edit link · <field>" chip instead; clicking it sends
 * `link-edit-request` with the CURRENT value read from bootData's
 * server-built `urls` map (the overlay has no other way to know a prop
 * value that isn't reflected in the DOM). Inbound `apply-field` for a url
 * field is best-effort cosmetic: it updates the first matching `<a>` inside
 * that block wrapper (preferring one marked `[data-field]` for that field
 * name, if any) — the real source of truth is Studio's save.
 */

import type { Bridge } from "./bridge.js";
import type { EditableFieldMap } from "./dom.js";

export const LINK_CHIP_CLASS = "ac-edit-link-chip";
export const LINK_CHIP_VISIBLE_CLASS = "ac-edit-link-chip--visible";

export type UrlValueMap = Record<string, Record<string, string>>;

interface LinkFieldState {
  wrapper: HTMLElement;
  blockId: string;
  field: string;
  chip: HTMLButtonElement;
}

export interface LinkOverlay {
  /** Wire a link chip on every block wrapper with a url-kind field under `root`. */
  activate(root: ParentNode, fields: EditableFieldMap, urls: UrlValueMap, bridge: Bridge, token: string): void;
  /** Inbound `apply-field` (Studio → overlay): best-effort update the block's `<a href>`. */
  applyField(blockId: string, field: string, value: string): void;
  /** Inbound `set-readonly`: disable the link-chip affordance. */
  setReadonly(on: boolean): void;
}

interface LinkFieldTarget {
  wrapper: HTMLElement;
  blockId: string;
  field: string;
}

function findLinkFields(root: ParentNode, fields: EditableFieldMap): LinkFieldTarget[] {
  const out: LinkFieldTarget[] = [];
  for (const wrapper of Array.from(root.querySelectorAll<HTMLElement>("[data-block-id][data-block-type]"))) {
    const blockId = wrapper.getAttribute("data-block-id");
    const blockType = wrapper.getAttribute("data-block-type");
    if (!blockId || !blockType) continue;
    for (const [field, kind] of Object.entries(fields[blockType] ?? {})) {
      if (kind === "url") out.push({ wrapper, blockId, field });
    }
  }
  return out;
}

function ensureChip(wrapper: HTMLElement, field: string, index: number): HTMLButtonElement {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = LINK_CHIP_CLASS;
  chip.textContent = `Edit link · ${field}`;
  chip.style.position = "absolute";
  chip.style.top = `${4 + index * 24}px`;
  chip.style.right = "4px";
  if (getComputedStyle(wrapper).position === "static") wrapper.style.position = "relative";
  wrapper.appendChild(chip);
  return chip;
}

export function createLinkOverlay(): LinkOverlay {
  const states: LinkFieldState[] = [];
  let readonly = false;

  return {
    activate(root, fields, urls, bridge, token) {
      const chipIndexByWrapper = new Map<HTMLElement, number>();

      for (const { wrapper, blockId, field } of findLinkFields(root, fields)) {
        const index = chipIndexByWrapper.get(wrapper) ?? 0;
        chipIndexByWrapper.set(wrapper, index + 1);

        const chip = ensureChip(wrapper, field, index);
        const state: LinkFieldState = { wrapper, blockId, field, chip };
        states.push(state);

        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          if (readonly) return;
          const value = urls[blockId]?.[field] ?? "";
          bridge.send({ ac: "edit", token, type: "link-edit-request", blockId, field, value });
        });

        wrapper.addEventListener("mouseenter", () => chip.classList.add(LINK_CHIP_VISIBLE_CLASS));
        wrapper.addEventListener("mouseleave", () => chip.classList.remove(LINK_CHIP_VISIBLE_CLASS));
      }
    },

    applyField(blockId, field, value) {
      for (const state of states) {
        if (state.blockId !== blockId || state.field !== field) continue;
        const anchor =
          state.wrapper.querySelector<HTMLAnchorElement>(`a[data-field="${field}"]`) ??
          state.wrapper.querySelector<HTMLAnchorElement>("a");
        if (anchor) anchor.setAttribute("href", value);
      }
    },

    setReadonly(on) {
      readonly = on;
      for (const state of states) {
        state.chip.classList.toggle(LINK_CHIP_VISIBLE_CLASS, false);
      }
    },
  };
}
