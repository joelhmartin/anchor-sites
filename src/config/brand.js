import { BUSINESS } from "./site.js";
import { brandColors } from "./theme.js";

export const brand = {
  name:    BUSINESS.name,
  tagline: BUSINESS.tagline,
  logo:    null,
  colors: {
    primary:      brandColors[500],
    primaryHover: brandColors[600],
  },
};
