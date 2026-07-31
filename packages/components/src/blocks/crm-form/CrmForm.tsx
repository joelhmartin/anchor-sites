import * as React from "react";
import type { CrmFormProps } from "./schema.js";
import { EditModeContext } from "../../editable.js";

/**
 * D-053 — CRM embed block.
 *
 * SSR path: `dangerouslySetInnerHTML` with operator-authored embed_code.
 * PHI never touches the builder — the embed is from anchor-hub (D-006).
 * Compliant with architectural anchor #7: the <form> lives inside the
 * embed string, outside React's event system.
 *
 * Editor preview path: a styled placeholder card.
 * D1201 (W2-SEC) — the workspace editor is the SSR preview wrapped in
 * `EditModeProvider` (render-page.tsx), so the component consumes
 * `EditModeContext` directly: in edit mode the live embed HTML is never
 * rendered (an editor must not execute operator/AI-authored embeds — and a
 * live form under the click-to-edit overlay would be a submit trap anyway).
 * The `isEditorPreview` prop remains for editors that inject props instead
 * of context (buildPuckConfig honors the manifest's `requiresEditorWrapper`).
 */
export function CrmForm({
  embed_code,
  label,
  isEditorPreview = false,
}: CrmFormProps & { isEditorPreview?: boolean }) {
  const editMode = React.useContext(EditModeContext);
  if (isEditorPreview || editMode) {
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
