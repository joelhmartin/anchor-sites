// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAdminToken, clearAdminToken, getAdminToken } from "./adminToken.js";
import { streamAgentEvents } from "./agent-api.js";

function sseResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

describe("streamAgentEvents (P-T11 client)", () => {
  const realFetch = global.fetch;

  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("parses SSE frames, skipping heartbeats, and calls onEvent for each", async () => {
    global.fetch = vi.fn(async () =>
      sseResponse('data: {"type":"a"}\n\n: hb\n\ndata: {"type":"b"}\n\n'),
    ) as unknown as typeof fetch;

    const events: unknown[] = [];
    await streamAgentEvents("/api/x", { onEvent: (e) => events.push(e) });
    expect(events).toEqual([{ type: "a" }, { type: "b" }]);
  });

  // Item 7 (CodeRabbit — mirrors apiFetch.ts:47-50): a 401 here previously
  // threw without clearing the stored token, unlike every other admin API
  // call — the Studio drawer's session-expired guard never fired for this
  // one SSE path.
  it("clears the stored admin token on a 401, before throwing (item 7)", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })) as unknown as typeof fetch;

    await expect(streamAgentEvents("/api/x", { onEvent: () => undefined })).rejects.toThrow(
      /agent stream request failed \(401\)/,
    );
    expect(getAdminToken()).toBeNull();
  });

  it("does not clear the token on a non-401 error status", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 500 })) as unknown as typeof fetch;

    await expect(streamAgentEvents("/api/x", { onEvent: () => undefined })).rejects.toThrow(
      /agent stream request failed \(500\)/,
    );
    expect(getAdminToken()).toBe("tok");
  });
});
