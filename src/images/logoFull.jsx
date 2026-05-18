import { LOGOS, BUSINESS } from "../config/site.js";

/**
 * Logo component — renders the appropriate variant based on context.
 *
 * @param {string}  className
 * @param {boolean} dark      — true = dark/black logo (for light backgrounds)
 * @param {"horizontal"|"stacked"|"icon"} variant — logo layout (default: horizontal)
 */
const LogoFull = ({ className = "", dark = false, variant = "horizontal" }) => {
  let src;

  if (variant === "icon") {
    src = LOGOS.icon;
  } else if (variant === "stacked") {
    src = dark ? (LOGOS.stackedBlack || LOGOS.horizontalBlack) : (LOGOS.stackedWhite || LOGOS.horizontalWhite);
  } else {
    src = dark ? LOGOS.horizontalBlack : LOGOS.horizontalWhite;
  }

  return (
    <img
      src={src}
      alt={BUSINESS.name}
      className={className}
    />
  );
};

export default LogoFull;
