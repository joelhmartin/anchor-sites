// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TemplateDetailDialog, type TemplateSummary } from "./TemplateDetailDialog.js";
import { setAdminToken, clearAdminToken } from "../lib/adminToken.js";

const TPL: TemplateSummary = {
  id: "tpl-1",
  name: "Dental Practice",
  description: "Warm, modern dental site.",
  category: "Medical",
  cover_image_url: null,
  pages_count: 2,
};

const DETAIL = {
  template: TPL,
  pages: [
    { slug: "home", title: "Home" },
    { slug: "about", title: "About Us" },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("TemplateDetailDialog (W1.1 / D205)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  function mount(over: Partial<Parameters<typeof TemplateDetailDialog>[0]> = {}) {
    const onUse = vi.fn();
    const onPreview = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <TemplateDetailDialog
        template={TPL}
        open
        onOpenChange={onOpenChange}
        onUse={onUse}
        onPreview={onPreview}
        {...over}
      />,
    );
    return { onUse, onPreview, onOpenChange };
  }

  it("shows name, description, category, page count, and the fetched page manifest", async () => {
    global.fetch = vi.fn(async () => json(DETAIL)) as unknown as typeof fetch;
    mount();

    expect(screen.getByRole("dialog", { name: "Dental Practice" })).toBeTruthy();
    expect(screen.getByText("Warm, modern dental site.")).toBeTruthy();
    expect(screen.getByText("Medical")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("About Us")).toBeTruthy());
    expect(screen.getByText("2 pages")).toBeTruthy();
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([u]) => u === "/api/templates/tpl-1")).toBe(
      true,
    );
  });

  it("cover has alt text derived from the template name (D714)", async () => {
    global.fetch = vi.fn(async () => json(DETAIL)) as unknown as typeof fetch;
    mount();
    expect(screen.getByRole("img", { name: "Dental Practice template cover" })).toBeTruthy();
  });

  it("'Use this template' fires onUse; the built-in X closes via onOpenChange", async () => {
    global.fetch = vi.fn(async () => json(DETAIL)) as unknown as typeof fetch;
    const { onUse, onOpenChange } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Use this template" }));
    expect(onUse).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("'Preview' is disabled until the manifest loads, then passes the pages up", async () => {
    let resolve!: (r: Response) => void;
    global.fetch = vi.fn(
      () => new Promise<Response>((r) => (resolve = r)),
    ) as unknown as typeof fetch;
    const { onPreview } = mount();

    const preview = screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement;
    expect(preview.disabled).toBe(true);

    resolve(json(DETAIL));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(onPreview).toHaveBeenCalledWith(DETAIL.pages);
  });

  it("manifest fetch failure shows an error with a retry", async () => {
    const mock = vi
      .fn()
      .mockImplementationOnce(async () => json({ error: "boom" }, 500))
      .mockImplementation(async () => json(DETAIL));
    global.fetch = mock as unknown as typeof fetch;
    mount();

    await waitFor(() => expect(screen.getByText(/Couldn't load the page list/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("About Us")).toBeTruthy());
  });
});
