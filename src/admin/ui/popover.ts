// src/admin/ui/popover.ts
//
// D315 — the anchored-popover behavior that was hand-rolled and triplicated
// (WorkspacePage's Publish confirmation, UserMenu, and the old AgentChatDrawer)
// centralized into one hook: outside-click + Escape dismissal, focus RESTORE
// to the trigger on close, and the keyboard contract the ARIA role implies
// (D313) — a focus trap for `role="dialog"`, arrow-key navigation for
// `role="menu"`. Consumers keep their own JSX (panel markup, role, initial
// focus for a dialog); this owns the behavior that every anchored popover
// needs and that each copy re-implemented (usually incompletely).

import { useEffect, useRef, type RefObject } from "react";

function focusableWithin(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

function menuItemsWithin(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitem"]'));
}

/** APG dialog focus trap: keep Tab / Shift+Tab inside the panel. */
function trapTab(e: KeyboardEvent, panel: HTMLElement): void {
  const focusables = focusableWithin(panel);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey) {
    if (active === first || !panel.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else if (active === last) {
    e.preventDefault();
    first.focus();
  }
}

/** APG menu keyboard: Up/Down cycle items, Home/End jump to ends. */
function menuNav(e: KeyboardEvent, panel: HTMLElement): void {
  const items = menuItemsWithin(panel);
  if (items.length === 0) return;
  const active = document.activeElement as HTMLElement | null;
  const idx = active ? items.indexOf(active) : -1;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    items[(idx + 1) % items.length].focus();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    items[(idx - 1 + items.length) % items.length].focus();
  } else if (e.key === "Home") {
    e.preventDefault();
    items[0].focus();
  } else if (e.key === "End") {
    e.preventDefault();
    items[items.length - 1].focus();
  }
}

export type UsePopoverOptions = {
  open: boolean;
  onClose: () => void;
  /** The popover panel element (role="dialog"/"menu"). */
  panelRef: RefObject<HTMLElement | null>;
  /** The trigger element — ignored by the outside-click handler, and where
   * focus is restored when the popover closes. */
  triggerRef: RefObject<HTMLElement | null>;
  /** The ARIA keyboard contract to implement. Omit for a plain dismissable
   * popover with no trap/nav (still gets Escape + outside-click + restore). */
  keyboard?: "dialog" | "menu";
  /** Menu mode only: focus the first menu item when the popover opens (APG). */
  autoFocusFirstItem?: boolean;
};

/**
 * Anchored, dismissable, focus-managed popover behavior. Returns nothing —
 * it wires document listeners while `open`.
 */
export function usePopover({
  open,
  onClose,
  panelRef,
  triggerRef,
  keyboard,
  autoFocusFirstItem,
}: UsePopoverOptions): void {
  // D313 — restore focus to the trigger when the popover closes (neither the
  // publish popover nor UserMenu did this before), and, for a menu, move
  // focus into the first item on open.
  const restoreRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    if (keyboard === "menu" && autoFocusFirstItem) {
      menuItemsWithin(panelRef.current)[0]?.focus();
    }
    return () => {
      const target = triggerRef.current ?? restoreRef.current;
      target?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const panel = panelRef.current;
      if (!panel) return;
      if (keyboard === "dialog" && e.key === "Tab") trapTab(e, panel);
      else if (keyboard === "menu") menuNav(e, panel);
    }
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open, keyboard, onClose, panelRef, triggerRef]);
}
