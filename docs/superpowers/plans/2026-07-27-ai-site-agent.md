# AI Site Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A persistent, site-scoped, multi-turn AI agent that builds and edits whole draft sites conversationally from a Studio chat drawer (spec: `docs/superpowers/specs/2026-07-27-ai-site-agent-design.md`).

**Architecture:** In-service tool-use loop in `src/server/ai/agent/` beside the untouched Phase 6 code. Tools wrap existing primitives (edit ops + shared validator, inline page SQL patterns, `handleMaterializeTemplate`, the GCS media pipeline). Conversations persist in `ai_conversations`/`ai_messages`; long turns run in a pg-boss job; the Studio drawer consumes SSE.

**Tech Stack:** TypeScript ESM (`.js` import suffixes, `tsx` runtime — no build step for the server), Express 4, zod 3, `@anthropic-ai/sdk@0.97.1` (pinned), pg-boss ^12 (v12 semantics: handlers receive an ARRAY of jobs; `createQueue` before `work`), React 18 + react-router-dom 7, Tailwind (zinc/indigo Studio palette), vitest + supertest + testing-library.

## Global Constraints

- Phase 6 files (`propose.ts`, `client.ts`, the `ai-edit` endpoint, `AskAiPanel`) are NOT modified except where a task explicitly says "Modify".
- Every block write goes through `applyAndValidate` (`src/server/ai/edit-ops.js`) or `validateBlocks` (`src/blocks/validate.js`) — no unvalidated `pages.blocks` writes. Import `"…/blocks/index.js"` for the registry side-effect wherever validation runs.
- Every page-blocks mutation writes a `page_revisions` row in the same transaction: `INSERT INTO page_revisions (page_id, blocks, seo, source) VALUES ($1, $2::jsonb, $3::jsonb, 'ai')` (note the `seo` column — mirror `admin-pages.ts:139-149`).
- Every tool rejects IDs outside `ctx.siteId` (cross-tenant guard) — unit-tested per write tool.
- AI modes via `resolveAiMode` (`src/server/ai/config.js`): no `ANTHROPIC_API_KEY` → `stub`; `"dry-run"` → dry-run; else `api`. CI never spends. Model pin stays `AI_MODEL` (`claude-sonnet-4-6`); never pass `model` from new code.
- Router convention: factories `xxxRouter(opts = {}): Router` with injectable `pool?: Pool` and collaborators; `requireAdmin()` (from `src/middleware/requireAdmin.js`) applied **per route**, never `router.use`; rate limiting via `rateLimit({ max, windowMs })` from `src/middleware/rateLimit.js` (in-repo middleware, NOT express-rate-limit).
- Error shapes (copy existing): `400 { error: "invalid payload", details: [{ path, message }] }`, `401 { error: "unauthorized" }`, `404 { error: "<thing> not found" }`, `409 { error: "slug already in use" }`, `400 { error: "block validation failed", failures }`, `204` empty on delete.
- DB access: `import { pool as defaultPool } from "…/db.js"`; transactions = `pool.connect()` → `BEGIN`/`COMMIT`/`ROLLBACK`/`release()` (the `templates.ts:400` pattern).
- `getBoss()` (from `src/server/jobs/index.js`) THROWS when `bootJobs` hasn't run — every new enqueue site is injectable (router opts) with a lazy default, mirroring `src/server/routes/media.ts:58-66`.
- Env knobs (all optional): `AI_AGENT_TOKEN_BUDGET` (default `1000000` tokens/conversation/day), `AI_AGENT_MAX_TOOL_CALLS` (default `30`/turn), `PIXABAY_API_KEY` (unset → stub hits).
- Node/integration tests: gate with `const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;`, run migrations programmatically via `node-pg-migrate` in `beforeAll` (copy the header of `tests/integration/from-template.test.ts:1-25`), build a per-router express app (NOT a full `createApp`), auth with `X-Admin-Token` + `ADMIN_API_TOKEN` env. jsdom tests: `// @vitest-environment jsdom` pragma + `global.fetch` mock + `setAdminToken/clearAdminToken` from `src/admin/lib/adminToken.js` (copy the header of `src/admin/pages/site-tabs/PagesTab.test.tsx:1-36`). Run: `TEST_DATABASE_URL=postgres://anchor:anchor@localhost:5434/anchor_test npx vitest run <file>` (needs `docker compose up -d postgres`).
- Commit after every task (operator preference: per-subitem commits).
- v1 streams at event granularity (assistant message / tool events), not token deltas — `runMessage` is non-streaming by type (`MessageCreateParamsNonStreaming`); the SSE protocol below leaves room to add deltas later without breaking clients.

## File Structure

```
db/migrations/1747601000000_ai_agent.cjs        Task 1  (tables)
tests/helpers/agent-db.ts                       Task 1  (shared node-test bootstrap)
src/server/ai/agent/repo.ts (+.test.ts)         Task 1  (conversation/message persistence)
src/server/media/pixabay.ts (+.test.ts)         Task 2  (stock search client, stub/api)
src/server/media/ingest.ts (+.test.ts)          Task 3  (server-side image ingest from URL/Buffer)
src/server/ai/agent/tools/types.ts              Task 4  (AgentTool contract + change events)
src/server/ai/agent/tools/read.ts (+.test.ts)   Task 4  (get_site_overview, get_page, list_templates, list_media)
src/server/ai/agent/tools/index.ts              Task 4  (tool registry, Anthropic tool defs, dispatcher)
src/server/ai/agent/tools/pages.ts (+.test.ts)  Task 5  (create_page, update_page, delete_page)
src/server/ai/agent/tools/settings.ts (+.test)  Task 6  (set_brand_tokens, set_seo_defaults, set_page_seo)
src/server/ai/agent/tools/assets.ts (+.test.ts) Task 7  (search_stock_images, import_image, apply_site_template)
src/server/ai/agent/loop.ts (+.test.ts)         Task 8  (runAgentTurn: context, caps, budget, stub script)
src/server/jobs/agent-turn.ts (+.test.ts)       Task 9  (handleAgentTurn job handler)
src/server/jobs/index.ts                        Task 9  (Modify: AGENT_TURN queue + registration)
src/server/routes/admin-ai-agent.ts (+tests)    Task 10 (conversation CRUD, message POST, SSE tail)
src/server/routes/admin-pages.ts                Task 10 (Modify: draft preview endpoint)
src/server/app.ts                               Task 10 (Modify: mount router inside createApp)
src/admin/lib/agent-api.ts                      Task 11 (SSE-over-fetch reader)
src/admin/components/AgentChatDrawer.tsx (+t)   Task 11 (drawer: messages, cards, revert, input, usage)
src/admin/pages/NewSiteWizard.tsx               Task 12 (Modify: "Start with AI" path)
src/admin/pages/SiteDetailPage.tsx              Task 12 (Modify: drawer mount + ?ai=1 + preview iframe)
tests/integration/ai-agent-build.test.ts        Task 13 (full stub-mode build end-to-end)
cloudbuild.yaml, .env.example, docs/ai-agent.md Task 14 (secrets incl. PLUGIN_CONFIG_ENC_KEY fix, docs)
```

---

### Task 1: Migration, shared test bootstrap, conversation repo

**Files:**
- Create: `db/migrations/1747601000000_ai_agent.cjs`
- Create: `tests/helpers/agent-db.ts`
- Create: `src/server/ai/agent/repo.ts`
- Test: `src/server/ai/agent/repo.test.ts`

**Interfaces:**
- Consumes: `pool` pattern (`pg`), `node-pg-migrate` programmatic API (copy `tests/integration/from-template.test.ts:12-25`).
- Produces (used by Tasks 3–13):
  - `tests/helpers/agent-db.ts`: `setupAgentDb(): { runMigrations(): Promise<void>; teardown(): Promise<void>; getPool(): Pool; seedSite(slug: string): Promise<{ id: string }>; seedPage(siteId: string, slug: string, blocks?: unknown[]): Promise<{ id: string }> }`
  - `repo.ts` types/functions (ALL take `pool: Pool` as first arg — mirrors `src/server/blog/repo.ts` style):
    - `type AiConversation = { id: string; site_id: string; title: string; status: "active"|"error"|"archived"; token_usage: Record<string, { input: number; output: number }>; created_at: string; updated_at: string }`
    - `type AiMessageRole = "user"|"assistant"|"tool"`
    - `type AiMessage = { id: string; conversation_id: string; role: AiMessageRole; content: unknown; created_at: string }`
    - `createConversation(pool, siteId, title): Promise<AiConversation>`
    - `getConversation(pool, id, siteId): Promise<AiConversation | null>` (null when id belongs to another site)
    - `listConversations(pool, siteId): Promise<AiConversation[]>` (by `updated_at` DESC)
    - `appendMessage(pool, conversationId, role, content): Promise<AiMessage>` (also bumps conversation `updated_at`)
    - `listMessages(pool, conversationId, opts?: { limit?: number; afterId?: string }): Promise<AiMessage[]>` (ascending; `limit` = LAST n; `afterId` = only rows after that id)
    - `setConversationStatus(pool, id, status): Promise<void>`
    - `addTokenUsage(pool, id, usage: { input: number; output: number }, day?: string): Promise<void>` (accumulate under `token_usage[day]`; day defaults to `new Date().toISOString().slice(0,10)`)
    - `getTodayUsage(conv: AiConversation, day?: string): { input: number; output: number }` (pure)

- [ ] **Step 1: Write the migration** (match `1747579000000_posts.cjs` style, incl. the `touch_updated_at` trigger)

