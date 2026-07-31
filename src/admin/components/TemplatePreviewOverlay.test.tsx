// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TemplatePreviewOverlay } from "./TemplatePreviewOverlay.js";
import { setAdminToken, clearAdminToken } from "../lib/adminToken.js";

const TPL = { id: "tpl-1", name: "Dental Practice" };
const PAGES = [
  { slug: "home", title: "Home" },
  { slug: "about", title: "About Us" },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const mintResponse = () =>
  json({ token: "ptv1.tpl-1.9999999999.sig", expires_at: new Date(Date.now() + 900_000).toISOString() });

describe("TemplatePreviewOverlay (W1.1 / D701)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  function mount() {
    const onUse = vi.fn();
    const onClose = vi.fn();
    render(<TemplatePreviewOverlay template={TPL} pages={PAGES} onUse={onUse} onClose={onClose} />);
    return { onUse, onClose };
  }

  it("mints a template preview token and mounts the sandboxed iframe on the first page", async () => {
    const mock = vi.fn(async (url: string) => {
      if (url === "/api/templates/tpl-1/preview-token") return mintResponse();
      return json({});
    });
    global.fetch = mock as unknown as typeof fetch;
    mount();

    await waitFor(() => {
      const iframe = screen.getByTitle("Dental Practice preview") as HTMLIFrameElement;
      expect(iframe.getAttribute("src")).toContain("/api/templates/tpl-1/preview/home?token=");
      expect(iframe.getAttribute("src")).toContain(encodeURIComponent("ptv1.tpl-1.9999999999.sig"));
      expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    });
    expect(
      mock.mock.calls.filter(([u, o]) => u === "/api/templates/tpl-1/preview-token" && (o as RequestInit)?.method === "POST")
        .length,
    ).toBe(1);
  });

  it("page switcher swaps the iframe to the picked page's preview", async () => {
    global.fetch = vi.fn(async () => mintResponse()) as unknown as typeof fetch;
    mount();

    await waitFor(() => expect(screen.getByTitle("Dental Practice preview")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "About Us" }));
    const iframe = screen.getByTitle("Dental Practice preview") as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toContain("/preview/about?token=");
    expect(
      (screen.getByRole("button", { name: "About Us" }) as HTMLButtonElement).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("'Use this template', the close button, and Escape all work", async () => {
    global.fetch = vi.fn(async () => mintResponse()) as unknown as typeof fetch;
    const { onUse, onClose } = mount();

    fireEvent.click(screen.getByRole("button", { name: "Use this template" }));
    expect(onUse).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("falls back to the legacy admin token when minting fails", async () => {
    global.fetch = vi.fn(async () => json({ error: "nope" }, 503)) as unknown as typeof fetch;
    mount();

    await waitFor(() => {
      const iframe = screen.getByTitle("Dental Practice preview") as HTMLIFrameElement;
      expect(iframe.getAttribute("src")).toContain("token=tok");
    });
  });
});
