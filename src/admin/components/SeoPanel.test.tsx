// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SeoPanel } from "./SeoPanel.js";
import type { SeoFields } from "../../server/seo/schema.js";

function setup(value: SeoFields = {}) {
  const onChange = vi.fn();
  render(<SeoPanel siteId="s1" value={value} onChange={onChange} />);
  return { onChange };
}

describe("SeoPanel (P9-T9.7, D-049)", () => {
  afterEach(cleanup);

  it("renders the core SEO fields", () => {
    setup();
    expect(screen.getByRole("heading", { name: "SEO" })).toBeTruthy();
    expect(screen.getByPlaceholderText(/Defaults to the page title/)).toBeTruthy();
    expect(screen.getByLabelText("Open Graph title")).toBeTruthy();
    expect(screen.getByText("Twitter card")).toBeTruthy();
  });

  it("emits a description edit, and prunes an empty value to undefined", () => {
    const { onChange } = setup();
    const desc = screen.getByPlaceholderText(/Shown in search results/);
    fireEvent.change(desc, { target: { value: "Hello" } });
    expect(onChange).toHaveBeenLastCalledWith({ description: "Hello" });

    cleanup();
    const { onChange: onChange2 } = setup({ description: "old" });
    fireEvent.change(screen.getByPlaceholderText(/Shown in search results/), {
      target: { value: "   " },
    });
    expect(onChange2).toHaveBeenLastCalledWith({ description: undefined });
  });

  it("toggles robots index/follow", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByLabelText("Index this page"));
    expect(onChange).toHaveBeenLastCalledWith({ robots: { index: false, follow: true } });
  });

  it("nests og.title under og and keeps existing og fields", () => {
    const { onChange } = setup({ og: { description: "d" } });
    fireEvent.change(screen.getByLabelText("Open Graph title"), { target: { value: "OG" } });
    expect(onChange).toHaveBeenLastCalledWith({ og: { description: "d", title: "OG" } });
  });

  it("sets and clears the twitter card", () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByDisplayValue("Default (large image)"), {
      target: { value: "summary" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ twitter: { card: "summary" } });

    cleanup();
    const { onChange: onChange2 } = setup({ twitter: { card: "summary" } });
    fireEvent.change(screen.getByDisplayValue("Summary"), { target: { value: "" } });
    expect(onChange2).toHaveBeenLastCalledWith({ twitter: undefined });
  });

  it("exposes the og:image media picker (Choose image)", () => {
    setup();
    expect(screen.getByText("Choose image")).toBeTruthy();
  });
});
