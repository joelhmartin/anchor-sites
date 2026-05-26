import type { Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import type { BlockRegistryEntry } from "../../blocks/types.js";

/**
 * Plugin manifest contract (P7.5-T7.5.2, D-016 / D-045).
 *
 * A plugin is a self-describing unit of integration. Its manifest declares
 * everything the renderer composes at boot: blocks, an Express router, the
 * tables it owns, a per-site config schema, and required env. A manifest holds
 * live values (React components, a router factory, a Zod schema) so it is NOT
 * fully serializable — `validatePluginManifest` validates the serializable
 * metadata via Zod (`pluginMetaSchema`) plus structural/cross-field rules.
 *
 * Distribution: a real plugin ships as a versioned `@anchorcorps/plugin-<name>`
 * package on Artifact Registry (same channel as `@anchorcorps/components`,
 * D-005/D-026) whose entry exports a `PluginManifest`. v1 composes
 * explicitly-`registerPlugin()`-ed manifests; dynamic package discovery is
 * deferred to the first real plugin (D-045).
 */

/** A block contributed by a plugin — same shape as a core block entry, but its
 * `type` MUST be namespaced `<plugin-name>/<block>` to avoid collisions. */
export type PluginBlock = { type: string } & BlockRegistryEntry;

/** Injected into a plugin's router factory at mount time. */
export type PluginRouterContext = {
  pool: Pool;
  /** The plugin's own name (so the router can scope queries / read config). */
  pluginName: string;
};

export type PluginManifest = {
  /** kebab-case, globally unique. Also the `/api/plugins/<name>` mount + block namespace. */
  name: string;
  /** semver. The version recorded in `site_plugins.version` on install. */
  version: string;
  /** Blocks registered into the global block registry at boot (namespaced types). */
  blocks?: PluginBlock[];
  /** Factory for the plugin's Express router, mounted once at `/api/plugins/<name>`.
   * Per-site enablement is enforced inside (via `req.site.plugins`), not here. */
  createRouter?: (ctx: PluginRouterContext) => Router;
  /** The tables this plugin owns. Every name MUST start with `plg_<name>_`.
   * The loader verifies these exist before mounting (fail-soft otherwise). */
  migrations?: { tables: string[] };
  /** Zod schema for per-site config. Validated before persisting. */
  configSchema?: z.ZodTypeAny;
  /** Keys within `configSchema` whose values are secret and stored encrypted. */
  secretConfigKeys?: string[];
  /** Env vars the plugin needs present to function (checked + logged at boot). */
  requiredEnv?: string[];
};

const NAME_RE = /^[a-z][a-z0-9-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const ENV_RE = /^[A-Z][A-Z0-9_]*$/;

/** Postgres table prefix a plugin's tables must use (hyphens → underscores). */
export function pluginTablePrefix(name: string): string {
  return `plg_${name.replace(/-/g, "_")}_`;
}

/** Block namespace prefix — `<name>/`. */
export function pluginBlockPrefix(name: string): string {
  return `${name}/`;
}

/** Zod schema for the serializable manifest metadata. */
export const pluginMetaSchema = z.object({
  name: z.string().regex(NAME_RE, "name must be kebab-case"),
  version: z.string().regex(SEMVER_RE, "version must be semver"),
  migrations: z.object({ tables: z.array(z.string()).default([]) }).optional(),
  secretConfigKeys: z.array(z.string()).optional(),
  requiredEnv: z.array(z.string().regex(ENV_RE, "env vars must be UPPER_SNAKE")).optional(),
});

/**
 * Validate a manifest. Returns a list of human-readable errors (empty = valid).
 * Covers the Zod metadata plus structural rules Zod can't express:
 * block-type namespacing, table-prefix ownership, and secret-key membership.
 */
export function validatePluginManifest(manifest: PluginManifest): string[] {
  const errors: string[] = [];

  const meta = pluginMetaSchema.safeParse(manifest);
  if (!meta.success) {
    for (const issue of meta.error.issues) {
      errors.push(`${issue.path.join(".") || "manifest"}: ${issue.message}`);
    }
    // Without a valid name the structural checks below are meaningless.
    if (!NAME_RE.test(manifest.name ?? "")) return errors;
  }

  const blockPrefix = pluginBlockPrefix(manifest.name);
  for (const block of manifest.blocks ?? []) {
    if (!block.type.startsWith(blockPrefix)) {
      errors.push(`block "${block.type}" must be namespaced "${blockPrefix}<block>"`);
    }
  }

  const tablePrefix = pluginTablePrefix(manifest.name);
  for (const table of manifest.migrations?.tables ?? []) {
    if (!table.startsWith(tablePrefix)) {
      errors.push(`table "${table}" must start with "${tablePrefix}"`);
    }
  }

  if (manifest.createRouter !== undefined && typeof manifest.createRouter !== "function") {
    errors.push("createRouter must be a function");
  }

  // secretConfigKeys must be real keys of a ZodObject configSchema.
  if (manifest.secretConfigKeys?.length) {
    if (manifest.configSchema instanceof z.ZodObject) {
      const shapeKeys = Object.keys(manifest.configSchema.shape);
      for (const key of manifest.secretConfigKeys) {
        if (!shapeKeys.includes(key)) {
          errors.push(`secretConfigKey "${key}" is not a field of configSchema`);
        }
      }
    } else {
      errors.push("secretConfigKeys requires configSchema to be a Zod object");
    }
  }

  return errors;
}
