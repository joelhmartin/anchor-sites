import type { Pool } from "pg";
import type { z } from "zod";

export type AgentChangeEvent = {
  kind: "page_created" | "page_updated" | "page_deleted" | "site_updated"
      | "template_applied" | "image_imported";
  page_id?: string;
  revision_id?: string;
  summary: string;
};

export type AgentToolCtx = {
  pool: Pool;
  siteId: string;
  conversationId: string;
  env: NodeJS.ProcessEnv;
  genId?: () => string; // deterministic block ids in tests
};

export type AgentToolResult =
  | { ok: true; data: unknown; summary?: string; change?: AgentChangeEvent }
  | { ok: false; error: string; details?: unknown };

export type AgentTool<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  paramsSchema: S;
  execute: (ctx: AgentToolCtx, input: z.infer<S>) => Promise<AgentToolResult>;
};
