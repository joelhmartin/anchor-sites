import type { Pool } from "pg";
import "../../blocks/index.js"; // side-effect: populate the block registry for validateBlocks (D-039)
import { validateBlocks, type BlockShape, type ValidationFailure } from "../../blocks/validate.js";
import { postInputSchema, postPatchSchema, type PostInput, type PostPatch } from "./schema.js";
import type { SeoFields } from "../seo/schema.js";

/**
 * Blog repository (P8-T8.9, D-047). Pool-injected; EVERY query is scoped by
 * `site_id` (multi-tenant). `body` is re-validated through the shared registry
 * validator (D-039) on create/update.
 */
export type Post = {
  id: string;
  site_id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body: BlockShape[];
  seo: SeoFields;
  status: "draft" | "published";
  published_at: string | null;
  author_id: string | null;
  created_at: string;
  updated_at: string;
};

export class PostSlugConflictError extends Error {
  constructor(public slug: string) {
    super(`post slug "${slug}" already in use for this site`);
    this.name = "PostSlugConflictError";
  }
}

export class InvalidPostBodyError extends Error {
  constructor(public failures: ValidationFailure[]) {
    super(`post body failed block validation (${failures.length} issue(s))`);
    this.name = "InvalidPostBodyError";
  }
}

function assertValidBody(body: BlockShape[]): void {
  const failures = validateBlocks(body);
  if (failures.length > 0) throw new InvalidPostBodyError(failures);
}

const COLS = `id, site_id, slug, title, excerpt, body, seo, status,
  to_char(published_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSZ') AS published_at,
  author_id,
  to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSZ') AS created_at,
  to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSZ') AS updated_at`;

function isUniqueViolation(err: unknown, constraint: string): boolean {
  return Boolean(
    err && typeof err === "object" && "code" in err && err.code === "23505" &&
      "constraint" in err && err.constraint === constraint,
  );
}

export async function createPost(pool: Pool, siteId: string, input: PostInput): Promise<Post> {
  const data = postInputSchema.parse(input);
  assertValidBody(data.body);
  try {
    const res = await pool.query<Post>(
      `INSERT INTO posts (site_id, slug, title, excerpt, body, seo, status, published_at, author_id)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7, CASE WHEN $7 = 'published' THEN now() ELSE NULL END, $8)
       RETURNING ${COLS}`,
      [siteId, data.slug, data.title, data.excerpt ?? null, JSON.stringify(data.body), JSON.stringify(data.seo), data.status, data.author_id ?? null],
    );
    return res.rows[0];
  } catch (err) {
    if (isUniqueViolation(err, "posts_site_slug_unique")) throw new PostSlugConflictError(data.slug);
    throw err;
  }
}

export async function listPosts(
  pool: Pool,
  siteId: string,
  opts: { status?: "draft" | "published" } = {},
): Promise<Post[]> {
  const params: unknown[] = [siteId];
  let where = `site_id = $1`;
  if (opts.status) {
    params.push(opts.status);
    where += ` AND status = $2`;
  }
  const res = await pool.query<Post>(
    `SELECT ${COLS} FROM posts WHERE ${where}
     ORDER BY COALESCE(published_at, created_at) DESC`,
    params,
  );
  return res.rows;
}

export async function getPostBySlug(pool: Pool, siteId: string, slug: string): Promise<Post | null> {
  const res = await pool.query<Post>(`SELECT ${COLS} FROM posts WHERE site_id = $1 AND slug = $2`, [
    siteId,
    slug,
  ]);
  return res.rows[0] ?? null;
}

export async function getPostById(pool: Pool, siteId: string, id: string): Promise<Post | null> {
  const res = await pool.query<Post>(`SELECT ${COLS} FROM posts WHERE site_id = $1 AND id = $2`, [
    siteId,
    id,
  ]);
  return res.rows[0] ?? null;
}

export async function updatePost(
  pool: Pool,
  siteId: string,
  id: string,
  patch: PostPatch,
): Promise<Post | null> {
  const data = postPatchSchema.parse(patch);
  if (data.body !== undefined) assertValidBody(data.body);

  const sets: string[] = [];
  const params: unknown[] = [siteId, id];
  const add = (frag: string, value: unknown) => {
    params.push(value);
    sets.push(`${frag} = $${params.length}`);
  };
  if (data.slug !== undefined) add("slug", data.slug);
  if (data.title !== undefined) add("title", data.title);
  if (data.excerpt !== undefined) add("excerpt", data.excerpt);
  if (data.body !== undefined) {
    params.push(JSON.stringify(data.body));
    sets.push(`body = $${params.length}::jsonb`);
  }
  if (data.seo !== undefined) {
    params.push(JSON.stringify(data.seo));
    sets.push(`seo = $${params.length}::jsonb`);
  }
  if (data.author_id !== undefined) add("author_id", data.author_id);
  if (data.status !== undefined) {
    add("status", data.status);
    // Stamp published_at on first publish; clear it when reverting to draft.
    params.push(data.status);
    sets.push(
      `published_at = CASE WHEN $${params.length} = 'published' THEN COALESCE(published_at, now()) ELSE NULL END`,
    );
  }
  if (sets.length === 0) return getPostById(pool, siteId, id);

  try {
    const res = await pool.query<Post>(
      `UPDATE posts SET ${sets.join(", ")} WHERE site_id = $1 AND id = $2 RETURNING ${COLS}`,
      params,
    );
    return res.rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err, "posts_site_slug_unique") && data.slug) {
      throw new PostSlugConflictError(data.slug);
    }
    throw err;
  }
}

export async function deletePost(pool: Pool, siteId: string, id: string): Promise<boolean> {
  const res = await pool.query(`DELETE FROM posts WHERE site_id = $1 AND id = $2`, [siteId, id]);
  return (res.rowCount ?? 0) > 0;
}
