// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { clearAdminToken, setAdminToken } from "../../../admin/lib/adminToken.js";
import { imageField } from "../image-field.js";

const MEDIA = [
  { id: "a1", alt: "Hero", variants_status: "ready", variants: [{ format: "webp", width: 400, url: "https://cdn/a1.webp" }] },
  { id: "a2", alt: "Logo", variants_status: "ready", variants: [{ format: "webp", width: 400, url: "https://cdn/a2.webp" }] },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type RP = { value: unknown; onChange: (v: string) => void };
function renderField(value: unknown, onChange: (v: string) => void, siteId?: string) {
  const field = imageField("Image", siteId) as unknown as { render: (p: RP) => React.ReactElement };
  return render(<>{field.render({ value, onChange })}</>);
}

describe("imageField (P5-T5.7)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("is a Puck custom field labelled Image", () => {
    const field = imageField("Image", "s1") as unknown as { type: string; label: string; render: unknown };
    expect(field.type).toBe("custom");
    expect(field.label).toBe("Image");
    expect(typeof field.render).toBe("function");
  });

  it("lists the site's media when opened and selecting sets the asset id", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/sites/s1/media");
      return json({ media: MEDIA });
    }) as unknown as typeof fetch;

    const onChange = vi.fn();
    renderField("", onChange, "s1");
    fireEvent.click(screen.getByRole("button", { name: "Choose image" }));

    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);
    fireEvent.click(options[1]);
    expect(onChange).toHaveBeenCalledWith("a2");
  });

  it("clears the current selection", () => {
    const onChange = vi.fn();
    renderField("a1", onChange, "s1");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("shows an error when there is no site context", async () => {
    const onChange = vi.fn();
    renderField("", onChange, undefined);
    fireEvent.click(screen.getByRole("button", { name: "Choose image" }));
    await screen.findByText(/No site context/);
  });
});
