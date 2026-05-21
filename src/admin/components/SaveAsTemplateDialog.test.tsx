// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { SaveAsTemplateDialog } from "./SaveAsTemplateDialog.js";
import { setAdminToken, clearAdminToken } from "../lib/adminToken.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const PAGES = [
  { id: "p1", slug: "home", title: "Home" },
  { id: "p2", slug: "about", title: "About" },
];

function routeFetch(saveResponse: () => Response = () => json({ template: { id: "t1" } }, 201)) {
  return vi.fn(async (url: string, opts?: RequestInit) => {
    const method = (opts?.method ?? "GET").toUpperCase();
    if (url === "/api/sites/s1/pages") return json({ pages: PAGES });
    if (url === "/api/sites/s1/save-as-template" && method === "POST") return saveResponse();
    return json({});
  });
}

const saveCalls = (m: ReturnType<typeof routeFetch>) =>
  m.mock.calls.filter(([u, o]) => u === "/api/sites/s1/save-as-template" && (o?.method ?? "").toUpperCase() === "POST");

describe("SaveAsTemplateDialog (P7-T7.8)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  function open() {
    render(<SaveAsTemplateDialog siteId="s1" siteName="Acme Co" />);
    fireEvent.click(screen.getByRole("button", { name: "Save as template" }));
  }

  it("opens, loads pages (all checked), and saves with name; omits page_ids when all selected", async () => {
    const fetchMock = routeFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    open();

    await waitFor(() => expect(screen.getByLabelText("Home")).toBeTruthy());
    expect((screen.getByLabelText("Home") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("About") as HTMLInputElement).checked).toBe(true);

    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Acme Base" } });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));

    await waitFor(() => expect(saveCalls(fetchMock).length).toBe(1));
    const [, opts] = saveCalls(fetchMock)[0];
    const body = JSON.parse(opts!.body as string);
    expect(body.name).toBe("Acme Base");
    expect(body.page_ids).toBeUndefined(); // all selected → omitted
    await waitFor(() => expect(screen.getByText(/Saved .*Acme Base.* as a template/)).toBeTruthy());
  });

  it("sends explicit page_ids when a subset is selected", async () => {
    const fetchMock = routeFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    open();

    await waitFor(() => expect(screen.getByLabelText("About")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("About")); // uncheck About → only home
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Home Only" } });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));

    await waitFor(() => expect(saveCalls(fetchMock).length).toBe(1));
    const body = JSON.parse(saveCalls(fetchMock)[0][1]!.body as string);
    expect(body.page_ids).toEqual(["p1"]);
  });

  it("keeps Save disabled until a name is entered", async () => {
    global.fetch = routeFetch() as unknown as typeof fetch;
    open();
    await waitFor(() => expect(screen.getByLabelText("Home")).toBeTruthy());
    expect((screen.getByRole("button", { name: "Save template" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "X" } });
    expect((screen.getByRole("button", { name: "Save template" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("surfaces a 409 duplicate-name error inline", async () => {
    global.fetch = routeFetch(() => json({ error: "a template with that slug already exists" }, 409)) as unknown as typeof fetch;
    open();
    await waitFor(() => expect(screen.getByLabelText("Home")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Dup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(screen.getByText(/already exists/)).toBeTruthy());
  });
});
