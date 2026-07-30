import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
// Side-effect: register the static block types so template-block validation works.
import "../../blocks/index.js";
import {
  createTemplateInputSchema,
  validateTemplatePages,
  type CreateTemplateInput,
  type TemplateKind,
  type TemplateStatus,
  type TemplatePageValidationFailure,
} from "./schema.js";
import type { Block } from "../../blocks/types.js";

/**
 * Template repository (P7-T7.2, D-041). Pool-injected (defaults to the shared
 * pool) so routes, jobs, and tests share one implementation. `createTemplate`
 * owns its transaction; the read helpers are single queries.
 */

export type TemplateRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  source_site_id: string | null;
  kind: TemplateKind;
  brand_tokens: Record<string, string>;
  status: TemplateStatus;
  category: string | null;
  cover_image_url: string | null;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
};

export type TemplateListRow = TemplateRow & { pages_count: number };

export type TemplatePageRow = {
  id: string;
  template_id: string;
  slug: string;
  title: string;
  blocks: Block[];
  seo: Record<string, unknown>;
  sort_order: number;
  created_at: Date;
};

/** Raised when a captured page holds blocks the registry rejects (D-039 guardrail). */
export class TemplateValidationError extends Error {
  failures: TemplatePageValidationFailure[];
  constructor(failures: TemplatePageValidationFailure[]) {
    super("template block validation failed");
    this.name = "TemplateValidationError";
    this.failures = failures;
  }
}

/** Raised when the requested template slug already exists. */
export class TemplateSlugConflictError extends Error {
  slug: string;
  constructor(slug: string) {
    super(`template slug "${slug}" already in use`);
    this.name = "TemplateSlugConflictError";
    this.slug = slug;
  }
}

const TEMPLATE_COLS =
  "id, slug, name, description, source_site_id, kind, brand_tokens, status, category, cover_image_url, sort_order, created_at, updated_at";
const TEMPLATE_PAGE_COLS =
  "id, template_id, slug, title, blocks, seo, sort_order, created_at";

/**
 * Create a template + its pages in one transaction. Validates input via Zod
 * (throws ZodError on bad shape) and every page's blocks via the shared
 * registry validator (throws `TemplateValidationError`). Page `sort_order` is
 * assigned from array position so capture order is preserved.
 */
export async function createTemplate(
  input: CreateTemplateInput,
  opts: { pool?: Pool } = {},
): Promise<{ template: TemplateRow; pages: TemplatePageRow[] }> {
  const pool = opts.pool ?? defaultPool;
  const parsed = createTemplateInputSchema.parse(input);

  const failures = validateTemplatePages(parsed.pages);
  if (failures.length > 0) throw new TemplateValidationError(failures);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const dup = await client.query(`SELECT 1 FROM templates WHERE slug = $1`, [parsed.slug]);
    if (dup.rowCount && dup.rowCount > 0) {
      await client.query("ROLLBACK");
      throw new TemplateSlugConflictError(parsed.slug);
    }

    const tplRes = await client.query<TemplateRow>(
      `INSERT INTO templates (slug, name, description, source_site_id, kind, brand_tokens, category, cover_image_url, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       RETURNING ${TEMPLATE_COLS}`,
      [
        parsed.slug,
        parsed.name,
        parsed.description ?? null,
        parsed.source_site_id ?? null,
        parsed.kind,
        JSON.stringify(parsed.brand_tokens ?? {}),
        parsed.category ?? null,
        parsed.cover_image_url ?? null,
        parsed.sort_order ?? 0,
      ],
    );
    const template = tplRes.rows[0];

    const pages: TemplatePageRow[] = [];
    for (let i = 0; i < parsed.pages.length; i++) {
      const page = parsed.pages[i];
      const pageRes = await client.query<TemplatePageRow>(
        `INSERT INTO template_pages (template_id, slug, title, blocks, seo, sort_order)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
         RETURNING ${TEMPLATE_PAGE_COLS}`,
        [
          template.id,
          page.slug,
          page.title,
          JSON.stringify(page.blocks),
          JSON.stringify(page.seo),
          i,
        ],
      );
      pages.push(pageRes.rows[0]);
    }

    await client.query("COMMIT");
    return { template, pages };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * List templates (gallery order: `sort_order` ascending, then `name`) with a
 * page count. Defaults to active only; pass `status: "archived"` to list
 * archived, or filter by `kind`.
 */
export async function listTemplates(
  opts: { pool?: Pool; kind?: TemplateKind; status?: TemplateStatus } = {},
): Promise<TemplateListRow[]> {
  const pool = opts.pool ?? defaultPool;
  const conds: string[] = [];
  const params: unknown[] = [];

  const status: TemplateStatus = opts.status ?? "active";
  params.push(status);
  conds.push(`t.status = $${params.length}`);

  if (opts.kind) {
    params.push(opts.kind);
    conds.push(`t.kind = $${params.length}`);
  }

  const res = await pool.query<TemplateListRow>(
    `SELECT ${TEMPLATE_COLS.split(", ").map((c) => `t.${c}`).join(", ")},
            COUNT(tp.id)::int AS pages_count
       FROM templates t
       LEFT JOIN template_pages tp ON tp.template_id = t.id
      WHERE ${conds.join(" AND ")}
      GROUP BY t.id
      ORDER BY t.sort_order ASC, t.name ASC`,
    params,
  );
  return res.rows;
}

/** Fetch one template with its pages (ordered by sort_order). `null` if missing. */
export async function getTemplate(
  id: string,
  opts: { pool?: Pool } = {},
): Promise<{ template: TemplateRow; pages: TemplatePageRow[] } | null> {
  const pool = opts.pool ?? defaultPool;
  const tplRes = await pool.query<TemplateRow>(
    `SELECT ${TEMPLATE_COLS} FROM templates WHERE id = $1`,
    [id],
  );
  if (tplRes.rowCount === 0) return null;

  const pagesRes = await pool.query<TemplatePageRow>(
    `SELECT ${TEMPLATE_PAGE_COLS} FROM template_pages
      WHERE template_id = $1
      ORDER BY sort_order ASC, created_at ASC`,
    [id],
  );
  return { template: tplRes.rows[0], pages: pagesRes.rows };
}

/**
 * Archive a template (soft delete — D-041 keeps the row, never hard-deletes).
 * Idempotent. Returns the updated row, or `null` if no such template.
 */
export async function archiveTemplate(
  id: string,
  opts: { pool?: Pool } = {},
): Promise<TemplateRow | null> {
  const pool = opts.pool ?? defaultPool;
  const res = await pool.query<TemplateRow>(
    `UPDATE templates SET status = 'archived' WHERE id = $1 RETURNING ${TEMPLATE_COLS}`,
    [id],
  );
  return res.rowCount && res.rowCount > 0 ? res.rows[0] : null;
}
