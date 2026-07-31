import * as React from "react";
import { cn } from "../lib/cn.js";
import { EditModeContext } from "../editable.js";

/**
 * JS-free accordion (D1200 — spec:
 * docs/superpowers/specs/2026-07-31-published-page-interactivity.md).
 *
 * Published tenant pages ship zero client JavaScript and preview iframes run
 * under `script-src 'none'`, so expand/collapse must be NATIVE browser
 * behavior: `<details>/<summary>`. Content is always in the SSR HTML (SEO +
 * no-JS visitors); toggling costs no script anywhere.
 *
 * Exclusive-open ("single" mode) uses the `<details name>` grouping
 * attribute — evergreen browsers close the previously-open item natively;
 * older browsers degrade to independent items, which is harmless.
 *
 * Edit mode (EditModeContext): every item renders `open` and the group name
 * is dropped, so the Studio inline editor shows all answers at once.
 */

type AccordionContextValue = {
  /** Shared `<details name>` for exclusive-open groups; undefined = multi-open. */
  name?: string;
  /** Edit mode renders every item open so editors see all content. */
  forceOpen: boolean;
};

const AccordionContext = React.createContext<AccordionContextValue>({
  forceOpen: false,
});

export type AccordionProps = React.HTMLAttributes<HTMLDivElement> & {
  /** When true, any number of items may be open at once. Default: exclusive. */
  multiple?: boolean;
};

export function Accordion({ multiple = false, className, children, ...props }: AccordionProps) {
  const editMode = React.useContext(EditModeContext);
  // useId is stable across renderToString/hydration and unique per instance,
  // so two accordions on one page never share an exclusivity group.
  const id = React.useId();
  const value = React.useMemo<AccordionContextValue>(
    () => ({
      name: multiple || editMode ? undefined : `ac-accordion-${id}`,
      forceOpen: editMode,
    }),
    [multiple, editMode, id],
  );
  return (
    <AccordionContext.Provider value={value}>
      <div className={className} {...props}>
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

export type AccordionItemProps = Omit<
  React.DetailsHTMLAttributes<HTMLDetailsElement>,
  "name" | "open"
>;

export function AccordionItem({ className, children, ...props }: AccordionItemProps) {
  const { name, forceOpen } = React.useContext(AccordionContext);
  return (
    <details
      name={name}
      open={forceOpen || undefined}
      className={cn("ac-accordion__item border-b border-theme-border", className)}
      {...props}
    >
      {children}
    </details>
  );
}

export type AccordionTriggerProps = React.HTMLAttributes<HTMLElement>;

export function AccordionTrigger({ className, children, ...props }: AccordionTriggerProps) {
  return (
    <summary
      className={cn(
        // list-none + the webkit variant suppress the default disclosure
        // marker; the chevron below is the only affordance (rotated via
        // `.ac-accordion__item[open]` CSS in styles.css).
        "flex cursor-pointer items-center justify-between py-4 text-left font-medium transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent list-none [&::-webkit-details-marker]:hidden",
        className,
      )}
      {...props}
    >
      {children}
      {/* Unicode chevron + CSS rotate; no inline SVG per D-005. */}
      <span aria-hidden="true" className="ac-chevron ml-2 inline-block transition-transform duration-200">
        ▾
      </span>
    </summary>
  );
}

export type AccordionContentProps = React.HTMLAttributes<HTMLDivElement>;

export function AccordionContent({ className, children, ...props }: AccordionContentProps) {
  return (
    <div className={cn("overflow-hidden text-sm text-theme-on-surface", className)} {...props}>
      <div className="pb-4 pt-0">{children}</div>
    </div>
  );
}
