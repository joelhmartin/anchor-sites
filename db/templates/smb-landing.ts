import type { TemplateSeed } from "./types.js";

/**
 * SMB Landing template (Task C-smb-landing, category "Business").
 *
 * The generalist template: a crisp, one-brand small-business site for
 * consultancies, agencies, and local B2B firms when no vertical template
 * fits. This is the template most users will start from, so it's kept the
 * cleanest — one consistent rhythm per page, no niche-specific blocks.
 *
 * Fictional business: Fieldstone Advisory, a small operations & marketing
 * consultancy founded in 2015 in Providence, Rhode Island, run by principal
 * consultant Dana Whitcomb and marketing strategy director Theo Lindqvist.
 *
 * Design reference: MUI's free "Marketing page" template
 * (mui.com/material-ui/getting-started/templates/marketing-page/) — a
 * sectioned hero → feature grid → stats → testimonials → CTA layout, kept
 * deliberately restrained (no announcement bar, no slider) so it reads as a
 * confident, single-brand professional-services site rather than a busy
 * landing page.
 *
 * Palette: confident indigo/slate. Indigo-900 (`--theme-main`) for chrome
 * (nav, footer), indigo-600 (`--theme-accent`) for every call-to-action, and
 * a cool slate neutral scale (`--theme-surface` / `--theme-muted` /
 * `--theme-border`) for body content — all pairings computed at ≥4.5:1
 * contrast (white on indigo-900 ≈ 15:1; white on indigo-600 ≈ 6.3:1;
 * slate-900 on slate-50 ≈ 18:1; slate-700 on slate-200 ≈ 8.4:1).
 */
const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Services", href: "/services" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

const navBar = (pageSlug: string) => ({
  id: `${pageSlug}-nav`,
  type: "nav-bar",
  props: {
    brand_name: "Fieldstone Advisory",
    links: NAV_LINKS,
    cta_label: "Get a Consultation",
    cta_href: "/contact",
    variant: "cta",
  },
});

const footer = (pageSlug: string) => ({
  id: `${pageSlug}-footer`,
  type: "rich-footer",
  props: {
    brand_name: "Fieldstone Advisory",
    tagline: "Operations and marketing consulting for small businesses in Providence, Rhode Island and beyond.",
    columns: [
      {
        heading: "Services",
        links: [
          { label: "Operations Consulting", href: "/services" },
          { label: "Marketing Strategy", href: "/services" },
          { label: "Fractional Marketing", href: "/services" },
        ],
      },
      {
        heading: "Company",
        links: [
          { label: "About", href: "/about" },
          { label: "Contact", href: "/contact" },
        ],
      },
    ],
    social_links: [
      { platform: "linkedin", href: "https://linkedin.com/company/fieldstone-advisory" },
      { platform: "facebook", href: "https://facebook.com/fieldstoneadvisory" },
    ],
    hours: "Mon–Fri 8:30 AM – 5:30 PM",
    small_print: "© 2026 Fieldstone Advisory. All rights reserved.",
  },
});

