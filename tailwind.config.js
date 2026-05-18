import { brandColors, accentColors, surfaceColors, navyColor } from "./src/config/theme.js";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand:   brandColors,
        accent:  accentColors,
        surface: surfaceColors,
        navy:    navyColor,
      },
      fontFamily: {
        sans:    ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        heading: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        drama:   ['"Cormorant Garamond"', "Georgia", "serif"],
        mono:    ['"IBM Plex Mono"', "monospace"],
      },
      borderRadius: {
        "2xl": "1.5rem",
        "3xl": "2rem",
        "4xl": "3rem",
        "5xl": "4rem",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "ticker": "ticker 20s linear infinite",
      },
      keyframes: {
        ticker: {
          "0%":   { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
    },
  },
  plugins: [],
};
