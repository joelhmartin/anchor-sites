import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../src/server/app.js";

describe("/__blocks/preview (dev-only harness)", () => {
  const app = createApp();

  it("GET serves the HTML form in non-production", async () => {
    const res = await request(app).get("/__blocks/preview");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("Block preview harness");
  });

  it("POST renders a blocks array to SSR HTML", async () => {
    const blocks = [
      { id: "h1", type: "hero", props: { title: "Posted" } },
      { id: "r1", type: "rich-text", props: { html: "<p>Body</p>" } },
    ];
    const res = await request(app).post("/__blocks/preview").send({ blocks });
    expect(res.status).toBe(200);
    expect(res.text).toContain("ac-hero");
    expect(res.text).toContain("Posted");
    expect(res.text).toContain("ac-rich-text");
    expect(res.text).toContain('data-block-id="h1"');
  });

  it("POST returns 400 for malformed input", async () => {
    const res = await request(app).post("/__blocks/preview").send({ wrong: 1 });
    expect(res.status).toBe(400);
  });
});
