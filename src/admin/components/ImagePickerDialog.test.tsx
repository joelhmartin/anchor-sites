// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ImagePickerDialog } from "./ImagePickerDialog.js";
import { POLL_CONFIG } from "./image-sources.js";
import { setAdminToken, clearAdminToken } from "../lib/adminToken.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const READY_ASSET = {
  id: "m1",
  alt: "Existing photo",
  variants_status: "ready",
  variants: [
    { name: "thumbnail", format: "webp", width: 200, height: 120, url: "https://cdn.example/m1-thumb.webp", bytes: 1 },
    { name: "lg", format: "jpg", width: 1600, height: 900, url: "https://cdn.example/m1-lg.jpg", bytes: 3 },
    { name: "md", format: "jpg", width: 800, height: 450, url: "https://cdn.example/m1-md.jpg", bytes: 2 },
  ],
};

describe("ImagePickerDialog (Task 10)", () => {
  const realFetch = global.fetch;
  const savedPoll = { ...POLL_CONFIG };

  beforeEach(() => {
    setAdminToken("tok");
    // Real behavior polls every 1.5s for up to 20s; shrink both for fast tests.
    POLL_CONFIG.intervalMs = 2;
    POLL_CONFIG.timeoutMs = 20;
  });
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
    Object.assign(POLL_CONFIG, savedPoll);
  });

  it("library: renders thumbs and picks with the alt-text input value + largest jpg url", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/sites/s1/media?limit=60" && method === "GET") return json({ media: [READY_ASSET] });
      return json({}, 404);
    }) as unknown as typeof fetch;

    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<ImagePickerDialog siteId="s1" open initialAlt="" onClose={onClose} onPick={onPick} />);

    await waitFor(() => expect(screen.getByAltText("Existing photo")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Alt text"), { target: { value: "A hero shot" } });
    fireEvent.click(screen.getByAltText("Existing photo"));

    expect(onPick).toHaveBeenCalledWith({
      asset_id: "m1",
      alt: "A hero shot",
      src: "https://cdn.example/m1-lg.jpg",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("upload: runs upload-url → PUT → complete in order, then picks after the ready poll", async () => {
    const seq: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/sites/s1/media?limit=60" && method === "GET") {
        if (seq.includes("complete")) return json({ media: [{ ...READY_ASSET, id: "a1" }] });
        return json({ media: [] });
      }
      if (url === "/api/sites/s1/media/upload-url" && method === "POST") {
        seq.push("upload-url");
        return json({
          asset_id: "a1",
          upload_url: "https://signed.example/put",
          headers: { "Content-Type": "image/png" },
        });
      }
      if (url === "https://signed.example/put" && method === "PUT") {
        seq.push("put");
        return new Response(null, { status: 200 });
      }
      if (url === "/api/sites/s1/media/a1/complete" && method === "POST") {
        seq.push("complete");
        return json({ asset_id: "a1", variants_status: "pending" }, 202);
      }
      return json({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const onPick = vi.fn();
    render(<ImagePickerDialog siteId="s1" open initialAlt="Studio banner" onClose={vi.fn()} onPick={onPick} />);

    fireEvent.click(screen.getByRole("tab", { name: "Upload" }));
    const file = new File(["bytes"], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("picker-upload-input"), { target: { files: [file] } });

    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(seq).toEqual(["upload-url", "put", "complete"]);
    expect(onPick).toHaveBeenCalledWith({
      asset_id: "a1",
      alt: "Studio banner",
      src: "https://cdn.example/m1-lg.jpg",
    });

    const urlCall = fetchMock.mock.calls.find((c) => String(c[0]) === "/api/sites/s1/media/upload-url")!;
    expect(JSON.parse((urlCall[1] as RequestInit).body as string)).toEqual({
      content_type: "image/png",
      alt: "photo.png",
    });
  });

  it("upload: on poll timeout, picks with an empty src and surfaces an info message", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/sites/s1/media/upload-url" && method === "POST") {
        return json({ asset_id: "a2", upload_url: "https://signed.example/put", headers: {} });
      }
      if (url === "https://signed.example/put" && method === "PUT") return new Response(null, { status: 200 });
      if (url === "/api/sites/s1/media/a2/complete" && method === "POST") return json({}, 202);
      if (url === "/api/sites/s1/media?limit=60" && method === "GET") return json({ media: [] }); // never ready
      return json({}, 404);
    }) as unknown as typeof fetch;

    const onPick = vi.fn();
    render(<ImagePickerDialog siteId="s1" open initialAlt="Timeout case" onClose={vi.fn()} onPick={onPick} />);

    fireEvent.click(screen.getByRole("tab", { name: "Upload" }));
    const file = new File(["bytes"], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("picker-upload-input"), { target: { files: [file] } });

    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(onPick).toHaveBeenCalledWith({ asset_id: "a2", alt: "Timeout case", src: "" });
    await waitFor(() => expect(screen.getByText(/processing/i)).toBeTruthy());
  });

  it("stock: search renders hits; import → poll → pick, carrying the alt text", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/sites/s1/media/stock-search" && method === "POST") {
        return json({
          hits: [
            {
              preview: "https://stock.example/p1.jpg",
              download_url: "https://stock.example/d1.jpg",
              credit: "Jane",
            },
          ],
        });
      }
      if (url === "/api/sites/s1/media/stock-import" && method === "POST") {
        return json({ asset_id: "s99" });
      }
      if (url === "/api/sites/s1/media?limit=60" && method === "GET") {
        return json({ media: [{ ...READY_ASSET, id: "s99" }] });
      }
      return json({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const onPick = vi.fn();
    render(<ImagePickerDialog siteId="s1" open initialAlt="Beach" onClose={vi.fn()} onPick={onPick} />);

    fireEvent.click(screen.getByRole("tab", { name: "Stock photos" }));
    fireEvent.change(screen.getByLabelText("Search stock photos"), { target: { value: "beach" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByAltText("Jane")).toBeTruthy());
    fireEvent.click(screen.getByAltText("Jane"));

    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(onPick).toHaveBeenCalledWith({
      asset_id: "s99",
      alt: "Beach",
      src: "https://cdn.example/m1-lg.jpg",
    });

    const importCall = fetchMock.mock.calls.find((c) => String(c[0]) === "/api/sites/s1/media/stock-import")!;
    expect(JSON.parse((importCall[1] as RequestInit).body as string)).toEqual({
      url: "https://stock.example/d1.jpg",
      alt: "Beach",
    });
  });
});
