import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app.js";
import { mountViteDev } from "./vite-dev.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const PORT = Number(process.env.PORT ?? 3000);
const isProd = process.env.NODE_ENV === "production";

async function main() {
  const app = createApp();

  if (isProd) {
    app.use(express.static(path.join(ROOT, "dist")));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(ROOT, "dist", "index.html"));
    });
  } else {
    await mountViteDev(app, ROOT);
  }

  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT} (${isProd ? "prod" : "dev"})`);
  });
}

main().catch((err) => {
  console.error("[server] failed to start", err);
  process.exit(1);
});
