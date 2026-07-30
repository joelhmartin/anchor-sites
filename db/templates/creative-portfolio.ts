import type { TemplateSeed } from "./types.js";

/**
 * Creative Portfolio template (Task C-creative-portfolio, category "Portfolio").
 *
 * Fictional business: Marlowe Studio, an independent design & illustration
 * practice run solo by Sable Marlowe out of Austin, TX — typographic
 * identities, packaging systems, and editorial illustration for record
 * labels, independent presses, coffee roasters, and festival promoters.
 *
 * Design reference: HTML5UP's "Solid State" theme — dark, oversized
 * display type, minimal chrome, a single accent color doing all the work.
 * Matches Lovable's "Jordan Studio" gallery entry: dark-first, typography
 * led, no stock-photo grid.
 *
 * Palette: a true near-black canvas (`--theme-main` / `--theme-surface`
 * both `#0B0B0D`) with a warm off-white ink and one electric accent (acid
 * lime `#C6FF00`) used sparingly for the stats band and primary buttons.
 * Contrast (WCAG relative-luminance formula, computed by hand):
 *   - main #0B0B0D vs on-main #F4F1EC   → ~17.4:1
 *   - surface #0B0B0D vs on-surface #F4F1EC → ~17.4:1 (same pair)
 *   - accent #C6FF00 vs on-accent #0B0B0D → ~16.6:1
 * All comfortably clear the 4.5:1 AA text threshold.
 *
 * Imagery: every `image_asset_id` field is left at the schema's empty-string
 * default — no asset exists at authoring time; the AI agent imports real
 * photos/illustration scans post-creation (see starter.ts precedent —
 * `cover` is the only image-shaped field this template supplies content for).
 * No `logo-reel` block is used: its `logos[].src` is a required non-empty
 * URL (not an asset id) with no authoring-time value to give it, so client
 * types are covered in copy (stats-band, rich-text) instead, per the task's
 * "process stats or logo-reel" either/or.
 */
