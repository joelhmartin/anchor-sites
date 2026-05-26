import { validatePluginManifest, type PluginManifest } from "./manifest.js";

/**
 * Runtime plugin registry (P7.5-T7.5.2, D-016 / D-045).
 *
 * Mirrors the block registry (`src/blocks/registry.ts`): plugins call
 * `registerPlugin(manifest)` at module load; the loader (T7.5.4) composes the
 * registered set against `site_plugins`. Global Map, uniqueness-enforced.
 * Do not export the Map — mutations go through `registerPlugin`, reads through
 * `getPlugin` / `listPlugins`.
 */
const plugins = new Map<string, PluginManifest>();

export function registerPlugin(manifest: PluginManifest): void {
  const errors = validatePluginManifest(manifest);
  if (errors.length > 0) {
    throw new Error(
      `invalid plugin manifest "${manifest.name}": ${errors.join("; ")}`,
    );
  }
  if (plugins.has(manifest.name)) {
    throw new Error(`plugin already registered: ${manifest.name}`);
  }
  plugins.set(manifest.name, manifest);
}

export function getPlugin(name: string): PluginManifest | undefined {
  return plugins.get(name);
}

export function listPlugins(): PluginManifest[] {
  return [...plugins.values()];
}

export function hasPlugin(name: string): boolean {
  return plugins.has(name);
}

/**
 * Test-only escape hatch. Resets the registry between tests so cross-test
 * order doesn't matter. Do not call from production code.
 */
export function __resetPluginsForTests(): void {
  plugins.clear();
}
