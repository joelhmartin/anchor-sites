import type { TemplateSeed } from "./types.js";

/**
 * Restaurant template — Task C-restaurant (per-file template library, Task C4).
 *
 * Design reference: HTML5UP's "Editorial" theme — magazine-style hero
 * treatment, generous whitespace, and long-form storytelling blocks —
 * adapted here for a neighborhood bistro's story-first layout (hero →
 * ambiance → signature dishes rather than a dense grid of stock photos).
 *
 * Fictional business: Ember & Rye, a wood-fired neighborhood bistro in
 * downtown Asheville, NC, run by chef-owner Elise Bonnier (Lyon-trained,
 * ex-NYC). Palette is a warm appetite scheme — cream surface, charcoal
 * ink, terracotta main, deep burgundy accent — using the canonical
 * `--theme-main` / `--theme-accent` / `--theme-surface` (+ `-on-` pairs)
 * keys the site-settings color editor exposes (see
 * `src/admin/components/BrandTokenFields.tsx`'s `DEFAULT_BRAND_TOKENS`).
 *
 * Imagery: every `image_asset_id` / `logo_asset_id` field is left as the
 * schema's empty-string default — no asset exists at authoring time; the
 * AI agent imports real photos post-creation (see starter.ts precedent —
 * `cover` is the only image-shaped field this template supplies content for).
 */
