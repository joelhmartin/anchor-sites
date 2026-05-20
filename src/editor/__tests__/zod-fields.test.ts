import { describe, expect, it } from "vitest";
import { z } from "zod";
import { humanizeLabel, zodToPuckFields } from "../zod-fields.js";

describe("zodToPuckFields (P5-T5.3 / D-002)", () => {
  it("maps primitives: string->text, number->number(+min/max), boolean->radio", () => {
    const schema = z.object({
      heading: z.string().default(""),
      count: z.number().min(1).max(10).default(3),
      featured: z.boolean().default(false),
    });
    const fields = zodToPuckFields(schema);
    expect(fields.heading).toEqual({ type: "text", label: "Heading" });
    expect(fields.count).toEqual({ type: "number", label: "Count", min: 1, max: 10 });
    expect(fields.featured).toEqual({
      type: "radio",
      label: "Featured",
      options: [
        { label: "Yes", value: true },
        { label: "No", value: false },
      ],
    });
  });

  it("maps ZodEnum -> select with humanized option labels", () => {
    const schema = z.object({ align: z.enum(["left", "center", "space-between"]).default("center") });
    expect(zodToPuckFields(schema).align).toEqual({
      type: "select",
      label: "Align",
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
        { label: "Space Between", value: "space-between" },
      ],
    });
  });

  it("maps nested ZodObject -> object with recursive objectFields", () => {
    const schema = z.object({
      cta: z.object({ label: z.string().default("Go"), href: z.string().default("#") }).default({}),
    });
    expect(zodToPuckFields(schema).cta).toEqual({
      type: "object",
      label: "Cta",
      objectFields: {
        label: { type: "text", label: "Label" },
        href: { type: "text", label: "Href" },
      },
    });
  });

  it("maps ZodArray<ZodObject> -> array with recursive arrayFields", () => {
    const schema = z.object({
      slides: z
        .array(z.object({ image: z.string().default(""), caption: z.string().default("") }))
        .default([]),
    });
    expect(zodToPuckFields(schema).slides).toEqual({
      type: "array",
      label: "Slides",
      arrayFields: {
        image: { type: "text", label: "Image" },
        caption: { type: "text", label: "Caption" },
      },
    });
  });

  it("unwraps Default/Optional/Nullable/Effects wrappers to the core type", () => {
    const schema = z.object({
      a: z.string().optional(),
      b: z.string().nullable().default(null),
      c: z
        .string()
        .refine((s) => s.length > 0)
        .default("x"),
    });
    const fields = zodToPuckFields(schema);
    expect(fields.a).toEqual({ type: "text", label: "A" });
    expect(fields.b).toEqual({ type: "text", label: "B" });
    expect(fields.c).toEqual({ type: "text", label: "C" });
  });

  it("falls back to textarea for unsupported constructs (array-of-primitive, union, record)", () => {
    const schema = z.object({
      tags: z.array(z.string()).default([]),
      mixed: z.union([z.string(), z.number()]).default("x"),
      bag: z.record(z.string()).default({}),
    });
    const fields = zodToPuckFields(schema);
    expect(fields.tags).toEqual({ type: "textarea", label: "Tags" });
    expect(fields.mixed).toEqual({ type: "textarea", label: "Mixed" });
    expect(fields.bag).toEqual({ type: "textarea", label: "Bag" });
  });

  it("returns {} for a non-object top-level schema (graceful)", () => {
    expect(zodToPuckFields(z.string())).toEqual({});
  });
});

describe("humanizeLabel", () => {
  it("handles snake_case, camelCase, kebab-case", () => {
    expect(humanizeLabel("asset_id")).toBe("Asset Id");
    expect(humanizeLabel("heroSlider")).toBe("Hero Slider");
    expect(humanizeLabel("cta-label")).toBe("Cta Label");
    expect(humanizeLabel("heading")).toBe("Heading");
  });
});
