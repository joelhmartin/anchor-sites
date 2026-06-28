import type { Pool } from "pg";
import "../../blocks/index.js"; // side-effect: populate the block registry for validateBlocks (D-039)
import { validateBlocks, type BlockShape, type ValidationFailure } from "../../blocks/validate.js";
import { eventInputSchema, eventPatchSchema, type EventInput, type EventPatch } from "./schema.js";
import type { SeoFields } from "../seo/schema.js";

/**
 * Events repository (P8-T8.10, D-047). Pool-injected; every query scoped by
 * `site_id`. `description` is re-validated through the shared registry
 * validator (D-039) on create/update.
 */
export type EventRecord = {
  id: string;
  site_id: string;
  slug: string;
  title: string;
  description: BlockShape[];
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  seo: SeoFields;
  status: "draft" | "published";
  created_at: string;
  updated_at: string;
};

export class EventSlugConflictError extends Error {
  constructor(public slug: string) {
    super(`event slug "${slug}" already in use for this site`);
    this.name = "EventSlugConflictError";
  }
}

export class InvalidEventDescriptionError extends Error {
  constructor(public failures: ValidationFailure[]) {
    super(`event description failed block validation (${failures.length} issue(s))`);
    this.name = "InvalidEventDescriptionError";
  }
}

function assertValidDescription(desc: BlockShape[]): void {
  const failures = validateBlocks(desc);
  if (failures.length > 0) throw new InvalidEventDescriptionError(failures);
}

const ISO = (col: string) => `to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS.MSZ')`;
const COLS = `id, site_id, slug, title, description, ${ISO("starts_at")} AS starts_at,
  ${ISO("ends_at")} AS ends_at, location, seo, status,
  ${ISO("created_at")} AS created_at, ${ISO("updated_at")} AS updated_at`;

function isUniqueViolation(err: unknown, constraint: string): boolean {
  return Boolean(
    err && typeof err === "object" && "code" in err && err.code === "23505" &&
      "constraint" in err && err.constraint === constraint,
  );
}

export async function createEvent(
  pool: Pool,
  siteId: string,
  input: EventInput,
): Promise<EventRecord> {
  const data = eventInputSchema.parse(input);
  assertValidDescription(data.description);
  try {
    const res = await pool.query<EventRecord>(
      `INSERT INTO events (site_id, slug, title, description, starts_at, ends_at, location, seo, status)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb,$9) RETURNING ${COLS}`,
      [
        siteId,
        data.slug,
        data.title,
        JSON.stringify(data.description),
        data.starts_at.toISOString(),
        data.ends_at ? data.ends_at.toISOString() : null,
        data.location ?? null,
        JSON.stringify(data.seo),
        data.status,
      ],
    );
    return res.rows[0];
  } catch (err) {
    if (isUniqueViolation(err, "events_site_slug_unique")) throw new EventSlugConflictError(data.slug);
    throw err;
  }
}

export async function listEvents(
  pool: Pool,
  siteId: string,
  opts: { status?: "draft" | "published" } = {},
): Promise<EventRecord[]> {
  const params: unknown[] = [siteId];
  let where = `site_id = $1`;
  if (opts.status) {
    params.push(opts.status);
    where += ` AND status = $2`;
  }
  const res = await pool.query<EventRecord>(
    `SELECT ${COLS} FROM events WHERE ${where} ORDER BY starts_at ASC`,
    params,
  );
  return res.rows;
}

export async function getEventBySlug(
  pool: Pool,
  siteId: string,
  slug: string,
): Promise<EventRecord | null> {
  const res = await pool.query<EventRecord>(
    `SELECT ${COLS} FROM events WHERE site_id = $1 AND slug = $2`,
    [siteId, slug],
  );
  return res.rows[0] ?? null;
}

export async function getEventById(
  pool: Pool,
  siteId: string,
  id: string,
): Promise<EventRecord | null> {
  const res = await pool.query<EventRecord>(
    `SELECT ${COLS} FROM events WHERE site_id = $1 AND id = $2`,
    [siteId, id],
  );
  return res.rows[0] ?? null;
}

export async function updateEvent(
  pool: Pool,
  siteId: string,
  id: string,
  patch: EventPatch,
): Promise<EventRecord | null> {
  const data = eventPatchSchema.parse(patch);
  if (data.description !== undefined) assertValidDescription(data.description);

  const sets: string[] = [];
  const params: unknown[] = [siteId, id];
  const add = (frag: string, value: unknown) => {
    params.push(value);
    sets.push(`${frag} = $${params.length}`);
  };
  if (data.slug !== undefined) add("slug", data.slug);
  if (data.title !== undefined) add("title", data.title);
  if (data.description !== undefined) {
    params.push(JSON.stringify(data.description));
    sets.push(`description = $${params.length}::jsonb`);
  }
  if (data.starts_at !== undefined) add("starts_at", data.starts_at.toISOString());
  if (data.ends_at !== undefined) add("ends_at", data.ends_at ? data.ends_at.toISOString() : null);
  if (data.location !== undefined) add("location", data.location);
  if (data.seo !== undefined) {
    params.push(JSON.stringify(data.seo));
    sets.push(`seo = $${params.length}::jsonb`);
  }
  if (data.status !== undefined) add("status", data.status);
  if (sets.length === 0) return getEventById(pool, siteId, id);

  try {
    const res = await pool.query<EventRecord>(
      `UPDATE events SET ${sets.join(", ")} WHERE site_id = $1 AND id = $2 RETURNING ${COLS}`,
      params,
    );
    return res.rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err, "events_site_slug_unique") && data.slug) {
      throw new EventSlugConflictError(data.slug);
    }
    throw err;
  }
}

export async function deleteEvent(pool: Pool, siteId: string, id: string): Promise<boolean> {
  const res = await pool.query(`DELETE FROM events WHERE site_id = $1 AND id = $2`, [siteId, id]);
  return (res.rowCount ?? 0) > 0;
}