export const smbLanding: TemplateSeed = {
  slug: "smb-landing",
  name: "SMB Consulting",
  description: "A crisp, confident one-brand site for consultancies and local B2B firms — benefit-led hero, proof stats, and outcome-focused service copy.",
  brand_tokens: {
    "--theme-main": "#312E81",
    "--theme-on-main": "#FFFFFF",
    "--theme-accent": "#4F46E5",
    "--theme-on-accent": "#FFFFFF",
    "--theme-surface": "#F8FAFC",
    "--theme-on-surface": "#0F172A",
    "--theme-muted": "#E2E8F0",
    "--theme-on-muted": "#334155",
    "--theme-border": "#CBD5E1",
  },
  category: "Business",
  sort_order: 100,
  cover: {
    stock_query: "business consulting meeting",
    alt: "Fieldstone Advisory consultants reviewing a growth plan around a conference table",
  },
  pages: [
    // ---------------------------------------------------------------
    // HOME — benefit-led hero, services feature-grid, proof, cta.
    // ---------------------------------------------------------------
    {
      slug: "home",
      title: "Home",
      sort_order: 0,
      seo: {
        title: "Fieldstone Advisory | Providence, RI Business Consulting",
        description:
          "Fieldstone Advisory fixes the operations and marketing gaps that cap small business growth in Providence, Rhode Island, then hands your team a plan to run.",
      },
      blocks: [
        navBar("home"),
        {
          id: "home-hero",
          type: "hero",
          props: {
            eyebrow: "Operations & Marketing Consulting",
            title: "Run a tighter business without hiring a bigger team.",
            subtitle:
              "Fieldstone Advisory helps Providence-area small businesses and B2B teams fix the operations and marketing gaps that quietly cap growth — then hands you a plan your own team can run.",
            cta_label: "Get a Consultation",
            cta_href: "/contact",
            align: "left",
          },
        },
        {
          id: "home-services-grid",
          type: "feature-grid",
          props: {
            eyebrow: "How We Help",
            heading: "Four ways we get a business unstuck",
            items: [
              {
                icon: "shield",
                title: "Operations Systems & Process Design",
                body: "We document the workflows living in your head so the business runs the same way whether or not you're in the room.",
              },
              {
                icon: "target",
                title: "Marketing Strategy & Positioning",
                body: "A clear, defensible message and a lead-generation plan built around who actually buys from you.",
              },
              {
                icon: "users",
                title: "Fractional Marketing Leadership",
                body: "Senior marketing direction for the cost of a coordinator — someone in your inbox, not just a slide deck.",
              },
              {
                icon: "award",
                title: "Growth Roadmapping & KPI Systems",
                body: "The handful of numbers that actually predict revenue, tracked in one dashboard everyone trusts.",
              },
            ],
          },
        },
        {
          id: "home-stats",
          type: "stats-band",
          props: {
            heading: "Eleven years of measurable results",
            stats: [
              { value: "11", label: "Years advising Providence businesses" },
              { value: "60+", label: "Clients guided through a growth stage" },
              { value: "92%", label: "Clients who renew after year one" },
              { value: "$1.2M", label: "Avg. client revenue growth tracked" },
            ],
          },
        },
        {
          id: "home-testimonials",
          type: "testimonial-carousel",
          props: {
            heading: "What clients say",
            autoplay: true,
            interval_ms: 6000,
            items: [
              {
                quote:
                  "Dana mapped out our fulfillment process in a single afternoon. It was the first time in four years I could take a real vacation.",
                author: "Grace Holloway",
                role: "Owner, Holloway Design Studio",
                avatar: "",
              },
              {
                quote:
                  "Theo rebuilt our messaging so it finally matched how our best customers actually talk about us. Inbound leads doubled in a quarter.",
                author: "Nate Ferris",
                role: "Founder, Ferris & Co. Bookkeeping",
                avatar: "",
              },
              {
                quote:
                  "We hired Fieldstone for a three-month engagement and kept them on as fractional marketing leadership for two years running.",
                author: "Sylvia Bramwell",
                role: "COO, Bramwell Logistics Group",
                avatar: "",
              },
            ],
          },
        },
        {
          id: "home-cta",
          type: "cta",
          props: {
            heading: "Ready to see where the friction actually is?",
            body: "A 30-minute working session is usually enough to tell you whether we're the right fit.",
            button_label: "Book a Working Session",
            button_href: "/contact",
            variant: "primary",
          },
        },
        footer("home"),
      ],
    },
    // ---------------------------------------------------------------
    // SERVICES — 3-4 offerings in rich-text, outcomes not features.
    // ---------------------------------------------------------------
    {
      slug: "services",
      title: "Services",
      sort_order: 1,
      seo: {
        title: "Services | Fieldstone Advisory Business Consulting",
        description:
          "Operations systems, marketing strategy, fractional marketing leadership, and growth roadmapping for Providence, Rhode Island small businesses ready to scale.",
      },
      blocks: [
        navBar("services"),
        {
          id: "services-hero",
          type: "hero",
          props: {
            eyebrow: "Our Services",
            title: "Four ways we get a business unstuck",
            subtitle:
              "Every engagement starts with the same question: what's the one change that would make the biggest difference in the next 90 days?",
            cta_label: "Talk Through Your Situation",
            cta_href: "/contact",
            align: "left",
          },
        },
        {
          id: "services-offerings",
          type: "rich-text",
          props: {
            html:
              "<h2>Operations Systems &amp; Process Design</h2><p>Most small businesses run on knowledge that lives in one person's head. We sit with your team, map how work actually moves through the business, and rebuild it into documented workflows anyone can follow. The outcome: fewer fires, faster onboarding, and a founder who can step away without the wheels coming off.</p><h2>Marketing Strategy &amp; Positioning</h2><p>We start by figuring out who your best customers actually are and why they choose you over the alternative, not by running a generic brand exercise. The outcome: a message your team can repeat consistently, and a plan built around the channels that plausibly work for your budget, not every channel that exists.</p><h2>Fractional Marketing Leadership</h2><p>For businesses that need senior marketing judgment but aren't ready for a full-time hire, we step in as embedded marketing leadership: running campaigns, managing freelancers and agencies, and reporting results in plain language. The outcome: marketing that's actually led, not just executed.</p><h2>Growth Roadmapping &amp; KPI Systems</h2><p>We help you pick the handful of numbers that genuinely predict revenue, build a simple dashboard to track them, and set a 12-month roadmap tied to real milestones. The outcome: a plan the whole team can see themselves in, and a way to know within weeks, not quarters, whether it's working.</p>",
            max_width: "medium",
          },
        },
        {
          id: "services-cta",
          type: "cta",
          props: {
            heading: "Not sure which service fits?",
            body: "Tell us where the business feels stuck and we'll tell you honestly whether that's an operations problem, a marketing problem, or both.",
            button_label: "Get a Consultation",
            button_href: "/contact",
            variant: "muted",
          },
        },
        footer("services"),
      ],
    },
    // ---------------------------------------------------------------
    // ABOUT — team split-hero + values feature-grid.
    // ---------------------------------------------------------------
    {
      slug: "about",
      title: "About",
      sort_order: 2,
      seo: {
        title: "About | Fieldstone Advisory Providence, RI Consulting",
        description:
          "Meet Dana Whitcomb and Theo Lindqvist of Fieldstone Advisory, the Providence, Rhode Island consultancy helping small businesses fix operations and marketing.",
      },
      blocks: [
        navBar("about"),
        {
          id: "about-hero",
          type: "hero",
          props: {
            eyebrow: "About Us",
            title: "Consultants who've actually run the departments they advise on",
            subtitle:
              "Fieldstone Advisory was founded in Providence, Rhode Island in 2015 by two operators who got tired of watching good businesses stall on fixable problems.",
            align: "left",
          },
        },
        {
          id: "about-whitcomb-split",
          type: "split-hero",
          props: {
            eyebrow: "Founder & Principal Consultant",
            heading: "Dana Whitcomb",
            body: "Dana spent nine years running operations for a regional logistics company before founding Fieldstone Advisory in 2015. She specializes in untangling the workflows, staffing structures, and vendor relationships that quietly cap a growing business, and in building systems the existing team can actually maintain after she leaves.",
            primary_cta_label: "Work With Dana",
            primary_cta_href: "/contact",
            image_alt: "Dana Whitcomb, Principal Consultant at Fieldstone Advisory, in the Providence office",
            variant: "image-right",
          },
        },
        {
          id: "about-lindqvist-split",
          type: "split-hero",
          props: {
            eyebrow: "Director of Marketing Strategy",
            heading: "Theo Lindqvist",
            body: "Theo joined Fieldstone in 2018 after leading demand generation for a regional software company. He builds positioning and lead-generation plans for businesses that have never had a formal marketing strategy, and often stays on afterward as fractional marketing leadership.",
            primary_cta_label: "Work With Theo",
            primary_cta_href: "/contact",
            image_alt: "Theo Lindqvist, Director of Marketing Strategy at Fieldstone Advisory",
            variant: "image-left",
          },
        },
        {
          id: "about-values-grid",
          type: "feature-grid",
          props: {
            eyebrow: "How We Work",
            heading: "The values behind every engagement",
            items: [
              {
                icon: "check",
                title: "Plain-spoken advice",
                body: "If an idea won't work for your budget or your team, we say so before you pay for it, not after.",
              },
              {
                icon: "shield",
                title: "Built to outlast us",
                body: "Every system we build is documented well enough that your team can run it without us in the room.",
              },
              {
                icon: "clock",
                title: "Fast first wins",
                body: "We look for one change that shows results inside 90 days before we talk about the 12-month plan.",
              },
              {
                icon: "heart",
                title: "No surprise scope",
                body: "Engagements are scoped and priced upfront. Anything that changes along the way gets a conversation, not a surprise invoice.",
              },
            ],
          },
        },
        {
          id: "about-cta",
          type: "cta",
          props: {
            heading: "Meet Dana and Theo in person",
            body: "The best way to know if we're the right fit is a 30-minute conversation about where the business actually stands.",
            button_label: "Schedule a Call",
            button_href: "/contact",
            variant: "primary",
          },
        },
        footer("about"),
      ],
    },
    // ---------------------------------------------------------------
    // CONTACT — crm_form, phone_number, faq-accordion (pricing/process).
    // ---------------------------------------------------------------
    {
      slug: "contact",
      title: "Contact",
      sort_order: 3,
      seo: {
        title: "Contact | Fieldstone Advisory Providence, RI",
        description:
          "Request a consultation from Fieldstone Advisory in Providence, Rhode Island. Call (401) 555-0173 or send your business details online to get started.",
      },
      blocks: [
        navBar("contact"),
        {
          id: "contact-hero",
          type: "hero",
          props: {
            eyebrow: "Get In Touch",
            title: "Tell us where the business feels stuck.",
            subtitle:
              "Most first calls run 30 minutes and end with a clear next step, whether or not that next step involves us.",
            cta_label: "Call (401) 555-0173",
            cta_href: "tel:+14015550173",
            align: "left",
          },
        },
        {
          id: "contact-phone",
          type: "phone_number",
          props: {
            number: "+14015550173",
            display: "(401) 555-0173 — Mon–Fri 8:30 AM – 5:30 PM",
          },
        },
        {
          id: "contact-form",
          type: "crm_form",
          props: {
            embed_code:
              "<form action=\"/api/leads\" method=\"post\" class=\"fieldstone-contact-form\"><input type=\"hidden\" name=\"_page\" value=\"/contact\"><label style=\"position:absolute;left:-9999px\" aria-hidden=\"true\">Leave this field empty<input type=\"text\" name=\"website\" tabindex=\"-1\" autocomplete=\"off\"></label><label>Name<input type=\"text\" name=\"name\" required></label><label>Company<input type=\"text\" name=\"company\"></label><label>Email<input type=\"email\" name=\"email\" required></label><label>What's going on?<textarea name=\"details\" rows=\"4\" required></textarea></label><button type=\"submit\">Request a Consultation</button></form>",
            label: "Request a Consultation",
          },
        },
        {
          id: "contact-hours",
          type: "rich-text",
          props: {
            html:
              "<h2>Hours &amp; Location</h2><p><strong>Office hours:</strong> Mon–Fri 8:30 AM – 5:30 PM.<br><strong>Office address:</strong> 88 Westminster Street, Suite 400, Providence, RI 02903.<br>About half of our current clients work with us fully remote — a site visit is never required to start an engagement.</p>",
            max_width: "medium",
          },
        },
        {
          id: "contact-faq",
          type: "faq-accordion",
          props: {
            heading: "Pricing & Process Questions",
            items: [
              {
                question: "How much does an engagement cost?",
                answer:
                  "Most engagements run $4,000–$18,000 depending on scope, with fractional marketing leadership billed monthly starting at $2,500. You'll get a fixed quote before any work begins, never an open-ended hourly clock.",
              },
              {
                question: "What happens after I fill out the form?",
                answer:
                  "We schedule a free 30-minute call within two business days, walk through what's actually going on, and tell you honestly whether we're a fit. If we are, you'll have a written proposal within a week.",
              },
              {
                question: "How long does a typical engagement take?",
                answer:
                  "Operations and marketing strategy projects usually run 6-10 weeks. Fractional marketing leadership is ongoing, month to month, with a 90-day minimum so there's time to see real results.",
              },
              {
                question: "Do you work with businesses outside Providence?",
                answer:
                  "Yes — about half our current clients are fully remote engagements across the Northeast and beyond. Site visits are available for Providence-area clients but aren't required for the work itself.",
              },
              {
                question: "Do you offer support after the project ends?",
                answer:
                  "Most clients keep us on a light monthly retainer for a quarter or two after the main engagement to make sure the new systems stick, then step down to as-needed check-ins.",
              },
            ],
            multiple: false,
          },
        },
        footer("contact"),
      ],
    },
  ],
};

export default smbLanding;
