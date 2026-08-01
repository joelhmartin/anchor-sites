import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAgentDb } from "../../../tests/helpers/agent-db.js";
import { sweepPageRevisions, sweepAiMessages } from "./retention.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();

d("retention sweeps (D506 / D518)", () => {
  let siteId: string;

  beforeAll(async () => {
    await db.runMigrations();
    siteId = (await db.seedSite("retention")).id;
  });
  afterAll(() => db.teardown());

  it("D506: keeps newest 50 revisions per page + anything <90d, drops the rest", async () => {
    const pool = db.getPool();
    const page = await db.seedPage(siteId, "rev-page");

    // 60 OLD revisions (120 days ago) + 5 recent ones.
    for (let i = 0; i < 60; i++) {
      await pool.query(
        `INSERT INTO page_revisions (page_id, blocks, seo, source, created_at)
         VALUES ($1, '[]'::jsonb, '{}'::jsonb, 'manual', now() - interval '120 days' + make_interval(secs => $2))`,
        [page.id, i],
      );
    }
    for (let i = 0; i < 5; i++) {
      await pool.query(
        `INSERT INTO page_revisions (page_id, blocks, seo, source, created_at)
         VALUES ($1, '[]'::jsonb, '{}'::jsonb, 'manual', now() - make_interval(secs => $2))`,
        [page.id, i],
      );
    }

    const res = await sweepPageRevisions(pool);
    expect(res.deleted).toBeGreaterThan(0);

    // Exactly 50 remain: the 5 recent + the newest 45 of the old ones (rank <= 50).
    const remaining = await pool.query<{ count: string }>(
      `SELECT count(*) FROM page_revisions WHERE page_id = $1`,
      [page.id],
    );
    expect(Number(remaining.rows[0].count)).toBe(50);
  });

  it("D506: a page with fewer than 50 revisions is never touched, however old", async () => {
    const pool = db.getPool();
    const page = await db.seedPage(siteId, "rev-small");
    for (let i = 0; i < 10; i++) {
      await pool.query(
        `INSERT INTO page_revisions (page_id, blocks, seo, source, created_at)
         VALUES ($1, '[]'::jsonb, '{}'::jsonb, 'manual', now() - interval '500 days' + make_interval(secs => $2))`,
        [page.id, i],
      );
    }
    await sweepPageRevisions(pool);
    const remaining = await pool.query<{ count: string }>(
      `SELECT count(*) FROM page_revisions WHERE page_id = $1`,
      [page.id],
    );
    expect(Number(remaining.rows[0].count)).toBe(10);
  });

  it("D518: purges messages of long-archived conversations, keeps active + recently-archived ones", async () => {
    const pool = db.getPool();
    const mk = async (status: string, updatedDaysAgo: number) => {
      const c = await pool.query<{ id: string }>(
        `INSERT INTO ai_conversations (site_id, title, status, updated_at)
         VALUES ($1, 't', $2, now() - make_interval(days => $3::int)) RETURNING id`,
        [siteId, status, updatedDaysAgo],
      );
      await pool.query(
        `INSERT INTO ai_messages (conversation_id, role, content) VALUES ($1, 'user', '[]'::jsonb)`,
        [c.rows[0].id],
      );
      return c.rows[0].id;
    };
    // NOTE: the one-per-site partial unique index forbids two non-archived
    // conversations, so the "active" control is created archived-then-flipped.
    const oldArchived = await mk("archived", 100);
    const recentArchived = await mk("archived", 10);
    const active = await mk("archived", 100);
    await pool.query(`UPDATE ai_conversations SET status = 'active' WHERE id = $1`, [active]);

    const res = await sweepAiMessages(pool);
    expect(res.deleted).toBeGreaterThanOrEqual(1);

    const count = async (id: string) =>
      Number(
        (await pool.query<{ count: string }>(`SELECT count(*) FROM ai_messages WHERE conversation_id = $1`, [id]))
          .rows[0].count,
      );
    expect(await count(oldArchived)).toBe(0); // purged
    expect(await count(recentArchived)).toBe(1); // within window
    expect(await count(active)).toBe(1); // not archived

    // The conversation ROW survives (only content is purged).
    expect((await pool.query(`SELECT 1 FROM ai_conversations WHERE id = $1`, [oldArchived])).rowCount).toBe(1);
  });
});
