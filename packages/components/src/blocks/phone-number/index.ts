import type { BlockManifestEntry } from "../manifest.js";
import { phoneNumberSchema } from "./schema.js";
import { PhoneNumber } from "./PhoneNumber.js";

export const phoneNumberEntry: BlockManifestEntry<typeof phoneNumberSchema> = {
  type: "phone_number",
  schema: phoneNumberSchema,
  component: PhoneNumber,
  label: "Phone number",
  // W1.5 / D1114: model-facing description + precondition hint (see
  // crm-form/index.ts). The CTM number-swap detail stays — it explains why
  // the displayed number may differ — but the model's guidance is to use
  // the business's REAL number, never a placeholder.
  description:
    "Clickable tel: phone link. When the site has a CallTrackingMetrics (CTM) account configured, CTM swaps in a tracking number after page load.",
  aiHints:
    "Use the business's real phone number from the brief — never invent one or use a placeholder like 555-0100. If no phone number is known, omit this block and put contact details in the rich-footer or a cta instead. The CTM number swap only happens when the operator has configured CTM; without it, exactly the number you set is shown.",
  category: "content",
};
