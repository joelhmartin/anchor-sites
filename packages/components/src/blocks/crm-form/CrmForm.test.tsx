import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CrmForm } from "./CrmForm.js";
import { crmFormSchema } from "./schema.js";

describe("CrmForm block", () => {
  it("SSR path: renders embed_code as innerHTML", () => {
    const props = crmFormSchema.parse({ embed_code: "<form data-crm><input /></form>" });
    const { container } = render(<CrmForm {...props} />);
    expect(container.querySelector(".ac-crm-form")).not.toBeNull();
    expect(container.querySelector("form[data-crm]")).not.toBeNull();
  });

  it("SSR path: does not show placeholder text", () => {
    const props = crmFormSchema.parse({ embed_code: "<form></form>", label: "Contact" });
    render(<CrmForm {...props} />);
    expect(screen.queryByText(/\[CRM Form/)).toBeNull();
  });

  it("editor preview: shows placeholder card instead of embed", () => {
    const props = crmFormSchema.parse({ embed_code: "<form></form>", label: "Contact" });
    render(<CrmForm {...props} isEditorPreview />);
    expect(screen.getByText("[CRM Form: Contact]")).toBeInTheDocument();
  });

  it("editor preview without label shows generic placeholder", () => {
    const props = crmFormSchema.parse({ embed_code: "<form></form>" });
    render(<CrmForm {...props} isEditorPreview />);
    expect(screen.getByText("[CRM Form]")).toBeInTheDocument();
  });

  it("editor preview: does NOT render the embed_code as HTML", () => {
    const props = crmFormSchema.parse({ embed_code: '<form data-secret="yes"></form>' });
    const { container } = render(<CrmForm {...props} isEditorPreview />);
    expect(container.querySelector("form")).toBeNull();
  });

  it("has ac-crm-form root class in both modes", () => {
    const props = crmFormSchema.parse({ embed_code: "<form></form>" });
    const { container: c1 } = render(<CrmForm {...props} />);
    expect(c1.querySelector(".ac-crm-form")).not.toBeNull();
    const { container: c2 } = render(<CrmForm {...props} isEditorPreview />);
    expect(c2.querySelector(".ac-crm-form")).not.toBeNull();
  });
});
