import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Express owns the HTML response (middleware mode + transformIndexHtml).
  // Vite is loaded as middleware from src/server/index.ts in dev.
  appType: "custom",
});
