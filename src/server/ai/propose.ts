import type Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import type { Block } from "../../blocks/types.js";
// Side-effect: ensure blocks are registered (needed in every mode, incl. the
// stub path, since applyAndValidate validates against the registry).
import "../../blocks/index.js";
import { runMessage } from "./client.js";
import { resolveAiMode, type AiMode } from "./config.js";
import { buildBlockCatalog } from "./catalog.js";
import { diffBlocks, type BlockDiff } from "./diff.js";
import {
  applyAndValidate,
  deleteParamsSchema,
  editOpSchema,
  insertParamsSchema,
  moveParamsSchema,
  updateParamsSchema,
  type EditOp,
} from "./edit-ops.js";

/**
 * AI-edit orchestration (P6-T6.4). Loads nothing and saves nothing — given the
 * page's current `Block[]` + an instruction, it returns a *preview*: a
 * schema-validated proposed `Block[]` plus a human diff. Apply is a separate
 * operator action (6.5). In stub/dry-run it returns a deterministic sample
 * proposal so dev + tests never spend.
 */

const SYSTEM_INTRO = `You edit a web page for the AnchorCorps site builder. The page is an ordered array of "blocks", each { id, type, props }. You are given the current blocks and a catalog of the ONLY block types you may use, each with a JSON Schema its props must satisfy.

Express the user's requested change as a minimal sequence of edit-operation tool calls:
- insert_block — add a new block (place: "start" | "end" | "after"; for "after" give after_id).
- update_block — change an existing block's props (shallow-merged; send only the props that change).
- delete_block — remove a block by id.
- move_block — reposition an existing block.

Rules:
- Use ONLY block types present in the catalog. Never invent a type.
- Every block's props MUST satisfy that type's JSON Schema; a proposal with an unknown type or invalid props is rejected wholesale.
- Reference existing blocks by their exact "id" from the current page.
- Make the smallest change that satisfies the instruction; leave unrelated blocks untouched.
- If the instruction is unclear or impossible with the available blocks, make no tool calls and briefly say why.`;

const STUB_HTML = "<p>[AI stub] Set ANTHROPIC_API_KEY to enable live AI edits.</p>";
const STUB_MESSAGE =
  "Stub mode (no ANTHROPIC_API_KEY): returning a fixed sample proposal. Configure the key for real edits.";

/** Strip the non-essential `$schema` key; Anthropic tool input_schema is plain JSON Schema. */
function toToolSchema(schema: z.ZodTypeAny): Anthropic.Tool.InputSchema {
  const js = zodToJsonSchema(schema, { $refStrategy: "none" }) as Record<string, unknown>;
  delete js.$schema;
  return js as Anthropic.Tool.InputSchema;
}

/**
 * The four edit tools. Built per call so `insert_block.block.type` can be
 * constrained to the currently-registered block types — a guardrail (P6-T6.7)
 * that steers the model to valid types. Server-side re-validation in
 * `applyAndValidate` (D-039) is still the hard gate. Output is deterministic
 * for a given registry, so the tool list stays byte-stable across requests
 * (prompt-cache friendly — tools render before the cached system block).
 */
function buildEditTools(): Anthropic.Tool[] {
  const registeredTypes = buildBlockCatalog().map((b) => b.type);
  const insertSchema = toToolSchema(insertParamsSchema) as Anthropic.Tool.InputSchema & {
    properties?: { block?: { properties?: { type?: Record<string, unknown> } } };
  };
  const typeProp = insertSchema.properties?.block?.properties?.type;
  if (typeProp) {
    insertSchema.properties!.block!.properties!.type = { ...typeProp, enum: registeredTypes };
  }
  return [
    {
      name: "insert_block",
      description: "Insert a new block of a catalog type at start, end, or after an existing block id.",
      input_schema: insertSchema,
    },
    {
      name: "update_block",
      description: "Shallow-merge new props into an existing block (by id). Send only the props that change.",
      input_schema: toToolSchema(updateParamsSchema),
    },
    {
      name: "delete_block",
      description: "Delete the block with the given id.",
      input_schema: toToolSchema(deleteParamsSchema),
    },
    {
      name: "move_block",
      description: "Move an existing block (by id) to start, end, or after another block id.",
      input_schema: toToolSchema(moveParamsSchema),
    },
  ];
}

