import { z } from "zod";
import type { BlockRegistryEntry } from "../../../blocks/types.js";

/**
 * Reference-plugin block (P7.5-T7.5.7). A minimal `ac-`-prefixed banner that
 * demonstrates a plugin contributing a block under its namespace
 * (`example/banner`). Pure function of props; Font Awesome over inline SVG; no
 * `font-family` (repo conventions). Registered into the global block registry
 * by the loader when the plugin is active.
 */

export const exampleBannerSchema = z.object({
  message: z.string().default("Hello from the example plugin"),
  tone: z.enum(["info", "warn"]).default("info"),
});

type Props = z.infer<typeof exampleBannerSchema>;

function ExampleBanner({ message, tone }: Props) {
  const icon = tone === "warn" ? "fa-triangle-exclamation" : "fa-circle-info";
  return (
    <div className={`ac-example-banner ac-example-banner--${tone}`} role="note">
      <i className={`fa-solid ${icon} ac-example-banner__icon`} aria-hidden="true" />
      <span className="ac-example-banner__message">{message}</span>
    </div>
  );
}

export const exampleBannerBlock: BlockRegistryEntry<typeof exampleBannerSchema> = {
  schema: exampleBannerSchema,
  component: ExampleBanner,
  label: "Example banner",
  description: "Reference-plugin banner demonstrating a plugin-contributed block.",
  category: "content",
};
