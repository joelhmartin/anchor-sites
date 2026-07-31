// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Composer } from "./Composer.js";

/**
 * W1.4 / D319 — input that will be ignored must look ignored. While a turn
 * is in flight (`busy`: sending OR a running build, including one
 * reconnected to after a reload) the composer visibly disables itself and
 * offers Stop; previously Enter silently no-op'd and a reconnected running
 * build still showed a Send button that would 409.
 */

function renderComposer(over: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSend = vi.fn();
  const onStop = vi.fn();
  render(
    <Composer
      draft=""
      onDraftChange={() => undefined}
      onSend={onSend}
      onStop={onStop}
      sending={false}
      busy={false}
      resumeVisible={false}
      onResume={() => undefined}
      usageText="0 tokens today"
      {...over}
    />,
  );
  return { onSend, onStop };
}

describe("Composer — busy honesty (D319)", () => {
  afterEach(cleanup);

  it("idle: textarea enabled with the normal prompt, Send offered", () => {
    renderComposer({ draft: "hello" });
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    expect(textarea.placeholder).toMatch(/ask anchor/i);
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("busy (running build, even without a local send): textarea visibly disabled with an honest hint, Stop offered", () => {
    renderComposer({ busy: true });
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
    expect(textarea.placeholder).toMatch(/build is running/i);
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("busy: Stop wires to onStop", () => {
    const { onStop } = renderComposer({ busy: true });
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("sending alone (pre-pickup window) counts as busy too", () => {
    renderComposer({ sending: true });
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).disabled).toBe(true);
  });
});
