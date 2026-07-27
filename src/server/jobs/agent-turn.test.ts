import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupAgentDb } from "../../../tests/helpers/agent-db.js";
import { createConversation, getConversation } from "../ai/agent/repo.js";
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
});
