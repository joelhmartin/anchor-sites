import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  __resetPluginsForTests,
  getPlugin,
  hasPlugin,
  listPlugins,
  registerPlugin,
} from "./registry.js";
import type { PluginManifest } from "./manifest.js";

const manifest = (name: string): PluginManifest => ({
  name,
  version: "1.0.0",
  configSchema: z.object({ region: z.string().default("us") }),
});

describe("plugin registry (P7.5-T7.5.2)", () => {
  beforeEach(() => __resetPluginsForTests());

  it("registers and reads back a plugin", () => {
    registerPlugin(manifest("alpha"));
    expect(hasPlugin("alpha")).toBe(true);
    expect(getPlugin("alpha")?.version).toBe("1.0.0");
    expect(listPlugins().map((p) => p.name)).toEqual(["alpha"]);
  });

  it("throws on a duplicate name", () => {
    registerPlugin(manifest("alpha"));
    expect(() => registerPlugin(manifest("alpha"))).toThrow(/already registered/);
  });

  it("throws on an invalid manifest before registering", () => {
    expect(() => registerPlugin(manifest("Bad Name"))).toThrow(/invalid plugin manifest/);
    expect(hasPlugin("Bad Name")).toBe(false);
  });

  it("reset clears the registry", () => {
    registerPlugin(manifest("alpha"));
    __resetPluginsForTests();
    expect(listPlugins()).toEqual([]);
  });
});
