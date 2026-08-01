// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ChatTranscript } from "./ChatTranscript.js";
import type { DisplayItem } from "./types.js";

// react-markdown is ESM-heavy; the transcript's assistant rendering isn't
// under test here, so stub it to plain text.
vi.mock("./Markdown.js", () => ({ Markdown: ({ children }: { children: string }) => <div>{children}</div> }));

function step(id: string, state: "running" | "done" | "error"): DisplayItem {
  return { id, kind: "step", toolCallId: id, name: "update_page", label: "Updating page", state };
}

function renderTranscript(items: DisplayItem[], busy = false) {
  return render(
    <MemoryRouter>
      <ChatTranscript
        items={items}
        busy={busy}
        siteId="s1"
        slug="acme"
        onSiteChanged={() => {}}
        scrollRef={{ current: null }}
        onScroll={() => {}}
      />
    </MemoryRouter>,
  );
}

describe("ChatTranscript", () => {
  afterEach(() => cleanup());

  // D320
  it("does not make the whole scroll container a live region", () => {
    const { container } = renderTranscript([{ id: "a1", kind: "assistant", text: "Done." }]);
    const scroller = container.querySelector(".overflow-y-auto");
    expect(scroller?.getAttribute("aria-live")).toBeNull();
    expect(scroller?.getAttribute("role")).not.toBe("log");
  });

  // D320 — the answer and system captions carry the live region instead.
  it("scopes aria-live to the assistant answer and system lines", () => {
    renderTranscript([
      { id: "a1", kind: "assistant", text: "Here is your homepage." },
      { id: "sys1", kind: "system", text: "Stopped." },
    ]);
    const answer = screen.getByText("Here is your homepage.").closest("[aria-live]");
    expect(answer?.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByText("Stopped.").getAttribute("role")).toBe("status");
  });

  // D327 — while any step runs, rows stay expanded (live progress) and the
  // running row exposes aria-busy.
  it("keeps step rows expanded while a step is still running", () => {
    renderTranscript([step("t1", "done"), step("t2", "running")]);
    // Both rows visible; no collapse toggle yet.
    expect(screen.getAllByText("Updating page")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Worked through/ })).toBeNull();
    const running = screen.getAllByText("Updating page")[1].closest("[aria-busy]");
    expect(running?.getAttribute("aria-busy")).toBe("true");
  });

  // D327 — once every step settles they collapse into one disclosure,
  // default closed, expandable on click.
  it("collapses settled steps into a 'Worked through N steps' disclosure", () => {
    renderTranscript([step("t1", "done"), step("t2", "done"), step("t3", "done")]);
    expect(screen.queryByText("Updating page")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Worked through 3 steps" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByText("Updating page")).toHaveLength(3);
  });

  // D327 — a failure in a collapsed group must be visible in the summary.
  it("flags a failed step in the collapsed summary", () => {
    renderTranscript([step("t1", "done"), step("t2", "error")]);
    expect(screen.getByRole("button", { name: /a step failed/ })).toBeTruthy();
  });
});
