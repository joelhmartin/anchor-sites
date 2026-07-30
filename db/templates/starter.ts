import type { TemplateSeed } from "./types.js";

/**
 * Built-in starter template (P7-T7.7, moved to its own module in Task C4).
 * Gives the new-from-template picker something to pick on day one. Content
 * unchanged from the original inline definition — cover is `null` for now
 * (no stock query authored yet).
 */
export const starter: TemplateSeed = {
  slug: "starter",
  name: "Starter",
  description: "A clean two-page starting point — hero, intro copy, and a call to action, plus an About page.",
  brand_tokens: { "--theme-main": "#0a3d62", "--theme-accent": "#f6b93b" },
  category: "Basic",
  sort_order: 999,
  cover: null,
  pages: [
    {
      slug: "home",
      title: "Home",
      seo: { title: "Welcome", description: "A fresh site built on the AnchorCorps platform." },
      sort_order: 0,
      blocks: [
        {
          id: "starter-home-hero",
          type: "hero",
          props: {
            eyebrow: "Welcome",
            title: "Your new site starts here.",
            subtitle: "Replace this copy, swap the colors, and publish — every block is editable.",
            cta_label: "Get in touch",
            cta_href: "#contact",
            align: "center",
          },
        },
        {
          id: "starter-home-rich",
          type: "rich-text",
          props: {
            html: "<h2>About this template</h2><p>This starter ships with a hero, a block of body copy, and a call to action. Edit it in the visual editor, or ask the AI to rework it.</p>",
            max_width: "medium",
          },
        },
        {
          id: "starter-home-cta",
          type: "cta",
          props: {
            heading: "Ready to launch?",
            body: "Customize the content, set your brand colors, and connect a domain.",
            button_label: "Contact us",
            button_href: "#contact",
            variant: "primary",
          },
        },
      ],
    },
    {
      slug: "about",
      title: "About",
      seo: { title: "About us" },
      sort_order: 1,
      blocks: [
        {
          id: "starter-about-hero",
          type: "hero",
          props: {
            eyebrow: "About",
            title: "A little about us.",
            subtitle: "Tell visitors who you are and what you do.",
            align: "left",
          },
        },
        {
          id: "starter-about-rich",
          type: "rich-text",
          props: {
            html: "<h2>Our story</h2><p>Replace this with your own background, mission, and the people behind the work.</p>",
            max_width: "medium",
          },
        },
      ],
    },
  ],
};
