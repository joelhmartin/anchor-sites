// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { PluginsTab } from "./PluginsTab.js";
import { setAdminToken, clearAdminToken } from "../../lib/adminToken.js";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const AVAILABLE = {
  plugins: [
    {
      name: "example",
      version: "1.0.0",
      required_env: [],
      secret_config_keys: ["api_key"],
      has_router: true,
      blocks: [],
      config_schema: {
        properties: {
          greeting: { type: "string", default: "hi" },
          api_key: { type: "string", default: "" },
        },
      },
    },
  ],
};

/** Route fetch by path+method; capture PUT calls for assertions. */
function mockApi(installed: unknown, putCapture: Array<{ url: string; body: unknown }>) {
  return vi.fn(async (url: string, opts?: RequestInit) => {
    const u = String(url);
    const method = opts?.method ?? "GET";
    if (u === "/api/plugins" && method === "GET") return json(AVAILABLE);
    if (u.endsWith("/plugins") && u.includes("/sites/") && method === "GET") return json(installed);
    if (method === "PUT") {
      putCapture.push({ url: u, body: JSON.parse(opts!.body as string) });
      return json({ plugin: { plugin_name: "example", version: "1.0.0", enabled: true, config: {}, secrets_set: [] } });
    }
    return json({ error: "unexpected" }, 500);
  });
}

describe("PluginsTab (P7.5-T7.5.8)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("lists plugins with config fields and secret set/unset hint", async () => {
    const installed = { plugins: [{ plugin_name: "example", version: "1.0.0", enabled: false, config: { greeting: "hi" }, secrets_set: [] }] };
    global.fetch = mockApi(installed, []) as unknown as typeof fetch;

    render(<PluginsTab siteId="s1" />);
    await waitFor(() => expect(screen.getByLabelText("greeting")).toBeTruthy());
    expect((screen.getByLabelText("greeting") as HTMLInputElement).value).toBe("hi");
    // Secret field present, password type, marked not set.
    const secret = screen.getByLabelText(/api_key/) as HTMLInputElement;
    expect(secret.type).toBe("password");
    expect(screen.getByText(/not set/)).toBeTruthy();
  });

  it("enables and saves config, sending the typed secret", async () => {
    const installed = { plugins: [{ plugin_name: "example", version: "1.0.0", enabled: false, config: { greeting: "hi" }, secrets_set: [] }] };
    const puts: Array<{ url: string; body: unknown }> = [];
    global.fetch = mockApi(installed, puts) as unknown as typeof fetch;

    render(<PluginsTab siteId="s1" />);
    await waitFor(() => expect(screen.getByLabelText("greeting")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Enable example"));
    fireEvent.change(screen.getByLabelText("greeting"), { target: { value: "howdy" } });
    fireEvent.change(screen.getByLabelText(/api_key/), { target: { value: "sk-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Saved.")).toBeTruthy());
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toBe("/api/sites/s1/plugins/example");
    expect(puts[0].body).toEqual({ enabled: true, config: { greeting: "howdy", api_key: "sk-123" } });
  });

  it("omits a blank secret on save (preserve existing)", async () => {
    const installed = { plugins: [{ plugin_name: "example", version: "1.0.0", enabled: true, config: { greeting: "hi" }, secrets_set: ["api_key"] }] };
    const puts: Array<{ url: string; body: unknown }> = [];
    global.fetch = mockApi(installed, puts) as unknown as typeof fetch;

    render(<PluginsTab siteId="s1" />);
    await waitFor(() => expect(screen.getByLabelText("greeting")).toBeTruthy());
    expect(screen.getByText(/leave blank to keep/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("greeting"), { target: { value: "yo" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body).toEqual({ enabled: true, config: { greeting: "yo" } });
  });
});