export const restaurant: TemplateSeed = {
  slug: "restaurant",
  name: "Restaurant",
  description: "A neighborhood bistro site — story-led hero, signature dishes, a full priced menu, private events, and reservations.",
  brand_tokens: {
    "--theme-main": "#b5502d",
    "--theme-on-main": "#fdf6ec",
    "--theme-accent": "#7a2331",
    "--theme-on-accent": "#fdf6ec",
    "--theme-surface": "#fdf6ec",
    "--theme-on-surface": "#2b211c",
  },
  category: "Restaurant",
  sort_order: 30,
  cover: {
    stock_query: "wood fired bistro",
    alt: "Warm, candlelit dining room in a wood-fired neighborhood bistro with an open hearth",
  },
  pages: [
    {
      slug: "home",
      title: "Home",
      sort_order: 0,
      seo: {
        title: "Ember & Rye | Wood-Fired Bistro in Asheville, NC",
        description:
          "Ember & Rye is a wood-fired neighborhood bistro in downtown Asheville, NC, serving Appalachian ingredients with French technique from chef-owner Elise Bonnier.",
      },
      blocks: [
        {
          id: "home-nav",
          type: "nav-bar",
          props: {
            brand_name: "Ember & Rye",
            logo_asset_id: "",
            links: [
              { label: "Home", href: "/" },
              { label: "Menu", href: "/menu" },
              { label: "About", href: "/about" },
              { label: "Private Events", href: "/private-events" },
              { label: "Visit", href: "/contact" },
            ],
            cta_label: "Reserve a Table",
            cta_href: "/contact",
            variant: "cta",
          },
        },
        {
          id: "home-hero",
          type: "hero",
          props: {
            eyebrow: "Downtown Asheville",
            title: "Wood smoke, candlelight, and a menu built around the harvest.",
            subtitle:
              "Ember & Rye is a neighborhood bistro on Haywood Lane serving Appalachian ingredients over an open hearth, with the technique chef Elise Bonnier learned in Lyon.",
            cta_label: "Reserve a Table",
            cta_href: "/contact",
            align: "center",
          },
        },
        {
          id: "home-ambiance",
          type: "split-hero",
          props: {
            eyebrow: "The Dining Room",
            heading: "Built around the fire",
            body:
              "Reclaimed heart-pine tables, hand-thrown pottery, and an open hearth that runs all night. On warm evenings the old loading-dock doors roll open onto the sidewalk. Ember & Rye feels like your favorite neighbor's kitchen — if your neighbor trained in Lyon.",
            primary_cta_label: "See the Menu",
            primary_cta_href: "/menu",
            secondary_cta_label: "Reserve a Table",
            secondary_cta_href: "/contact",
            image_asset_id: "",
            image_alt: "The warm, candlelit dining room at Ember & Rye with an open hearth",
            variant: "image-right",
          },
        },
        {
          id: "home-dishes",
          type: "feature-grid",
          props: {
            eyebrow: "Signature Dishes",
            heading: "What we're known for",
            items: [
              {
                icon: "🔥",
                title: "Wood-Fired Mountain Trout",
                body: "Line-caught rainbow trout from the French Broad watershed, charred over hickory embers with brown butter, capers, and charred lemon.",
              },
              {
                icon: "🦆",
                title: "Duck Leg Confit",
                body: "Slow-cooked duck leg, crisped to order, with cider-braised red cabbage and a rye-and-mustard jus.",
              },
              {
                icon: "🍝",
                title: "Brown Butter Agnolotti",
                body: "Hand-rolled pasta filled with ricotta and roasted squash, finished in brown butter, sage, and toasted hazelnuts.",
              },
              {
                icon: "🌽",
                title: "Cast-Iron Skillet Cornbread",
                body: "Buttermilk cornbread baked to order in cast iron, served warm with sorghum butter.",
              },
            ],
          },
        },
        {
          id: "home-cta",
          type: "cta",
          props: {
            heading: "Save your table by the fire",
            body: "Friday and Saturday fill up fast — reserve online or call us at (828) 555-0142.",
            button_label: "Reserve a Table",
            button_href: "/contact",
            variant: "primary",
          },
        },
        {
          id: "home-footer",
          type: "rich-footer",
          props: {
            brand_name: "Ember & Rye",
            tagline: "Wood-fired, Appalachian at heart.",
            columns: [
              {
                heading: "Explore",
                links: [
                  { label: "Menu", href: "/menu" },
                  { label: "About", href: "/about" },
                  { label: "Private Events", href: "/private-events" },
                ],
              },
              {
                heading: "Visit",
                links: [
                  { label: "Hours & Location", href: "/contact" },
                  { label: "Reservations", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "instagram", href: "#" },
              { platform: "facebook", href: "#" },
            ],
            hours: "Tue–Thu 5–9pm · Fri–Sat 5–10pm · Sun brunch 10am–2pm · Closed Mon",
            small_print: "© {year} Ember & Rye. All rights reserved.",
          },
        },
      ],
    },
    {
      slug: "menu",
      title: "Menu",
      sort_order: 1,
      seo: {
        title: "Menu | Ember & Rye Asheville",
        description:
          "See the wood-fired mains, handmade pasta, and hearth-baked sides on Ember & Rye's seasonal Asheville menu, plus cocktails built around rye whiskey and sorghum.",
      },
      blocks: [
        {
          id: "menu-nav",
          type: "nav-bar",
          props: {
            brand_name: "Ember & Rye",
            logo_asset_id: "",
            links: [
              { label: "Home", href: "/" },
              { label: "Menu", href: "/menu" },
              { label: "About", href: "/about" },
              { label: "Private Events", href: "/private-events" },
              { label: "Visit", href: "/contact" },
            ],
            cta_label: "Reserve a Table",
            cta_href: "/contact",
            variant: "cta",
          },
        },
        {
          id: "menu-hero",
          type: "hero",
          props: {
            eyebrow: "Dinner, Nightly",
            title: "The Menu",
            subtitle: "Seasonal, wood-fired, and built around what came off the truck this morning. Prices and dishes change with the harvest.",
            cta_label: "Reserve a Table",
            cta_href: "/contact",
            align: "left",
          },
        },
        {
          id: "menu-starters-sides",
          type: "rich-text",
          props: {
            html:
              "<h2>Starters</h2><ul><li><strong>Wood-Fired Oysters</strong> — charred with brown butter and hot sauce mignonette — $18</li><li><strong>Charred Carrot Soup</strong> — brown butter, toasted benne, sorghum — $11</li><li><strong>House Pimento Cheese</strong> — benne cracker, pickled okra — $10</li><li><strong>Smoked Trout Dip</strong> — rye crackers, watercress, preserved lemon — $14</li></ul><h2>Sides</h2><ul><li><strong>Cast-Iron Cornbread</strong> — sorghum butter — $7</li><li><strong>Charred Broccoli</strong> — chili vinegar, pecorino — $9</li><li><strong>Buttermilk Mashed Potatoes</strong> — brown butter, chives — $8</li></ul>",
            max_width: "medium",
          },
        },
        {
          id: "menu-mains-pasta",
          type: "rich-text",
          props: {
            html:
              "<h2>Wood-Fired Mains</h2><ul><li><strong>Wood-Fired Mountain Trout</strong> — brown butter, capers, charred lemon — $29</li><li><strong>Duck Leg Confit</strong> — cider-braised cabbage, rye mustard jus — $27</li><li><strong>Dry-Aged Ribeye (14 oz)</strong> — bone marrow butter, charred onion — $46</li><li><strong>Half Roasted Chicken</strong> — pan drippings, herb jus, market vegetable — $26</li></ul><h2>Handmade Pasta</h2><ul><li><strong>Brown Butter Agnolotti</strong> — roasted squash, sage, hazelnut — $24</li><li><strong>Rye Cavatelli</strong> — braised lamb ragu, pecorino — $25</li></ul>",
            max_width: "medium",
          },
        },
        {
          id: "menu-guest-note",
          type: "rich-text",
          props: {
            html:
              "<blockquote><p>“Order the agnolotti before you talk yourself into the ribeye. Then order the ribeye anyway.”</p><cite>— a guest, mid-argument with their dinner companion</cite></blockquote>",
            max_width: "medium",
          },
        },
        {
          id: "menu-desserts-drinks",
          type: "rich-text",
          props: {
            html:
              "<h2>Desserts</h2><ul><li><strong>Chocolate Chess Pie</strong> — bourbon whipped cream — $9</li><li><strong>Buttermilk Panna Cotta</strong> — macerated berries — $9</li></ul><h2>Wine &amp; Cocktails</h2><ul><li><strong>Ember Old Fashioned</strong> — rye whiskey, sorghum, smoked orange — $14</li><li><strong>Hearth Spritz</strong> — aperitivo, prosecco, charred grapefruit — $13</li><li><strong>By-the-glass wine list</strong> — rotating, ask your server — $12–$18</li></ul>",
            max_width: "medium",
          },
        },
        {
          id: "menu-cta",
          type: "cta",
          props: {
            heading: "Hungry yet?",
            body: "Reserve a table and taste it for yourself.",
            button_label: "Make a Reservation",
            button_href: "/contact",
            variant: "primary",
          },
        },
        {
          id: "menu-footer",
          type: "rich-footer",
          props: {
            brand_name: "Ember & Rye",
            tagline: "Wood-fired, Appalachian at heart.",
            columns: [
              {
                heading: "Explore",
                links: [
                  { label: "Menu", href: "/menu" },
                  { label: "About", href: "/about" },
                  { label: "Private Events", href: "/private-events" },
                ],
              },
              {
                heading: "Visit",
                links: [
                  { label: "Hours & Location", href: "/contact" },
                  { label: "Reservations", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "instagram", href: "#" },
              { platform: "facebook", href: "#" },
            ],
            hours: "Tue–Thu 5–9pm · Fri–Sat 5–10pm · Sun brunch 10am–2pm · Closed Mon",
            small_print: "© {year} Ember & Rye. All rights reserved.",
          },
        },
      ],
    },
    {
      slug: "about",
      title: "About",
      sort_order: 2,
      seo: {
        title: "Our Story | Ember & Rye",
        description:
          "Meet chef Elise Bonnier and learn how Ember & Rye's wood-fired kitchen came to life in a converted Haywood Lane hardware store in downtown Asheville, NC.",
      },
      blocks: [
        {
          id: "about-nav",
          type: "nav-bar",
          props: {
            brand_name: "Ember & Rye",
            logo_asset_id: "",
            links: [
              { label: "Home", href: "/" },
              { label: "Menu", href: "/menu" },
              { label: "About", href: "/about" },
              { label: "Private Events", href: "/private-events" },
              { label: "Visit", href: "/contact" },
            ],
            cta_label: "Reserve a Table",
            cta_href: "/contact",
            variant: "cta",
          },
        },
        {
          id: "about-hero",
          type: "hero",
          props: {
            eyebrow: "Our Story",
            title: "A wood fire, a short list, and a table worth arguing over.",
            subtitle: "How a converted hardware store on Haywood Lane became Asheville's neighborhood bistro.",
            align: "left",
          },
        },
        {
          id: "about-story",
          type: "rich-text",
          props: {
            html:
              "<h2>How Ember &amp; Rye began</h2><p>Ember &amp; Rye opened in the fall of 2019 in a converted hardware store on Haywood Lane, three blocks off the square in downtown Asheville. The building still has its tin ceiling and its loading-dock doors, which now roll open on warm nights to let the smoke from the hearth drift out over the sidewalk tables.</p><p>The idea was simple: cook Appalachian ingredients — trout from the French Broad, sorghum from a farm outside Marshall, heritage pork from three counties over — with the technique chef Elise Bonnier learned in Lyon. No pretense, no tasting-menu theatrics, just a wood fire, a short list of things worth doing well, and a dining room that feels like someone's kitchen table.</p><p>Years on, the fire's still going every night we're open.</p>",
            max_width: "medium",
          },
        },
        {
          id: "about-pull-quotes",
          type: "rich-text",
          props: {
            html:
              "<blockquote><p>“You forget you're three blocks from Pack Square. It feels like someone invited you into their kitchen.”</p><cite>— overheard at the bar, first Friday of the month</cite></blockquote>" +
              "<blockquote><p>“I've had the trout four times this year. I'm not sorry.”</p><cite>— a regular, seated at the counter</cite></blockquote>",
            max_width: "medium",
          },
        },
        {
          id: "about-chef",
          type: "split-hero",
          props: {
            eyebrow: "Meet the Chef",
            heading: "Chef Elise Bonnier",
            body:
              "Trained in Lyon and seasoned in New York City kitchens, Elise Bonnier opened Ember & Rye in 2019 to cook the way she eats at home: something live-fired, something pickled, something worth arguing about with the table. Two James Beard semifinalist nods later, she still runs the pass six nights a week.",
            primary_cta_label: "View the Menu",
            primary_cta_href: "/menu",
            image_asset_id: "",
            image_alt: "Chef Elise Bonnier working the hearth at Ember & Rye",
            variant: "image-left",
          },
        },
        {
          id: "about-cta",
          type: "cta",
          props: {
            heading: "Come sit at our table",
            body: "We'd love to cook for you.",
            button_label: "Reserve Now",
            button_href: "/contact",
            variant: "muted",
          },
        },
        {
          id: "about-footer",
          type: "rich-footer",
          props: {
            brand_name: "Ember & Rye",
            tagline: "Wood-fired, Appalachian at heart.",
            columns: [
              {
                heading: "Explore",
                links: [
                  { label: "Menu", href: "/menu" },
                  { label: "About", href: "/about" },
                  { label: "Private Events", href: "/private-events" },
                ],
              },
              {
                heading: "Visit",
                links: [
                  { label: "Hours & Location", href: "/contact" },
                  { label: "Reservations", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "instagram", href: "#" },
              { platform: "facebook", href: "#" },
            ],
            hours: "Tue–Thu 5–9pm · Fri–Sat 5–10pm · Sun brunch 10am–2pm · Closed Mon",
            small_print: "© {year} Ember & Rye. All rights reserved.",
          },
        },
      ],
    },
    {
      slug: "private-events",
      title: "Private Events",
      sort_order: 3,
      seo: {
        title: "Private Events | Ember & Rye",
        description:
          "Host a rehearsal dinner, chef's table tasting, or full restaurant buyout at Ember & Rye — Asheville's wood-fired bistro with a private hearth room.",
      },
      blocks: [
        {
          id: "events-nav",
          type: "nav-bar",
          props: {
            brand_name: "Ember & Rye",
            logo_asset_id: "",
            links: [
              { label: "Home", href: "/" },
              { label: "Menu", href: "/menu" },
              { label: "About", href: "/about" },
              { label: "Private Events", href: "/private-events" },
              { label: "Visit", href: "/contact" },
            ],
            cta_label: "Reserve a Table",
            cta_href: "/contact",
            variant: "cta",
          },
        },
        {
          id: "events-hero",
          type: "split-hero",
          props: {
            eyebrow: "Private Events",
            heading: "Host something unforgettable at Ember & Rye",
            body:
              "From an intimate chef's table to a full restaurant buyout, our private events team builds the night around your table — wood-fired, family-style, and entirely yours.",
            primary_cta_label: "Inquire About Your Event",
            primary_cta_href: "/contact",
            image_asset_id: "",
            image_alt: "The Hearth Room, Ember & Rye's private dining room, set for a small event",
            variant: "image-left",
          },
        },
        {
          id: "events-options",
          type: "feature-grid",
          props: {
            eyebrow: "Ways to Book",
            heading: "Find your fit",
            items: [
              {
                icon: "🍽️",
                title: "The Hearth Room",
                body: "Our 16-seat private dining room, warmed by the open hearth, for rehearsal dinners, birthdays, and small celebrations.",
              },
              {
                icon: "🔪",
                title: "Chef's Table",
                body: "Six seats at the pass for a multi-course tasting menu paced by Chef Bonnier herself, with wine pairings included.",
              },
              {
                icon: "🥂",
                title: "Full Restaurant Buyout",
                body: "Reserve the entire dining room for up to 60 guests — weddings, corporate dinners, and holiday parties.",
              },
              {
                icon: "📋",
                title: "Custom Menus",
                body: "Every private event gets a menu built around the season, your guest count, and any dietary needs.",
              },
            ],
          },
        },
        {
          id: "events-cta",
          type: "cta",
          props: {
            heading: "Plan your event",
            body: "Tell us your date, your guest count, and what you're celebrating — we'll build the rest.",
            button_label: "Inquire About Private Events",
            button_href: "/contact",
            variant: "primary",
          },
        },
        {
          id: "events-footer",
          type: "rich-footer",
          props: {
            brand_name: "Ember & Rye",
            tagline: "Wood-fired, Appalachian at heart.",
            columns: [
              {
                heading: "Explore",
                links: [
                  { label: "Menu", href: "/menu" },
                  { label: "About", href: "/about" },
                  { label: "Private Events", href: "/private-events" },
                ],
              },
              {
                heading: "Visit",
                links: [
                  { label: "Hours & Location", href: "/contact" },
                  { label: "Reservations", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "instagram", href: "#" },
              { platform: "facebook", href: "#" },
            ],
            hours: "Tue–Thu 5–9pm · Fri–Sat 5–10pm · Sun brunch 10am–2pm · Closed Mon",
            small_print: "© {year} Ember & Rye. All rights reserved.",
          },
        },
      ],
    },
    {
      slug: "contact",
      title: "Visit Us",
      sort_order: 4,
      seo: {
        title: "Visit Us | Ember & Rye Asheville",
        description:
          "Find Ember & Rye's hours and location on Haywood Lane in downtown Asheville, plus a direct line and online form to reserve your next wood-fired dinner.",
      },
      blocks: [
        {
          id: "contact-nav",
          type: "nav-bar",
          props: {
            brand_name: "Ember & Rye",
            logo_asset_id: "",
            links: [
              { label: "Home", href: "/" },
              { label: "Menu", href: "/menu" },
              { label: "About", href: "/about" },
              { label: "Private Events", href: "/private-events" },
              { label: "Visit", href: "/contact" },
            ],
            cta_label: "Reserve a Table",
            cta_href: "/contact",
            variant: "cta",
          },
        },
        {
          id: "contact-hero",
          type: "hero",
          props: {
            eyebrow: "Visit Us",
            title: "Find us on Haywood Lane",
            subtitle: "Three blocks off Pack Square, next to the old freight depot. Come hungry.",
            align: "left",
          },
        },
        {
          id: "contact-info",
          type: "rich-text",
          props: {
            html:
              "<h2>Hours</h2><ul><li>Tuesday – Thursday: 5:00 – 9:00 PM</li><li>Friday – Saturday: 5:00 – 10:00 PM</li><li>Sunday: Brunch, 10:00 AM – 2:00 PM</li><li>Monday: Closed</li></ul><h2>Location</h2><p>118 Haywood Lane, Asheville, NC 28801 — three blocks off Pack Square, next to the old freight depot. Street parking is free after 6 PM; the Rankin Ave. garage is a two-minute walk.</p><h2>Reservations</h2><p>We hold half the dining room for walk-ins every night, but for parties of two or more we recommend booking ahead — especially Friday and Saturday. Use the form below or call us directly.</p>",
            max_width: "medium",
          },
        },
        {
          id: "contact-phone",
          type: "phone_number",
          props: {
            number: "+18285550142",
            display: "(828) 555-0142",
          },
        },
        {
          id: "contact-reservations",
          type: "crm_form",
          props: {
            embed_code:
              "<form action=\"/api/leads\" method=\"post\" class=\"ac-reservation-form\"><input type=\"hidden\" name=\"_page\" value=\"/contact\"><label style=\"position:absolute;left:-9999px\" aria-hidden=\"true\">Leave this field empty<input type=\"text\" name=\"website\" tabindex=\"-1\" autocomplete=\"off\"></label><label for=\"res-name\">Name</label><input id=\"res-name\" name=\"name\" type=\"text\" required /><label for=\"res-date\">Date</label><input id=\"res-date\" name=\"date\" type=\"date\" required /><label for=\"res-party\">Party size</label><input id=\"res-party\" name=\"party_size\" type=\"number\" min=\"1\" max=\"20\" required /><label for=\"res-phone\">Phone</label><input id=\"res-phone\" name=\"phone\" type=\"tel\" required /><button type=\"submit\">Request a Table</button></form>",
            label: "Reservation Request",
          },
        },
        {
          id: "contact-footer",
          type: "rich-footer",
          props: {
            brand_name: "Ember & Rye",
            tagline: "Wood-fired, Appalachian at heart.",
            columns: [
              {
                heading: "Explore",
                links: [
                  { label: "Menu", href: "/menu" },
                  { label: "About", href: "/about" },
                  { label: "Private Events", href: "/private-events" },
                ],
              },
              {
                heading: "Visit",
                links: [
                  { label: "Hours & Location", href: "/contact" },
                  { label: "Reservations", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "instagram", href: "#" },
              { platform: "facebook", href: "#" },
            ],
            hours: "Tue–Thu 5–9pm · Fri–Sat 5–10pm · Sun brunch 10am–2pm · Closed Mon",
            small_print: "© {year} Ember & Rye. All rights reserved.",
          },
        },
      ],
    },
  ],
};
