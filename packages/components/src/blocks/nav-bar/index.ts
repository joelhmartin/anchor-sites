import type { BlockManifestEntry } from "../manifest.js";
import { navBarSchema } from "./schema.js";
import { NavBar } from "./component.js";

export const navBarEntry: BlockManifestEntry<typeof navBarSchema> = {
  type: "nav-bar",
  schema: navBarSchema,
  component: NavBar,
  label: "Nav bar",
  description: "Site navigation: brand + links, with default/centered/cta layout variants.",
  aiHints: "Use once, at the top of the page. Keep link labels under 3 words.",
  category: "header",
};
