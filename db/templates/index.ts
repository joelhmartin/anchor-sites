import type { TemplateSeed } from "./types.js";
import { starter } from "./starter.js";

/**
 * The template library registry (Task C4). Each template is authored as one
 * module (`starter.ts`, and `<slug>.ts` for each of C5-C14) exporting a single
 * `TemplateSeed`; this file just collects them for `seed-templates.ts` to
 * iterate. Adding a new template is: author the module, import it here, push
 * it onto this array — no other file needs to change.
 */
export const allTemplates: TemplateSeed[] = [starter];
