import type { CrmFormProps } from "./schema.js";

/**
 * D-053 — CRM embed block.
 *
 * SSR path: `dangerouslySetInnerHTML` with operator-authored embed_code.
 * PHI never touches the builder — the embed is from anchor-hub (D-006).
 * Compliant with architectural anchor #7: the <form> lives inside the
 * embed string, outside React's event system.
 *
 * Editor preview path: a styled placeholder card.
 * Detected via `isEditorPreview` prop so the Puck editor never renders
 * a live form-in-editor, which would violate the editor constraint.
 */
export function CrmForm({
  embed_code,
  label,
  isEditorPreview = false,
}: CrmFormProps & { isEditorPreview?: boolean }) {
  if (isEditorPreview) {
    return (
      <div className="ac-crm-form ac-crm-form--preview">
        <div
          style={{
            border: "1px dashed #aaa",
            borderRadius: "4px",
            padding: "1.5rem",
            textAlign: "center",
            color: "#555",
            background: "#fafafa",
          }}
        >
          {label ? `[CRM Form: ${label}]` : "[CRM Form]"}
        </div>
      </div>
    );
  }

  return (
    <div
      className="ac-crm-form"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: embed_code }}
    />
  );
}
