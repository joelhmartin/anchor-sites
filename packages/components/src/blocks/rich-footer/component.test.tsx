import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RichFooter } from "./component.js";
import { richFooterSchema } from "./schema.js";
import { EditModeProvider } from "../../editable.js";

describe("ac-rich-footer", () => {
  it("renders the ac-rich-footer root as a <footer> with brand tokens", () => {
    const props = richFooterSchema.parse({});
    const { container } = render(<RichFooter {...props} />);
    const footer = container.querySelector("footer.ac-rich-footer");
    expect(footer).not.toBeNull();
    expect(footer?.className).toMatch(/bg-theme-main/);
  });

  it("renders default columns with headings + links as nav landmarks", () => {
    const props = richFooterSchema.parse({});
    const { container } = render(<RichFooter {...props} />);
    const navs = container.querySelectorAll(".ac-rich-footer__column");
    expect(navs.length).toBe(2);
    expect(navs[0].tagName).toBe("NAV");
    expect(screen.getByText("Company")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "#about");
  });

  it("renders up to 4 columns", () => {
    const columns = Array.from({ length: 4 }, (_, i) => ({
      heading: `Col ${i}`,
      links: [{ label: `L${i}`, href: `#${i}` }],
    }));
    const props = richFooterSchema.parse({ columns });
    const { container } = render(<RichFooter {...props} />);
    expect(container.querySelectorAll(".ac-rich-footer__column")).toHaveLength(4);
  });

  it("renders social links with an accessible label and no bare social row when empty", () => {
    const props = richFooterSchema.parse({
      social_links: [
        { platform: "facebook", href: "https://fb.example" },
        { platform: "instagram", href: "https://ig.example" },
      ],
    });
    const { container } = render(<RichFooter {...props} />);
    const links = container.querySelectorAll(".ac-rich-footer__social-link");
    expect(links).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Facebook" })).toHaveAttribute(
      "href",
      "https://fb.example",
    );
    expect(links[0].querySelector("svg")).not.toBeNull();
  });

  it("regression: no social list renders when social_links is empty", () => {
    const props = richFooterSchema.parse({ social_links: [] });
    const { container } = render(<RichFooter {...props} />);
    expect(container.querySelector(".ac-rich-footer__social")).toBeNull();
  });

  it("marks brand_name/tagline/hours/small_print with data-field", () => {
    const props = richFooterSchema.parse({
      brand_name: "Acme Co",
      tagline: "We build things",
      hours: "Mon-Fri 9-5",
      small_print: "© 2026 Acme Co",
    });
    const { container } = render(<RichFooter {...props} />);
    expect(container.querySelector('[data-field="brand_name"]')?.textContent).toBe("Acme Co");
    expect(container.querySelector('[data-field="tagline"]')?.textContent).toBe(
      "We build things",
    );
    expect(container.querySelector('[data-field="hours"]')?.textContent).toBe("Mon-Fri 9-5");
    expect(container.querySelector('[data-field="small_print"]')?.textContent).toBe(
      "© 2026 Acme Co",
    );
  });

  it("regression: empty brand_name/tagline/hours/small_print render nothing in normal mode", () => {
    const props = richFooterSchema.parse({
      brand_name: "",
      tagline: "",
      hours: "",
      small_print: "",
    });
    const { container } = render(<RichFooter {...props} />);
    expect(container.querySelector('[data-field="brand_name"]')).toBeNull();
    expect(container.querySelector('[data-field="tagline"]')).toBeNull();
    expect(container.querySelector('[data-field="hours"]')).toBeNull();
    expect(container.querySelector(".ac-rich-footer__bottom")).toBeNull();
  });

  it("edit mode: empty fields become clickable data-empty markers and the small-print row still renders", () => {
    const props = richFooterSchema.parse({
      brand_name: "",
      tagline: "",
      hours: "",
      small_print: "",
    });
    const { container } = render(
      <EditModeProvider>
        <RichFooter {...props} />
      </EditModeProvider>,
    );
    expect(container.querySelector('[data-field="brand_name"][data-empty="true"]')).not.toBeNull();
    expect(container.querySelector('[data-field="small_print"][data-empty="true"]')).not.toBeNull();
    expect(container.querySelector(".ac-rich-footer__bottom")).not.toBeNull();
  });
});
