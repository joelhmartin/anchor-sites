import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import express from "express";
import request from "supertest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { setupAgentDb } from "../helpers/agent-db.js";
import { adminAiAgentRouter, sseSend } from "../../src/server/routes/admin-ai-agent.js";
import { adminPagesRouter } from "../../src/server/routes/admin-pages.js";
import { appendMessage, setConversationStatus, getConversation } from "../../src/server/ai/agent/repo.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const ADMIN_TOKEN = "test-admin-token";
const auth = (r: request.Test) => r.set("X-Admin-Token", ADMIN_TOKEN);

/**
 * Fix round 1 (reviewer extra #2): grabs just the FIRST SSE frame off a raw
 * socket, then destroys the client request — the tail route's poll/heartbeat
 * timers never end the response on their own, so a normal buffered request
 * would hang forever. supertest has no "read one chunk then abort" mode, so
 * this uses `node:http` directly, per the reviewer's recipe.
 */
async function fetchFirstSseEvent(
  appToServe: express.Express,
  path: string,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const server: Server = appToServe.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      const req = http.get({ host: "127.0.0.1", port, path, headers }, (res) => {
        let buffer = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf8");
          if (buffer.includes("\n\n")) {
            // Swallow the ECONNRESET/aborted-socket noise this destroy causes
            // on the client side — we already have what we came for.
            req.on("error", () => undefined);
            req.destroy();
            resolve(buffer);
          }
        });
        res.on("error", reject);
      });
      req.on("error", (err) => {
        reject(err);
      });
    });
    const frame = raw.split("\n\n")[0];
    const line = frame.startsWith("data:") ? frame.slice("data:".length).trim() : frame.trim();
    return JSON.parse(line);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// Ungated (no DB needed) — pure-function coverage of the fix-round-1
// dead-socket guard, so it runs even where TEST_DATABASE_URL is unset.
describe("sseSend dead-socket guard (fix round 1, reviewer extra #3)", () => {
  it("no-ops instead of writing once the response has already ended", () => {
    const write = vi.fn();
    const fakeRes = { writableEnded: true, write } as unknown as Parameters<typeof sseSend>[0];
    sseSend(fakeRes, { type: "x" });
    expect(write).not.toHaveBeenCalled();
  });

  it("writes normally while the response is still open", () => {
    const write = vi.fn();
    const fakeRes = { writableEnded: false, write } as unknown as Parameters<typeof sseSend>[0];
    sseSend(fakeRes, { type: "x" });
    expect(write).toHaveBeenCalledWith('data: {"type":"x"}\n\n');
  });
});

