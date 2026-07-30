import type { TemplateSeed } from "./types.js";
import { starter } from "./starter.js";
import { dentalPractice } from "./dental-practice.js";
import { homeServices } from "./home-services.js";
import { restaurant } from "./restaurant.js";
import { lawFirm } from "./law-firm.js";
import { fitnessStudio } from "./fitness-studio.js";
import { creativePortfolio } from "./creative-portfolio.js";
import { coaching } from "./coaching.js";
import { nonprofit } from "./nonprofit.js";
import { localRetail } from "./local-retail.js";
import { smbLanding } from "./smb-landing.js";

/**
 * The template library registry (Task C4). Each template is authored as one
 * module (`starter.ts`, and `<slug>.ts` for each of C5-C14) exporting a single
 * `TemplateSeed`; this file just collects them for `seed-templates.ts` to
 * iterate. Adding a new template is: author the module, import it here, push
 * it onto this array — no other file needs to change.
 */
export const allTemplates: TemplateSeed[] = [
  dentalPractice,
  homeServices,
  restaurant,
  lawFirm,
  fitnessStudio,
  creativePortfolio,
  coaching,
  nonprofit,
  localRetail,
  smbLanding,
  starter,
];
