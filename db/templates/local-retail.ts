import type { TemplateSeed } from "./types.js";

/**
 * Local Retail template (Task C-series, slug `local-retail`, per-file
 * template authoring — see `.superpowers/sdd/2026-07-30-lovable-workspace/
 * template-authoring-guide.md`).
 *
 * Design reference: a warm indie-retail layout in the spirit of Tailwind
 * UI's free marketing sections — a photo-forward storefront hero, a
 * browsable feature-grid standing in for shelf departments, and a
 * split-image "teaser" band pointing deeper into the site — recomposed
 * without any cart/checkout chrome, since this is a visit-us site for a
 * brick-and-mortar shop, not e-commerce.
 *
 * Fictional business: Rowhouse Records, an independent vinyl and turntable
 * shop at 1416 Light Street in Federal Hill, Baltimore, MD 21230 — (410)
 * 555-0187. Owner-run by Nora Petrakis since 2014, in a converted rowhouse
 * storefront three blocks up from the harbor.
 *
 * Brand tokens: a cozy forest/mustard indie-retail palette — deep forest
 * green (`--theme-main`) for chrome and trust, warm mustard (`--theme-
 * accent`) for calls to action, and a warm cream surface (`--theme-
 * surface`) instead of stark white. All four on-color pairs verified at
 * ≥4.5:1 contrast (main/on-main 5.72:1, accent/on-accent 4.95:1 using dark
 * espresso text on mustard rather than white, surface/on-surface 14.8:1).
 */
const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Shop", href: "/shop-info" },
  { label: "Events", href: "/events" },
  { label: "Visit", href: "/visit" },
];

const FOOTER_COLUMNS = [
  {
    heading: "Explore",
    links: [
      { label: "Shop", href: "/shop-info" },
      { label: "Events", href: "/events" },
    ],
  },
  {
    heading: "Visit",
    links: [
      { label: "Hours & Location", href: "/visit" },
      { label: "Special Orders", href: "/visit" },
    ],
  },
];

const SOCIAL_LINKS = [
  { platform: "instagram" as const, href: "#" },
  { platform: "facebook" as const, href: "#" },
];

const HOURS = "Tue–Sat 11am–7pm · Sun 12–5pm · Closed Mon";

function footer(id: string) {
  return {
    id,
    type: "rich-footer",
    props: {
      brand_name: "Rowhouse Records",
      tagline: "Vinyl, turntables, and Federal Hill's best dollar crates.",
      columns: FOOTER_COLUMNS,
      social_links: SOCIAL_LINKS,
      hours: HOURS,
      small_print: "© {year} Rowhouse Records. All rights reserved.",
    },
  };
}

function nav(id: string) {
  return {
    id,
    type: "nav-bar",
    props: {
      brand_name: "Rowhouse Records",
      logo_asset_id: "",
      links: NAV_LINKS,
      cta_label: "Plan Your Visit",
      cta_href: "/visit",
      variant: "cta",
    },
  };
}