d("agent HTTP API (integration, Task 10)", () => {
  const db = setupAgentDb();
  let app: express.Express;
  // Fix round 1: a SEPARATE app with no injected `enqueue`, so it exercises
  // the router's real default (`getBoss().send(...)`) — jobs are never
  // booted in this test process, so `getBoss()` throws and the default
  // enqueue's catch path is what's under test.
  let noEnqueueApp: express.Express;
  let enqueueSpy: ReturnType<typeof vi.fn>;
  // Round 2 fix, item 1: injectable so a null `enqueue()` result can be
  // driven down either the "queue is down" (503) or "pg-boss deduped it"
  // (202 deduped:true) path without touching the real pgboss schema.
  // Defaults to `false` — the same outcome the real default implementation
  // has whenever no matching job row exists.
  let hasLiveAgentTurnJobSpy: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    await db.runMigrations();
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;

    enqueueSpy = vi.fn(async () => "job-id-1");
    hasLiveAgentTurnJobSpy = vi.fn(async () => false);

    const a = express();
    a.use(express.json());
    a.use(
      "/api",
      adminAiAgentRouter({
        pool: db.getPool(),
        enqueue: enqueueSpy,
        hasLiveAgentTurnJob: hasLiveAgentTurnJobSpy,
        messageRateLimit: { max: 200, windowMs: 60_000 },
      }),
    );
    a.use("/api", adminPagesRouter({ pool: db.getPool() }));
    app = a;

    const b = express();
    b.use(express.json());
    b.use(
      "/api",
      adminAiAgentRouter({
        pool: db.getPool(),
        messageRateLimit: { max: 200, windowMs: 60_000 },
      }),
    );
    noEnqueueApp = b;
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

  it("run:\"job\" on conversation create enqueues and returns 202 with job_id", async () => {
    const site = await db.seedSite("agent-routes-create-job");
    enqueueSpy.mockClear();
    const res = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({
      message: "build me a site",
      run: "job",
    });
    expect(res.status).toBe(202);
    expect(res.body.queued).toBe(true);
    expect(res.body.job_id).toBe("job-id-1");
    expect(enqueueSpy).toHaveBeenCalledWith({
      conversationId: res.body.conversation.id,
      siteId: site.id,
      continuation: 0,
    });
  });

  it("Task A2 — a message POST enqueues an AGENT_TURN job (payload {conversationId, siteId, continuation: 0}), persists the user message, and returns 202 {queued, job_id, conversation_id} — no agent turn runs in-request", async () => {
    const site = await db.seedSite("agent-routes-msg-job");
    const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({});
    const conversationId = created.body.conversation.id;

    enqueueSpy.mockClear();
    const res = await auth(
      request(app).post(`/api/sites/${site.id}/agent/conversations/${conversationId}/messages`),
    ).send({ message: "keep going" });
    expect(res.status).toBe(202);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body.queued).toBe(true);
    expect(res.body.job_id).toBe("job-id-1");
    expect(res.body.conversation_id).toBe(conversationId);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith({ conversationId, siteId: site.id, continuation: 0 });

    // The user message was persisted by the route itself, before enqueueing.
    const detail = await auth(
      request(app).get(`/api/sites/${site.id}/agent/conversations/${conversationId}`),
    );
    expect(
      detail.body.messages.some(
        (m: { role: string; content: unknown }) =>
          m.role === "user" &&
          JSON.stringify(m.content).includes("keep going"),
      ),
    ).toBe(true);
  });

  it("Fix round 1 (Finding 1 — reviewer) — the 202 response includes user_message_id, the real persisted id of the just-appended user row, so the client can tail from a non-null cursor instead of replacing its whole transcript", async () => {
    const site = await db.seedSite("agent-routes-user-message-id");
    const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({});
    const conversationId = created.body.conversation.id;

    const res = await auth(
      request(app).post(`/api/sites/${site.id}/agent/conversations/${conversationId}/messages`),
    ).send({ message: "keep going" });
    expect(res.status).toBe(202);
    expect(typeof res.body.user_message_id).toBe("string");

    const detail = await auth(
      request(app).get(`/api/sites/${site.id}/agent/conversations/${conversationId}`),
    );
    const userMessage = detail.body.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage).toBeTruthy();
    expect(res.body.user_message_id).toBe(userMessage.id);
  });

  it("Fix round 1 — run:\"job\" with the DEFAULT enqueue (pg-boss unbooted) 503s instead of lying queued:true", async () => {
    const site = await db.seedSite("agent-routes-default-enqueue-conv");
    const res = await auth(
      request(noEnqueueApp).post(`/api/sites/${site.id}/agent/conversations`),
    ).send({ message: "build me a site", run: "job" });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("job queue unavailable");

    // The conversation + seed message are still persisted — a retry works.
    const listed = await auth(request(noEnqueueApp).get(`/api/sites/${site.id}/agent/conversations`));
    expect(listed.body.conversations).toHaveLength(1);
  });

  it("Fix round 1 — run:\"job\" message POST with the DEFAULT enqueue (pg-boss unbooted) 503s", async () => {
    const site = await db.seedSite("agent-routes-default-enqueue-msg");
    const created = await auth(
      request(noEnqueueApp).post(`/api/sites/${site.id}/agent/conversations`),
    ).send({});
    const conversationId = created.body.conversation.id;

    const res = await auth(
      request(noEnqueueApp).post(`/api/sites/${site.id}/agent/conversations/${conversationId}/messages`),
    ).send({ message: "keep going" });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("job queue unavailable");

    // The user message is still persisted despite the queue failure.
    const detail = await auth(
      request(noEnqueueApp).get(`/api/sites/${site.id}/agent/conversations/${conversationId}`),
    );
    expect(detail.body.messages.some((m: { role: string }) => m.role === "user")).toBe(true);
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

  it("Task A2 — a message POST never streams SSE and never runs an agent turn in-request; it's always 202 JSON, job tailed via GET .../events", async () => {
    const site = await db.seedSite("agent-routes-no-inline");
    const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({});
    const conversationId = created.body.conversation.id;

    const res = await auth(
      request(app).post(`/api/sites/${site.id}/agent/conversations/${conversationId}/messages`),
    ).send({ message: "hello agent" });

    expect(res.headers["content-type"]).not.toContain("text/event-stream");
    expect(res.status).toBe(202);
    expect(res.body).toEqual({
      queued: true,
      job_id: "job-id-1",
      conversation_id: conversationId,
      user_message_id: expect.any(String),
    });

    // The route persisted the user message itself; nothing else (no
    // assistant reply) is written in-request — that's the job's job.
    const detail = await auth(
      request(app).get(`/api/sites/${site.id}/agent/conversations/${conversationId}`),
    );
    expect(detail.body.messages.map((m: { role: string }) => m.role)).toEqual(["user"]);
  });

  describe("GET .../events snapshot semantics (fix round 1, reviewer extra #2)", () => {
    it("no cursor: snapshot carries the full (last-50) message backlog", async () => {
      const site = await db.seedSite("agent-routes-events-nocursor");
      const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({});
      const conversationId = created.body.conversation.id;

      const m1 = await appendMessage(db.getPool(), conversationId, "user", [{ type: "text", text: "one" }]);
      const m2 = await appendMessage(db.getPool(), conversationId, "assistant", [{ type: "text", text: "two" }]);
      const m3 = await appendMessage(db.getPool(), conversationId, "user", [{ type: "text", text: "three" }]);

      const event = (await fetchFirstSseEvent(
        app,
        `/api/sites/${site.id}/agent/conversations/${conversationId}/events`,
        { "X-Admin-Token": ADMIN_TOKEN },
      )) as { type: string; conversation: { id: string }; messages: { id: string }[] };

      expect(event.type).toBe("snapshot");
      expect(event.conversation.id).toBe(conversationId);
      expect(event.messages.map((m) => m.id)).toEqual([m1.id, m2.id, m3.id]);
    });

    it("with ?after=<id>: snapshot carries ONLY messages newer than the cursor", async () => {
      const site = await db.seedSite("agent-routes-events-cursor");
      const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({});
      const conversationId = created.body.conversation.id;

      const m1 = await appendMessage(db.getPool(), conversationId, "user", [{ type: "text", text: "one" }]);
      const m2 = await appendMessage(db.getPool(), conversationId, "assistant", [{ type: "text", text: "two" }]);
      const m3 = await appendMessage(db.getPool(), conversationId, "user", [{ type: "text", text: "three" }]);

      const event = (await fetchFirstSseEvent(
        app,
        `/api/sites/${site.id}/agent/conversations/${conversationId}/events?after=${m1.id}`,
        { "X-Admin-Token": ADMIN_TOKEN },
      )) as { type: string; messages: { id: string }[] };

      expect(event.type).toBe("snapshot");
      const ids = event.messages.map((m) => m.id);
      expect(ids).toEqual([m2.id, m3.id]);
      expect(ids).not.toContain(m1.id);
    });

    it("Important 3 — no longer authenticates via ?token=: the drawer's tail always sends X-Admin-Token, so the query-string shim is 401'd here to keep the admin token out of URLs/logs (unlike the preview route, which still needs it for its <iframe>)", async () => {
      const site = await db.seedSite("agent-routes-events-no-query-token");
      const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({});
      const conversationId = created.body.conversation.id;

      const res = await request(app).get(
        `/api/sites/${site.id}/agent/conversations/${conversationId}/events?token=${ADMIN_TOKEN}`,
      );
      expect(res.status).toBe(401);
    });
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
      // Critical 2: the preview response carries its own CSP with a
      // `sandbox` directive (second layer alongside the iframe's `sandbox`
      // attribute in SiteDetailPage.tsx) so embedded/injected scripts can't
      // reach the parent admin origin.
      expect(res.headers["content-security-policy"]).toContain("sandbox allow-scripts");
      // Item 9 (CodeRabbit — preview refresh): the response must never be
      // servable from a cache, stale or otherwise (the client also busts
      // the URL itself with a `v=<nonce>` query param — SiteDetailPage.tsx).
      expect(res.headers["cache-control"]).toBe("no-store");
      // Item 13 (CodeRabbit): keeps the `?token=` URL out of subresource
      // Referer headers until the short-lived-token redesign lands.
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
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

  describe("turn serialization (bot-review fix wave, item 1)", () => {
    it("409s a message POST while the conversation is already 'running'", async () => {
      const site = await db.seedSite("agent-routes-turn-lock-msg");
      const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({});
      const conversationId = created.body.conversation.id;
      await setConversationStatus(db.getPool(), conversationId, "running");

      const res = await auth(
        request(app).post(`/api/sites/${site.id}/agent/conversations/${conversationId}/messages`),
      ).send({ message: "hi" });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("turn already running");

      // No user message was appended — the claim guard runs BEFORE appendMessage.
      const detail = await auth(
        request(app).get(`/api/sites/${site.id}/agent/conversations/${conversationId}`),
      );
      expect(detail.body.messages).toEqual([]);
    });

    it("409s a message POST while the conversation is already 'running', without ever calling enqueue", async () => {
      const site = await db.seedSite("agent-routes-turn-lock-msg-job");
      const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({});
      const conversationId = created.body.conversation.id;
      await setConversationStatus(db.getPool(), conversationId, "running");

      enqueueSpy.mockClear();
      const res = await auth(
        request(app).post(`/api/sites/${site.id}/agent/conversations/${conversationId}/messages`),
      ).send({ message: "hi" });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("turn already running");
      expect(enqueueSpy).not.toHaveBeenCalled();
    });

    it("a stale-running conversation (>10 min, crashed turn) is claimable again instead of 409ing forever", async () => {
      const site = await db.seedSite("agent-routes-turn-lock-stale");
      const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({});
      const conversationId = created.body.conversation.id;
      await setConversationStatus(db.getPool(), conversationId, "running");
      await db.getPool().query(
        `UPDATE ai_conversations SET updated_at = now() - interval '11 minutes' WHERE id = $1`,
        [conversationId],
      );

      const res = await auth(
        request(app).post(`/api/sites/${site.id}/agent/conversations/${conversationId}/messages`),
      ).send({ message: "hello again" });
      expect(res.status).toBe(202);
      expect(res.body.queued).toBe(true);

      const convAfter = await getConversation(db.getPool(), conversationId, site.id);
      expect(convAfter!.status).toBe("active");
    });

    it("a message POST releases the route's claim so the conversation isn't stuck 'running' before the job even starts", async () => {
      const site = await db.seedSite("agent-routes-turn-lock-job-release");
      const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({});
      const conversationId = created.body.conversation.id;

      const res = await auth(
        request(app).post(`/api/sites/${site.id}/agent/conversations/${conversationId}/messages`),
      ).send({ message: "keep going" });
      expect(res.status).toBe(202);

      const convAfter = await getConversation(db.getPool(), conversationId, site.id);
      expect(convAfter!.status).toBe("active");
    });

    // ── Round 2 fixes ──

    it("releases the lock BEFORE calling enqueue, not after (item 2 — closes the silent lost-build window)", async () => {
      const site = await db.seedSite("agent-routes-turn-lock-order");
      const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({});
      const conversationId = created.body.conversation.id;

      // The enqueue mock reads the conversation's OWN status, from inside
      // the call — this is what actually proves the ordering (not just the
      // end state after the whole request completes, which round 1's tests
      // already cover): if the route still held 'running' across the
      // enqueue call (the round-1 shape), this would observe 'running', not
      // 'active'.
      let statusAtEnqueueTime: string | undefined;
      enqueueSpy.mockImplementationOnce(async (input: { conversationId: string; siteId: string }) => {
        const conv = await getConversation(db.getPool(), input.conversationId, input.siteId);
        statusAtEnqueueTime = conv?.status;
        return "job-id-order";
      });

      const res = await auth(
        request(app).post(`/api/sites/${site.id}/agent/conversations/${conversationId}/messages`),
      ).send({ message: "keep going" });
      expect(res.status).toBe(202);
      expect(statusAtEnqueueTime).toBe("active");
    });

    it("conversation-create-with-job also releases BEFORE enqueue (item 2, same fix on the other job path)", async () => {
      const site = await db.seedSite("agent-routes-turn-lock-order-create");

      let statusAtEnqueueTime: string | undefined;
      enqueueSpy.mockImplementationOnce(async (input: { conversationId: string; siteId: string }) => {
        const conv = await getConversation(db.getPool(), input.conversationId, input.siteId);
        statusAtEnqueueTime = conv?.status;
        return "job-id-order-create";
      });

      const res = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({
        message: "build me a site",
        run: "job",
      });
      expect(res.status).toBe(202);
      expect(statusAtEnqueueTime).toBe("active");
    });

    it("a null enqueue result that's actually a pg-boss dedupe reports 202 deduped:true, not 503 (item 1)", async () => {
      const site = await db.seedSite("agent-routes-turn-lock-dedupe");
      const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({});
      const conversationId = created.body.conversation.id;

      enqueueSpy.mockImplementationOnce(async () => null);
      hasLiveAgentTurnJobSpy.mockImplementationOnce(async () => true);

      const res = await auth(
        request(app).post(`/api/sites/${site.id}/agent/conversations/${conversationId}/messages`),
      ).send({ message: "keep going" });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({
        queued: true,
        deduped: true,
        conversation_id: conversationId,
        user_message_id: expect.any(String),
      });
      expect(hasLiveAgentTurnJobSpy).toHaveBeenCalledWith(conversationId);

      // The lock was already released before the (deduped) enqueue attempt —
      // a live job for this conversation is expected to still flip it back
      // to 'active' itself when it finishes, same as any other job turn.
      const convAfter = await getConversation(db.getPool(), conversationId, site.id);
      expect(convAfter!.status).toBe("active");
    });

    it("a null enqueue result that's genuinely a down queue still reports 503 (hasLiveAgentTurnJob returns false)", async () => {
      const site = await db.seedSite("agent-routes-turn-lock-down");
      const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({});
      const conversationId = created.body.conversation.id;

      enqueueSpy.mockImplementationOnce(async () => null);
      hasLiveAgentTurnJobSpy.mockImplementationOnce(async () => false);

      const res = await auth(
        request(app).post(`/api/sites/${site.id}/agent/conversations/${conversationId}/messages`),
      ).send({ message: "keep going" });
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: "job queue unavailable" });
    });

    it("an exception between claim and append releases the lock (to 'error') instead of leaking it for 10 minutes (item 3)", async () => {
      const site = await db.seedSite("agent-routes-turn-lock-exception");
      const created = await auth(request(app).post(`/api/sites/${site.id}/agent/conversations`)).send({});
      const conversationId = created.body.conversation.id;

      // A minimal fake pool: `query()` (used by claim/release/getConversation
      // — everything except appendMessage's transaction) delegates straight
      // to the real pool, so claim genuinely succeeds against the real DB.
      // `connect()` (only used by appendMessage's BEGIN/INSERT/COMMIT
      // transaction) returns a fake client whose INSERT throws — the
      // simplest way to force a genuine failure between claim and append
      // without touching repo.ts internals. BEGIN/ROLLBACK are no-ops since
      // nothing needs to actually commit for this test.
      const realPool = db.getPool();
      const failingPool = {
        query: (...args: unknown[]) => (realPool.query as (...a: unknown[]) => unknown)(...args),
        connect: async () => ({
          query: async (sql: string) => {
            if (sql.startsWith("INSERT INTO ai_messages")) {
              throw new Error("boom (simulated append failure)");
            }
            return { rows: [], rowCount: 0 };
          },
          release: () => undefined,
        }),
      };
      const failingApp = express();
      failingApp.use(express.json());
      failingApp.use(
        "/api",
        adminAiAgentRouter({
          pool: failingPool as unknown as Pool,
          enqueue: enqueueSpy,
          hasLiveAgentTurnJob: hasLiveAgentTurnJobSpy,
          messageRateLimit: { max: 200, windowMs: 60_000 },
        }),
      );

      const res = await auth(
        request(failingApp).post(`/api/sites/${site.id}/agent/conversations/${conversationId}/messages`),
      ).send({ message: "keep going" });
      expect(res.status).toBe(500);

      // The lock was released to 'error', not left stuck at 'running'.
      const convAfter = await getConversation(db.getPool(), conversationId, site.id);
      expect(convAfter!.status).toBe("error");
    });
  });
});
