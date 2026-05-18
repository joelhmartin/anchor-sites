/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THEME — Brand color palette. Single source of truth.
 *
 * Both tailwind.config.js and brand.js import from here.
 * Update these when setting up a new site.
 *
 * Use a tool like https://uicolors.app to generate a full
 * 50–950 palette from your primary color.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const brandColors = {
  50:  "#eff6ff",
  100: "#dbeafe",
  200: "#bfdbfe",
  300: "#93c5fd",
  400: "#60a5fa",
  500: "#2d95eb",   // ← Primary brand color
  600: "#2589db",   // ← Primary hover
  700: "#1d6faf",
  800: "#1e5c8f",
  900: "#1a4d75",
  950: "#132f4a",
};

export const accentColors = {
  400: "#f5c97a",
  500: "#e9a84c",
  600: "#c4832a",
};

export const surfaceColors = {
  50:  "#FFFFFF",
  100: "#FAFAFA",
  200: "#F2F2F2",
  300: "#E8E8E8",
  400: "#D9D9D9",
};

export const navyColor = {
  DEFAULT: "#1d1a1a",
  light:   "#2d2426",
  dark:    "#111010",
};
