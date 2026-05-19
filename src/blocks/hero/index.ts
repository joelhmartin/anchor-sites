import "./styles.css";
import { registerBlock } from "../registry.js";
import { heroSchema } from "./schema.js";
import { Hero } from "./component.js";

registerBlock("hero", {
  schema: heroSchema,
  component: Hero,
  label: "Hero",
  description: "Top-of-page banner with eyebrow, title, subtitle, and CTA.",
  aiHints: "Use one per page, at the top. Keep titles under 8 words.",
  category: "header",
});

export { heroSchema, Hero };
