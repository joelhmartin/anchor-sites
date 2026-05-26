import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  pluginBlockPrefix,
  pluginTablePrefix,
  validatePluginManifest,
  type PluginManifest,
} from "./manifest.js";

const validManifest = (over: Partial<PluginManifest> = {}): PluginManifest => ({
  name: "example",
  version: "1.0.0",
  blocks: [
    {
      type: "example/banner",
      schema: z.object({ text: z.string().default("hi") }),
      component: () => null,
      label: "Banner",
      description: "A banner",
      category: "content",
    },
  ],
  migrations: { tables: ["plg_example_notes"] },
  configSchema: z.object({ region: z.string().default("us"), api_key: z.string().default("") }),
  secretConfigKeys: ["api_key"],
  requiredEnv: ["EXAMPLE_FLAG"],
  ...over,
});

describe("plugin manifest (P7.5-T7.5.2)", () => {
  it("prefix helpers convert hyphens to underscores for tables", () => {
    expect(pluginTablePrefix("my-plugin")).toBe("plg_my_plugin_");
    expect(pluginBlockPrefix("my-plugin")).toBe("my-plugin/");
  });

  it("accepts a well-formed manifest", () => {
    expect(validatePluginManifest(validManifest())).toEqual([]);
  });

  it("rejects a non-kebab name", () => {
    const errors = validatePluginManifest(validManifest({ name: "Example_Plugin" }));
    expect(errors.join(" ")).toMatch(/kebab/);
  });

  it("rejects a non-semver version", () => {
    const errors = validatePluginManifest(validManifest({ version: "v1" }));
    expect(errors.join(" ")).toMatch(/semver/);
  });

  it("rejects a block type that isn't namespaced under the plugin", () => {
    const errors = validatePluginManifest(
      validManifest({
        blocks: [
          {
            type: "banner",
            schema: z.object({}),
            component: () => null,
            label: "B",
            description: "d",
            category: "content",
          },
        ],
      }),
    );
    expect(errors.join(" ")).toMatch(/namespaced "example\//);
  });

  it("rejects a table not prefixed with plg_<name>_", () => {
    const errors = validatePluginManifest(validManifest({ migrations: { tables: ["notes"] } }));
    expect(errors.join(" ")).toMatch(/must start with "plg_example_"/);
  });

  it("rejects a secretConfigKey that isn't a configSchema field", () => {
    const errors = validatePluginManifest(validManifest({ secretConfigKeys: ["nope"] }));
    expect(errors.join(" ")).toMatch(/not a field of configSchema/);
  });

  it("rejects secretConfigKeys when configSchema is not a Zod object", () => {
    const errors = validatePluginManifest(
      validManifest({ configSchema: z.string(), secretConfigKeys: ["api_key"] }),
    );
    expect(errors.join(" ")).toMatch(/requires configSchema to be a Zod object/);
  });

  it("rejects env vars that aren't UPPER_SNAKE", () => {
    const errors = validatePluginManifest(validManifest({ requiredEnv: ["lower"] }));
    expect(errors.join(" ")).toMatch(/UPPER_SNAKE/);
  });

  it("rejects a non-function createRouter", () => {
    const errors = validatePluginManifest(
      // @ts-expect-error — deliberately wrong type
      validManifest({ createRouter: "nope" }),
    );
    expect(errors.join(" ")).toMatch(/createRouter must be a function/);
  });
});
