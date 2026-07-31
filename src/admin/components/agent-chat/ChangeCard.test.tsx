// @vitest-environment jsdom
//
// W2-CONC / D328 — ChangeCard's Revert obeys the agent-busy gate. Publish
// and Edit are disabled while a turn runs; a mid-build Revert used to POST a
// restore that raced the running agent's writes on the same page.
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChangeCard } from "./ChangeCard.js";

afterEach(cleanup);
import type { AgentChangeEvent } from "../../lib/agent-api.js";

vi.mock("../../lib/apiFetch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/apiFetch.js")>();
  return { ...actual, apiFetch: vi.fn(async () => ({})) };
});

const change: AgentChangeEvent = {
  summary: "Updated the hero headline",
  page_id: "page-1",
  revision_id: "rev-1",
} as AgentChangeEvent;

function renderCard(agentBusy: boolean, onSiteChanged = vi.fn()) {
  return render(
    <MemoryRouter>
      <ChangeCard
        siteId="site-1"
        slug="my-site"
        change={change}
        onSiteChanged={onSiteChanged}
        agentBusy={agentBusy}
      />
    </MemoryRouter>,
  );
}

describe("ChangeCard (D328 busy gate)", () => {
  it("disables Revert while the agent is running, with the same title copy as Publish", () => {
    renderCard(true);
    const button = screen.getByRole("button", { name: "Revert" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("Agent is running");
  });

  it("Revert works normally when the agent is idle", async () => {
    const { apiFetch } = await import("../../lib/apiFetch.js");
    const onSiteChanged = vi.fn();
    renderCard(false, onSiteChanged);
    const button = screen.getByRole("button", { name: "Revert" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute("title")).toBeNull();

    fireEvent.click(button);
    await waitFor(() => expect(onSiteChanged).toHaveBeenCalledTimes(1));
    expect(vi.mocked(apiFetch)).toHaveBeenCalledWith(
      "/api/sites/site-1/pages/page-1/revisions/rev-1/restore",
      { method: "POST" },
    );
  });
});
