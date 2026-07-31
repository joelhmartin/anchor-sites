import type { BlockManifestEntry } from "../manifest.js";
import { crmFormSchema } from "./schema.js";
import { CrmForm } from "./CrmForm.js";

export const crmFormEntry: BlockManifestEntry<typeof crmFormSchema> = {
  type: "crm_form",
  schema: crmFormSchema,
  component: CrmForm,
  label: "CRM form",
  // W1.5 / D1114 (refreshed post-W1.6/D700): the description + aiHints are
  // written for the MODEL as consumer (the AI block catalog serializes
  // both). Since W1.6, templates ship WORKING platform lead forms — plain
  // HTML posts to the site's own /api/leads endpoint (stored as Leads) — so
  // the old "renders nothing without a CRM embed" precondition is false and
  // steered agents away from a block that works out of the box. PHI/form
  // submissions still never touch the builder (D-006).
  description:
    "Lead-capture form. Renders the embed_code HTML verbatim; templates ship a working platform lead form that posts to the site's own /api/leads endpoint and stores submissions as Leads.",
  aiHints:
    "embed_code must be a complete HTML form. Reuse or adapt an existing crm_form embed already on this site, or the platform lead-form pattern: <form action=\"/api/leads\" method=\"post\"> with name/email/message inputs, a hidden _page input carrying the page path, and a visually-hidden text input named \"website\" (honeypot — leave it empty). Never invent third-party form embeds, iframes, or external form URLs; an externally-hosted CRM embed is only valid when the operator supplied it.",
  category: "content",
  requiresEditorWrapper: true,
};
