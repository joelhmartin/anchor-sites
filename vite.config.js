import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  // Express owns the HTML response (middleware mode + transformIndexHtml).
  // Vite is loaded as middleware from src/server/index.ts in dev.
  appType: "custom",
  resolve: {
    alias: {
      // Stub the monorepo shared package so this standalone app can build
      "@my-app/shared": fileURLToPath(new URL("./src/shared/index.js", import.meta.url)),
    },
  },
});
