import type { BlockManifestEntry } from "../manifest.js";
import { phoneNumberSchema } from "./schema.js";
import { PhoneNumber } from "./PhoneNumber.js";

export const phoneNumberEntry: BlockManifestEntry<typeof phoneNumberSchema> = {
  type: "phone_number",
  schema: phoneNumberSchema,
  component: PhoneNumber,
  label: "Phone number",
  description: "Clickable tel: link. CTM will swap the display number after mount — never re-renders to preserve the swap.",
  category: "content",
};
