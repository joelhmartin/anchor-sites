import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app.js";

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
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: ROOT,
      appType: "custom",
      server: { middlewareMode: true },
    });
    app.use(vite.middlewares);
    app.get(/.*/, async (req, res, next) => {
      try {
        const url = req.originalUrl;
        const template = await vite.transformIndexHtml(
          url,
          await (await import("node:fs/promises")).readFile(
            path.join(ROOT, "index.html"),
            "utf-8",
          ),
        );
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (err) {
        vite.ssrFixStacktrace(err as Error);
        next(err);
      }
    });
  }

  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT} (${isProd ? "prod" : "dev"})`);
  });
}

main().catch((err) => {
  console.error("[server] failed to start", err);
  process.exit(1);
});