const navLinks = [
  { label: "Home", href: "/" },
  { label: "Work", href: "/work" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

const navBar = (pageSlug: string) => ({
  id: `${pageSlug}-nav`,
  type: "nav-bar",
  props: {
    brand_name: "Marlowe Studio",
    links: navLinks,
    cta_label: "Start a Project",
    cta_href: "/contact",
    variant: "cta",
  },
});

const footer = (pageSlug: string) => ({
  id: `${pageSlug}-footer`,
  type: "rich-footer",
  props: {
    brand_name: "Marlowe Studio",
    tagline: "Independent design & illustration, Austin, TX.",
    columns: [
      {
        heading: "Studio",
        links: [
          { label: "Work", href: "/work" },
          { label: "About", href: "/about" },
          { label: "Contact", href: "/contact" },
        ],
      },
      {
        heading: "Get in Touch",
        links: [
          { label: "Start a Project", href: "/contact" },
          { label: "Email the Studio", href: "mailto:hello@marlowestudio.com" },
        ],
      },
    ],
    social_links: [
      { platform: "instagram", href: "https://instagram.com/marlowestudio" },
      { platform: "twitter", href: "https://twitter.com/marlowestudio" },
    ],
    hours: "Currently booking into Q1 2027 — inquire for availability.",
    small_print: "© 2026 Marlowe Studio. All rights reserved.",
  },
});

export const creativePortfolio: TemplateSeed = {
  slug: "creative-portfolio",
  name: "Creative Portfolio",
  description: "A dark, typography-led portfolio for an independent designer or illustrator — selected work, case studies, and a personality-forward contact page.",
  brand_tokens: {
    "--theme-main": "#0B0B0D",
    "--theme-on-main": "#F4F1EC",
    "--theme-accent": "#C6FF00",
    "--theme-on-accent": "#0B0B0D",
    "--theme-surface": "#0B0B0D",
    "--theme-on-surface": "#F4F1EC",
  },
  category: "Portfolio",
  sort_order: 60,
  cover: {
    stock_query: "dark portfolio typography",
    alt: "Bold oversized typography on a near-black background, evoking a designer's dark-mode portfolio",
  },
  pages: [
    {
      slug: "home",
      title: "Home",
      sort_order: 0,
      seo: {
        title: "Marlowe Studio | Independent Design & Illustration",
        description:
          "Marlowe Studio is an independent design and illustration studio in Austin, TX, crafting typographic identities and packaging for record labels and festivals.",
      },
      blocks: [
        navBar("home"),
        {
          id: "home-hero",
          type: "hero",
          props: {
            eyebrow: "Independent Design & Illustration — Austin, TX",
            title: "We give ideas a spine.",
            subtitle:
              "Marlowe Studio builds typographic identities, packaging systems, and editorial illustration for record labels, independent presses, coffee roasters, and festival promoters who'd rather stand out than fit in.",
            cta_label: "See the Work",
            cta_href: "/work",
            align: "left",
          },
        },
        {
          id: "home-work-grid",
          type: "feature-grid",
          props: {
            eyebrow: "Selected Work",
            heading: "Four briefs, four different fights worth having",
            items: [
              {
                icon: "01",
                title: "Northline Records",
                body: "A visual identity and vinyl packaging system for an Austin post-punk label, built to survive a decade of pressings without losing its edge.",
              },
              {
                icon: "02",
                title: "Meridian Press",
                body: "Cover illustration and a typographic system for an independent fiction press, designed so a Meridian spine is recognizable from across a bookstore.",
              },
              {
                icon: "03",
                title: "Fernweh Coffee Collective",
                body: "Packaging and wayfinding for a four-roaster coffee collective — one shared system, four distinct roast personalities.",
              },
              {
                icon: "04",
                title: "Static Age Festival",
                body: "A three-year poster and signage series for a touring music festival, redesigned annually without breaking the audience's recognition.",
              },
            ],
          },
        },
        {
          id: "home-stats",
          type: "stats-band",
          props: {
            heading: "Nine years of independent practice",
            stats: [
              { value: "9 yrs", label: "Running the studio solo, no account managers in sight" },
              { value: "60+", label: "Identity, packaging & illustration projects shipped" },
              { value: "4", label: "Industries served: labels, presses, roasters, festivals" },
              { value: "1", label: "Point of contact — me, the whole time" },
            ],
          },
        },
        {
          id: "home-cta",
          type: "cta",
          props: {
            heading: "Have a brief worth obsessing over?",
            body: "Q1 2027 slots are open. Tell me what you're building and I'll tell you honestly whether I'm the right fit.",
            button_label: "Start a Project",
            button_href: "/contact",
            variant: "primary",
          },
        },
        footer("home"),
      ],
    },
    {
      slug: "work",
      title: "Work",
      sort_order: 1,
      seo: {
        title: "Selected Work | Marlowe Studio",
        description:
          "Case studies from Marlowe Studio: identity and packaging for Northline Records, Meridian Press, Fernweh Coffee Collective, and the Static Age festival.",
      },
      blocks: [
        navBar("work"),
        {
          id: "work-hero",
          type: "hero",
          props: {
            eyebrow: "Selected Work",
            title: "A few of the fights worth having",
            subtitle:
              "Case studies from nine years of identity, packaging, and illustration work — the brief, the tension, and what shipped.",
            align: "left",
          },
        },
        {
          id: "work-northline",
          type: "rich-text",
          props: {
            html:
              "<h2>Northline Records</h2><p><strong>Client:</strong> Independent post-punk record label, Austin, TX</p><p>Northline signs bands that don't fit cleanly on a genre page, and their old logo — a stock reverb-drenched wordmark — didn't help. The brief was a full identity that could live on a 12-inch sleeve, a merch tag, and a festival banner without losing tension.</p><p>We built a two-weight display type system paired with a single recurring motif: a hairline crack that splits every Northline mark down the middle, deep enough to notice, controlled enough to repeat. The packaging system runs on uncoated stock with a single spot color per release, so the catalog reads as a family from across a record shop.</p><p>Eighteen releases in, the crack motif is now the thing fans get tattooed.</p>",
            max_width: "medium",
          },
        },
        {
          id: "work-meridian",
          type: "rich-text",
          props: {
            html:
              "<h2>Meridian Press</h2><p><strong>Client:</strong> Independent literary fiction publisher, Austin, TX</p><p>Meridian publishes translated fiction that big houses pass on, and needed covers that could hold their own on a shelf next to imprints with ten times the marketing budget. Instead of one static template, we designed a modular illustration grammar — a recurring geometry of overlapping arcs that each commissioned illustrator has to work within, but never repeats exactly.</p><p>Every jacket also carries the Meridian spine mark: a single vertical rule that breaks color exactly once, at a point tied to the book's page count. It's a piece of information design nobody notices consciously and every bookseller mentions anyway.</p><blockquote><p>“Readers started asking for 'the press with the cracked spine' before they could remember the name Meridian.”</p><cite>— Meridian Press, marketing lead</cite></blockquote>",
            max_width: "medium",
          },
        },
        {
          id: "work-fernweh",
          type: "rich-text",
          props: {
            html:
              "<h2>Fernweh Coffee Collective</h2><p><strong>Client:</strong> Four-roaster specialty coffee collective, Austin, TX</p><p>Fernweh is four independent roasters sharing one retail space, and the ask was a packaging and wayfinding system that unified the storefront without flattening each roaster's identity. We built one structural bag format and one typographic grid, then gave each roaster a single accent color and a hand-drawn mark of their own.</p><p>On the shelf, the wall of bags reads as one collective from ten feet away and four distinct roasters up close — which turned out to be exactly the conversation Fernweh wanted customers having with the staff.</p>",
            max_width: "medium",
          },
        },
        {
          id: "work-static-age",
          type: "rich-text",
          props: {
            html:
              "<h2>Static Age Festival</h2><p><strong>Client:</strong> Touring three-day music festival</p><p>Static Age needed a poster and signage system that could be redesigned every year without the audience losing the thread — the festival's biggest fear was becoming visually forgettable the moment it got interesting. We locked one wayfinding grammar (a numbered arrow system used across every stage and gate) and left the poster illustration completely open, year to year.</p><p>Three years in, the numbered arrows get recognized before the lineup is even announced, and the poster series has become something attendees collect.</p>",
            max_width: "medium",
          },
        },
        {
          id: "work-cta",
          type: "cta",
          props: {
            heading: "Sound like your kind of brief?",
            body: "If it involves a stubborn print run, an odd number of stakeholders, or a deadline that scares you a little, let's talk.",
            button_label: "Start a Project",
            button_href: "/contact",
            variant: "muted",
          },
        },
        footer("work"),
      ],
    },
    {
      slug: "about",
      title: "About",
      sort_order: 2,
      seo: {
        title: "About | Marlowe Studio",
        description:
          "Meet Sable Marlowe, the designer and illustrator behind Marlowe Studio, and the principles — one contact, one device per job — that shape every project.",
      },
      blocks: [
        navBar("about"),
        {
          id: "about-hero",
          type: "hero",
          props: {
            eyebrow: "About",
            title: "Design that argues for itself.",
            subtitle: "The studio, the practice, and the person running both.",
            align: "left",
          },
        },
        {
          id: "about-story",
          type: "rich-text",
          props: {
            html:
              "<h2>How the studio started</h2><p>Sable Marlowe spent five years as a senior designer inside two Austin agencies before going independent in 2017 — not because agency work was bad, but because the best projects kept getting handed to whoever had capacity, not whoever had the strongest opinion about the brief. Marlowe Studio exists so the person with the opinions and the person doing the work are always the same person.</p><p>The practice is intentionally small: one designer, one point of contact, and a client roster capped low enough that every project gets read twice before it ships. Most work comes from labels, presses, roasters, and festivals — independent operators who've been burned by a template before and want something that argues for itself on a shelf.</p>",
            max_width: "medium",
          },
        },
        {
          id: "about-approach",
          type: "split-hero",
          props: {
            eyebrow: "How I Work",
            heading: "Slow onboarding, fast execution",
            body:
              "Every project starts with two weeks of nothing but questions — about the catalog, the shelf, the competitor nobody wants to name out loud. Only after that does a pencil touch paper. It's a slower start than most studios promise, but it means the disagreements happen in the middle of the project, not the week before launch.",
            primary_cta_label: "See the Work",
            primary_cta_href: "/work",
            image_alt: "Sable Marlowe sketching a packaging layout at a studio desk in Austin, Texas",
            variant: "image-right",
          },
        },
        {
          id: "about-principles",
          type: "feature-grid",
          props: {
            eyebrow: "Principles",
            heading: "What doesn't change from project to project",
            items: [
              {
                icon: "◆",
                title: "Typography carries the brand",
                body: "Color and imagery shift by project — the type system is the thing that has to be recognizable at a glance, every time.",
              },
              {
                icon: "◆",
                title: "One structural idea per project",
                body: "Every identity gets exactly one recurring device — a crack, an arc, an arrow — repeated until it's inevitable, not scattered across five ideas.",
              },
              {
                icon: "◆",
                title: "No template, ever",
                body: "Every system is drawn from the client's actual constraints — print run, shelf, venue — not from a mood board of what portfolios currently reward.",
              },
              {
                icon: "◆",
                title: "Direct or not at all",
                body: "No account managers, no junior hand-off. If Marlowe Studio is on the project, Sable Marlowe is on the project.",
              },
            ],
          },
        },
        {
          id: "about-cta",
          type: "cta",
          props: {
            heading: "Curious if I'm the right fit?",
            body: "Most good projects start with a five-minute email, not a formal RFP.",
            button_label: "Get in Touch",
            button_href: "/contact",
            variant: "primary",
          },
        },
        footer("about"),
      ],
    },
    {
      slug: "contact",
      title: "Contact",
      sort_order: 3,
      seo: {
        title: "Contact | Marlowe Studio",
        description:
          "Start a project with Marlowe Studio. Independent designer Sable Marlowe is currently booking into Q1 2027 — send a brief by email or the form below.",
      },
      blocks: [
        navBar("contact"),
        {
          id: "contact-hero",
          type: "hero",
          props: {
            eyebrow: "Contact",
            title: "Tell me what you're building.",
            subtitle: "Email works best — I read every message myself, usually within two business days.",
            align: "left",
          },
        },
        {
          id: "contact-info",
          type: "rich-text",
          props: {
            html:
              "<h2>Before you write</h2><p>I take on a small number of projects at a time, currently booking into Q1 2027. The best briefs tell me three things: what you're making, who it's for, and why the version that exists right now isn't working.</p><p>Based in Austin, Texas. Calls happen by appointment only — text or email gets the fastest reply, and most of the work itself happens remotely.</p>",
            max_width: "medium",
          },
        },
        {
          id: "contact-phone",
          type: "phone_number",
          props: {
            number: "+15125550173",
            display: "(512) 555-0173",
          },
        },
        {
          id: "contact-form",
          type: "crm_form",
          props: {
            embed_code:
              "<form action=\"/inquiries\" method=\"post\" class=\"ac-project-inquiry-form\"><label for=\"inq-name\">Name</label><input id=\"inq-name\" name=\"name\" type=\"text\" required /><label for=\"inq-email\">Email</label><input id=\"inq-email\" name=\"email\" type=\"email\" required /><label for=\"inq-type\">Project Type</label><select id=\"inq-type\" name=\"project_type\" required><option value=\"identity\">Brand Identity</option><option value=\"packaging\">Packaging</option><option value=\"illustration\">Editorial Illustration</option><option value=\"other\">Something Else</option></select><label for=\"inq-budget\">Budget Range</label><select id=\"inq-budget\" name=\"budget\"><option value=\"under-5k\">Under $5,000</option><option value=\"5k-15k\">$5,000 - $15,000</option><option value=\"15k-plus\">$15,000+</option></select><label for=\"inq-message\">Tell me about the project</label><textarea id=\"inq-message\" name=\"message\" required></textarea><button type=\"submit\">Send the Brief</button></form>",
            label: "Project Inquiry",
          },
        },
        footer("contact"),
      ],
    },
  ],
};

export default creativePortfolio;
