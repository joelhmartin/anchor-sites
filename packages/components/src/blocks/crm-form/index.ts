import type { BlockManifestEntry } from "../manifest.js";
import { crmFormSchema } from "./schema.js";
import { CrmForm } from "./CrmForm.js";

export const crmFormEntry: BlockManifestEntry<typeof crmFormSchema> = {
  type: "crm_form",
  schema: crmFormSchema,
  component: CrmForm,
  label: "CRM form",
  description: "Renders a CRM embed from anchor-hub. PHI never touches the builder (D-006). Use embed_code from the CRM site detail.",
  category: "content",
  requiresEditorWrapper: true,
};
