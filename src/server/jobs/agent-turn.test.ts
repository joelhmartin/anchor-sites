import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupAgentDb } from "../../../tests/helpers/agent-db.js";
import { createConversation, getConversation, setConversationStatus } from "../ai/agent/repo.js";
import { handleAgentTurn } from "./agent-turn.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();
const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

d("handleAgentTurn (P-T9 / ai.agent-turn)", () => {
  beforeAll(() => db.runMigrations());
  afterAll(() => db.teardown());

  it("relies on stub mode when ANTHROPIC_API_KEY is absent under vitest", () => {
    // Documents the assumption the happy-path test below depends on: no live
    // Anthropic call happens because the test env has no key configured.
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("happy path: runs a real stub turn against a seeded empty site and creates the starter page", async () => {
    const site = await db.seedSite(`agent-turn-happy-${runId}`);
    const conv = await createConversation(db.getPool(), site.id, "t");

    await handleAgentTurn(
      { conversationId: conv.id, siteId: site.id },
      { pool: db.getPool() },
    );

    const pages = await db.getPool().query(
      `SELECT slug FROM pages WHERE site_id = $1`, [site.id],
    );
    expect(pages.rows.map((r) => r.slug)).toEqual(["home"]);

    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("active");
  });

  it("on runTurn failure: marks the conversation errored and rethrows", async () => {
    const site = await db.seedSite(`agent-turn-error-${runId}`);
    const conv = await createConversation(db.getPool(), site.id, "t");

    const runTurn = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(
      handleAgentTurn(
        { conversationId: conv.id, siteId: site.id },
        { pool: db.getPool(), runTurn },
      ),
    ).rejects.toThrow("boom");

    expect(runTurn).toHaveBeenCalledWith({
      pool: db.getPool(), conversationId: conv.id, siteId: site.id,
    });

    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("error");
  });

  // ── Bot-review fix wave, items 1+2 (turn serialization / job dedup) ──

  it("job re-delivery: a conversation already 'running' (fresh) is claimed by nobody — no-op, runTurn never called", async () => {
    const site = await db.seedSite(`agent-turn-redelivery-${runId}`);
    const conv = await createConversation(db.getPool(), site.id, "t");
    await setConversationStatus(db.getPool(), conv.id, "running");

    const runTurn = vi.fn();
    await handleAgentTurn({ conversationId: conv.id, siteId: site.id }, { pool: db.getPool(), runTurn });

    expect(runTurn).not.toHaveBeenCalled();
    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    // Still 'running' — this delivery didn't own the lock, so it must not
    // touch status at all (neither release nor error it).
    expect(convAfter!.status).toBe("running");
  });

  it("stale takeover: a 'running' conversation whose updated_at is >10 minutes old is claimable and runs normally", async () => {
    const site = await db.seedSite(`agent-turn-stale-${runId}`);
    const conv = await createConversation(db.getPool(), site.id, "t");
    await setConversationStatus(db.getPool(), conv.id, "running");
    await db.getPool().query(
      `UPDATE ai_conversations SET updated_at = now() - interval '11 minutes' WHERE id = $1`,
      [conv.id],
    );

    await handleAgentTurn({ conversationId: conv.id, siteId: site.id }, { pool: db.getPool() });

    const pages = await db.getPool().query(`SELECT slug FROM pages WHERE site_id = $1`, [site.id]);
    expect(pages.rows.map((r) => r.slug)).toEqual(["home"]);
    const convAfter = await getConversation(db.getPool(), conv.id, site.id);
    expect(convAfter!.status).toBe("active");
  });
});
