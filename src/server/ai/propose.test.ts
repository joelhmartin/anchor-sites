import { beforeEach, describe, expect, it, vi } from "vitest";
import { blockManifest } from "@anchorcorps/components";
import { __resetRegistryForTests, registerBlock } from "../../blocks/registry.js";
import { richTextBlock } from "../../blocks/rich-text/index.js";
import type { Block } from "../../blocks/types.js";
import { proposeEdit, type ProposeEditInput } from "./propose.js";

beforeEach(() => {
  __resetRegistryForTests();
  for (const entry of blockManifest) {
    const { type, ...rest } = entry;
    registerBlock(type, rest);
  }
  registerBlock("rich-text", richTextBlock);
});

const API = { ANTHROPIC_API_KEY: "sk-ant-real" };
const base = (): Block[] => [{ id: "b1", type: "hero", props: { title: "Hello" } }];

// Build a fake assistant message + an injectable client without importing the SDK.
type Content = Record<string, unknown>;
function msg(content: Content[]) {
  return {
    id: "m1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content,
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}
function toolUse(name: string, input: unknown) {
  return { type: "tool_use", id: `tu_${name}`, name, input };
}
function clientReturning(message: ReturnType<typeof msg>) {
  const create = vi.fn().mockResolvedValue(message);
  const client = { messages: { create } } as unknown as ProposeEditInput["client"];
  return { client, create };
}

describe("proposeEdit — stub/dry-run", () => {
  it("returns a deterministic sample proposal with no key (no spend)", async () => {
    const res = await proposeEdit({ blocks: base(), instruction: "anything", env: {} });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mode).toBe("stub");
    expect(res.diff.added).toHaveLength(1);
    const added = res.proposed_blocks.at(-1)!;
    expect(added.type).toBe("rich-text");
    expect(added.props.html).toContain("[AI stub]");
  });

  it("dry-run behaves the same and never constructs a client", async () => {
    const { client, create } = clientReturning(msg([]));
    const res = await proposeEdit({
      blocks: base(),
      instruction: "x",
      env: { ANTHROPIC_API_KEY: "dry-run" },
      client,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.mode).toBe("dry-run");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("proposeEdit — api (client mocked)", () => {
  it("turns tool_use ops into a validated proposal + diff", async () => {
    const { client } = clientReturning(
      msg([
        { type: "text", text: "Made the headline punchier." },
        toolUse("update_block", { id: "b1", props: { title: "Punchier!" } }),
      ]),
    );
    const res = await proposeEdit({ blocks: base(), instruction: "punchier hero", env: API, client });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mode).toBe("api");
    expect(res.proposed_blocks[0].props.title).toBe("Punchier!");
    expect(res.diff.updated).toEqual([{ id: "b1", type: "hero" }]);
    expect(res.message).toBe("Made the headline punchier.");
  });

  it("sends a cached system+catalog and the four edit tools with a registered-type enum (P6-T6.7)", async () => {
    const { client, create } = clientReturning(msg([toolUse("delete_block", { id: "b1" })]));
    await proposeEdit({ blocks: base(), instruction: "remove the hero", env: API, client });
    const arg = create.mock.calls[0][0] as {
      tools: { name: string; input_schema: Record<string, unknown> }[];
      system: { type: string; text: string; cache_control?: { type: string } }[];
      tool_choice: { type: string };
    };
    expect(arg.tools.map((t) => t.name).sort()).toEqual([
      "delete_block",
      "insert_block",
      "move_block",
      "update_block",
    ]);
    // Prompt caching: system is a content-block array with an ephemeral breakpoint.
    expect(Array.isArray(arg.system)).toBe(true);
    expect(arg.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(arg.system[0].text).toContain("BLOCK CATALOG");
    // Guardrail: insert_block.block.type is constrained to registered types.
    const insert = arg.tools.find((t) => t.name === "insert_block")!;
    const typeEnum = (
      insert.input_schema as { properties: { block: { properties: { type: { enum?: string[] } } } } }
    ).properties.block.properties.type.enum;
    expect(typeEnum).toContain("hero");
    expect(typeEnum).toContain("rich-text");
    expect(typeEnum).not.toContain("wormhole");
    expect(arg.tool_choice).toMatchObject({ type: "auto" });
  });

  it("rejects an unregistered block type at the validate stage (never applied)", async () => {
    const { client } = clientReturning(
      msg([toolUse("insert_block", { block: { type: "wormhole", props: {} }, place: "end" })]),
    );
    const res = await proposeEdit({ blocks: base(), instruction: "add a wormhole", env: API, client });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("validate");
  });

  it("rejects invalid props at the validate stage", async () => {
    const { client } = clientReturning(
      msg([toolUse("insert_block", { block: { type: "hero", props: { align: "diagonal" } } })]),
    );
    const res = await proposeEdit({ blocks: base(), instruction: "add a hero", env: API, client });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("validate");
  });

  it("rejects malformed tool input as bad_tool_input", async () => {
    // insert_block requires `block`; omitting it fails the op schema.
    const { client } = clientReturning(msg([toolUse("insert_block", { place: "end" })]));
    const res = await proposeEdit({ blocks: base(), instruction: "add something", env: API, client });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("bad_tool_input");
  });

  it("treats a text-only response (no tool calls) as a no-op proposal", async () => {
    const { client } = clientReturning(
      msg([{ type: "text", text: "I can't do that with the available blocks." }]),
    );
    const res = await proposeEdit({ blocks: base(), instruction: "do the impossible", env: API, client });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.diff.summary).toBe("No changes");
    expect(res.proposed_blocks).toEqual(base());
    expect(res.message).toContain("can't do that");
  });
});
