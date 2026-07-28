import type { Pool } from "pg";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { blockShape } from "../../blocks/validate.js";
import { brandTokensSchema } from "../../blocks/brand-tokens.js";
import { listBlocks } from "../../blocks/registry.js";
import { seoFieldsSchema, siteSeoDefaultsSchema } from "../seo/schema.js";
// Side-effect: register the static + package blocks before we read them
// (mirrors src/server/ai/catalog.ts). generateBlocksMd() needs a populated
// registry to produce a complete doc.
import "../../blocks/index.js";

/**
 * Deterministic content-monorepo serializer (T3, GitHub sync).
 *
 * Turns a site's DB rows into a `Map<relativePath, fileContents>` (relative
 * to `sites/<slug>/` — the exporter (T4) adds that prefix + the repo-root
 * README.md/BLOCKS.md before pushing). Every file is produced by
 * `stableStringify` so identical DB content always yields identical bytes —
 * that's what lets the exporter compare git blob shas and skip no-op
 * commits (D: "Deterministic serialization" in the plan's Global
 * Constraints).
 *
 * The companion `parsePageFile`/`parseSiteFile` are the READ side: they
 * guard `JSON.parse` and validate against the same Zod shapes, used by the
 * import job (T6) to accept hand-edited files back from the repo. Blocks are
 * only checked structurally here (`blockShape`) — registry-level validation
 * (`validateBlocks`, unknown asset ids, etc.) is the import job's job, since
 * it needs a DB connection this module doesn't require for parsing.
 */

// ---------------------------------------------------------------------------
// stableStringify
// ---------------------------------------------------------------------------

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeysDeep(source[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * `JSON.stringify` with recursively sorted object keys, 2-space indent, and a
 * trailing newline — deterministic regardless of the property-insertion
 * order of the input.
 */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// File naming
// ---------------------------------------------------------------------------

/**
 * Repo-relative path (under `sites/<slug>/`) for a page's file. `slug` is
 * assumed already validated against the DB's slug charset
 * (`/^[a-z0-9-]+$/`, enforced by the pages table / save routes) — no extra
 * sanitization here.
 */
export function pageFileName(slug: string): string {
  return `pages/${slug}.json`;
}

// ---------------------------------------------------------------------------
// File schemas
// ---------------------------------------------------------------------------

export const siteFileSchema = z.object({
  display_name: z.string(),
  default_brand_tokens: brandTokensSchema,
  seo_defaults: siteSeoDefaultsSchema,
  domains: z.array(z.string()).optional(),
  plugins: z.array(z.string()).optional(),
});
export type SiteFile = z.infer<typeof siteFileSchema>;

export const pageFileSchema = z.object({
  title: z.string().min(1),
  status: z.enum(["draft", "published"]),
  seo: seoFieldsSchema.default({}),
  blocks: z.array(blockShape),
});
export type PageFile = z.infer<typeof pageFileSchema>;

export type FileParseError = { path: string; message: string };

/**
 * Format a `ZodError` into `{path, message}` pairs — same convention as
 * `validateBlocks` in `src/blocks/validate.ts` (dotted path, `"(root)"` for
 * issues with no path segments).
 */
function zodErrorsOf(error: z.ZodError): FileParseError[] {
  return error.errors.map((e) => ({
    path: e.path.join(".") || "(root)",
    message: e.message,
  }));
}

/**
 * Guarded `JSON.parse` + `pageFileSchema` validation. Malformed JSON and
 * schema violations both come back as `{ok: false, errors}` — never throws.
 * `blocks` are only checked for the structural shape (id/type/props); the
 * import job additionally runs them through the live block registry
 * (`validateBlocks`) before persisting, since that needs a DB-backed asset
 * check this module doesn't do.
 */
export function parsePageFile(
  jsonText: string,
): { ok: true; page: PageFile } | { ok: false; errors: FileParseError[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    return {
      ok: false,
      errors: [{ path: "(root)", message: `invalid JSON: ${(err as Error).message}` }],
    };
  }
  const parsed = pageFileSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: zodErrorsOf(parsed.error) };
  }
  return { ok: true, page: parsed.data };
}

