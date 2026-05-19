/**
 * Package-local Tailwind config (D-028).
 *
 * Compiled to a single `dist/styles.css` consumed via
 * `import "@anchorcorps/components/styles.css"`. The renderer does NOT
 * need to install Tailwind to use the package — this config exists only
 * to generate the package's prebuilt CSS bundle.
 *
 * Content globs are scoped to this package — Tailwind never scans the
 * renderer's source, so the bundle size is bounded by the package's own
 * usage.
 */

import tailwindAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx,css}"],
  theme: {
    extend: {
      colors: {
        // Brand tokens — these map to CSS custom properties the renderer
        // sets at :root per-site. Components reference Tailwind classes
        // like `bg-theme-main` which compile to `background: var(--theme-main)`.
        "theme-main":      "var(--theme-main)",
        "theme-on-main":   "var(--theme-on-main, #fff)",
        "theme-accent":    "var(--theme-accent)",
        "theme-on-accent": "var(--theme-on-accent, #111)",
        "theme-surface":   "var(--theme-surface, #fff)",
        "theme-on-surface": "var(--theme-on-surface, #111)",
        "theme-muted":     "var(--theme-muted, #f4f4f5)",
        "theme-on-muted":  "var(--theme-on-muted, #4b5563)",
        "theme-border":    "var(--theme-border, #e5e7eb)",
      },
      borderRadius: {
        // Reserve scale; consumers can override at :root via
        // `--theme-radius`. No `font-family` declarations here (D-005).
      },
    },
  },
  plugins: [tailwindAnimate],
};
