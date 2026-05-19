import path from "node:path";
import { readFile } from "node:fs/promises";
import type { Express } from "express";
import type { ViteDevServer } from "vite";

export async function mountViteDev(app: Express, root: string): Promise<ViteDevServer> {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root,
    appType: "custom",
    server: { middlewareMode: true },
  });

  app.use(vite.middlewares);

  app.get(/.*/, async (req, res, next) => {
    try {
      const url = req.originalUrl;
      const html = await vite.transformIndexHtml(
        url,
        await readFile(path.join(root, "index.html"), "utf-8"),
      );
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (err) {
      vite.ssrFixStacktrace(err as Error);
      next(err);
    }
  });

  return vite;
}
