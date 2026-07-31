import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CrmForm } from "./CrmForm.js";
import { crmFormSchema } from "./schema.js";
import { EditModeProvider } from "../../editable.js";

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

  // D1201 (W2-SEC) — the workspace editor IS the SSR preview wrapped in
  // EditModeProvider (render-page.tsx). The context alone must flip the
  // placeholder: the editor never executes a live operator/AI-authored embed.
  describe("[D1201] EditModeContext renders the placeholder without any prop", () => {
    it("edit mode: placeholder card, embed_code NOT in the DOM", () => {
      const props = crmFormSchema.parse({
        embed_code: '<form data-live="yes"><input name="a" /></form>',
        label: "Contact",
      });
      const { container } = render(
        <EditModeProvider>
          <CrmForm {...props} />
        </EditModeProvider>,
      );
      expect(screen.getByText("[CRM Form: Contact]")).toBeInTheDocument();
      expect(container.querySelector("form")).toBeNull();
      expect(container.innerHTML).not.toContain("data-live");
    });

    it("outside the provider the SSR embed path is unchanged", () => {
      const props = crmFormSchema.parse({ embed_code: "<form data-crm><input /></form>" });
      const { container } = render(<CrmForm {...props} />);
      expect(container.querySelector("form[data-crm]")).not.toBeNull();
    });
  });

  it("has ac-crm-form root class in both modes", () => {
    const props = crmFormSchema.parse({ embed_code: "<form></form>" });
    const { container: c1 } = render(<CrmForm {...props} />);
    expect(c1.querySelector(".ac-crm-form")).not.toBeNull();
    const { container: c2 } = render(<CrmForm {...props} isEditorPreview />);
    expect(c2.querySelector(".ac-crm-form")).not.toBeNull();
  });
});