/** Guarded `JSON.parse` + `siteFileSchema` validation. Same shape as `parsePageFile`. */
export function parseSiteFile(
  jsonText: string,
): { ok: true; site: SiteFile } | { ok: false; errors: FileParseError[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    return {
      ok: false,
      errors: [{ path: "(root)", message: `invalid JSON: ${(err as Error).message}` }],
    };
  }
  const parsed = siteFileSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: zodErrorsOf(parsed.error) };
  }
  return { ok: true, site: parsed.data };
}

// ---------------------------------------------------------------------------
// serializeSite
// ---------------------------------------------------------------------------

type MediaVariantFile = { name: string; format: string; url: string };
type MediaAssetFile = {
  alt: string;
  content_type: string;
  width: number | null;
  height: number | null;
  variants: MediaVariantFile[];
};

/**
 * Reads a site's current DB state and serializes it into the content-repo
 * file map: `site.json`, one `pages/<slug>.json` per page, and `media.json`.
 * Keys are relative to `sites/<slug>/` — the exporter (T4) adds that prefix
 * plus the repo-root README.md/BLOCKS.md.
 *
 * Every value is `stableStringify`'d, so re-running this against unchanged
 * DB rows yields byte-identical output (the no-op-export contract).
 */
export async function serializeSite(pool: Pool, siteId: string): Promise<Map<string, string>> {
  const siteResult = await pool.query<{
    slug: string;
    display_name: string;
    default_brand_tokens: Record<string, string>;
    seo_defaults: Record<string, unknown>;
  }>(
    `SELECT slug, display_name, default_brand_tokens, seo_defaults
       FROM sites WHERE id = $1`,
    [siteId],
  );
  const site = siteResult.rows[0];
  if (!site) {
    throw new Error(`site not found: ${siteId}`);
  }

  const domainsResult = await pool.query<{ hostname: string }>(
    `SELECT hostname FROM site_domains WHERE site_id = $1 ORDER BY hostname`,
    [siteId],
  );
  const pluginsResult = await pool.query<{ plugin_name: string }>(
    `SELECT plugin_name FROM site_plugins
       WHERE site_id = $1 AND enabled = true
       ORDER BY plugin_name`,
    [siteId],
  );

  const siteFile: SiteFile = {
    display_name: site.display_name,
    default_brand_tokens: site.default_brand_tokens ?? {},
    seo_defaults: (site.seo_defaults ?? {}) as SiteFile["seo_defaults"],
    domains: domainsResult.rows.map((r) => r.hostname),
    plugins: pluginsResult.rows.map((r) => r.plugin_name),
  };

  const files = new Map<string, string>();
  files.set("site.json", stableStringify(siteFile));

  const pagesResult = await pool.query<{
    slug: string;
    title: string;
    status: "draft" | "published";
    seo: Record<string, unknown>;
    blocks: unknown[];
  }>(
    `SELECT slug, title, status, seo, blocks
       FROM pages WHERE site_id = $1 ORDER BY slug`,
    [siteId],
  );
  for (const page of pagesResult.rows) {
    const pageFile: PageFile = {
      title: page.title,
      status: page.status,
      seo: (page.seo ?? {}) as PageFile["seo"],
      blocks: page.blocks as PageFile["blocks"],
    };
    files.set(pageFileName(page.slug), stableStringify(pageFile));
  }

  const assetsResult = await pool.query<{
    id: string;
    alt: string;
    content_type: string;
    width: number | null;
    height: number | null;
    variants: Array<{ name: string; format: string; url: string }> | null;
  }>(
    `SELECT id, alt, content_type, width, height, variants
       FROM media_assets
      WHERE site_id = $1 AND variants_status = 'ready'
      ORDER BY id`,
    [siteId],
  );
  const assets: Record<string, MediaAssetFile> = {};
  for (const asset of assetsResult.rows) {
    assets[asset.id] = {
      alt: asset.alt,
      content_type: asset.content_type,
      width: asset.width,
      height: asset.height,
      variants: (asset.variants ?? []).map((v) => ({
        name: v.name,
        format: v.format,
        url: v.url,
      })),
    };
  }
  files.set("media.json", stableStringify({ assets }));

  return files;
}

