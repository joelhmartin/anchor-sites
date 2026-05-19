import type { BlockManifestEntry } from "../manifest.js";
import { imageSchema } from "./schema.js";
import { Image } from "./component.js";

export const imageEntry: BlockManifestEntry<typeof imageSchema> = {
  type: "image",
  schema: imageSchema,
  component: Image,
  label: "Image",
  description:
    "Responsive image with WebP+JPG srcset, lazy loading, and optional focal point. Resolves variants via MediaContext.",
  aiHints:
    "Always set alt unless purely decorative. Use focal_point when the subject is off-center and the image is cropped (fit: cover).",
  category: "content",
};