function buildSystemPrompt(): string {
  return `${SYSTEM_INTRO}\n\n--- BLOCK CATALOG ---\n${JSON.stringify(buildBlockCatalog())}`;
}

function buildUserPrompt(blocks: Block[], instruction: string): string {
  return `Current page blocks:\n${JSON.stringify(blocks)}\n\nInstruction: ${instruction}`;
}

type ParseOpsResult =
  | { ok: true; ops: EditOp[]; text: string }
  | { ok: false; failures: { tool: string; errors: { path: string; message: string }[] }[] };

/** Turn the model's tool_use blocks into EditOps (the tool name supplies `op`). */
function parseOpsFromMessage(message: Anthropic.Message): ParseOpsResult {
  const ops: EditOp[] = [];
  const texts: string[] = [];
  const failures: { tool: string; errors: { path: string; message: string }[] }[] = [];

  for (const block of message.content) {
    if (block.type === "text") {
      texts.push(block.text);
    } else if (block.type === "tool_use") {
      const candidate = { op: block.name, ...(block.input as Record<string, unknown>) };
      const parsed = editOpSchema.safeParse(candidate);
      if (!parsed.success) {
        failures.push({
          tool: block.name,
          errors: parsed.error.errors.map((e) => ({
            path: e.path.join(".") || "(root)",
            message: e.message,
          })),
        });
        continue;
      }
      ops.push(parsed.data);
    }
  }

  if (failures.length) return { ok: false, failures };
  return { ok: true, ops, text: texts.join("\n").trim() };
}

export type ProposeEditInput = {
  blocks: Block[];
  instruction: string;
  /** Inject a mocked SDK client (tests). */
  client?: Anthropic;
  /** Override env for mode resolution (tests). */
  env?: NodeJS.ProcessEnv;
  /** Deterministic id generator (tests). */
  genId?: () => string;
  maxTokens?: number;
};

export type ProposeEditResult =
  | {
      ok: true;
      mode: AiMode;
      proposed_blocks: Block[];
      ops: EditOp[];
      diff: BlockDiff;
      message: string;
    }
  | {
      ok: false;
      mode: AiMode;
      reason: "bad_tool_input" | "apply" | "validate";
      message: string;
      failures: unknown[];
    };

export async function proposeEdit(input: ProposeEditInput): Promise<ProposeEditResult> {
  const { blocks, instruction } = input;
  const mode = resolveAiMode(input.env);

  let ops: EditOp[];
  let message: string;

  if (mode !== "api") {
    // Deterministic sample proposal — exercises the full apply+validate+diff
    // pipeline without a model call (no spend).
    ops = [
      editOpSchema.parse({
        op: "insert_block",
        block: { type: "rich-text", props: { html: STUB_HTML } },
        place: "end",
      }),
    ];
    message = STUB_MESSAGE;
  } else {
    const res = await runMessage(
      {
        // Cache the stable prefix (tools render before system, so one breakpoint
        // on the system block caches tools + system + catalog). The volatile
        // page blocks + instruction live in `messages`, after the breakpoint.
        system: [
          { type: "text", text: buildSystemPrompt(), cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: buildUserPrompt(blocks, instruction) }],
        tools: buildEditTools(),
        tool_choice: { type: "auto" },
        ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
      },
      { client: input.client, env: input.env },
    );
    const parsed = parseOpsFromMessage(res.message);
    if (!parsed.ok) {
      return {
        ok: false,
        mode,
        reason: "bad_tool_input",
        message: "The model returned tool input that does not match the edit-op contract.",
        failures: parsed.failures,
      };
    }
    ops = parsed.ops;
    message =
      parsed.text ||
      (ops.length === 0 ? "No changes proposed." : `${ops.length} edit(s) proposed.`);
  }

  const result = applyAndValidate(blocks, ops, { genId: input.genId });
  if (!result.ok) {
    return {
      ok: false,
      mode,
      reason: result.stage,
      message: `Proposal rejected at the ${result.stage} stage and was not applied.`,
      failures: result.failures,
    };
  }

  return {
    ok: true,
    mode,
    proposed_blocks: result.blocks,
    ops,
    diff: diffBlocks(blocks, result.blocks),
    message,
  };
}