```js
/* eslint-disable camelcase */

// AI site agent (post-v1 — spec docs/superpowers/specs/2026-07-27-ai-site-agent-design.md).
// Conversations are site-scoped; messages store raw Anthropic content-block
// arrays so tool_use/tool_result replay losslessly when rebuilding model context.

exports.up = (pgm) => {
  pgm.createTable("ai_conversations", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    site_id: { type: "uuid", notNull: true, references: '"sites"', onDelete: "CASCADE" },
    title: { type: "text", notNull: true, default: "New conversation" },
    status: {
      type: "text", notNull: true, default: "active",
      check: "status IN ('active','error','archived')",
    },
    token_usage: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("ai_conversations", ["site_id", "updated_at"], { name: "ai_conversations_site_idx" });
  pgm.createTrigger("ai_conversations", "ai_conversations_touch_updated_at", {
    when: "BEFORE", operation: "UPDATE", level: "ROW", function: "touch_updated_at",
  });

  pgm.createTable("ai_messages", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    conversation_id: {
      type: "uuid", notNull: true, references: '"ai_conversations"', onDelete: "CASCADE",
    },
    role: { type: "text", notNull: true, check: "role IN ('user','assistant','tool')" },
    content: { type: "jsonb", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("ai_messages", ["conversation_id", "created_at", "id"], { name: "ai_messages_conv_idx" });
};

exports.down = (pgm) => {
  pgm.dropTable("ai_messages");
  pgm.dropTrigger("ai_conversations", "ai_conversations_touch_updated_at");
  pgm.dropTable("ai_conversations");
};
```

(Before writing: confirm the `touch_updated_at` function is created in an earlier migration — grep `db/migrations` for it; if it has a different name, use that.)

- [ ] **Step 2: Run `npm run migrate:up`** against the dev DB. Expected: applies cleanly. (Test DB gets migrated programmatically per-suite — see Step 3.)

- [ ] **Step 3: Write the shared test bootstrap**

```ts
// tests/helpers/agent-db.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import migrate from "node-pg-migrate";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;

/**
 * Shared bootstrap for AI-agent node suites. Mirrors the header of
 * tests/integration/from-template.test.ts: programmatic migrations up in
 * beforeAll, down + pool.end() in afterAll. Suites must self-skip when
 * TEST_DATABASE_URL is unset: `const d = process.env.TEST_DATABASE_URL ? describe : describe.skip`.
 */
export function setupAgentDb() {
  let pool: Pool | null = null;
  return {
    async runMigrations() {
      await migrate({
        databaseUrl: TEST_DB_URL!, dir: MIGRATIONS_DIR, migrationsTable: "pgmigrations",
        direction: "up", count: Infinity, log: () => undefined,
      });
      pool = new Pool({ connectionString: TEST_DB_URL });
    },
    async teardown() {
      await pool?.end();
      pool = null;
    },
    getPool(): Pool {
      if (!pool) throw new Error("runMigrations() first");
      return pool;
    },
    async seedSite(slug: string): Promise<{ id: string }> {
      const r = await this.getPool().query<{ id: string }>(
        `INSERT INTO sites (slug, display_name) VALUES ($1, $2) RETURNING id`,
        [slug, `Site ${slug}`],
      );
      return r.rows[0];
    },
    async seedPage(siteId: string, slug: string, blocks: unknown[] = []): Promise<{ id: string }> {
      const r = await this.getPool().query<{ id: string }>(
        `INSERT INTO pages (site_id, slug, title, blocks, status)
         VALUES ($1, $2, $3, $4::jsonb, 'draft') RETURNING id`,
        [siteId, slug, `Page ${slug}`, JSON.stringify(blocks)],
      );
      return r.rows[0];
    },
  };
}
```

Before finalizing: open `tests/integration/from-template.test.ts` and check whether suites run migrations down in `afterAll` and whether `sites`/`pages` need more NOT NULL columns than shown — match reality. If concurrent suites conflict on a shared test DB, use unique slugs per suite (e.g. prefix with the suite name) instead of truncating.

- [ ] **Step 4: Write failing repo tests**

```ts
// src/server/ai/agent/repo.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAgentDb } from "../../../../tests/helpers/agent-db.js";
import {
  createConversation, getConversation, listConversations, appendMessage,
  listMessages, setConversationStatus, addTokenUsage, getTodayUsage,
} from "./repo.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();

d("ai agent repo", () => {
  let siteId: string;
  let otherSiteId: string;

  beforeAll(async () => {
    await db.runMigrations();
    siteId = (await db.seedSite("agent-repo-a")).id;
    otherSiteId = (await db.seedSite("agent-repo-b")).id;
  });
  afterAll(() => db.teardown());

  it("creates and fetches a conversation, scoped by site", async () => {
    const conv = await createConversation(db.getPool(), siteId, "Build my site");
    expect(conv.status).toBe("active");
    expect(await getConversation(db.getPool(), conv.id, siteId)).toMatchObject({ id: conv.id });
    expect(await getConversation(db.getPool(), conv.id, otherSiteId)).toBeNull();
  });

  it("appends and lists messages in order, honoring limit + afterId", async () => {
    const conv = await createConversation(db.getPool(), siteId, "t");
    const m1 = await appendMessage(db.getPool(), conv.id, "user", [{ type: "text", text: "one" }]);
    await appendMessage(db.getPool(), conv.id, "assistant", [{ type: "text", text: "two" }]);
    await appendMessage(db.getPool(), conv.id, "tool", [{ type: "tool_result", tool_use_id: "x", content: "ok" }]);
    const all = await listMessages(db.getPool(), conv.id);
    expect(all.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect((await listMessages(db.getPool(), conv.id, { limit: 2 })).map((m) => m.role))
      .toEqual(["assistant", "tool"]);
    expect((await listMessages(db.getPool(), conv.id, { afterId: m1.id })).length).toBe(2);
  });

  it("accumulates token usage per day and reads today's total", async () => {
    const conv = await createConversation(db.getPool(), siteId, "t");
    await addTokenUsage(db.getPool(), conv.id, { input: 100, output: 50 }, "2026-07-27");
    await addTokenUsage(db.getPool(), conv.id, { input: 10, output: 5 }, "2026-07-27");
    const fresh = await getConversation(db.getPool(), conv.id, siteId);
    expect(getTodayUsage(fresh!, "2026-07-27")).toEqual({ input: 110, output: 55 });
    expect(getTodayUsage(fresh!, "2026-07-28")).toEqual({ input: 0, output: 0 });
  });

  it("sets status and lists newest-first", async () => {
    const c1 = await createConversation(db.getPool(), siteId, "one");
    const c2 = await createConversation(db.getPool(), siteId, "two");
    await setConversationStatus(db.getPool(), c1.id, "error");
    const list = await listConversations(db.getPool(), siteId);
    expect(list.findIndex((c) => c.id === c2.id)).toBeLessThan(list.findIndex((c) => c.id === c1.id));
    expect(list.find((c) => c.id === c1.id)!.status).toBe("error");
  });
});
```

- [ ] **Step 5: Run to verify failure** — `TEST_DATABASE_URL=… npx vitest run src/server/ai/agent/repo.test.ts` → FAIL (`repo.js` not found)

- [ ] **Step 6: Implement the repo**

