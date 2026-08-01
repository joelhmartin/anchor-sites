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
      missing_env: [],
      secret_config_keys: ["api_key"],
      has_router: true,
      blocks: [{ type: "hello", label: "Hello", description: "A greeting block" }],
      config_schema: {
        properties: {
          greeting: { type: "string", default: "hi", title: "Greeting" },
          api_key: { type: "string", default: "" },
        },
      },
    },
  ],
};

/** Route fetch by path+method; capture PUT calls for assertions. */
function mockApi(
  installed: unknown,
  putCapture: Array<{ url: string; body: unknown }>,
  available: unknown = AVAILABLE,
  installedStatus = 200,
) {
  return vi.fn(async (url: string, opts?: RequestInit) => {
    const u = String(url);
    const method = opts?.method ?? "GET";
    if (u === "/api/plugins" && method === "GET") return json(available);
    if (u.endsWith("/plugins") && u.includes("/sites/") && method === "GET")
      return json(installed, installedStatus);
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
    await waitFor(() => expect(screen.getByLabelText("Greeting")).toBeTruthy());
    expect((screen.getByLabelText("Greeting") as HTMLInputElement).value).toBe("hi");
    // Secret field present, password type, marked not set.
    const secret = screen.getByLabelText(/Api key/) as HTMLInputElement;
    expect(secret.type).toBe("password");
    expect(screen.getByText(/not set/)).toBeTruthy();
  });

  it("shows what the plugin provides (D439)", async () => {
    const installed = { plugins: [] };
    global.fetch = mockApi(installed, []) as unknown as typeof fetch;
    render(<PluginsTab siteId="s1" />);
    await waitFor(() => expect(screen.getByText(/Provides blocks: Hello/)).toBeTruthy());
    expect(screen.getByText(/Adds server routes/)).toBeTruthy();
  });

  it("enables and saves config, sending the typed secret", async () => {
    const installed = { plugins: [{ plugin_name: "example", version: "1.0.0", enabled: false, config: { greeting: "hi" }, secrets_set: [] }] };
    const puts: Array<{ url: string; body: unknown }> = [];
    global.fetch = mockApi(installed, puts) as unknown as typeof fetch;

    render(<PluginsTab siteId="s1" />);
    await waitFor(() => expect(screen.getByLabelText("Greeting")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Enable example"));
    fireEvent.change(screen.getByLabelText("Greeting"), { target: { value: "howdy" } });
    fireEvent.change(screen.getByLabelText(/Api key/), { target: { value: "sk-123" } });
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
    await waitFor(() => expect(screen.getByLabelText("Greeting")).toBeTruthy());
    expect(screen.getByText(/leave blank to keep/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Greeting"), { target: { value: "yo" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body).toEqual({ enabled: true, config: { greeting: "yo" } });
  });

  it("blocks saving when the installed-config fetch fails, instead of writing defaults (D413)", async () => {
    const puts: Array<{ url: string; body: unknown }> = [];
    // installed fetch 500s.
    global.fetch = mockApi({ error: "boom" }, puts, AVAILABLE, 500) as unknown as typeof fetch;
    render(<PluginsTab siteId="s1" />);
    await waitFor(() => expect(screen.getByText(/Couldn’t load this site’s plugin settings/)).toBeTruthy());
    // No Save button rendered at all → defaults can't be written.
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(puts).toHaveLength(0);
  });

  it("serializes typed number/boolean config, not strings (D434)", async () => {
    const available = {
      plugins: [
        {
          name: "typed",
          version: "2.0.0",
          required_env: [],
          missing_env: [],
          secret_config_keys: [],
          has_router: false,
          blocks: [],
          config_schema: {
            properties: {
              max_items: { type: "number", default: 5, title: "Max items" },
              enabled_flag: { type: "boolean", default: false, title: "Enabled flag" },
            },
          },
        },
      ],
    };
    const installed = { plugins: [{ plugin_name: "typed", version: "2.0.0", enabled: false, config: { max_items: 5, enabled_flag: false }, secrets_set: [] }] };
    const puts: Array<{ url: string; body: unknown }> = [];
    global.fetch = mockApi(installed, puts, available) as unknown as typeof fetch;

    render(<PluginsTab siteId="s1" />);
    await waitFor(() => expect(screen.getByLabelText("Max items")).toBeTruthy());
    const num = screen.getByLabelText("Max items") as HTMLInputElement;
    expect(num.type).toBe("number");
    fireEvent.change(num, { target: { value: "12" } });
    fireEvent.click(screen.getByLabelText("Enabled flag"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(puts).toHaveLength(1));
    const body = puts[0].body as { config: { max_items: unknown; enabled_flag: unknown } };
    expect(body.config.max_items).toBe(12); // number, not "12"
    expect(body.config.enabled_flag).toBe(true); // boolean, not "true"
  });

  it("warns about and refuses to enable a plugin with unmet required env (D438)", async () => {
    const available = {
      plugins: [
        {
          name: "needsenv",
          version: "1.0.0",
          required_env: ["SOME_API_KEY"],
          missing_env: ["SOME_API_KEY"],
          secret_config_keys: [],
          has_router: false,
          blocks: [],
          config_schema: null,
        },
      ],
    };
    const installed = { plugins: [] };
    global.fetch = mockApi(installed, [], available) as unknown as typeof fetch;
    render(<PluginsTab siteId="s1" />);
    await waitFor(() => expect(screen.getByText(/Missing configuration: SOME_API_KEY/)).toBeTruthy());
    const toggle = screen.getByLabelText("Enable needsenv") as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
  });
});