export const localRetail: TemplateSeed = {
  slug: "local-retail",
  name: "Local Retail",
  description: "An indie brick-and-mortar shop site — storefront hero, browsable departments, recurring in-store events, and a visit-us page with special orders.",
  brand_tokens: {
    "--theme-main": "#3f6b47",
    "--theme-on-main": "#fbf6ea",
    "--theme-accent": "#b9862f",
    "--theme-on-accent": "#2a2015",
    "--theme-surface": "#fbf6ea",
    "--theme-on-surface": "#2a2015",
  },
  category: "Retail",
  sort_order: 90,
  cover: {
    stock_query: "vinyl record shop",
    alt: "A cozy independent record shop storefront with crates of vinyl and warm string lights",
  },
  pages: [
    {
      slug: "home",
      title: "Home",
      sort_order: 0,
      seo: {
        title: "Rowhouse Records | Vinyl Shop in Federal Hill, Baltimore",
        description:
          "Rowhouse Records is an independent vinyl shop in Federal Hill, Baltimore, stocking new and used records, turntables, hi-fi gear, and weekly listening events.",
      },
      blocks: [
        nav("home-nav"),
        {
          id: "home-hero",
          type: "hero",
          props: {
            eyebrow: "Federal Hill, Baltimore",
            title: "A rowhouse full of records, and a turntable spinning something new.",
            subtitle:
              "Nora Petrakis has run Rowhouse Records out of a converted Light Street storefront since 2014 — new and used vinyl, turntables, and a dollar crate worth digging through.",
            cta_label: "Get Directions",
            cta_href: "/visit",
            align: "center",
          },
        },
        {
          id: "home-what-we-carry",
          type: "feature-grid",
          props: {
            eyebrow: "What We Carry",
            heading: "Shelves worth losing an afternoon to",
            items: [
              {
                icon: "💿",
                title: "New & Used Vinyl",
                body: "Soul, funk, go-go, jazz, hip-hop, and indie rock — plus a deep Baltimore-artist section and a growing wall of 180-gram audiophile reissues, sorted by genre and re-stocked every week.",
              },
              {
                icon: "🎧",
                title: "Turntables & Hi-Fi",
                body: "From the entry-level Aldergrove SP-2 belt-drive to the direct-drive Aldergrove Mark III, plus needles, cleaning kits, and bookshelf speakers — with free setup help at the counter.",
              },
              {
                icon: "🗃️",
                title: "Dollar Crates",
                body: "Four crates out front, always a dollar, restocked from every trade-in that comes through the door.",
              },
              {
                icon: "📝",
                title: "Special Orders",
                body: "Can't find it on the shelf? We'll track down out-of-print pressings, import editions, and Harborlight Reissues represses through our distributor network.",
              },
            ],
          },
        },
        {
          id: "home-events-teaser",
          type: "split-hero",
          props: {
            eyebrow: "Community",
            heading: "Something's always spinning here",
            body:
              "Vinyl Wednesdays, First Friday listening parties, and Saturday crate-digs turn the shop into a living room for Federal Hill's record collectors. Pull up a milk crate and stay a while.",
            primary_cta_label: "See the Full Calendar",
            primary_cta_href: "/events",
            image_asset_id: "",
            image_alt: "Neighbors browsing crates of records during a First Friday listening party at Rowhouse Records",
            variant: "image-left",
          },
        },
        {
          id: "home-regulars",
          type: "testimonial-carousel",
          props: {
            heading: "What the regulars say",
            autoplay: true,
            interval_ms: 6000,
            items: [
              {
                quote:
                  "I came in for a birthday gift and left with four records and a new turntable. Nora talked me out of the cheap one and I'm glad she did.",
                author: "Odalys Ferro",
                role: "Regular since 2019",
                avatar: "",
              },
              {
                quote:
                  "The Saturday crate digs are the best dollar I spend all week. I've built half my funk collection out of that bin.",
                author: "Trevor Nakashima",
                role: "Vinyl Wednesdays regular",
                avatar: "",
              },
              {
                quote:
                  "They tracked down an out-of-print pressing I'd been hunting for two years. Three weeks and it was in my hands.",
                author: "Yolanda Pruitt",
                role: "Special-order customer",
                avatar: "",
              },
            ],
          },
        },
        {
          id: "home-cta",
          type: "cta",
          props: {
            heading: "Come flip through the crates",
            body: "We're three blocks up from the harbor, open six days a week.",
            button_label: "Plan Your Visit",
            button_href: "/visit",
            variant: "primary",
          },
        },
        footer("home-footer"),
      ],
    },
    {
      slug: "shop-info",
      title: "Shop",
      sort_order: 1,
      seo: {
        title: "Departments | Rowhouse Records, Baltimore",
        description:
          "Browse Rowhouse Records: genre-sorted new and used vinyl, turntables and hi-fi gear, a trade-in counter, and special orders for out-of-print pressings.",
      },
      blocks: [
        nav("shop-nav"),
        {
          id: "shop-hero",
          type: "hero",
          props: {
            eyebrow: "In the Shop",
            title: "What's on the shelves",
            subtitle: "Genre-sorted vinyl up front, a turntable bar you can actually test drive, and a trade counter that's always buying. Here's what's always on the shelves.",
            cta_label: "Plan Your Visit",
            cta_href: "/visit",
            align: "left",
          },
        },
        {
          id: "shop-departments",
          type: "rich-text",
          props: {
            html:
              "<h2>New &amp; Used Vinyl</h2><p>The front room is sorted by genre — soul, funk, go-go, jazz, hip-hop, indie rock, folk, and a standing Baltimore-artist section we keep stocked from local releases and estate collections. New pressings and 180-gram audiophile reissues sit up front; used stock (graded honestly, every sleeve played before it's priced) fills the back bins.</p><h2>Turntables &amp; Hi-Fi</h2><p>We carry a small, carefully chosen line of turntables — the entry-level Aldergrove SP-2 belt-drive up through the direct-drive Aldergrove Mark III — along with replacement needles, cleaning brushes and fluid, and a rack of bookshelf speakers. Bring in your table and we'll help you dial it in at no charge.</p><h2>Trade-In &amp; Buy Counter</h2><p>Bring a crate, leave with cash or store credit. We buy individual records and whole collections — just drop by during shop hours, no appointment needed.</p><h2>Special Orders</h2><p>If it's out of print or hard to find, ask at the counter or use the form on our Visit page. We work with a distributor network — including Harborlight Reissues — that can usually track down a pressing within a couple of weeks.</p>",
            max_width: "medium",
          },
        },
        {
          id: "shop-by-the-numbers",
          type: "stats-band",
          props: {
            heading: "Rowhouse Records, by the numbers",
            stats: [
              { value: "12 yrs", label: "In Federal Hill" },
              { value: "8,000+", label: "Records in stock" },
              { value: "4", label: "Dollar crates, always full" },
            ],
          },
        },
        {
          id: "shop-cta",
          type: "cta",
          props: {
            heading: "Looking for something specific?",
            body: "Ask at the counter, or send us a special order request.",
            button_label: "Request a Special Order",
            button_href: "/visit",
            variant: "muted",
          },
        },
        footer("shop-footer"),
      ],
    },
    {
      slug: "events",
      title: "Events",
      sort_order: 2,
      seo: {
        title: "Events | Rowhouse Records, Federal Hill",
        description:
          "See what is happening at Rowhouse Records: weekly Vinyl Wednesdays, monthly First Friday listening parties, Saturday crate-digs, and local-artist spotlights.",
      },
      blocks: [
        nav("events-nav"),
        {
          id: "events-announcement",
          type: "announcement-bar",
          props: {
            text: "First Friday Listening Party — first Friday of every month, 7–9pm. Doors open early for dollar-crate diggers.",
            link_label: "Get Directions",
            link_href: "/visit",
          },
        },
        {
          id: "events-hero",
          type: "hero",
          props: {
            eyebrow: "In-Store Events",
            title: "Come hang out, not just shop",
            subtitle: "Every week has something going on at Rowhouse — here's the regular lineup.",
            align: "left",
          },
        },
        {
          id: "events-recurring",
          type: "rich-text",
          props: {
            html:
              "<h2>Vinyl Wednesdays</h2><p>Every Wednesday, 5–7pm. The week's new arrivals get their first spin on the shop turntable, staff picks included. Come early for first crack at anything rare.</p><h2>First Friday Listening Party</h2><p>First Friday of the month, 7–9pm. We clear the front room, pour some cider, and spin full albums start to finish — a different genre theme every month, picked by a different staffer.</p><h2>Crate Dig Saturdays</h2><p>Every Saturday, 11am–1pm. The dollar crates get a fresh dump from the week's trade-ins before the shop even opens to the rest of the day — regulars know to show up early.</p><h2>Baltimore Local Spotlight</h2><p>Third Thursday of the month, 6–8pm. A short in-store set from a Baltimore-based artist or band, followed by an informal Q&amp;A and a signing at the counter.</p>",
            max_width: "medium",
          },
        },
        {
          id: "events-cta",
          type: "cta",
          props: {
            heading: "Want a reminder before the next one?",
            body: "Follow us or stop by the counter to get added to the events list.",
            button_label: "Get in Touch",
            button_href: "/visit",
            variant: "primary",
          },
        },
        footer("events-footer"),
      ],
    },
    {
      slug: "visit",
      title: "Visit",
      sort_order: 3,
      seo: {
        title: "Visit Us | Rowhouse Records, Baltimore",
        description:
          "Find Rowhouse Records on Light Street in Federal Hill, Baltimore — hours, parking, and transit details, plus a phone line to request a special-order pressing.",
      },
      blocks: [
        nav("visit-nav"),
        {
          id: "visit-hero",
          type: "hero",
          props: {
            eyebrow: "Visit Us",
            title: "Find us on Light Street",
            subtitle: "Three blocks up from the harbor, in a converted rowhouse storefront with a green awning.",
            align: "left",
          },
        },
        {
          id: "visit-details",
          type: "rich-text",
          props: {
            html:
              "<h2>Hours</h2><ul><li>Tuesday – Saturday: 11:00 AM – 7:00 PM</li><li>Sunday: 12:00 – 5:00 PM</li><li>Monday: Closed</li></ul><h2>Location &amp; Parking</h2><p>1416 Light Street, Baltimore, MD 21230 — three blocks north of the Inner Harbor promenade. Street parking is free after 6 PM and all day Sunday; the Cross Street Market garage is a three-minute walk and validates for two hours with any purchase.</p><h2>Transit</h2><p>The CityLink Purple and Route 1 buses both stop at Light &amp; Cross, half a block from the door. The Camden Yards light rail stop is a flat 12-minute walk if you'd rather skip the bus.</p>",
            max_width: "medium",
          },
        },
        {
          id: "visit-faq",
          type: "faq-accordion",
          props: {
            heading: "Parking & Special Orders",
            multiple: false,
            items: [
              {
                question: "Is parking hard to find?",
                answer:
                  "Not usually. Street parking is free after 6 PM and all day Sunday, and the Cross Street Market garage is a three-minute walk with two free hours on any purchase.",
              },
              {
                question: "How long does a special order take?",
                answer:
                  "Most requests come in within a couple of weeks through our distributor network. We'll call or text as soon as it's on the shelf waiting for you.",
              },
              {
                question: "Do I need to pay up front for a special order?",
                answer:
                  "No — we just ask for a deposit on rare or import pressings. Standard reissues and in-print titles don't require anything until you pick them up.",
              },
              {
                question: "Can I request something in person instead of using the form?",
                answer:
                  "Of course. Ask at the counter any time we're open and we'll fill out the request with you on the spot.",
              },
            ],
          },
        },
        {
          id: "visit-phone",
          type: "phone_number",
          props: {
            number: "+14105550187",
            display: "(410) 555-0187",
          },
        },
        {
          id: "visit-special-order",
          type: "crm_form",
          props: {
            embed_code:
              "<form action=\"/api/leads\" method=\"post\" class=\"ac-special-order-form\"><input type=\"hidden\" name=\"_page\" value=\"/visit\"><label style=\"position:absolute;left:-9999px\" aria-hidden=\"true\">Leave this field empty<input type=\"text\" name=\"website\" tabindex=\"-1\" autocomplete=\"off\"></label><label for=\"so-name\">Name</label><input id=\"so-name\" name=\"name\" type=\"text\" required /><label for=\"so-contact\">Email or phone</label><input id=\"so-contact\" name=\"contact\" type=\"text\" required /><label for=\"so-artist\">Artist / title</label><input id=\"so-artist\" name=\"artist_title\" type=\"text\" required /><label for=\"so-format\">Format</label><input id=\"so-format\" name=\"format\" type=\"text\" placeholder=\"LP, 7-inch, box set...\" /><label for=\"so-notes\">Notes</label><textarea id=\"so-notes\" name=\"notes\" rows=\"3\"></textarea><button type=\"submit\">Request This Pressing</button></form>",
            label: "Special Order Request",
          },
        },
        footer("visit-footer"),
      ],
    },
  ],
};
