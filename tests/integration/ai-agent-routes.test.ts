import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { setupAgentDb } from "../helpers/agent-db.js";
import { adminAiAgentRouter } from "../../src/server/routes/admin-ai-agent.js";
import { adminPagesRouter } from "../../src/server/routes/admin-pages.js";
import type { AgentTurnEvent } from "../../src/server/ai/agent/loop.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const ADMIN_TOKEN = "test-admin-token";
const auth = (r: request.Test) => r.set("X-Admin-Token", ADMIN_TOKEN);

// Reads a text/event-stream response body fully (supertest's default JSON
// parser chokes on `data: {...}\n\n` framing) — pattern from the task brief.
const sseParser = (res: request.Response, cb: (err: Error | null, body: string) => void) => {
  let data = "";
  res.on("data", (c: Buffer) => (data += c.toString("utf8")));
  res.on("end", () => cb(null, data));
};

d("agent HTTP API (integration, Task 10)", () => {
  const db = setupAgentDb();
  let app: express.Express;
  let enqueueSpy: ReturnType<typeof vi.fn>;
  let runTurnSpy: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    await db.runMigrations();
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;

    enqueueSpy = vi.fn(async () => "job-id-1");
    runTurnSpy = vi.fn(async (input: { onEvent?: (e: AgentTurnEvent) => void }) => {
      input.onEvent?.({ type: "assistant_text", text: "hello from the stub turn" });
      input.onEvent?.({ type: "turn_done", reason: "end_turn" });
      return { reason: "end_turn" as const, toolCalls: 0 };
    });

    const a = express();
    a.use(express.json());
    a.use(
      "/api",
      adminAiAgentRouter({
        pool: db.getPool(),
        runTurn: runTurnSpy,
        enqueue: enqueueSpy,
        messageRateLimit: { max: 200, windowMs: 60_000 },
      }),
    );
    a.use("/api", adminPagesRouter({ pool: db.getPool() }));
    app = a;
  }, 60_000);

  afterAll(async () => {
    await db.teardown();
    delete process.env.ADMIN_API_TOKEN;
  });

  it("401s without an admin token", async () => {
    const site = await db.seedSite("agent-routes-401");
    const res = await request(app).get(`/api/sites/${site.id}/agent/conversations`);
    expect(res.status).toBe(401);
  });

  it("creates, lists, and fetches a conversation (round trip)", async () => {
    const site = await db.seedSite("agent-routes-crud");

    const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({
      title: "My chat",
    });
    expect(created.status).toBe(201);
    expect(created.body.conversation.title).toBe("My chat");
    expect(created.body.conversation.site_id).toBe(site.id);
    const conversationId = created.body.conversation.id;

    const listed = await auth(request(app).get(`/api/sites/${site.id}/agent/conversations`));
    expect(listed.status).toBe(200);
    expect(listed.body.conversations.map((c: { id: string }) => c.id)).toContain(conversationId);

    const detail = await auth(
      request(app).get(`/api/sites/${site.id}/agent/conversations/${conversationId}`),
    );
    expect(detail.status).toBe(200);
    expect(detail.body.conversation.id).toBe(conversationId);
    expect(detail.body.messages).toEqual([]);
  });

  it("derives the title from the first 60 chars of the message when no title is given", async () => {
    const site = await db.seedSite("agent-routes-title");
    const longMessage = "x".repeat(100);
    const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({
      message: longMessage,
    });
    expect(created.status).toBe(201);
    expect(created.body.conversation.title).toBe(longMessage.slice(0, 60));

    const detail = await auth(
      request(app).get(`/api/sites/${site.id}/agent/conversations/${created.body.conversation.id}`),
    );
    expect(detail.body.messages).toHaveLength(1);
    expect(detail.body.messages[0].role).toBe("user");
  });

  it("404s for a conversation fetched under the wrong siteId (cross-tenant guard)", async () => {
    const siteA = await db.seedSite("agent-routes-tenant-a");
    const siteB = await db.seedSite("agent-routes-tenant-b");
    const created = await auth(request(app).post(`/api/sites/${siteA.id}/agent/conversations`)).send({});
    const conversationId = created.body.conversation.id;

    const res = await auth(
      request(app).get(`/api/sites/${siteB.id}/agent/conversations/${conversationId}`),
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("conversation not found");
  });

  it("404s creating a conversation for a nonexistent site", async () => {
    const res = await auth(
      request(app).post(`/api/sites/00000000-0000-0000-0000-000000000000/agent/conversations`),
    ).send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("site not found");
  });

  it("400s on an invalid create payload", async () => {
    const site = await db.seedSite("agent-routes-badpayload");
    const res = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({
      run: "not-a-real-mode",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid payload");
    expect(res.body.details[0]).toHaveProperty("path");
    expect(res.body.details[0]).toHaveProperty("message");
  });

  it("run:\"job\" on conversation create enqueues and returns 202", async () => {
    const site = await db.seedSite("agent-routes-create-job");
    enqueueSpy.mockClear();
    const res = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({
      message: "build me a site",
      run: "job",
    });
    expect(res.status).toBe(202);
    expect(res.body.queued).toBe(true);
    expect(enqueueSpy).toHaveBeenCalledWith({
      conversationId: res.body.conversation.id,
      siteId: site.id,
    });
  });

  it("run:\"job\" on a message POST enqueues and returns 202", async () => {
    const site = await db.seedSite("agent-routes-msg-job");
    const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({});
    const conversationId = created.body.conversation.id;

    enqueueSpy.mockClear();
    const res = await auth(
      request(app).post(`/api/sites/${site.id}/agent/conversations/${conversationId}/messages`),
    ).send({ message: "keep going", run: "job" });
    expect(res.status).toBe(202);
    expect(res.body.queued).toBe(true);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith({ conversationId, siteId: site.id });
  });

  it("404s a message POST for a conversation under the wrong site", async () => {
    const siteA = await db.seedSite("agent-routes-msg-tenant-a");
    const siteB = await db.seedSite("agent-routes-msg-tenant-b");
    const created = await auth(request(app).post(`/api/sites/${siteA.id}/agent/conversations`)).send({});
    const conversationId = created.body.conversation.id;

    const res = await auth(
      request(app).post(`/api/sites/${siteB.id}/agent/conversations/${conversationId}/messages`),
    ).send({ message: "hi" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("conversation not found");
  });

  it("inline message POST streams SSE with the injected turn's events, ending in turn_done", async () => {
    const site = await db.seedSite("agent-routes-inline");
    const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({});
    const conversationId = created.body.conversation.id;

    const res = await auth(
      request(app)
        .post(`/api/sites/${site.id}/agent/conversations/${conversationId}/messages`)
        .buffer(true)
        .parse(sseParser),
    ).send({ message: "hello agent" });

    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["cache-control"]).toContain("no-transform");
    expect(res.body).toContain("hello from the stub turn");
    expect(res.body).toContain("turn_done");
    expect(res.body).toContain("end_turn");

    // The user message + the (stub-emitted) assistant text should both be
    // persisted — onEvent alone doesn't persist; that's the loop's job in
    // real usage, but the ROUTE itself must have appended the user message.
    const detail = await auth(
      request(app).get(`/api/sites/${site.id}/agent/conversations/${conversationId}`),
    );
    expect(detail.body.messages.some((m: { role: string }) => m.role === "user")).toBe(true);
  });

  it("a promoted turn enqueues the continuation job exactly once and reports promoted", async () => {
    const site = await db.seedSite("agent-routes-promoted");
    const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({});
    const conversationId = created.body.conversation.id;

    runTurnSpy.mockImplementationOnce(async (input: { onEvent?: (e: AgentTurnEvent) => void }) => {
      input.onEvent?.({ type: "turn_done", reason: "promoted" });
      return { reason: "promoted" as const, toolCalls: 15 };
    });
    enqueueSpy.mockClear();

    const res = await auth(
      request(app)
        .post(`/api/sites/${site.id}/agent/conversations/${conversationId}/messages`)
        .buffer(true)
        .parse(sseParser),
    ).send({ message: "do a big build" });

    expect(res.body).toContain("promoted");
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith({ conversationId, siteId: site.id });
  });

  it("catches a throwing turn and streams a turn_done error frame instead of crashing", async () => {
    const site = await db.seedSite("agent-routes-turn-throws");
    const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({});
    const conversationId = created.body.conversation.id;

    runTurnSpy.mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const res = await auth(
      request(app)
        .post(`/api/sites/${site.id}/agent/conversations/${conversationId}/messages`)
        .buffer(true)
        .parse(sseParser),
    ).send({ message: "this will throw" });

    expect(res.body).toContain("turn_done");
    expect(res.body).toContain("\"reason\":\"error\"");
  });

  describe("draft preview (admin-pages.ts)", () => {
    it("renders a draft page's current blocks as HTML", async () => {
      const site = await db.seedSite("agent-routes-preview");
      const page = await db.seedPage(site.id, "home", [
        { id: "b1", type: "rich-text", props: { html: "<p>Preview Marker 12345</p>" } },
      ]);

      const res = await auth(request(app).get(`/api/sites/${site.id}/pages/${page.id}/preview`));
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.text).toContain("Preview Marker 12345");
    });

    it("404s when the page belongs to a different site", async () => {
      const siteA = await db.seedSite("agent-routes-preview-tenant-a");
      const siteB = await db.seedSite("agent-routes-preview-tenant-b");
      const page = await db.seedPage(siteA.id, "home", []);

      const res = await auth(request(app).get(`/api/sites/${siteB.id}/pages/${page.id}/preview`));
      expect(res.status).toBe(404);
    });

    it("authenticates via ?token= with no header (tokenFromQuery shim)", async () => {
      const site = await db.seedSite("agent-routes-preview-token");
      const page = await db.seedPage(site.id, "home", [
        { id: "b1", type: "rich-text", props: { html: "<p>Token Marker</p>" } },
      ]);

      const res = await request(app).get(
        `/api/sites/${site.id}/pages/${page.id}/preview?token=${ADMIN_TOKEN}`,
      );
      expect(res.status).toBe(200);
      expect(res.text).toContain("Token Marker");
    });
  });
});
