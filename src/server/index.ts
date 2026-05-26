import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app.js";
import { mountViteDev } from "./vite-dev.js";
import { pool } from "./db.js";
import { bootJobs, stopJobs } from "./jobs/index.js";
import { verifyPluginMigrations } from "./plugins/loader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const PORT = Number(process.env.PORT ?? 3000);
const isProd = process.env.NODE_ENV === "production";

async function main() {
  // Verify registered plugins (env + migrations) before composing the app, so
  // only properly-installed plugins mount (P7.5-T7.5.4, fail-soft).
  let activePlugins: string[] | undefined;
  try {
    const { active, skipped } = await verifyPluginMigrations({ pool });
    activePlugins = active;
    for (const s of skipped) {
      console.warn(`[plugins] skipping "${s.name}": ${s.reason}`);
    }
  } catch (err) {
    console.error("[plugins] verify failed; starting with no plugins", err);
    activePlugins = [];
  }

  const app = createApp({ activePlugins });

  if (isProd) {
    app.use(express.static(path.join(ROOT, "dist")));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(ROOT, "dist", "index.html"));
    });
  } else {
    await mountViteDev(app, ROOT);
  }

  // Boot pg-boss (D-030 / P3-T3.8). Skipped when JOBS_ENABLED=false.
  try {
    await bootJobs(pool);
  } catch (err) {
    console.error("[server] pg-boss failed to start; continuing without job runner", err);
  }

  const server = app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT} (${isProd ? "prod" : "dev"})`);
  });

  // Clean shutdown — pg-boss flushes in-flight jobs.
  const shutdown = async (signal: string) => {
    console.log(`[server] ${signal} received, shutting down`);
    await stopJobs().catch((err) => console.error("[server] stopJobs error", err));
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[server] failed to start", err);
  process.exit(1);
});
