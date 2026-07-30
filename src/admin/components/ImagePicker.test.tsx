// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { clearAdminToken, setAdminToken } from "../lib/adminToken.js";
import { ImagePicker } from "./ImagePicker.js";

/**
 * Relocated from `src/editor/custom-fields/__tests__/image-field.test.tsx`
 * (Task B5, 2026-07-30 lovable-workspace SDD) when Puck was removed. That
 * file tested the Puck `imageField()` wrapper (gone with Puck); this tests
 * the underlying `ImagePicker` component directly, which SeoPanel and
 * SeoSettingsTab use without any Puck field wrapper.
 */

const MEDIA = [
  { id: "a1", alt: "Hero", variants_status: "ready", variants: [{ format: "webp", width: 400, url: "https://cdn/a1.webp" }] },
  { id: "a2", alt: "Logo", variants_status: "ready", variants: [{ format: "webp", width: 400, url: "https://cdn/a2.webp" }] },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("ImagePicker (P5-T5.7)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("lists the site's media when opened and selecting sets the asset id", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/sites/s1/media");
      return json({ media: MEDIA });
    }) as unknown as typeof fetch;

    const onChange = vi.fn();
    render(<ImagePicker value="" onChange={onChange} siteId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose image" }));

    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);
    fireEvent.click(options[1]);
    expect(onChange).toHaveBeenCalledWith("a2");
  });

  it("clears the current selection", () => {
    const onChange = vi.fn();
    render(<ImagePicker value="a1" onChange={onChange} siteId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("shows an error when there is no site context", async () => {
    const onChange = vi.fn();
    render(<ImagePicker value="" onChange={onChange} siteId={undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose image" }));
    await screen.findByText(/No site context/);
  });
});
