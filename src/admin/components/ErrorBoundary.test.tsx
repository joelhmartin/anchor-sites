// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary.js";

afterEach(cleanup);

function ThrowOnRender({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("test render error");
  return <div>content ok</div>;
}

describe("ErrorBoundary (P12-T12.4)", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <ThrowOnRender shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("content ok")).toBeTruthy();
  });

  it("renders fallback UI when child throws", () => {
    // Suppress the expected console.error from React
    const origError = console.error;
    console.error = vi.fn();
    render(
      <ErrorBoundary>
        <ThrowOnRender shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    console.error = origError;
  });

  it("renders custom fallback prop when provided", () => {
    const origError = console.error;
    console.error = vi.fn();
    render(
      <ErrorBoundary fallback={<div>custom fallback</div>}>
        <ThrowOnRender shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("custom fallback")).toBeTruthy();
    console.error = origError;
  });
});
