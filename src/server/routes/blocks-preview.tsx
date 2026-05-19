import { Router, type Request, type Response } from "express";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { BlockRenderer } from "../../components/BlockRenderer.js";
// Side-effect: register the three static blocks.
import "../../blocks/index.js";

export const blocksPreviewRouter: Router = Router();

const FORM_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Block preview harness</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { margin: 0; font: 14px/1.4 system-ui, sans-serif; color: #1a1a1a; }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 1.5rem; }
    h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
    textarea {
      width: 100%; min-height: 240px;
      font: 13px/1.4 ui-monospace, SFMono-Regular, monospace;
      padding: 0.75rem; border: 1px solid #ccc; border-radius: 0.375rem;
      resize: vertical;
    }
    button { padding: 0.5rem 1rem; border: 0; border-radius: 0.375rem;
             background: #111; color: #fff; cursor: pointer; }
    .out { margin-top: 1.5rem; border: 1px solid #ddd; border-radius: 0.375rem; }
    .out__head { background: #f5f5f5; padding: 0.5rem 0.75rem; font-weight: 600;
                 border-bottom: 1px solid #ddd; }
    .out__body { padding: 1rem; }
    .hint { color: #666; font-size: 0.8125rem; margin: 0.5rem 0 0.75rem; }
  </style>
</head>
<body>
  <main class="wrap">
    <h1>Block preview harness <small style="font-weight:400;color:#666">— dev only</small></h1>
    <p class="hint">POST a JSON array of <code>Block</code> objects to <code>/__blocks/preview</code>.
       Example below — click <em>Render</em> to see the SSR output.</p>
    <form id="f">
      <textarea id="j">[
  { "id": "b1", "type": "hero",      "props": { "title": "Hello world", "cta_label": "Get started", "cta_href": "/x" } },
  { "id": "b2", "type": "rich-text", "props": { "html": "<h2>Heading</h2><p>Some body text.</p>" } },
  { "id": "b3", "type": "cta",       "props": { "heading": "Ready?", "button_label": "Talk to us", "button_href": "/contact" } }
]</textarea>
      <p><button type="submit">Render</button></p>
    </form>
    <div id="out" class="out" hidden>
      <div class="out__head">Rendered HTML</div>
      <div id="outBody" class="out__body"></div>
    </div>
  </main>
  <script>
    const f = document.getElementById('f');
    const j = document.getElementById('j');
    const out = document.getElementById('out');
    const outBody = document.getElementById('outBody');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const blocks = JSON.parse(j.value);
        const r = await fetch('/__blocks/preview', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ blocks })
        });
        const html = await r.text();
        outBody.innerHTML = html;
        out.hidden = false;
      } catch (err) {
        outBody.textContent = String(err);
        out.hidden = false;
      }
    });
  </script>
</body>
</html>`;

blocksPreviewRouter.get("/__blocks/preview", (_req: Request, res: Response) => {
  res.status(200).set({ "Content-Type": "text/html; charset=utf-8" }).end(FORM_HTML);
});

blocksPreviewRouter.post("/__blocks/preview", (req: Request, res: Response) => {
  const blocks = req.body?.blocks;
  if (!Array.isArray(blocks)) {
    res.status(400).type("text/html").end("expected { blocks: Block[] }");
    return;
  }
  try {
    const html = renderToString(createElement(BlockRenderer, { blocks, editable: true }));
    res.status(200).set({ "Content-Type": "text/html; charset=utf-8" }).end(html);
  } catch (err) {
    res.status(500).type("text/plain").end(String(err));
  }
});
