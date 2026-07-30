import type { TemplateSeed } from "./types.js";

/**
 * Home Services template (Task C5-C14, slug `home-services`).
 *
 * Fictional business: Ironclad Home Services — a licensed plumbing, HVAC &
 * electrical contractor serving Columbus, Ohio and the surrounding metro
 * since 2009.
 *
 * Design reference: Tailwind UI's free marketing sections — the split-image
 * hero, centered dark CTA band, and "simple with large numbers" stats
 * pattern — recomposed with a bold, high-contrast contractor palette (deep
 * navy + safety orange) and an always-visible emergency-call banner, the
 * dominant convention in contractor-marketing sites (24/7 urgency + a
 * tap-to-call number above the fold on every page).
 *
 * Brand tokens: deep navy (`--theme-main`) for chrome/trust, safety orange
 * (`--theme-accent`) for every call-to-action, so the "call now" affordance
 * never blends into the page.
 */
export const homeServices: TemplateSeed = {
  slug: "home-services",
  name: "Home Services",
  description: "A bold, high-contrast contractor site for plumbing, HVAC & electrical pros — emergency CTA up top, service-area response times, and review trust stats.",
  category: "Home Services",
  sort_order: 20,
  brand_tokens: {
    "--theme-main": "#0b2545",
    "--theme-on-main": "#ffffff",
    "--theme-accent": "#f2610c",
    "--theme-on-accent": "#ffffff",
    "--theme-surface": "#ffffff",
    "--theme-on-surface": "#101828",
    "--theme-muted": "#eef2f7",
    "--theme-on-muted": "#334155",
    "--theme-border": "#d7dee7",
  },
  cover: {
    stock_query: "plumber electrician van",
    alt: "Ironclad Home Services technician van parked outside a Columbus home",
  },
  pages: [
    // ---------------------------------------------------------------
    // HOME — emergency CTA prominent, phone-number block up top.
    // ---------------------------------------------------------------
    {
      slug: "home",
      title: "Home",
      sort_order: 0,
      seo: {
        title: "Ironclad Home Services | Columbus Plumbing & HVAC",
        description:
          "Licensed plumbing, HVAC & electrical repair in Columbus, Ohio. 24/7 emergency dispatch, upfront pricing, and 15+ years serving Central Ohio homes.",
      },
      blocks: [
        {
          id: "home-nav",
          type: "nav-bar",
          props: {
            brand_name: "Ironclad Home Services",
            links: [
              { label: "Home", href: "/" },
              { label: "Services", href: "/services" },
              { label: "Service Area", href: "/service-area" },
              { label: "Reviews", href: "/reviews" },
              { label: "Contact", href: "/contact" },
            ],
            cta_label: "Call Now",
            cta_href: "tel:+16145550142",
            variant: "cta",
          },
        },
        {
          id: "home-announcement",
          type: "announcement-bar",
          props: {
            text: "24/7 Emergency Dispatch — a licensed tech is always on call in Central Ohio.",
            link_label: "Call (614) 555-0142",
            link_href: "tel:+16145550142",
          },
        },
        {
          id: "home-hero",
          type: "hero",
          props: {
            eyebrow: "Licensed & Insured Since 2009",
            title: "Plumbing, HVAC & Electrical Done Right — Fast.",
            subtitle:
              "Ironclad Home Services sends a background-checked, licensed tech to your Columbus-area home the same day you call — burst pipe, dead furnace, or a panel that won't stop tripping.",
            cta_label: "Request Service",
            cta_href: "/contact",
            align: "left",
          },
        },
        {
          id: "home-phone",
          type: "phone_number",
          props: {
            number: "+16145550142",
            display: "(614) 555-0142 — Emergency Line, Answered 24/7",
          },
        },
        {
          id: "home-features",
          type: "feature-grid",
          props: {
            eyebrow: "What We Fix",
            heading: "One call covers every trade in the house.",
            items: [
              {
                icon: "shield",
                title: "Plumbing",
                body: "Drain cleaning, water heaters, leak detection, and repiping — same-day service.",
              },
              {
                icon: "sparkles",
                title: "HVAC",
                body: "AC and furnace repair, installs, and maintenance plans that keep Ohio weather from winning.",
              },
              {
                icon: "bolt",
                title: "Electrical",
                body: "Panel upgrades, rewiring, generator installs, and EV chargers from a licensed master electrician.",
              },
            ],
          },
        },
        {
          id: "home-stats",
          type: "stats-band",
          props: {
            heading: "Central Ohio has trusted Ironclad since 2009.",
            stats: [
              { value: "15+", label: "Years in business" },
              { value: "2,400+", label: "Jobs completed" },
              { value: "24/7", label: "Emergency dispatch" },
              { value: "4.9/5", label: "Average review rating" },
            ],
          },
        },
        {
          id: "home-cta",
          type: "cta",
          props: {
            heading: "Something broken? We're already on our way.",
            body: "Tell us what's going on and we'll get a licensed tech scheduled — often the same day.",
            button_label: "Schedule Service",
            button_href: "/contact",
            variant: "primary",
          },
        },
        {
          id: "home-footer",
          type: "rich-footer",
          props: {
            brand_name: "Ironclad Home Services",
            tagline: "Licensed plumbing, HVAC & electrical contractors serving Columbus, Ohio since 2009.",
            columns: [
              {
                heading: "Services",
                links: [
                  { label: "Plumbing", href: "/services" },
                  { label: "HVAC", href: "/services" },
                  { label: "Electrical", href: "/services" },
                ],
              },
              {
                heading: "Company",
                links: [
                  { label: "Service Area", href: "/service-area" },
                  { label: "Reviews", href: "/reviews" },
                  { label: "Contact", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "facebook", href: "https://facebook.com/ironcladhomeservices" },
              { platform: "instagram", href: "https://instagram.com/ironcladhomeservices" },
            ],
            hours: "Mon-Fri 7am-8pm · Sat 8am-6pm · Sun Emergency Dispatch Only",
            small_print: "Ohio Lic. #OH-48219 · Bonded & Insured · © 2026 Ironclad Home Services.",
          },
        },
      ],
    },
    // ---------------------------------------------------------------
    // SERVICES
    // ---------------------------------------------------------------
    {
      slug: "services",
      title: "Services",
      sort_order: 1,
      seo: {
        title: "Services | Ironclad Home Services Columbus",
        description:
          "Full-service plumbing, HVAC, and electrical repair and installation in Columbus, Ohio, from drain cleaning to panel upgrades to EV charger installs.",
      },
      blocks: [
        {
          id: "services-nav",
          type: "nav-bar",
          props: {
            brand_name: "Ironclad Home Services",
            links: [
              { label: "Home", href: "/" },
              { label: "Services", href: "/services" },
              { label: "Service Area", href: "/service-area" },
              { label: "Reviews", href: "/reviews" },
              { label: "Contact", href: "/contact" },
            ],
            cta_label: "Call Now",
            cta_href: "tel:+16145550142",
            variant: "cta",
          },
        },
        {
          id: "services-hero",
          type: "hero",
          props: {
            eyebrow: "Our Services",
            title: "Every trade your home needs, under one truck.",
            subtitle:
              "Our techs cross-train across plumbing, HVAC, and electrical, so one visit usually solves the whole problem — no juggling three contractors.",
            cta_label: "Get a Quote",
            cta_href: "/contact",
            align: "left",
          },
        },
        {
          id: "services-grid",
          type: "feature-grid",
          props: {
            eyebrow: "The Full List",
            heading: "Plumbing, HVAC & electrical — done by licensed pros.",
            items: [
              {
                icon: "check",
                title: "Drain Cleaning & Hydro-Jetting",
                body: "Camera-inspected drain clearing for slow sinks, backed-up mains, and stubborn tree-root clogs.",
              },
              {
                icon: "shield",
                title: "Water Heater Repair & Install",
                body: "Tank and tankless water heater service, same-day replacement when a unit can't be saved.",
              },
              {
                icon: "sparkles",
                title: "AC Repair & Installation",
                body: "Diagnostics, refrigerant service, and full system replacement for every major AC brand.",
              },
              {
                icon: "clock",
                title: "Furnace & Heating Repair",
                body: "Furnace tune-ups, igniter and blower repair, and new furnace installs before the cold hits.",
              },
              {
                icon: "bolt",
                title: "Panel Upgrades & Rewiring",
                body: "200-amp panel upgrades, knob-and-tube rewiring, and code corrections for older Columbus homes.",
              },
              {
                icon: "award",
                title: "Generator & EV Charger Install",
                body: "Whole-home standby generators and Level 2 EV charger installs, permitted and inspected.",
              },
            ],
          },
        },
        {
          id: "services-detail",
          type: "rich-text",
          props: {
            html: "<h2>Maintenance plans</h2><p>The Ironclad Comfort Plan bundles a spring AC tune-up, a fall furnace inspection, and a whole-home plumbing check into one annual visit — members also get priority scheduling and 15% off parts on any repair.</p><h2>Licensed for every job</h2><p>Dave Kessler (Master Plumber), Maria Ontiveros (Lead HVAC Technician), and Tyrell Banks (Master Electrician) hold Ohio state licensing in their trades, and every job pulls the required permit before work starts.</p>",
            max_width: "medium",
          },
        },
        {
          id: "services-cta",
          type: "cta",
          props: {
            heading: "Not sure which service you need?",
            body: "Describe the problem and we'll match you with the right tech — no upsells, just a fix.",
            button_label: "Talk to a Tech",
            button_href: "/contact",
            variant: "muted",
          },
        },
        {
          id: "services-footer",
          type: "rich-footer",
          props: {
            brand_name: "Ironclad Home Services",
            tagline: "Licensed plumbing, HVAC & electrical contractors serving Columbus, Ohio since 2009.",
            columns: [
              {
                heading: "Services",
                links: [
                  { label: "Plumbing", href: "/services" },
                  { label: "HVAC", href: "/services" },
                  { label: "Electrical", href: "/services" },
                ],
              },
              {
                heading: "Company",
                links: [
                  { label: "Service Area", href: "/service-area" },
                  { label: "Reviews", href: "/reviews" },
                  { label: "Contact", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "facebook", href: "https://facebook.com/ironcladhomeservices" },
              { platform: "instagram", href: "https://instagram.com/ironcladhomeservices" },
            ],
            hours: "Mon-Fri 7am-8pm · Sat 8am-6pm · Sun Emergency Dispatch Only",
            small_print: "Ohio Lic. #OH-48219 · Bonded & Insured · © 2026 Ironclad Home Services.",
          },
        },
      ],
    },
    // ---------------------------------------------------------------
    // SERVICE AREA — cities + response times, stats-band.
    // ---------------------------------------------------------------
    {
      slug: "service-area",
      title: "Service Area",
      sort_order: 2,
      seo: {
        title: "Service Area | Ironclad Home Services Columbus Metro",
        description:
          "Ironclad Home Services dispatches licensed techs across Columbus, Dublin, Westerville, Grove City, Reynoldsburg, and Hilliard with fast average response times.",
      },
      blocks: [
        {
          id: "service-area-nav",
          type: "nav-bar",
          props: {
            brand_name: "Ironclad Home Services",
            links: [
              { label: "Home", href: "/" },
              { label: "Services", href: "/services" },
              { label: "Service Area", href: "/service-area" },
              { label: "Reviews", href: "/reviews" },
              { label: "Contact", href: "/contact" },
            ],
            cta_label: "Call Now",
            cta_href: "tel:+16145550142",
            variant: "cta",
          },
        },
        {
          id: "service-area-hero",
          type: "hero",
          props: {
            eyebrow: "Where We Work",
            title: "Fast local response across Central Ohio.",
            subtitle:
              "Six trucks run routes across the Columbus metro every day, so a tech is always close by when something breaks.",
            cta_label: "Check My Address",
            cta_href: "/contact",
            align: "center",
          },
        },
        {
          id: "service-area-cities",
          type: "feature-grid",
          props: {
            eyebrow: "Cities We Cover",
            heading: "Average dispatch time by city.",
            items: [
              { icon: "target", title: "Columbus", body: "Avg. response: 28 minutes" },
              { icon: "target", title: "Dublin", body: "Avg. response: 35 minutes" },
              { icon: "target", title: "Westerville", body: "Avg. response: 32 minutes" },
              { icon: "target", title: "Grove City", body: "Avg. response: 30 minutes" },
              { icon: "target", title: "Reynoldsburg", body: "Avg. response: 34 minutes" },
              { icon: "target", title: "Hilliard", body: "Avg. response: 38 minutes" },
            ],
          },
        },
        {
          id: "service-area-stats",
          type: "stats-band",
          props: {
            heading: "Coverage that keeps up with Central Ohio.",
            stats: [
              { value: "6", label: "Cities served daily" },
              { value: "32 min", label: "Average dispatch time" },
              { value: "24/7", label: "Emergency availability" },
              { value: "15+", label: "Years serving the metro" },
            ],
          },
        },
        {
          id: "service-area-cta",
          type: "cta",
          props: {
            heading: "Not seeing your neighborhood?",
            body: "Call the office — we cover most of Franklin County and take one-off jobs just outside it.",
            button_label: "Ask About Your Address",
            button_href: "/contact",
            variant: "primary",
          },
        },
        {
          id: "service-area-footer",
          type: "rich-footer",
          props: {
            brand_name: "Ironclad Home Services",
            tagline: "Licensed plumbing, HVAC & electrical contractors serving Columbus, Ohio since 2009.",
            columns: [
              {
                heading: "Services",
                links: [
                  { label: "Plumbing", href: "/services" },
                  { label: "HVAC", href: "/services" },
                  { label: "Electrical", href: "/services" },
                ],
              },
              {
                heading: "Company",
                links: [
                  { label: "Service Area", href: "/service-area" },
                  { label: "Reviews", href: "/reviews" },
                  { label: "Contact", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "facebook", href: "https://facebook.com/ironcladhomeservices" },
              { platform: "instagram", href: "https://instagram.com/ironcladhomeservices" },
            ],
            hours: "Mon-Fri 7am-8pm · Sat 8am-6pm · Sun Emergency Dispatch Only",
            small_print: "Ohio Lic. #OH-48219 · Bonded & Insured · © 2026 Ironclad Home Services.",
          },
        },
      ],
    },
    // ---------------------------------------------------------------
    // REVIEWS — testimonial-carousel + trust stats.
    // ---------------------------------------------------------------
    {
      slug: "reviews",
      title: "Reviews",
      sort_order: 3,
      seo: {
        title: "Reviews | Ironclad Home Services Columbus",
        description:
          "Read what Columbus-area homeowners say about Ironclad Home Services' plumbing, HVAC, and electrical repairs — 4.9 out of 5 stars across 2,400+ jobs.",
      },
      blocks: [
        {
          id: "reviews-nav",
          type: "nav-bar",
          props: {
            brand_name: "Ironclad Home Services",
            links: [
              { label: "Home", href: "/" },
              { label: "Services", href: "/services" },
              { label: "Service Area", href: "/service-area" },
              { label: "Reviews", href: "/reviews" },
              { label: "Contact", href: "/contact" },
            ],
            cta_label: "Call Now",
            cta_href: "tel:+16145550142",
            variant: "cta",
          },
        },
        {
          id: "reviews-hero",
          type: "hero",
          props: {
            eyebrow: "Reviews",
            title: "Homeowners across Columbus trust Ironclad.",
            subtitle: "Real jobs, real feedback — verified through our post-service review requests.",
            cta_label: "Book Your Service",
            cta_href: "/contact",
            align: "center",
          },
        },
        {
          id: "reviews-carousel",
          type: "testimonial-carousel",
          props: {
            heading: "What our customers say",
            autoplay: true,
            interval_ms: 6000,
            items: [
              {
                quote:
                  "Our water heater died on a Sunday night and Dave had a new one installed by noon Monday. Upfront pricing, no surprise fees.",
                author: "Karen Whitfield",
                role: "Homeowner, Clintonville",
                avatar: "",
              },
              {
                quote:
                  "Tyrell rewired our 1950s panel and explained every step. First contractor who didn't make us feel like a nuisance for asking questions.",
                author: "Marcus Dillard",
                role: "Homeowner, Dublin",
                avatar: "",
              },
              {
                quote:
                  "Furnace went out during the first cold snap of the year. Maria diagnosed it in ten minutes and had parts on the truck. Heat was back by dinner.",
                author: "Priya Anand",
                role: "Homeowner, Westerville",
                avatar: "",
              },
              {
                quote:
                  "Called about a slow drain, they found a bigger issue with a camera inspection before it became a real problem. Saved us a repiping bill.",
                author: "Jonathan Reyes",
                role: "Homeowner, Grove City",
                avatar: "",
              },
            ],
          },
        },
        {
          id: "reviews-stats",
          type: "stats-band",
          props: {
            heading: "The numbers behind the reviews.",
            stats: [
              { value: "4.9/5", label: "Average rating" },
              { value: "2,400+", label: "Jobs completed" },
              { value: "98%", label: "Would recommend us" },
              { value: "15+", label: "Years in business" },
            ],
          },
        },
        {
          id: "reviews-cta",
          type: "cta",
          props: {
            heading: "See why Columbus calls Ironclad first.",
            body: "Join thousands of homeowners who trust us with their plumbing, HVAC, and electrical work.",
            button_label: "Request Service",
            button_href: "/contact",
            variant: "primary",
          },
        },
        {
          id: "reviews-footer",
          type: "rich-footer",
          props: {
            brand_name: "Ironclad Home Services",
            tagline: "Licensed plumbing, HVAC & electrical contractors serving Columbus, Ohio since 2009.",
            columns: [
              {
                heading: "Services",
                links: [
                  { label: "Plumbing", href: "/services" },
                  { label: "HVAC", href: "/services" },
                  { label: "Electrical", href: "/services" },
                ],
              },
              {
                heading: "Company",
                links: [
                  { label: "Service Area", href: "/service-area" },
                  { label: "Reviews", href: "/reviews" },
                  { label: "Contact", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "facebook", href: "https://facebook.com/ironcladhomeservices" },
              { platform: "instagram", href: "https://instagram.com/ironcladhomeservices" },
            ],
            hours: "Mon-Fri 7am-8pm · Sat 8am-6pm · Sun Emergency Dispatch Only",
            small_print: "Ohio Lic. #OH-48219 · Bonded & Insured · © 2026 Ironclad Home Services.",
          },
        },
      ],
    },
    // ---------------------------------------------------------------
    // CONTACT — crm-form + hours.
    // ---------------------------------------------------------------
    {
      slug: "contact",
      title: "Contact",
      sort_order: 4,
      seo: {
        title: "Contact | Ironclad Home Services Columbus",
        description:
          "Request plumbing, HVAC, or electrical service from Ironclad Home Services in Columbus, Ohio. Call (614) 555-0142 or send your job details online.",
      },
      blocks: [
        {
          id: "contact-nav",
          type: "nav-bar",
          props: {
            brand_name: "Ironclad Home Services",
            links: [
              { label: "Home", href: "/" },
              { label: "Services", href: "/services" },
              { label: "Service Area", href: "/service-area" },
              { label: "Reviews", href: "/reviews" },
              { label: "Contact", href: "/contact" },
            ],
            cta_label: "Call Now",
            cta_href: "tel:+16145550142",
            variant: "cta",
          },
        },
        {
          id: "contact-hero",
          type: "hero",
          props: {
            eyebrow: "Get In Touch",
            title: "Tell us what's broken. We'll send the right tech.",
            subtitle: "Same-day scheduling is available for most plumbing, HVAC, and electrical calls.",
            cta_label: "Call (614) 555-0142",
            cta_href: "tel:+16145550142",
            align: "left",
          },
        },
        {
          id: "contact-phone",
          type: "phone_number",
          props: {
            number: "+16145550142",
            display: "(614) 555-0142 — Office & Emergency Line",
          },
        },
        {
          id: "contact-form",
          type: "crm_form",
          props: {
            embed_code: "<form action=\"/api/leads\" method=\"post\" class=\"ironclad-contact-form\"><label>Name<input type=\"text\" name=\"name\" required></label><label>Phone<input type=\"tel\" name=\"phone\" required></label><label>Address<input type=\"text\" name=\"address\" required></label><label>What's going on?<textarea name=\"details\" rows=\"4\" required></textarea></label><button type=\"submit\">Request Service</button></form>",
            label: "Request Service Form",
          },
        },
        {
          id: "contact-hours",
          type: "rich-text",
          props: {
            html: "<h2>Hours &amp; Location</h2><p><strong>Office hours:</strong> Mon-Fri 7:00 AM - 8:00 PM, Sat 8:00 AM - 6:00 PM, Sun Emergency Dispatch Only.<br><strong>Emergency line:</strong> answered 24/7, every day of the year.<br><strong>Shop address:</strong> 4820 Groveport Pike, Columbus, OH 43207.</p>",
            max_width: "medium",
          },
        },
        {
          id: "contact-footer",
          type: "rich-footer",
          props: {
            brand_name: "Ironclad Home Services",
            tagline: "Licensed plumbing, HVAC & electrical contractors serving Columbus, Ohio since 2009.",
            columns: [
              {
                heading: "Services",
                links: [
                  { label: "Plumbing", href: "/services" },
                  { label: "HVAC", href: "/services" },
                  { label: "Electrical", href: "/services" },
                ],
              },
              {
                heading: "Company",
                links: [
                  { label: "Service Area", href: "/service-area" },
                  { label: "Reviews", href: "/reviews" },
                  { label: "Contact", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "facebook", href: "https://facebook.com/ironcladhomeservices" },
              { platform: "instagram", href: "https://instagram.com/ironcladhomeservices" },
            ],
            hours: "Mon-Fri 7am-8pm · Sat 8am-6pm · Sun Emergency Dispatch Only",
            small_print: "Ohio Lic. #OH-48219 · Bonded & Insured · © 2026 Ironclad Home Services.",
          },
        },
      ],
    },
  ],
};

export default homeServices;
