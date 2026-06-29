import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PhoneNumber } from "./PhoneNumber.js";
import { phoneNumberSchema } from "./schema.js";

describe("PhoneNumber block", () => {
  it("renders a tel: link with the number as display when display is omitted", () => {
    const props = phoneNumberSchema.parse({ number: "+15550001234" });
    render(<PhoneNumber {...props} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "tel:+15550001234");
    expect(link).toHaveTextContent("+15550001234");
  });

  it("uses display prop as link text when provided", () => {
    const props = phoneNumberSchema.parse({ number: "+15550001234", display: "(555) 000-1234" });
    render(<PhoneNumber {...props} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "tel:+15550001234");
    expect(link).toHaveTextContent("(555) 000-1234");
  });

  it("has ac-phone-number root class", () => {
    const props = phoneNumberSchema.parse({ number: "+15550001234" });
    const { container } = render(<PhoneNumber {...props} />);
    expect(container.querySelector(".ac-phone-number")).not.toBeNull();
  });

  it("never re-renders with fresh props (memo comparator always true)", () => {
    const props = phoneNumberSchema.parse({ number: "+15550001234" });
    const { rerender } = render(<PhoneNumber {...props} />);
    const before = screen.getByRole("link").textContent;
    rerender(<PhoneNumber number="+19990009999" />);
    // memo(() => true) prevents re-render — DOM must NOT update
    const after = screen.getByRole("link").textContent;
    expect(after).toBe(before);
  });
});
