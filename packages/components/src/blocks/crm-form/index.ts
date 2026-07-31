import type { BlockManifestEntry } from "../manifest.js";
import { crmFormSchema } from "./schema.js";
import { CrmForm } from "./CrmForm.js";

export const crmFormEntry: BlockManifestEntry<typeof crmFormSchema> = {
  type: "crm_form",
  schema: crmFormSchema,
  component: CrmForm,
  label: "CRM form",
  // W1.5 / D1114: the description + aiHints are written for the MODEL as
  // consumer (the AI block catalog serializes both) — they must carry the
  // block's render precondition, not internal architecture notes. Form
  // submissions/PHI still never touch the builder (D-006); the embed is
  // configured by the operator on the site's CRM tab.
  description:
    "Embedded lead-capture form provided by the site's CRM integration. Renders nothing unless the operator has configured a CRM embed for this site.",
  aiHints:
    "PRECONDITION: only place this when the site's CRM embed is configured (operator-managed; you cannot configure it). On a site without a configured CRM, this renders as an empty gap — use a cta block (linking to a contact method) or a rich-text contact section instead.",
  category: "content",
  requiresEditorWrapper: true,
};
