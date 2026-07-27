import type Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import type { AgentTool, AgentToolCtx, AgentToolResult } from "./types.js";
import { readTools } from "./read.js";
import { pageTools } from "./pages.js";
import { settingsTools } from "./settings.js";
import { assetTools } from "./assets.js";

export const agentTools: AgentTool[] = [...readTools, ...pageTools, ...settingsTools, ...assetTools];

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