```ts
// src/server/ai/agent/repo.ts
import type { Pool } from "pg";

export type AiConversation = {
  id: string; site_id: string; title: string;
  status: "active" | "error" | "archived";
  token_usage: Record<string, { input: number; output: number }>;
  created_at: string; updated_at: string;
};
export type AiMessageRole = "user" | "assistant" | "tool";
export type AiMessage = {
  id: string; conversation_id: string; role: AiMessageRole;
  content: unknown; created_at: string;
};

export async function createConversation(
  pool: Pool, siteId: string, title: string,
): Promise<AiConversation> {
  const r = await pool.query(
    `INSERT INTO ai_conversations (site_id, title) VALUES ($1, $2) RETURNING *`,
    [siteId, title],
  );
  return r.rows[0];
}

export async function getConversation(
  pool: Pool, id: string, siteId: string,
): Promise<AiConversation | null> {
  const r = await pool.query(
    `SELECT * FROM ai_conversations WHERE id = $1 AND site_id = $2`, [id, siteId],
  );
  return r.rows[0] ?? null;
}

export async function listConversations(pool: Pool, siteId: string): Promise<AiConversation[]> {
  const r = await pool.query(
    `SELECT * FROM ai_conversations WHERE site_id = $1 ORDER BY updated_at DESC`, [siteId],
  );
  return r.rows;
}

export async function appendMessage(
  pool: Pool, conversationId: string, role: AiMessageRole, content: unknown,
): Promise<AiMessage> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `INSERT INTO ai_messages (conversation_id, role, content)
       VALUES ($1, $2, $3::jsonb) RETURNING *`,
      [conversationId, role, JSON.stringify(content)],
    );
    await client.query(
      `UPDATE ai_conversations SET updated_at = now() WHERE id = $1`, [conversationId],
    );
    await client.query("COMMIT");
    return r.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listMessages(
  pool: Pool, conversationId: string, opts: { limit?: number; afterId?: string } = {},
): Promise<AiMessage[]> {
  if (opts.afterId) {
    const r = await pool.query(
      `SELECT * FROM ai_messages
       WHERE conversation_id = $1
         AND (created_at, id) > (SELECT created_at, id FROM ai_messages WHERE id = $2)
       ORDER BY created_at ASC, id ASC`,
      [conversationId, opts.afterId],
    );
    return r.rows;
  }
  if (opts.limit) {
    const r = await pool.query(
      `SELECT * FROM (
         SELECT * FROM ai_messages WHERE conversation_id = $1
         ORDER BY created_at DESC, id DESC LIMIT $2
       ) t ORDER BY created_at ASC, id ASC`,
      [conversationId, opts.limit],
    );
    return r.rows;
  }
  const r = await pool.query(
    `SELECT * FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at ASC, id ASC`,
    [conversationId],
  );
  return r.rows;
}

export async function setConversationStatus(
  pool: Pool, id: string, status: AiConversation["status"],
): Promise<void> {
  await pool.query(`UPDATE ai_conversations SET status = $2 WHERE id = $1`, [id, status]);
}

export async function addTokenUsage(
  pool: Pool, id: string, usage: { input: number; output: number },
  day: string = new Date().toISOString().slice(0, 10),
): Promise<void> {
  // Read-modify-write under FOR UPDATE; turns are sequential per conversation
  // so contention is theoretical, but the lock makes the math safe anyway.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT token_usage FROM ai_conversations WHERE id = $1 FOR UPDATE`, [id],
    );
    if (r.rows[0]) {
      const tu = r.rows[0].token_usage ?? {};
      const cur = tu[day] ?? { input: 0, output: 0 };
      tu[day] = { input: cur.input + usage.input, output: cur.output + usage.output };
      await client.query(
        `UPDATE ai_conversations SET token_usage = $2::jsonb WHERE id = $1`,
        [id, JSON.stringify(tu)],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export function getTodayUsage(
  conv: AiConversation, day: string = new Date().toISOString().slice(0, 10),
): { input: number; output: number } {
  return conv.token_usage?.[day] ?? { input: 0, output: 0 };
}
```

- [ ] **Step 7: Run tests → pass**; `npm run typecheck`
- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat(agent): ai_conversations/ai_messages tables + repo + test bootstrap"`

---

### Task 2: Pixabay client (stub/api modes)

**Files:**
- Create: `src/server/media/pixabay.ts`
- Test: `src/server/media/pixabay.test.ts` (node env, no DB — no `d` gate needed)

**Interfaces:**
- Produces (used by Task 7):
  - `type PixabayImage = { id: number; tags: string; previewURL: string; largeImageURL: string; imageWidth: number; imageHeight: number; user: string; pageURL: string }`
  - `searchPixabay(q: string, opts?: { perPage?: number; env?: NodeJS.ProcessEnv; fetchFn?: typeof fetch }): Promise<{ mode: "stub" | "api"; hits: PixabayImage[] }>`

- [ ] **Step 1: Write failing tests**

```ts
// src/server/media/pixabay.test.ts
import { describe, it, expect, vi } from "vitest";
import { searchPixabay } from "./pixabay.js";

const FIXTURE = {
  hits: [{
    id: 111, tags: "dentist, smile", previewURL: "https://cdn.pixabay.com/p/111.jpg",
    largeImageURL: "https://pixabay.com/get/111_1280.jpg", imageWidth: 1280,
    imageHeight: 853, user: "photog", pageURL: "https://pixabay.com/photos/111/",
  }],
};

describe("searchPixabay", () => {
  it("returns deterministic stub hits when PIXABAY_API_KEY is unset", async () => {
    const res = await searchPixabay("dentist office", { env: {} as NodeJS.ProcessEnv });
    expect(res.mode).toBe("stub");
    expect(res.hits.length).toBeGreaterThan(0);
    expect(res.hits[0].largeImageURL).toContain("example.invalid");
  });

  it("calls the API with key + query + safesearch, returns typed hits", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => FIXTURE })) as unknown as typeof fetch;
    const res = await searchPixabay("dentist office", {
      env: { PIXABAY_API_KEY: "k123" } as NodeJS.ProcessEnv, fetchFn, perPage: 5,
    });
    expect(res.mode).toBe("api");
    const url = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("key=k123");
    expect(url).toContain("q=dentist+office");
    expect(url).toContain("safesearch=true");
    expect(url).toContain("per_page=5");
    expect(res.hits[0]).toMatchObject({ id: 111, user: "photog" });
  });

  it("throws a descriptive error on non-OK responses", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 429 })) as unknown as typeof fetch;
    await expect(
      searchPixabay("x", { env: { PIXABAY_API_KEY: "k" } as NodeJS.ProcessEnv, fetchFn }),
    ).rejects.toThrow(/pixabay.*429/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**
- [ ] **Step 3: Implement**

```ts
// src/server/media/pixabay.ts

/**
 * Pixabay search for the AI site agent. Mode mirrors src/server/ai/config.ts:
 * no PIXABAY_API_KEY = deterministic stub hits, zero network — dev + CI never
 * touch the API. Stub URLs use example.invalid so an accidental real fetch
 * fails loudly (import_image special-cases them — see tools/assets.ts).
 */
export type PixabayImage = {
  id: number; tags: string; previewURL: string; largeImageURL: string;
  imageWidth: number; imageHeight: number; user: string; pageURL: string;
};

const STUB_HITS: PixabayImage[] = [1, 2, 3].map((n) => ({
  id: n, tags: "stub, placeholder",
  previewURL: `https://example.invalid/stub-${n}-preview.jpg`,
  largeImageURL: `https://example.invalid/stub-${n}-1280.jpg`,
  imageWidth: 1280, imageHeight: 853, user: "stub", pageURL: `https://example.invalid/stub-${n}`,
}));

export async function searchPixabay(
  q: string,
  opts: { perPage?: number; env?: NodeJS.ProcessEnv; fetchFn?: typeof fetch } = {},
): Promise<{ mode: "stub" | "api"; hits: PixabayImage[] }> {
  const env = opts.env ?? process.env;
  const key = env.PIXABAY_API_KEY;
  if (!key) return { mode: "stub", hits: STUB_HITS };

  const fetchFn = opts.fetchFn ?? fetch;
  const params = new URLSearchParams({
    key, q, image_type: "photo", safesearch: "true",
    per_page: String(opts.perPage ?? 9),
  });
  const res = await fetchFn(`https://pixabay.com/api/?${params.toString()}`);
  if (!res.ok) throw new Error(`pixabay search failed: ${res.status}`);
  const body = (await res.json()) as { hits?: unknown[] };
  const hits = (body.hits ?? []).map((h) => {
    const x = h as Record<string, unknown>;
    return {
      id: Number(x.id), tags: String(x.tags ?? ""), previewURL: String(x.previewURL ?? ""),
      largeImageURL: String(x.largeImageURL ?? x.webformatURL ?? ""),
      imageWidth: Number(x.imageWidth ?? 0), imageHeight: Number(x.imageHeight ?? 0),
      user: String(x.user ?? ""), pageURL: String(x.pageURL ?? ""),
    };
  });
  return { mode: "api", hits };
}
```

- [ ] **Step 4: Run tests → pass**; `npm run typecheck`
- [ ] **Step 5: Commit** — `feat(agent): pixabay search client with stub mode`

---

### Task 3: Server-side image ingest

**Files:**
- Create: `src/server/media/ingest.ts`
- Test: `src/server/media/ingest.test.ts`

**Interfaces:**
- Consumes: `getStorage`, `MEDIA_BUCKET`, `extForContentType` (`src/server/media/storage.js`); the `media_assets` insert shape from `src/server/routes/media.ts:106-123` (columns: `site_id, gcs_key, content_type, alt, focal_point`, plus `variants_status` default `pending`; `gcs_key = originals/${siteId}/${assetId}.${ext}`); the GCS save options from `src/server/jobs/media-process-upload.ts:97-108`; `MEDIA_PROCESS_UPLOAD` (`src/server/jobs/index.js`).
- Produces (used by Task 7):

```ts
export type IngestDeps = {
  fetchFn?: typeof fetch;
  storage?: ReturnType<typeof getStorage>;   // injectable like MediaProcessUploadDeps
  enqueue?: (jobName: string, data: unknown) => Promise<string | null>;
};
export async function ingestImageFromUrl(
  pool: Pool,
  input: { siteId: string; url: string; alt: string; contentType?: string },
  deps?: IngestDeps,
): Promise<{ asset_id: string; gcs_key: string }>;
```

- [ ] **Step 1: Write failing tests** — use `setupAgentDb()` (Task 1) + the `d` gate; a fake `fetchFn` returning a 4-byte PNG buffer with `headers.get("content-type") === "image/png"`; a fake `storage` object `{ bucket: () => ({ file: (key) => ({ save: async (buf, opts) => { captured = { key, opts }; } }) }) }`; an `enqueue` spy. Assert:
  - `media_assets` row exists with `site_id`, `alt`, `content_type = 'image/png'`, `gcs_key = originals/<siteId>/<assetId>.png`, `variants_status = 'pending'`;
  - GCS save was called with that key and `metadata.contentType: "image/png"`, `resumable: false`;
  - `enqueue` called with `("media.process-upload", { asset_id })` (import and compare `MEDIA_PROCESS_UPLOAD`);
  - non-OK download → rejects `/download failed.*404/i` and **no media_assets row remains** (insert happens only after a successful download);
  - unsupported content-type (e.g. `text/html`, `extForContentType` → null) → rejects with a clear message.
- [ ] **Step 2: Run to verify failure**
- [ ] **Step 3: Implement**

```ts
// src/server/media/ingest.ts
import type { Pool } from "pg";
import { getStorage, MEDIA_BUCKET, extForContentType } from "./storage.js";
import { MEDIA_PROCESS_UPLOAD } from "../jobs/index.js";

export type IngestDeps = {
  fetchFn?: typeof fetch;
  storage?: ReturnType<typeof getStorage>;
  enqueue?: (jobName: string, data: unknown) => Promise<string | null>;
};

/**
 * Server-side ingest for the AI agent: fetch an image URL and land it in the
 * standard media pipeline (asset row → GCS original → variants job) — the same
 * shape the browser signed-URL flow produces, so hydration Just Works.
 * Download happens BEFORE the insert so a failed fetch leaves no orphan row.
 */
export async function ingestImageFromUrl(
  pool: Pool,
  input: { siteId: string; url: string; alt: string; contentType?: string },
  deps: IngestDeps = {},
): Promise<{ asset_id: string; gcs_key: string }> {
  const fetchFn = deps.fetchFn ?? fetch;
  const res = await fetchFn(input.url);
  if (!res.ok) throw new Error(`image download failed: ${res.status} for ${input.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType =
    input.contentType ?? res.headers?.get?.("content-type") ?? "application/octet-stream";
  const ext = extForContentType(contentType);
  if (!ext) throw new Error(`unsupported image content-type: ${contentType}`);

  const ins = await pool.query<{ id: string }>(
    `INSERT INTO media_assets (site_id, gcs_key, content_type, alt)
     VALUES ($1, 'pending', $2, $3) RETURNING id`,
    [input.siteId, contentType, input.alt],
  );
  const assetId = ins.rows[0].id;
  const gcsKey = `originals/${input.siteId}/${assetId}.${ext}`;
  await pool.query(`UPDATE media_assets SET gcs_key = $1 WHERE id = $2`, [gcsKey, assetId]);

  const storage = deps.storage ?? getStorage();
  await storage.bucket(MEDIA_BUCKET).file(gcsKey).save(buf, {
    metadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
    resumable: false,
  });

  const enqueue =
    deps.enqueue ??
    (async (name: string, data: unknown) => {
      // Lazy import + try/catch: getBoss() throws when bootJobs hasn't run
      // (tests, JOBS_ENABLED=false) — mirror routes/media.ts + create-site.ts.
      try {
        const { getBoss } = await import("../jobs/index.js");
        return await getBoss().send(name, data as Record<string, unknown>);
      } catch {
        return null;
      }
    });
  await enqueue(MEDIA_PROCESS_UPLOAD, { asset_id: assetId });

  return { asset_id: assetId, gcs_key: gcsKey };
}
```

Before finalizing: open `db/migrations/1747573000000_media_assets.cjs` — if `alt` or `focal_point` are NOT NULL or the insert needs more columns, match the real schema (the routes insert at `media.ts:106` is the source of truth).

- [ ] **Step 4: Run tests → pass**; `npm run typecheck`
- [ ] **Step 5: Commit** — `feat(agent): server-side image ingest into media pipeline`

---

### Task 4: Tool contract + read tools + dispatcher

**Files:**
- Create: `src/server/ai/agent/tools/types.ts`
- Create: `src/server/ai/agent/tools/read.ts`
- Create: `src/server/ai/agent/tools/index.ts`
- Test: `src/server/ai/agent/tools/read.test.ts`

**Interfaces:**
- Consumes: `zodToJsonSchema`; `setupAgentDb` (Task 1).
- Produces (used by Tasks 5–10):

```ts
// types.ts — exact contents
import type { Pool } from "pg";
import type { z } from "zod";

export type AgentChangeEvent = {
  kind: "page_created" | "page_updated" | "page_deleted" | "site_updated"
      | "template_applied" | "image_imported";
  page_id?: string;
  revision_id?: string;
  summary: string;
};

export type AgentToolCtx = {
  pool: Pool;
  siteId: string;
  conversationId: string;
  env: NodeJS.ProcessEnv;
  genId?: () => string; // deterministic block ids in tests
};

export type AgentToolResult =
  | { ok: true; data: unknown; summary?: string; change?: AgentChangeEvent }
  | { ok: false; error: string; details?: unknown };

export type AgentTool<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  paramsSchema: S;
  execute: (ctx: AgentToolCtx, input: z.infer<S>) => Promise<AgentToolResult>;
};
```

```ts
// index.ts exports
export const agentTools: AgentTool[];                    // Tasks 5–7 append their arrays
export function buildAgentToolDefs(): Anthropic.Tool[];  // zodToJsonSchema, $refStrategy:"none", $schema stripped — copy the toToolSchema pattern from propose.ts:50 into THIS file; do NOT modify propose.ts
export async function executeAgentTool(ctx: AgentToolCtx, name: string, input: unknown): Promise<AgentToolResult>;
// unknown tool → { ok:false, error:`unknown tool: ${name}` }
// paramsSchema.safeParse fail → { ok:false, error:"invalid tool input", details: parsed.error.errors.map(e => ({ path: e.path.join(".") || "(root)", message: e.message })) }
// execute() throw → { ok:false, error: message } (caught — a tool bug must not kill the turn)
```

Read tools in `read.ts` (all site-scoped SQL against `ctx.pool`):
- `get_site_overview` — params `z.object({})`; data `{ site: { id, slug, display_name, status, default_brand_tokens, seo_defaults }, pages: [{ id, slug, title, status, updated_at }] (ORDER BY updated_at DESC — same as admin-sites.ts:181), media_count: number, templates: [{ id, slug, name, kind }] (active only) }`.
- `get_page` — params `z.object({ page_id: z.string().uuid() })`; data: `{ id, slug, title, status, blocks, seo }`; `WHERE id = $1 AND site_id = $2` → miss = `{ ok: false, error: "page not found in this site" }`.
- `list_templates` — params `z.object({ kind: z.enum(["site","page"]).optional() })`; active templates (`templates` table, `status = 'active'`).
- `list_media` — params `z.object({})`; `SELECT id, alt, content_type, variants_status FROM media_assets WHERE site_id = $1 ORDER BY created_at DESC LIMIT 100`.

- [ ] **Step 1: Write failing tests** — `setupAgentDb` + `d` gate; seed two sites, two pages on site A; ctx = `{ pool: db.getPool(), siteId, conversationId: "conv-test", env: {} as NodeJS.ProcessEnv }`. Assert: overview lists only site A's pages; `get_page` returns blocks for A's page and `ok:false` for B's page id; `executeAgentTool` → `ok:false` for `"nonexistent_tool"` and for `get_page` with `{}` (invalid input, details array present); a tool whose execute throws (register a throwing dummy in the test via `agentTools.push`, popped in `afterAll`) → `ok:false` with the error message.
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement `types.ts` (verbatim above), `read.ts`, `index.ts`:**

```ts
// src/server/ai/agent/tools/index.ts
import type Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import type { AgentTool, AgentToolCtx, AgentToolResult } from "./types.js";
import { readTools } from "./read.js";
// Task 5 adds: import { pageTools } from "./pages.js";
// Task 6 adds: import { settingsTools } from "./settings.js";
// Task 7 adds: import { assetTools } from "./assets.js";

export const agentTools: AgentTool[] = [...readTools];

function toToolSchema(schema: z.ZodTypeAny): Anthropic.Tool.InputSchema {
  const js = zodToJsonSchema(schema, { $refStrategy: "none" }) as Record<string, unknown>;
  delete js.$schema;
  return js as Anthropic.Tool.InputSchema;
}

export function buildAgentToolDefs(): Anthropic.Tool[] {
  return agentTools.map((t) => ({
    name: t.name, description: t.description, input_schema: toToolSchema(t.paramsSchema),
  }));
}

export async function executeAgentTool(
  ctx: AgentToolCtx, name: string, input: unknown,
): Promise<AgentToolResult> {
  const tool = agentTools.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `unknown tool: ${name}` };
  const parsed = tool.paramsSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return {
      ok: false, error: "invalid tool input",
      details: parsed.error.errors.map((e) => ({ path: e.path.join(".") || "(root)", message: e.message })),
    };
  }
  try {
    return await tool.execute(ctx, parsed.data);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "tool crashed" };
  }
}
```

- [ ] **Step 4: Run → pass**; `npm run typecheck`
- [ ] **Step 5: Commit** — `feat(agent): tool contract, dispatcher, read tools`

---

### Task 5: Page write tools

**Files:**
- Create: `src/server/ai/agent/tools/pages.ts`
- Modify: `src/server/ai/agent/tools/index.ts` (append `pageTools`)
- Test: `src/server/ai/agent/tools/pages.test.ts`

**Interfaces:**
- Consumes: `applyAndValidate`, `editOpsSchema` (`src/server/ai/edit-ops.js`); `blockShape`, `validateBlocks` (`src/blocks/validate.js`); `diffBlocks` (`src/server/ai/diff.js`); `nanoid`; `import "../../../blocks/index.js"` registry side-effect (same as `propose.ts:7` — required in this module).
- Produces (`export const pageTools: AgentTool[]`):
  - `create_page` — params `z.object({ slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/), title: z.string().min(1), blocks: z.array(z.object({ type: z.string().min(1), props: z.record(z.unknown()).default({}) })).default([]) })`. Assign each block `{ id: (ctx.genId ?? nanoid)(), type, props }`, run `validateBlocks`; failures → `{ ok: false, error: "block validation failed", details: failures }`. Then one transaction (`pool.connect()`/BEGIN): `INSERT INTO pages (site_id, slug, title, blocks, status) VALUES ($1,$2,$3,$4::jsonb,'draft') RETURNING id` + `INSERT INTO page_revisions (page_id, blocks, seo, source) VALUES ($1,$2::jsonb,'{}'::jsonb,'ai') RETURNING id`. Unique-violation on `(site_id, slug)` → `{ ok: false, error: "slug already in use" }` (catch pg error code `23505`). Change event `page_created` with both ids.
  - `update_page` — params `z.object({ page_id: z.string().uuid(), title: z.string().min(1).optional(), ops: editOpsSchema })`. Load page site-scoped (`SELECT blocks, seo FROM pages WHERE id=$1 AND site_id=$2`); miss → `ok:false "page not found in this site"`. `applyAndValidate(page.blocks, ops, { genId: ctx.genId })`; failure → `{ ok: false, error: "proposal rejected at the <stage> stage", details: failures }` (this is what the model self-corrects from). Success → transaction: `UPDATE pages SET blocks=$1::jsonb, title=COALESCE($2,title), updated_at=now() WHERE id=$3` + revision insert (blocks + existing `seo`, source `'ai'`) `RETURNING id`. Data `{ page_id, revision_id, diff: diffBlocks(before, after) }`; change event `page_updated`, summary = `diff.summary`.
  - `delete_page` — params `z.object({ page_id: z.string().uuid() })`. Site-scoped; count pages first — deleting the last page → `{ ok: false, error: "cannot delete the only page" }`. (No existing HTTP delete endpoint to reuse — this is new SQL: `DELETE FROM pages WHERE id=$1 AND site_id=$2`.) Change event `page_deleted`.

- [ ] **Step 1: Write failing tests** covering: create (page + revision rows exist with `source='ai'`, blocks got ids, duplicate slug → `ok:false`); update happy path (blocks changed in DB, revision row, `diff.summary` non-empty; cross-site page_id → `ok:false`); update with an unknown block type in an insert op → `ok:false` AND page blocks unchanged in DB; delete happy + last-page refusal. Use real registered block types for valid cases (open `packages/components/src/blocks/hero/schema.ts` and `src/blocks/rich-text/` for exact prop names — e.g. rich-text takes `{ html: string }`; verify hero's actual fields before hardcoding).
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement** (~140 lines) per the contracts above.
- [ ] **Step 4: Run → pass**; `npm run typecheck`
- [ ] **Step 5: Commit** — `feat(agent): page write tools (create/update/delete) with revisions`

---

### Task 6: Site-settings tools

**Files:**
- Create: `src/server/ai/agent/tools/settings.ts`
- Modify: `src/server/ai/agent/tools/index.ts` (append `settingsTools`)
- Test: `src/server/ai/agent/tools/settings.test.ts`

**Interfaces:**
- Consumes: `brandTokensSchema` (`src/blocks/brand-tokens.js` — a `z.record(string,string)` with `--theme-*` key validation); `siteSeoDefaultsSchema`, `seoFieldsSchema` (`src/server/seo/schema.js` — note the exact export names); `evictSiteCache` (`src/middleware/resolveSite.js`).
- Produces (`export const settingsTools: AgentTool[]`):
  - `set_brand_tokens` — params `z.object({ tokens: brandTokensSchema })`; `UPDATE sites SET default_brand_tokens=$1::jsonb WHERE id=$2`; then evict the resolver cache for every hostname (copy `admin-sites.ts:253-257`: `SELECT hostname FROM site_domains WHERE site_id=$1` → `evictSiteCache(hostname)` each). Change event `site_updated` ("Brand tokens updated").
  - `set_seo_defaults` — params `z.object({ seo_defaults: siteSeoDefaultsSchema })`; `UPDATE sites SET seo_defaults=$1::jsonb WHERE id=$2` + same cache eviction. Change event `site_updated`.
  - `set_page_seo` — params `z.object({ page_id: z.string().uuid(), seo: seoFieldsSchema })`; site-scoped `UPDATE pages SET seo=$1::jsonb, updated_at=now() WHERE id=$2 AND site_id=$3` + revision insert with the page's current blocks and the NEW seo (`source: 'ai'`) — matching how the page save endpoint always writes blocks+seo to revisions. Change event `page_updated` with `revision_id`.

- [ ] **Step 1: Write failing tests** — valid tokens (e.g. `{ "--theme-main": "#112233" }`) persist and re-read from `sites`; invalid tokens (bad key `"main"`) → dispatcher returns `ok:false "invalid tool input"`; `set_page_seo` cross-site → `ok:false`; revision row written for `set_page_seo`. Mock nothing — `evictSiteCache` is a pure in-memory cache call, safe in tests.
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement** (~90 lines)
- [ ] **Step 4: Run → pass**; `npm run typecheck`
- [ ] **Step 5: Commit** — `feat(agent): brand/SEO settings tools`

---

### Task 7: Template + image tools

**Files:**
- Create: `src/server/ai/agent/tools/assets.ts`
- Modify: `src/server/ai/agent/tools/index.ts` (append `assetTools`)
- Test: `src/server/ai/agent/tools/assets.test.ts`

**Interfaces:**
- Consumes: `searchPixabay` (Task 2), `ingestImageFromUrl` + `IngestDeps` (Task 3), `handleMaterializeTemplate` + types (`src/server/jobs/materialize-template.js` — signature `handleMaterializeTemplate(data: { siteId, templateId }, deps: { pool }): Promise<{ pages_created, pages_skipped, brand_tokens_adopted, … }>`; it is idempotent and skips sites that already have pages); `getTemplate` (`src/server/templates/repo.js` — confirm exact name/signature by reading the file).
- Produces (`export const assetTools: AgentTool[]`), plus a test seam:
  - `export function __setIngestDepsForTests(deps: IngestDeps | null): void` — module-level override passed through to `ingestImageFromUrl`; reset with `null` in `afterEach`.
  - `apply_site_template` — params `z.object({ template_id: z.string().uuid() })`. Load template (site kind, active — 404/kind/archived checks like `templates.ts:359-441`, but as `ok:false` results). Call `handleMaterializeTemplate({ siteId: ctx.siteId, templateId }, { pool: ctx.pool })` **directly** (synchronous materialization — the agent needs the pages to exist before its next tool call; the pg-boss queue is for operator-initiated creates). `pages_created === 0` → `{ ok: false, error: "site already has pages; edit them instead" }`. Data: the handler's result. Change event `template_applied`.
  - `search_stock_images` — params `z.object({ query: z.string().min(2), per_page: z.number().int().min(1).max(20).default(9) })`; calls `searchPixabay(query, { perPage, env: ctx.env })`; data `{ mode, hits: hits.map(h => ({ id: h.id, tags: h.tags, preview: h.previewURL, download_url: h.largeImageURL, width: h.imageWidth, height: h.imageHeight, credit: h.user })) }`. No side effects.
  - `import_image` — params `z.object({ url: z.string().url(), alt: z.string().min(3) })` (alt REQUIRED — spec: agent writes alt at import). When the url host is `example.invalid` (stub hits), inject a `fetchFn` that returns a canned 1×1 PNG (embed the 67-byte base64 constant `iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==` decoded via `Buffer.from(b64, "base64")`, `headers: new Headers({ "content-type": "image/png" })`) so stub builds stay fully offline; otherwise pass the test-seam deps (or none). Calls `ingestImageFromUrl(ctx.pool, { siteId: ctx.siteId, url, alt })`; data `{ asset_id, alt }`; change event `image_imported`. Tool description MUST tell the model: "after importing, place the image with the image block using this asset_id and the same alt text" (the `image` block references media by `asset_id`).

- [ ] **Step 1: Write failing tests** — seed a site + a `kind:'site'` template with one `template_pages` row (inline SQL fixture with valid registered blocks); `apply_site_template` creates the page and returns `pages_created: 1`; second call → `ok:false` "already has pages". `search_stock_images` in stub env returns 3 hits with `download_url`. `import_image` with a stub URL + `__setIngestDepsForTests({ storage: fakeStorage, enqueue: spy })` creates a `media_assets` row with the given alt, no network.
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement** (~130 lines)
- [ ] **Step 4: Run → pass**; `npm run typecheck`
- [ ] **Step 5: Commit** — `feat(agent): template apply + stock image tools`

---

### Task 8: Agent loop (`runAgentTurn`)

**Files:**
- Create: `src/server/ai/agent/loop.ts`
- Test: `src/server/ai/agent/loop.test.ts`

**Interfaces:**
- Consumes: repo (Task 1, pool-first signatures), tools (Tasks 4–7), `runMessage` (`src/server/ai/client.js` — non-streaming, injectable client, pinned model), `resolveAiMode` (`config.js`), `buildBlockCatalog` (`catalog.js`), `import "../../blocks/index.js"`.
- Produces (used by Tasks 9–10):

```ts
import type Anthropic from "@anthropic-ai/sdk";
import type { AgentChangeEvent } from "./tools/types.js";

export type TurnDoneReason = "end_turn" | "max_tools" | "budget" | "error" | "promoted";
export type AgentTurnEvent =
  | { type: "assistant_text"; text: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; name: string; ok: boolean; summary?: string; change?: AgentChangeEvent }
  | { type: "turn_done"; reason: TurnDoneReason; message?: string };

export async function runAgentTurn(input: {
  pool: Pool;
  conversationId: string;
  siteId: string;
  env?: NodeJS.ProcessEnv;
  client?: Anthropic;                                       // injected mock in tests
  onEvent?: (e: AgentTurnEvent) => void;
  limits?: { maxToolCalls?: number; deadlineMs?: number };  // route passes {15, 45_000}; job passes {}
  genId?: () => string;
}): Promise<{ reason: TurnDoneReason; toolCalls: number }>;
```

**Behavior (implement exactly; the caller persists the triggering user message BEFORE calling this):**

1. Caps: `maxToolCalls = limits.maxToolCalls ?? Number(env.AI_AGENT_MAX_TOOL_CALLS ?? 30)`; `deadline = limits.deadlineMs ? Date.now() + limits.deadlineMs : null`.
2. **Stub / dry-run** (`resolveAiMode(env) !== "api"`) — deterministic script exercising the REAL tool path, zero spend:
   - site has no pages → `executeAgentTool(ctx, "create_page", { slug: "home", title: "Home", blocks: [{ type: "hero", props: { /* real hero prop names — read the schema */ } }, { type: "rich-text", props: { html: "<p>[AI agent stub] Set ANTHROPIC_API_KEY for live builds.</p>" } }] })`; persist a synthetic assistant message `[{ type: "tool_use", id: "toolu_stub_1", name: "create_page", input }]`, persist role-`tool` message `[{ type: "tool_result", tool_use_id: "toolu_stub_1", content: JSON.stringify(result.data) }]`, emit `tool_call` + `tool_result` events;
   - then persist + emit a final assistant text ("Stub mode: created a starter Home page." / "Stub mode: no changes made — site already has pages.");
   - emit `turn_done end_turn`, return.
3. **API mode loop:**
   - System prompt (module const):

```ts
const AGENT_SYSTEM_INTRO = `You are the site agent for the AnchorCorps site builder. You work on exactly ONE site per conversation, using only the provided tools. Pages are ordered arrays of typed "blocks"; the catalog below lists the ONLY block types you may use and the JSON Schema each block's props must satisfy.

Rules:
- TEMPLATE-FIRST: for a new or empty site, call get_site_overview first, then prefer apply_site_template with a fitting site template and adapt the result, over building page-by-page from scratch.
- All work lands on DRAFT pages. You cannot publish, change domains, or configure plugins — the operator does that.
- Batch related edits: one update_page call with several ops beats several calls.
- When you import an image you MUST supply descriptive alt text, then place it with the image block using the returned asset_id and the same alt.
- Write real, specific copy for the business described — no lorem ipsum.
- If a tool result reports a validation failure, correct the input and retry; after repeated failures, stop and explain.
- Reference pages and blocks by their exact ids from tool results. Never invent ids or block types.
- When the work is done, summarize what you changed in one short paragraph.`;
// system = [{ type: "text", text: `${AGENT_SYSTEM_INTRO}\n\n--- BLOCK CATALOG ---\n${JSON.stringify(buildBlockCatalog())}`, cache_control: { type: "ephemeral" } }]
```

   - Rebuild API messages from `listMessages(pool, conversationId, { limit: 40 })`: DB `user`/`assistant` map 1:1; DB `tool` → API role `"user"` (tool_result blocks ride in user-role messages per the Anthropic messages convention). Content is the raw stored array. Drop leading messages until the first is role `user`.
   - **Budget gate before every model call**: `getTodayUsage(await getConversation(pool, conversationId, siteId))`; `input + output >= Number(env.AI_AGENT_TOKEN_BUDGET ?? 1_000_000)` → persist assistant text "Daily token budget for this conversation is exhausted — try again tomorrow or raise AI_AGENT_TOKEN_BUDGET.", emit it, emit `turn_done budget`, return.
   - `const { message } = await runMessage({ system, messages, tools: buildAgentToolDefs(), tool_choice: { type: "auto" }, max_tokens: 8192 }, { client: input.client, env });` then `addTokenUsage(pool, conversationId, { input: message.usage.input_tokens ?? 0, output: message.usage.output_tokens ?? 0 })`.
   - Persist `appendMessage(pool, conversationId, "assistant", message.content)`; emit `assistant_text` per text block.
   - `message.stop_reason !== "tool_use"` → emit `turn_done end_turn`, return.
   - Execute every `tool_use` block **sequentially** via `executeAgentTool`; tool_result content block: `{ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result.ok ? result.data : { error: result.error, details: result.details }), is_error: !result.ok }`; persist all as ONE role-`tool` message; emit `tool_call`/`tool_result` (carry `result.change`) per block.
   - **Failure streak**: map `toolName → consecutive ok:false count`, reset on any success; a tool hitting 3 → persist assistant text explaining the stop, `setConversationStatus(pool, conversationId, "error")`, emit `turn_done error`, return.
   - **Caps**: cumulative tool calls ≥ `maxToolCalls` → persist a short assistant note, emit `turn_done max_tools`, return. `deadline` passed → emit `turn_done promoted` and return `{ reason: "promoted" }` WITHOUT persisting anything extra — the last persisted message is the role-`tool` message, so a continuation call rebuilds context ending in tool_results and the model resumes mid-task naturally.
   - Loop to the budget gate.

- [ ] **Step 1: Write failing tests** (`setupAgentDb`; scripted fake client `{ messages: { create: vi.fn() } } as unknown as Anthropic` returning hand-built `Anthropic.Message` objects in sequence — copy the message-shape from `client.ts:82-105`'s `cannedMessage`; `env: { ANTHROPIC_API_KEY: "test-key" } as NodeJS.ProcessEnv`):
  - happy path: seeded page; script = [tool_use `get_site_overview`] → [tool_use `update_page` w/ valid ops] → [text, `stop_reason: "end_turn"`]; assert 3 `create` calls, DB message sequence roles `user(pre-persisted by test), assistant, tool, assistant, tool, assistant`, page blocks actually changed + revision `source='ai'`, event order, usage accumulated (set nonzero `usage` on the fake messages).
  - self-correction: first `update_page` has an insert op with unknown type → tool_result `is_error: true` in DB → next scripted message fixes it → final success; the failed attempt did not change the page.
  - failure streak: same bad call scripted 3× → `turn_done error`, conversation status `error`.
  - promotion: `limits: { deadlineMs: 0 }` + a tool_use script → `{ reason: "promoted" }`, last DB message role `tool`.
  - budget: `addTokenUsage` past the default before the call → immediate `budget`, zero `create` calls.
  - stub: `env: {}` on an empty site → real `home` page created; synthetic tool_use/tool_result pair persisted.
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement `loop.ts`** (~220 lines)
- [ ] **Step 4: Run → pass**; `npm run typecheck`
- [ ] **Step 5: Commit** — `feat(agent): multi-turn agent loop with caps, budget, stub script`

---

### Task 9: pg-boss job for build turns

**Files:**
- Create: `src/server/jobs/agent-turn.ts`
- Modify: `src/server/jobs/index.ts` (queue const + registration in `registerHandlers`)
- Test: `src/server/jobs/agent-turn.test.ts`

**Interfaces:**
- Consumes: `runAgentTurn` (Task 8), `setConversationStatus` (Task 1).
- Produces:
  - In `src/server/jobs/index.ts`: `export const AGENT_TURN = "ai.agent-turn";` next to the other queue constants; inside `registerHandlers`: `await boss.createQueue(AGENT_TURN); await boss.work<AgentTurnInput>(AGENT_TURN, async ([job]) => { await handleAgentTurn(job.data, { pool: defaultPool }); });` (v12 array-destructure pattern, exactly like the neighbors).
  - `agent-turn.ts`:

```ts
import type { Pool } from "pg";
import { runAgentTurn } from "../ai/agent/loop.js";
import { setConversationStatus } from "../ai/agent/repo.js";

export type AgentTurnInput = { conversationId: string; siteId: string };
export type AgentTurnDeps = { pool: Pool; runTurn?: typeof runAgentTurn };

/**
 * Build-turn worker: full caps, no deadline (progress persists as ai_messages;
 * the SSE tail reads the DB, so no onEvent wiring here). Errors mark the
 * conversation `error` and rethrow so pg-boss records the failure.
 */
export async function handleAgentTurn(data: AgentTurnInput, deps: AgentTurnDeps): Promise<void> {
  const runTurn = deps.runTurn ?? runAgentTurn;
  try {
    await runTurn({ pool: deps.pool, conversationId: data.conversationId, siteId: data.siteId });
  } catch (err) {
    await setConversationStatus(deps.pool, data.conversationId, "error").catch(() => undefined);
    throw err;
  }
}
```

- [ ] **Step 1: Write failing tests** — stub mode (`ANTHROPIC_API_KEY` absent from process.env under vitest — assert, or pass a `runTurn` spy): `handleAgentTurn` with a real empty seeded site+conversation creates the stub page; with `runTurn` throwing → conversation status becomes `error` and the handler rethrows.
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement + register**
- [ ] **Step 4: Run → pass**; `npm run typecheck`
- [ ] **Step 5: Commit** — `feat(agent): ai.agent-turn queue + worker`

---

### Task 10: HTTP routes (conversations, messages, SSE, preview)

**Files:**
- Create: `src/server/routes/admin-ai-agent.ts`
- Modify: `src/server/app.ts` (mount inside `createApp` with the other `/api` routers — MUST be inside createApp so it beats the vite/static catch-alls)
- Modify: `src/server/routes/admin-pages.ts` (draft preview endpoint)
- Test: `tests/integration/ai-agent-routes.test.ts`

**Interfaces:**
- Consumes: repo, loop, `AGENT_TURN` (+ `getBoss` lazily), `requireAdmin()` (`src/middleware/requireAdmin.js`), `rateLimit` (`src/middleware/rateLimit.js`), `renderPage` + `PageRecord` (`src/server/render-page.js`).
- Produces:

```ts
export type AdminAiAgentOptions = {
  pool?: Pool;
  runTurn?: typeof runAgentTurn;                                     // injectable for tests
  enqueue?: (input: AgentTurnInput) => Promise<string | null>;       // default: lazy getBoss().send(AGENT_TURN, input) in try/catch
  messageRateLimit?: RateLimitOptions;                               // default { max: 10, windowMs: 60_000 }
};
export function adminAiAgentRouter(opts: AdminAiAgentOptions = {}): Router;
```

| Route | Behavior |
|---|---|
| `POST /api/sites/:siteId/agent/conversations` | zod body `{ title?: string; message?: string; run?: "inline"\|"job" }`. Site must exist (`SELECT id FROM sites WHERE id=$1` → 404 `site not found`). Create conversation (title = provided, else first 60 chars of message, else "New conversation"). If `message`: `appendMessage(pool, id, "user", [{ type: "text", text: message }])`; then `run === "job"` → `enqueue({ conversationId, siteId })` → `202 { conversation, queued: true }`. Otherwise `201 { conversation }` (client then POSTs /messages for inline streaming — creation itself never streams). |
| `GET /api/sites/:siteId/agent/conversations` | `200 { conversations }` |
| `GET /api/sites/:siteId/agent/conversations/:conversationId` | `getConversation(pool, id, siteId)` → 404 `conversation not found` (cross-tenant guard) → `200 { conversation, messages }` (all, ascending) |
| `POST .../:conversationId/messages` | zod body `{ message: z.string().min(1), run: z.enum(["inline","job"]).default("inline") }`. 404 as above; conversation status `error` → allowed (message becomes the resume). Append user message. `run:"job"` → enqueue → `202 { queued: true }`. Inline → SSE: `sseInit(res)`; `await runTurn({ pool, conversationId, siteId, onEvent: (e) => sseSend(res, e), limits: { maxToolCalls: 15, deadlineMs: 45_000 } })`; if result reason `promoted` → `enqueue(...)` (the done event already told the client); `res.end()`. Wrap in try/catch → on throw, `sseSend(res, { type: "turn_done", reason: "error", message: "internal" })` + end. |
| `GET .../:conversationId/events?after=<messageId>` | SSE tail for job-run turns: `sseInit`; send `{ type: "snapshot", conversation, messages }` (after `after` if given, else last 50); then `setInterval` 1000ms → `listMessages(pool, id, { afterId: lastSeenId })` → emit `{ type: "message", message }` each + re-fetch conversation, emit `{ type: "status", status }` on change; heartbeat `res.write(": hb\n\n")` every 15s; `clearInterval` on `req.on("close")`. |

Preview endpoint (in `admin-pages.ts`, inside the existing router factory):
`GET /sites/:siteId/pages/:pageId/preview` — `tokenFromQuery` shim then `admin` (the router's existing `requireAdmin()` instance). Load the site row by id and the page row site-scoped (ANY status — that's the point: preview drafts). Build the `ResolvedSite`-shaped object `renderPage` needs: import the type from `src/middleware/resolveSite.js` and satisfy it from a `SELECT` on `sites` (+ primary hostname from `site_domains`) — extend the select list until `tsc` is satisfied; mirror how the tenant page route (`src/server/app.ts:130`'s catch-all → find the actual route file via `pageRouter`) hydrates media assets for blocks and pass the same `assets` array. Then `const { html } = renderPage(site, page as PageRecord, { assets }); res.status(200).type("html").send(html);`.

SSE + query-token helpers (top of `admin-ai-agent.ts`, exported for the preview endpoint to import):

```ts
export function sseInit(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}
export function sseSend(res: Response, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
/** iframes/EventSource can't set headers; lift ?token= into the header requireAdmin reads. */
export function tokenFromQuery(req: Request, _res: Response, next: NextFunction): void {
  if (!req.headers["x-admin-token"] && typeof req.query.token === "string") {
    req.headers["x-admin-token"] = req.query.token;
  }
  next();
}
```

- [ ] **Step 1: Write failing integration tests** — per-router app (the `from-template.test.ts` pattern): `express()` + `express.json()` + `app.use("/api", adminAiAgentRouter({ pool, runTurn: spy, enqueue: spy }))` (+ `adminPagesRouter({ pool })` for preview), `process.env.ADMIN_API_TOKEN = "test-admin-token"`, `auth()` helper. Cover: conversation create/list/detail round-trip; 404 for a conversation under the wrong siteId; `run:"job"` hits the `enqueue` spy with `{ conversationId, siteId }` and returns 202; inline message POST returns `content-type: text/event-stream` and the streamed body contains `"turn_done"` (with `runTurn` spy emitting a fixed event sequence via `onEvent` then resolving — use supertest `.buffer(true).parse((res, cb) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => cb(null, d)); })`); unauthenticated → 401; preview: 200 HTML containing a seeded draft page's text, 404 cross-site, and `?token=test-admin-token` works with no header.
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement router (~230 lines) + preview endpoint + `app.ts` mount** (`app.use("/api", adminAiAgentRouter())` next to the other routers, before the page catch-all).
- [ ] **Step 4: Run → pass**; `npm run typecheck`
- [ ] **Step 5: Commit** — `feat(agent): agent HTTP API (conversations, SSE, draft preview)`

---

### Task 11: Studio chat drawer

**Files:**
- Create: `src/admin/lib/agent-api.ts`
- Create: `src/admin/components/AgentChatDrawer.tsx`
- Test: `src/admin/components/AgentChatDrawer.test.tsx` (jsdom pragma)

**Interfaces:**
- Consumes: `apiFetch`, `ApiError` (`src/admin/lib/apiFetch.js`); `getAdminToken` (`src/admin/lib/adminToken.js`); UI kit `src/admin/ui/{button,card,input,spinner}.js` + `cn`; HTTP contract from Task 10; `AgentTurnEvent`/`AgentChangeEvent` shapes (declare local TS types mirroring them — the admin bundle must not import server modules).
- Produces:
  - `agent-api.ts`: `streamAgentEvents(path: string, opts: { body?: unknown; signal?: AbortSignal; onEvent: (e: Record<string, unknown>) => void }): Promise<void>` — `fetch(path, { method: opts.body ? "POST" : "GET", credentials: "include", headers: { "Content-Type": "application/json", ...(getAdminToken() ? { "X-Admin-Token": getAdminToken()! } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined, signal })`; non-2xx → throw `ApiError`; else read `res.body!.getReader()` + `TextDecoder`, accumulate, split on `\n\n`, skip `:` heartbeat lines, `JSON.parse` after stripping the `data: ` prefix, call `onEvent` per event.
  - `AgentChatDrawer` props: `{ siteId: string; slug: string; open: boolean; onClose: () => void; onSiteChanged: () => void; autoTail?: boolean }` (`autoTail` — start tailing `/events` on mount; used right after wizard job-run builds).

**Component behavior:** on open: `apiFetch<{ conversations }>(GET .../agent/conversations)` → pick newest `active`/`error`, else lazily create on first send (`POST` no message). Render (Tailwind, match `AskAiPanel`'s idiom — `EditorPage.tsx:145-269`): scrollable list (user text right-aligned zinc; assistant text; **change cards** for `tool_result` events / persisted messages that carry `change`), textarea + Send button, footer showing today's tokens (from conversation `token_usage`), "Resume" button when status `error` (sends `message: "continue"`). Sending: append locally, `streamAgentEvents(POST .../messages, { message })`; events append live; `turn_done` reason `promoted` → immediately `streamAgentEvents(GET .../events?after=<lastMessageId>)` and keep appending from `{type:"message"}` snapshots (derive display items from persisted messages: assistant text blocks → text bubbles; tool messages → cards where the matching tool result parses). Any event with a `change` → call `onSiteChanged()`. Change card: `change.summary` + `Open page` (react-router `Link` to `/sites/${slug}/pages/${change.page_id}`) + when `revision_id`: `Revert` → `apiFetch(POST /api/sites/${siteId}/pages/${change.page_id}/revisions/${change.revision_id}/restore, { method: "POST" })` → `onSiteChanged()`. (Restore route confirmed at `admin-pages.ts:305-310`; open it and match the exact path + response.)

- [ ] **Step 1: Write failing jsdom tests** — `// @vitest-environment jsdom` pragma; `setAdminToken("tok")` in beforeEach, cleanup pattern from `PagesTab.test.tsx:26-36`; mock `../lib/agent-api.js` with `vi.mock` so `streamAgentEvents` synchronously emits: `{type:"assistant_text",text:"Working…"}`, `{type:"tool_result",name:"update_page",ok:true,change:{kind:"page_updated",page_id:"p1",revision_id:"r1",summary:"1 updated"}}`, `{type:"turn_done",reason:"end_turn"}`; mock `global.fetch` for the `apiFetch` calls (conversations list, revert POST). Assert: bubbles + card render; Revert calls the restore URL and fires `onSiteChanged`; Send clears the textarea.
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement** (~260 lines total across the two files)
- [ ] **Step 4: Run → pass**; `npm run typecheck`
- [ ] **Step 5: Commit** — `feat(agent): Studio chat drawer with change cards + revert`

---

### Task 12: Wizard "Start with AI" + site-detail integration

**Files:**
- Modify: `src/admin/pages/NewSiteWizard.tsx`
- Modify: `src/admin/pages/SiteDetailPage.tsx`
- Test: `src/admin/pages/NewSiteWizard.test.tsx`, `src/admin/pages/SiteDetailPage.test.tsx` (extend if they exist — check first — else create with the jsdom pragma pattern)

**Behavior:**
- **Wizard**: the step-1 "Start from" select (blank | template) gains a third mode `ai` ("Start with AI ✨"). AI mode reveals a required description textarea ("Describe the business, the pages you want, tone…"). Submit for AI mode (new `submitWithAi()` beside `submitFromTemplate()`):
  1. `const site = await apiFetch<{ site?: { id: string }; id?: string }>("/api/sites", { method: "POST", body: { slug, display_name: displayName.trim() } })` — open the existing blank-path submit in this file and reuse its exact call + response-shape handling and 409 `handleConflict`;
  2. `await apiFetch(`/api/sites/${siteIdFromResponse}/agent/conversations`, { method: "POST", body: { title: "Initial build", message: description.trim(), run: "job" } })`;
  3. `navigate(`/sites/${slug}?ai=1`)`.
- **SiteDetailPage** (`SiteDetailView`): add an "AI" header button (`aria-pressed`, like the editor's Ask-AI toggle) controlling `const [aiOpen, setAiOpen] = useState(searchParams.get("ai") === "1")` (`useSearchParams` from react-router-dom). Render `<AgentChatDrawer siteId={site.id} slug={slug} open={aiOpen} onClose={() => setAiOpen(false)} onSiteChanged={reload} autoTail={searchParams.get("ai") === "1"} />` beside the tabpanel (drawer as a right-hand column, `flex` layout — tabs stay usable). Below/beside the drawer when open: preview iframe

```tsx
const previewSrc = previewPageId
  ? `/api/sites/${site.id}/pages/${previewPageId}/preview${getAdminToken() ? `?token=${encodeURIComponent(getAdminToken()!)}` : ""}`
  : null;
{previewSrc && <iframe title="Draft preview" src={previewSrc} key={previewNonce} className="h-96 w-full rounded border border-zinc-200" />}
```

  `previewPageId` = `page_id` of the latest change event bubbled up from the drawer (add an optional `onChangeEvent?: (c: AgentChangeEvent) => void` prop to `AgentChatDrawer` — thread it in Task 11 if doing these tasks in order, else add here), falling back to the first page from the Pages data already loaded on this screen; `previewNonce` increments on every change event (forces iframe reload). When Studio runs on session auth (no token in localStorage), the iframe rides the session cookie — omit the query param.

- [ ] **Step 1: Write failing tests** — wizard AI path: fill name/slug/description → submit → assert both fetch calls (order + bodies: site create, then conversation with `run:"job"`) and navigation target `/sites/<slug>?ai=1` (mock `global.fetch`; assert via `MemoryRouter` route probe as in `PagesTab.test.tsx:14-24`). SiteDetail: with `?ai=1` the drawer renders open (mock `AgentChatDrawer` with `vi.mock` to a stub that records props).
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → pass**; `npm run typecheck`
- [ ] **Step 5: Commit** — `feat(agent): Start-with-AI wizard path + drawer/preview on site detail`

---

### Task 13: End-to-end stub build integration test

**Files:**
- Test: `tests/integration/ai-agent-build.test.ts`

The Definition-of-Done rehearsal, zero API spend, no mocks of our own code. Per-router app with `adminAiAgentRouter({ pool })` + `adminPagesRouter({ pool })` + `adminSitesRouter({ pool })`; `ADMIN_API_TOKEN` env; explicitly `delete process.env.ANTHROPIC_API_KEY` scoped to the suite (stub mode). Flow:
1. `POST /api/sites` (fresh slug) → site id.
2. `POST .../agent/conversations { message: "Build a dental site" }` (no run — returns 201, message persisted).
3. Call `runAgentTurn({ pool, conversationId, siteId })` **directly** (inline SSE under supertest is exercised in Task 10; here we validate the pipeline end-state).
4. Assert via HTTP: conversation detail shows roles `user, assistant, tool, assistant`; the site's pages list (reuse whichever route serves it — `GET /api/sites/:siteId/pages` on adminSitesRouter) contains `home` with status `draft`; the page's revisions list contains `source: 'ai'`; `GET .../pages/:pageId/preview?token=…` returns HTML containing the stub hero/rich-text copy.
5. A second conversation + `runAgentTurn` on the same site reports no changes (stub: site non-empty) and page count is unchanged.

- [ ] **Step 1: Write the test** (should pass if Tasks 1–10 are correct — this is the integration gate, not TDD)
- [ ] **Step 2: Run the FULL suite** (`TEST_DATABASE_URL=… DATABASE_URL=… npm test`) + `npm run typecheck`. Expected: green except the 2 known pre-existing seed-slug failures.
- [ ] **Step 3: Commit** — `test(agent): end-to-end stub-mode site build`

---

### Task 14: Ops — secrets, env docs, feature doc

**Files:**
- Modify: `cloudbuild.yaml` (`--set-secrets` list, ~line 118)
- Modify: `.env.example`
- Create: `docs/ai-agent.md`

- [ ] **Step 1: Append to `--set-secrets`**, matching its existing `ENV_NAME=secret-name:latest` format exactly: `ANTHROPIC_API_KEY`, `PIXABAY_API_KEY`, and the currently-missing `PLUGIN_CONFIG_ENC_KEY`. **Remove nothing.** The `--set-secrets` flag REPLACES the whole list per deploy (this is the class of bug that caused the OAuth outage — D-referenced in `project-shared-dns-and-secret-deploy-gotcha`), so this list must be the complete set. Commit body must state: operator must create the three secrets in Secret Manager BEFORE the next deploy or Cloud Build fails (`printf 'sk-…' | gcloud secrets create anthropic-api-key --data-file=-` etc., plus `roles/secretmanager.secretAccessor` for the runtime SA — mirror how existing secrets were set up per `docs/security.md` / BLOCKERS.md if documented).
- [ ] **Step 2: `.env.example`** — add `ANTHROPIC_API_KEY` (comment: unset = AI stub mode), `PIXABAY_API_KEY` (unset = stub image hits), `AI_AGENT_TOKEN_BUDGET=1000000`, `AI_AGENT_MAX_TOOL_CALLS=30`, matching the file's comment style.
- [ ] **Step 3: Write `docs/ai-agent.md`** — link the spec; tool table (name → what it wraps); turn lifecycle (inline vs job vs 45s/15-call promotion; resume semantics = context rebuild ends in tool_results); SSE event types (`assistant_text`, `tool_call`, `tool_result`, `turn_done`, tail's `snapshot`/`message`/`status`); budget + caps knobs; stub-mode behavior; operator runbook (provision secrets, watch `ai_conversations.token_usage`, conversation `error` status + Resume).
- [ ] **Step 4: Full suite + typecheck once more; commit** — `chore(agent): wire secrets (incl. PLUGIN_CONFIG_ENC_KEY fix), env + docs`

---

## Self-Review Notes (performed at write time)

- **Spec coverage:** tables (T1), every spec-listed tool (T4–T7; `list_media`/`get_site_overview`/`get_page`/`list_templates` read set intact), auto-apply + revisions with `seo` column (T5/T6), Sonnet + prompt caching (T8 system block `cache_control`, pinned client), Pixabay + mandatory alt (T2/T7), caps/retry-streak/budget (T8), job path + 45s/15-call promotion with DB-resume semantics (T8–T10), SSE incl. tail (T10), drawer with change cards/revert/usage footer/resume (T11), wizard + `?ai=1` + preview iframe (T12), stub-mode CI build (T8/T13), secrets incl. `PLUGIN_CONFIG_ENC_KEY` (T14). Spec's "text deltas" consciously downgraded to event-granularity (Global Constraints) — `runMessage` is non-streaming by type; protocol reserves room for deltas.
- **Verified against code (second scout pass):** pg-boss v12 `([job])` handler shape + `bootJobs/getBoss`-throws (T3/T9/T10 enqueues are injectable/lazy); media insert columns + `originals/` key scheme + `.save(..., resumable:false)` (T3); no pages repo/no delete endpoint — inline SQL is the codebase norm (T5); `siteSeoDefaultsSchema` exact export name + `evictSiteCache` after site updates (T6); `handleMaterializeTemplate({siteId,templateId},{pool})` direct-call idempotency (T7); router-factory + per-route `requireAdmin()` + in-repo `rateLimit` + error shapes (T10); test conventions — programmatic migrations, `d` gate, per-router apps, jsdom pragma + `global.fetch` (T1 helper, all tasks); `apiFetch.ts`/`adminToken.ts` real paths (T11/T12).
- **Remaining read-first drift checks (marked in-task):** `touch_updated_at` trigger name (T1), `from-template.test.ts` teardown convention (T1), `media_assets` NOT NULLs (T3), hero block prop names (T5/T8), `getTemplate` signature (T7), tenant route's media-hydration call + `ResolvedSite` columns (T10), restore route exact path/response (T11), blank-path site-create response shape (T12).
- **Type consistency:** `AgentChangeEvent` flows tools → loop events → SSE → drawer cards unchanged; `TurnDoneReason` handled at route (`promoted` → enqueue) and job (none); pool-first repo signatures used consistently in loop/job/routes; `AgentTurnInput { conversationId, siteId }` shared by job + route enqueue.
