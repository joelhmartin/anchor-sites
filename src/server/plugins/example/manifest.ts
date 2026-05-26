import { z } from "zod";
import type { PluginManifest } from "../manifest.js";
import { exampleBannerBlock } from "./block.js";
import { createExampleRouter } from "./router.js";

/**
 * Reference plugin (P7.5-T7.5.7, D-045). The in-repo proof that the manifest
 * contract is complete + usable end-to-end: it exercises EVERY manifest field
 * — a namespaced block, a router, an owned `plg_example_` table, a config
 * schema with a secret field, and a required env var. It is the integration
 * test target and a working template for real `@anchorcorps/plugin-*` packages.
 *
 * Distribution note: a real plugin ships as a versioned Artifact Registry
 * package whose entry exports a manifest like this; the example lives in-repo
 * and only self-registers at boot behind ENABLE_EXAMPLE_PLUGIN (see builtin.ts)
 * so prod stays clean by default.
 */
export const exampleManifest: PluginManifest = {
  name: "example",
  version: "1.0.0",
  blocks: [{ type: "example/banner", ...exampleBannerBlock }],
  createRouter: createExampleRouter,
  migrations: { tables: ["plg_example_notes"] },
  configSchema: z.object({
    greeting: z.string().default("hi"),
    api_key: z.string().default(""),
  }),
  secretConfigKeys: ["api_key"],
  requiredEnv: ["EXAMPLE_PLUGIN_API_BASE"],
};
