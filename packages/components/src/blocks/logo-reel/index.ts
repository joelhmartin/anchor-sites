import type { BlockManifestEntry } from "../manifest.js";
import { logoReelSchema } from "./schema.js";
import { LogoReel } from "./component.js";

export const logoReelEntry: BlockManifestEntry<typeof logoReelSchema> = {
  type: "logo-reel",
  schema: logoReelSchema,
  component: LogoReel,
  label: "Logo reel",
  description: "Horizontal scrolling logo strip. CSS-only marquee.",
  aiHints:
    "5-12 logos works best. Use to signal social proof / partners / clients. Disable speed reductions for users with prefers-reduced-motion.",
  category: "content",
};
