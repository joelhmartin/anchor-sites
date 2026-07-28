import * as React from "react";

/**
 * Inline-editing marker context (P?-inline-editing Task 2).
 *
 * `EditModeContext` defaults to `false` so every existing consumer of the
 * component package (production SSR, current tests) is unaffected unless it
 * explicitly opts in via `EditModeProvider`. The overlay/editor app wraps its
 * live-preview tree in `EditModeProvider` to flip block internals into
 * "clickable, always-rendered, empty-state-visible" mode.
 */
export const EditModeContext = React.createContext<boolean>(false);

export function EditModeProvider({ children }: { children: React.ReactNode }) {
  return <EditModeContext.Provider value={true}>{children}</EditModeContext.Provider>;
}

export interface EditableProps {
  /** Prop/schema field name this marker corresponds to (e.g. "eyebrow"). */
  field: string;
  /** Element tag to render. Defaults to "span". */
  as?: keyof JSX.IntrinsicElements;
  className?: string;
  /** The prop value (may be ""). */
  value: string;
  /** Shown in edit mode when `value` is empty. */
  placeholder?: string;
  /** Custom rendering of the value; defaults to `{value}`. */
  children?: React.ReactNode;
}

/**
 * Renders a text field with a `data-field` marker the inline-editing overlay
 * uses to locate and edit it.
 *
 * Normal mode (no `EditModeProvider` ancestor): behaves EXACTLY like the
 * conditional-render guards it replaces — empty `value` renders `null`,
 * non-empty renders the element with `data-field` added.
 *
 * Edit mode: always renders the element so empty fields stay clickable. Empty
 * values render the placeholder text with `data-empty="true"`.
 */
export function Editable({
  field,
  as = "span",
  className,
  value,
  placeholder,
  children,
}: EditableProps): JSX.Element | null {
  const editMode = React.useContext(EditModeContext);
  const isEmpty = value === "";
  const Tag = as as React.ElementType;

  if (!editMode && isEmpty) {
    return null;
  }

  if (isEmpty) {
    return (
      <Tag data-field={field} data-empty="true" className={className}>
        {placeholder ?? `Add ${field.replace(/_/g, " ")}…`}
      </Tag>
    );
  }

  return (
    <Tag data-field={field} className={className}>
      {children ?? value}
    </Tag>
  );
}
