// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MediaTab } from "./MediaTab.js";
import { setAdminToken, clearAdminToken } from "../../lib/adminToken.js";

const READY = {
  id: "m1",
  alt: "A logo",
  content_type: "image/png",
  variants_status: "ready",
  variants: [
    { name: "thumbnail", format: "webp", width: 200, height: 120, url: "https://cdn.example/m1-thumbnail.webp", bytes: 1 },
    { name: "md", format: "webp", width: 768, height: 460, url: "https://cdn.example/m1-md.webp", bytes: 2 },
  ],
  width: 1000,
  height: 600,
  created_at: "2026-05-18T00:00:00Z",
};
const PROCESSING = {
  id: "m2",
  alt: "Pending pic",
  content_type: "image/jpeg",
  variants_status: "processing",
  variants: [],
  width: null,
  height: null,
  created_at: "2026-05-19T00:00:00Z",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("MediaTab (P4-T4.14)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("renders a grid: ready asset as a thumbnail, pending asset as a status badge", async () => {
    global.fetch = vi.fn(async () => json({ media: [READY, PROCESSING] })) as unknown as typeof fetch;
    render(<MediaTab siteId="s1" />);
    await waitFor(() => expect(screen.getByAltText("A logo")).toBeTruthy());
    // Smallest variant chosen for the thumbnail.
    expect((screen.getByAltText("A logo") as HTMLImageElement).src).toContain("m1-thumbnail.webp");
    expect(screen.getByText("processing")).toBeTruthy();
  });

  it("runs the upload-url → PUT → complete flow in order", async () => {
    const seq: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/media" && method === "GET") return json({ media: [] });
      if (url === "/api/sites/s1/media/upload-url" && method === "POST") {
        seq.push("upload-url");
        return json({ asset_id: "a1", upload_url: "https://signed.example/put", headers: { "Content-Type": "image/png" } });
      }
      if (url === "https://signed.example/put" && method === "PUT") {
        seq.push("put");
        return new Response(null, { status: 200 });
      }
      if (url === "/api/sites/s1/media/a1/complete" && method === "POST") {
        seq.push("complete");
        return json({ asset_id: "a1", variants_status: "pending", enqueued: true }, 202);
      }
      return json({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<MediaTab siteId="s1" />);
    await waitFor(() => expect(screen.getByText(/No media yet/)).toBeTruthy());

    const file = new File(["bytes"], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("media-upload-input"), { target: { files: [file] } });

    await waitFor(() => expect(seq).toEqual(["upload-url", "put", "complete"]));

    // upload-url POST carries the file's content type + name as alt.
    const urlCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/sites/s1/media/upload-url",
    )!;
    expect(JSON.parse((urlCall[1] as RequestInit).body as string)).toEqual({
      content_type: "image/png",
      alt: "photo.png",
    });
    // The signed PUT carries the raw file as the body (no admin token to GCS).
    const putCall = fetchMock.mock.calls.find((c) => String(c[0]) === "https://signed.example/put")!;
    expect((putCall[1] as RequestInit).method).toBe("PUT");
    expect((putCall[1] as RequestInit).body).toBe(file);
  });

  it("surfaces an upload error when the PUT to storage fails", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sites/s1/media" && method === "GET") return json({ media: [] });
      if (url === "/api/sites/s1/media/upload-url" && method === "POST") {
        return json({ asset_id: "a1", upload_url: "https://signed.example/put", headers: {} });
      }
      if (url === "https://signed.example/put" && method === "PUT") return new Response(null, { status: 500 });
      return json({}, 404);
    }) as unknown as typeof fetch;

    render(<MediaTab siteId="s1" />);
    await waitFor(() => expect(screen.getByText(/No media yet/)).toBeTruthy());
    const file = new File(["bytes"], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("media-upload-input"), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/upload failed/)).toBeTruthy());
  });
});
