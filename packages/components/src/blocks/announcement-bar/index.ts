import type { BlockManifestEntry } from "../manifest.js";
import { announcementBarSchema } from "./schema.js";
import { AnnouncementBar } from "./component.js";

export const announcementBarEntry: BlockManifestEntry<typeof announcementBarSchema> = {
  type: "announcement-bar",
  schema: announcementBarSchema,
  component: AnnouncementBar,
  label: "Announcement bar",
  description: "Static full-width band with a short message and an optional link. Not dismissible.",
  aiHints: "Use for one time-sensitive message. Keep text under 15 words.",
  category: "layout",
};