// ---------------------------------------------------------------------------
// Generated docs
// ---------------------------------------------------------------------------

/**
 * Repo-root `BLOCKS.md` — generated documentation of every registered block
 * type, for humans hand-editing `pages/*.json` files. Mirrors
 * `src/server/ai/catalog.ts`'s registry-walk + `zodToJsonSchema` pattern so
 * the doc and the AI's prompt catalog never drift from each other or from
 * the live registry.
 */
export function generateBlocksMd(): string {
  const lines: string[] = [];
  lines.push("# Block Reference");
  lines.push("");
  lines.push(
    "Generated from the live block registry — do not hand-edit. Each `pages/*.json` " +
      'file is `{ title, status, seo, blocks }`; every entry in `blocks` is ' +
      '`{ id, type, props }` (plus optional `children`). The `type` and `props` ' +
      "below are validated on import; unknown types or invalid props are rejected " +
      "and reported back as a commit comment.",
  );
  lines.push("");

  const blocks = listBlocks();
  for (const { type, entry } of blocks) {
    const jsonSchema = zodToJsonSchema(entry.schema, { $refStrategy: "none" }) as Record<
      string,
      unknown
    >;
    const defaults = entry.schema.parse({});
    const example = { id: "example-1", type, props: defaults };

    lines.push(`## \`${type}\` — ${entry.label}`);
    lines.push("");
    lines.push(entry.description);
    lines.push("");
    if (entry.aiHints) {
      lines.push(`_${entry.aiHints}_`);
      lines.push("");
    }
    lines.push("**Props schema:**");
    lines.push("");
    lines.push("```json");
    lines.push(stableStringify(jsonSchema).trimEnd());
    lines.push("```");
    lines.push("");
    lines.push("**Minimal example:**");
    lines.push("");
    lines.push("```json");
    lines.push(stableStringify(example).trimEnd());
    lines.push("```");
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * Repo-root `README.md` — orients a human (or another agent) editing this
 * content monorepo directly: what the files mean, how edits get validated,
 * and how the export/import loop-prevention trailer works.
 */
export function generateReadme(repo: string): string {
  return `# Anchor Sites Content Sync

This repository (\`${repo}\`) is a generated, machine-synced mirror of content
managed in the Anchor Sites Studio. It is exported automatically on publish
and on manual export, and changes pushed back here are imported into the
Studio's database after validation.

## Layout

\`\`\`
sites/<slug>/site.json         site display name, brand tokens, SEO defaults
sites/<slug>/pages/<slug>.json one file per page (title, status, seo, blocks)
sites/<slug>/media.json        read-only manifest of processed media assets
README.md                      this file (generated)
BLOCKS.md                      reference for every block type (generated)
\`\`\`

## Editing rules

- Edit \`pages/*.json\` files directly to change page content. Each file is
  \`{ title, status, seo, blocks }\`; see \`BLOCKS.md\` for the full list of
  block types and their props.
- Edit \`site.json\` to change the site's display name, brand tokens
  (**replaced** wholesale on import), or SEO defaults (**shallow-merged**
  over what's already in the database).
- \`media.json\`, \`README.md\`, and \`BLOCKS.md\` are generated — edits to
  them are ignored on import (noted in the commit comment).
- Deleting a file in this repo is reported back as a comment on the
  triggering commit, but the corresponding page is **not** deleted from the
  Studio. Delete pages from the Studio itself.

## Validation

Every \`pages/*.json\` file is validated against the same Zod schema the
Studio's save endpoint uses (block shape, registry-known block types, and
referenced media asset ids) before it is applied. Files that fail validation
are skipped — with the reason reported as a comment on the commit — while
every other valid file in the same push is still applied.

## Sync semantics

- The database is the source of truth: exports overwrite this repo's content
  to match the database (later-writer-wins for concurrent DB edits); imports
  apply validated repo changes as new page revisions.
- Every commit made by an export ends with the trailer line
  \`Anchor-Sync: export\` — the import webhook skips any push where every
  commit carries that trailer, which prevents export → import → export
  loops.

See \`docs/github-sync.md\` in the Studio's own repository for the full
architecture and the operator runbook.
`;
}
