import { z } from "zod";

/**
 * Announcement-bar block (Task C2, batch 1 — structural blocks).
 *
 * A static, always-visible band (dismissible=false per the brief — no
 * dismiss affordance/state is implemented in this batch) with a short
 * message and an optional link.
 */
export const announcementBarSchema = z.object({
  text: z.string().min(1).max(200).default("Big news! Something new just launched."),
  link_label: z.string().max(40).default(""),
  link_href: z.string().max(500).default("#"),
});
export type AnnouncementBarProps = z.infer<typeof announcementBarSchema>;
