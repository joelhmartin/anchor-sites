import { hasPlugin, registerPlugin } from "./registry.js";
import { exampleManifest } from "./example/manifest.js";

/**
 * Register plugins bundled in this repo (P7.5-T7.5.7).
 *
 * Real plugins ship as versioned `@anchorcorps/plugin-*` Artifact Registry
 * packages and self-register on import (dynamic discovery is a documented
 * future addition — D-045). The in-repo `example` reference plugin is opt-in
 * via `ENABLE_EXAMPLE_PLUGIN=true` so prod stays clean by default; flip it to
 * exercise the framework end-to-end. Idempotent.
 */
export function registerBuiltinPlugins(): void {
  if (process.env.ENABLE_EXAMPLE_PLUGIN === "true" && !hasPlugin("example")) {
    registerPlugin(exampleManifest);
  }
}
