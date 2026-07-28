import { z } from "zod";
import type { AgentTool, AgentToolCtx, AgentToolResult } from "./types.js";
import { getTemplate } from "../../../templates/repo.js";
import { handleMaterializeTemplate } from "../../../jobs/materialize-template.js";
import { searchPixabay } from "../../../media/pixabay.js";
import { ingestImageFromUrl, type IngestDeps } from "../../../media/ingest.js";

/**
 * Template + image tools (Task 7): apply_site_template, search_stock_images,
 * import_image.
 *
 * `apply_site_template` calls `handleMaterializeTemplate` directly rather than
 * enqueueing the pg-boss job the operator-initiated /sites/from-template route
 * uses (routes/templates.ts:359-441) — the agent needs the pages to exist
 * before its next tool call, and the handler is already idempotent (skips
 * sites that already have pages), so a synchronous call is safe here. The
 * 404/kind/archived checks mirror that same route's guard block, translated
 * into `ok:false` tool results instead of HTTP responses.
 *
 * `import_image` special-cases `example.invalid` hosts (the shape Pixabay
 * stub hits use — see media/pixabay.ts) with a canned in-memory 1x1 PNG so
 * stub-mode builds (no PIXABAY_API_KEY, no GCS creds) stay fully offline even
 * when the agent "downloads" a stock photo it just searched for. Real hosts
 * fall through to whatever `__setIngestDepsForTests` seam is set (tests) or
 * no override at all (prod: real fetch + real GCS storage).
 */

export type { IngestDeps };

let ingestDepsOverride: IngestDeps | null = null;

/** Test-only seam: overrides the deps passed to `ingestImageFromUrl`. Reset with `null`. */
export function __setIngestDepsForTests(deps: IngestDeps | null): void {
  ingestDepsOverride = deps;
}

// 1x1 transparent PNG, embedded so the stub-hit short-circuit never touches
// the network even for the "download" half of import_image.
const STUB_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function stubImageFetch(): typeof fetch {
  const buf = Buffer.from(STUB_PNG_B64, "base64");
  const stub = (async () =>
    ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    }) as unknown as Response) as unknown as typeof fetch;
  return stub;
}

const applyTemplateParams = z.object({ template_id: z.string().uuid() });

const applySiteTemplate: AgentTool = {
  name: "apply_site_template",
  description:
    "Apply a site template's pages to the current site, giving it a full starter page set + brand tokens in one step. Fails if the site already has pages — use create_page/update_page to edit those instead.",
  paramsSchema: applyTemplateParams,
  async execute(
    ctx: AgentToolCtx,
    input: z.infer<typeof applyTemplateParams>,
  ): Promise<AgentToolResult> {
    const found = await getTemplate(input.template_id, { pool: ctx.pool });
    if (!found) {
      return { ok: false, error: "template not found" };
    }
    if (found.template.kind !== "site") {
      return { ok: false, error: "template is not a site template" };
    }
    if (found.template.status !== "active") {
      return { ok: false, error: "template is archived" };
    }

    // Check for existing pages BEFORE materializing rather than trusting
    // `pages_created === 0` afterward: a valid `kind:'site'` template may
    // itself have zero pages (the schema allows an empty `pages` array), so
    // applying one to a genuinely empty site would also yield
    // `pages_created: 0` and would otherwise be misreported as "already has
    // pages" (review finding, round 1).
    const existing = await ctx.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pages WHERE site_id = $1`,
      [ctx.siteId],
    );
    if (existing.rows[0].n > 0) {
      return { ok: false, error: "site already has pages; edit them instead" };
    }

    const result = await handleMaterializeTemplate(
      { siteId: ctx.siteId, templateId: input.template_id },
      { pool: ctx.pool },
    );

    const summary = `Applied template, creating ${result.pages_created} page(s).`;
    return {
      ok: true,
      data: result,
      summary,
      change: { kind: "template_applied", summary },
    };
  },
};

const searchStockImagesParams = z.object({
  query: z.string().min(2),
  per_page: z.number().int().min(1).max(20).default(9),
});

const searchStockImages: AgentTool = {
  name: "search_stock_images",
  description:
    "Search stock photography by keyword. Returns preview + full-size download URLs and photographer credit for each hit; no side effects. Pass a returned download_url to import_image to bring one into the site's media library.",
  paramsSchema: searchStockImagesParams,
  async execute(
    ctx: AgentToolCtx,
    input: z.infer<typeof searchStockImagesParams>,
  ): Promise<AgentToolResult> {
    const { mode, hits } = await searchPixabay(input.query, {
      perPage: input.per_page,
      env: ctx.env,
    });
    return {
      ok: true,
      data: {
        mode,
        hits: hits.map((h) => ({
          id: h.id,
          tags: h.tags,
          preview: h.previewURL,
          download_url: h.largeImageURL,
          width: h.imageWidth,
          height: h.imageHeight,
          credit: h.user,
        })),
      },
    };
  },
};

const importImageParams = z.object({
  url: z.string().url(),
  alt: z.string().min(3),
});

const importImage: AgentTool = {
  name: "import_image",
  description:
    "Download an image from a URL (e.g. a search_stock_images download_url) and import it into this site's media library with the given alt text. After importing, place the image with the image block using this asset_id and the same alt text.",
  paramsSchema: importImageParams,
  async execute(
    ctx: AgentToolCtx,
    input: z.infer<typeof importImageParams>,
  ): Promise<AgentToolResult> {
    const { hostname } = new URL(input.url);
    const deps: IngestDeps = { ...(ingestDepsOverride ?? {}) };
    if (hostname === "example.invalid" && !deps.fetchFn) {
      deps.fetchFn = stubImageFetch();
    }

    try {
      const result = await ingestImageFromUrl(
        ctx.pool,
        { siteId: ctx.siteId, url: input.url, alt: input.alt },
        deps,
      );
      const summary = `Imported image (asset ${result.asset_id}).`;
      return {
        ok: true,
        data: { asset_id: result.asset_id, alt: input.alt },
        summary,
        change: { kind: "image_imported", summary },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "image import failed" };
    }
  },
};

export const assetTools: AgentTool[] = [applySiteTemplate, searchStockImages, importImage];
