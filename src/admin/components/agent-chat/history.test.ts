// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { AiMessage } from "../../lib/agent-api.js";
import { deriveItemsFromMessage, deriveItemsFromMessages } from "./history.js";

/**
 * W1.4 / D601+D303 — persisted role-'system' rows (stall reconciler notes,
 * Stop confirmations, continuation-failure notes) must reconstruct as
 * `kind:"system"` DisplayItems so they render as the transcript's amber
 * SystemLine after a reload, exactly like the client's own local system
 * items.
 */

function msg(id: string, role: AiMessage["role"], content: unknown): AiMessage {
  return { id, conversation_id: "c1", role, content, created_at: "2026-07-30T00:00:00.000Z" };
}

describe("history — role-'system' rows (W1.4)", () => {
  it("derives a kind:'system' item from a persisted system row", () => {
    const items = deriveItemsFromMessage(
      msg("m1", "system", [{ type: "text", text: "Build was interrupted — press Resume to continue." }]),
    );
    expect(items).toEqual([
      { id: "m1-0", kind: "system", text: "Build was interrupted — press Resume to continue." },
    ]);
  });

  it("hydrates system rows in order alongside user/assistant rows", () => {
    const items = deriveItemsFromMessages([
      msg("m1", "user", [{ type: "text", text: "build it" }]),
      msg("m2", "system", [{ type: "text", text: "The build never started — the job queue may be down. Press Resume to try again." }]),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["user", "system"]);
  });

  it("ignores non-text blocks inside a system row rather than crashing", () => {
    expect(deriveItemsFromMessage(msg("m1", "system", [{ type: "weird" }]))).toEqual([]);
    expect(deriveItemsFromMessage(msg("m1", "system", "not-an-array"))).toEqual([]);
  });
});
