import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AnnouncementBar } from "./component.js";
import { announcementBarSchema } from "./schema.js";
import { EditModeProvider } from "../../editable.js";

describe("ac-announcement-bar", () => {
  it("renders as a labeled region with the ac-announcement-bar root class + accent tokens", () => {
    const props = announcementBarSchema.parse({});
    const { container } = render(<AnnouncementBar {...props} />);
    const root = container.querySelector(".ac-announcement-bar");
    expect(root).not.toBeNull();
    expect(root?.className).toMatch(/bg-theme-accent/);
    expect(screen.getByRole("region", { name: "Announcement" })).toBeInTheDocument();
  });

  it("marks text with data-field", () => {
    const props = announcementBarSchema.parse({ text: "Free shipping this week" });
    const { container } = render(<AnnouncementBar {...props} />);
    expect(container.querySelector('[data-field="text"]')?.textContent).toBe(
      "Free shipping this week",
    );
  });

  it("renders a link when link_label is set, with data-field on the label", () => {
    const props = announcementBarSchema.parse({
      link_label: "Learn more",
      link_href: "/promo",
    });
    const { container } = render(<AnnouncementBar {...props} />);
    const link = screen.getByRole("link", { name: "Learn more" });
    expect(link.getAttribute("href")).toBe("/promo");
    expect(container.querySelector('[data-field="link_label"]')?.textContent).toBe("Learn more");
  });

  it("regression: no link renders when link_label is empty in normal mode", () => {
    const props = announcementBarSchema.parse({ link_label: "" });
    const { container } = render(<AnnouncementBar {...props} />);
    expect(container.querySelector(".ac-announcement-bar__link")).toBeNull();
  });

  it("edit mode: empty link_label still renders a clickable link with a data-empty marker", () => {
    const props = announcementBarSchema.parse({ link_label: "" });
    const { container } = render(
      <EditModeProvider>
        <AnnouncementBar {...props} />
      </EditModeProvider>,
    );
    expect(container.querySelector(".ac-announcement-bar__link")).not.toBeNull();
    expect(
      container.querySelector('[data-field="link_label"][data-empty="true"]'),
    ).not.toBeNull();
  });

  it("has no dismiss control (dismissible=false, static band per the brief)", () => {
    const props = announcementBarSchema.parse({});
    render(<AnnouncementBar {...props} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
