import type { TemplateSeed } from "./types.js";

/**
 * Fitness / boutique-studio template (Task C-series, per-file template
 * authoring — see `.superpowers/sdd/2026-07-30-lovable-workspace/
 * template-authoring-guide.md`).
 *
 * Design reference: HTML5UP's "Solid State" (bold, dark, high-contrast
 * geometric blocks) reworked toward modern boutique-fitness marketing —
 * the dark-studio-with-neon-accent look used by brands like F45 / Barry's
 * Bootcamp: near-black hero/footer bands, an electric-coral accent band for
 * stats + CTAs, and a slightly-lifted dark surface for content sections.
 *
 * Fictional business: Pulse Fitness Studio, a boutique strength/cardio/yoga
 * studio at 2020 Larimer Street, Denver, CO 80205 — (303) 555-0148.
 */

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Classes", href: "/classes" },
  { label: "Trainers", href: "/trainers" },
  { label: "Pricing", href: "/pricing" },
  { label: "Contact", href: "/contact" },
];

function navBar(id: string) {
  return {
    id,
    type: "nav-bar",
    props: {
      brand_name: "Pulse Fitness Studio",
      logo_asset_id: "",
      links: NAV_LINKS,
      cta_label: "Book a Free Class",
      cta_href: "/contact",
      variant: "cta" as const,
    },
  };
}

function richFooter(id: string) {
  return {
    id,
    type: "rich-footer",
    props: {
      brand_name: "Pulse Fitness Studio",
      tagline: "Denver's boutique home for strength, cycle, and yoga.",
      columns: [
        {
          heading: "Studio",
          links: [
            { label: "Classes", href: "/classes" },
            { label: "Trainers", href: "/trainers" },
            { label: "Pricing", href: "/pricing" },
          ],
        },
        {
          heading: "Connect",
          links: [
            { label: "Contact", href: "/contact" },
            { label: "Home", href: "/" },
          ],
        },
      ],
      social_links: [
        { platform: "instagram" as const, href: "#" },
        { platform: "facebook" as const, href: "#" },
      ],
      hours: "Mon–Fri 5:00am–9:00pm\nSat 7:00am–3:00pm\nSun 8:00am–1:00pm",
      small_print: "© 2026 Pulse Fitness Studio. 2020 Larimer Street, Denver, CO 80205.",
    },
  };
}

export const fitnessStudio: TemplateSeed = {
  slug: "fitness-studio",
  name: "Fitness Studio",
  description: "A bold, high-energy boutique fitness studio template with classes, trainers, and membership pricing.",
  category: "Fitness",
  sort_order: 50,
  brand_tokens: {
    "--theme-main": "#131316",
    "--theme-on-main": "#F7F7FA",
    "--theme-accent": "#FF3D68",
    "--theme-on-accent": "#1A0611",
    "--theme-surface": "#1C1C22",
    "--theme-on-surface": "#F2F2F5",
  },
  cover: { stock_query: "boutique fitness studio", alt: "Instructor leading a high-energy fitness class in a modern studio" },
  pages: [
    {
      slug: "home",
      title: "Home",
      seo: {
        title: "Pulse Fitness Studio | Boutique Gym in Denver, CO",
        description:
          "Pulse Fitness Studio is Denver's boutique gym for HIIT, strength, cycle, and yoga classes. Book your free first class at our RiNo studio today.",
      },
      sort_order: 0,
      blocks: [
        navBar("home-nav"),
        {
          id: "home-hero-slider",
          type: "hero-slider",
          props: {
            slides: [
              {
                eyebrow: "Denver's Home For High-Energy Fitness",
                title: "Train Harder. Feel Electric.",
                subtitle:
                  "Pulse Fitness Studio blends strength, cardio, and yoga into 45-minute classes built to leave you buzzing.",
                image: "",
                image_asset_id: "",
                cta_label: "Claim Your Free Class",
                cta_href: "/contact",
              },
              {
                eyebrow: "40+ Classes Every Week",
                title: "Every Body. Every Goal. Every Day.",
                subtitle:
                  "From sunrise HIIT to midnight cycle, there's a class waiting for you at 2020 Larimer.",
                image: "",
                image_asset_id: "",
                cta_label: "See the Schedule",
                cta_href: "/classes",
              },
              {
                eyebrow: "Coached, Not Just Instructed",
                title: "Real Coaches. Real Results.",
                subtitle:
                  "Our certified trainers design every class to push you further than you'd go alone.",
                image: "",
                image_asset_id: "",
                cta_label: "Meet the Coaches",
                cta_href: "/trainers",
              },
            ],
            autoplay: true,
            interval_ms: 6000,
            align: "center",
          },
        },
        {
          id: "home-classes-grid",
          type: "feature-grid",
          props: {
            eyebrow: "What We Offer",
            heading: "Find Your Class",
            items: [
              {
                icon: "bolt",
                title: "HIIT Ignite",
                body: "45 minutes of max-effort intervals built to torch calories and build explosive power.",
              },
              {
                icon: "heart",
                title: "Power Yoga Flow",
                body: "A heated, strength-based flow that builds mobility, balance, and a calmer mind.",
              },
              {
                icon: "target",
                title: "Strength Lab",
                body: "Barbell-driven programming with coached form cues, four rotating lift days each week.",
              },
              {
                icon: "sparkles",
                title: "Studio Cycle",
                body: "Rhythm-based rides lit in neon, paced by our coaches' curated playlists.",
              },
              {
                icon: "shield",
                title: "Boxing Conditioning",
                body: "Bag work, footwork, and conditioning circuits with zero experience required.",
              },
              {
                icon: "clock",
                title: "Recovery & Mobility",
                body: "Foam rolling, breathwork, and guided stretching to keep you training pain-free.",
              },
            ],
          },
        },
        {
          id: "home-stats-band",
          type: "stats-band",
          props: {
            heading: "Pulse By The Numbers",
            stats: [
              { value: "1,200+", label: "Active members" },
              { value: "40+", label: "Classes every week" },
              { value: "12", label: "Certified coaches" },
              { value: "9", label: "Years in Denver" },
            ],
          },
        },
        {
          id: "home-testimonials",
          type: "testimonial-carousel",
          props: {
            heading: "Real Members. Real Pulse.",
            items: [
              {
                quote:
                  "I've tried every gym in Denver — nothing compares to the energy at Pulse. I actually look forward to 6am.",
                author: "Maria Gonzalez",
                role: "Member since 2019",
                avatar: "",
              },
              {
                quote:
                  "The coaches know my name and my goals. Strength Lab rebuilt my back after an injury other gyms ignored.",
                author: "Devon Whitfield",
                role: "Member since 2021",
                avatar: "",
              },
              {
                quote: "Power Yoga Flow is the only hour of my week where my brain actually stops racing.",
                author: "Renee Castellanos",
                role: "Member since 2022",
                avatar: "",
              },
            ],
            autoplay: true,
            interval_ms: 5000,
          },
        },
        {
          id: "home-cta",
          type: "cta",
          props: {
            heading: "Your First Class Is On Us",
            body: "New to Pulse? Grab a free class this week — no strings, no pressure, just sweat.",
            button_label: "Claim Your Free Class",
            button_href: "/contact",
            variant: "primary",
          },
        },
        richFooter("home-footer"),
      ],
    },
    {
      slug: "classes",
      title: "Classes",
      seo: {
        title: "Class Schedule | Pulse Fitness Studio Denver",
        description:
          "See Pulse Fitness Studio's full weekly class schedule: HIIT, Power Yoga Flow, Strength Lab, Cycle, Boxing Conditioning, and Recovery, all in Denver, CO.",
      },
      sort_order: 1,
      blocks: [
        navBar("classes-nav"),
        {
          id: "classes-hero",
          type: "hero",
          props: {
            eyebrow: "The Schedule",
            title: "40+ Classes, Every Single Week",
            subtitle: "Whatever your goal — strength, sweat, or stillness — there's a class starting soon.",
            cta_label: "Book a Free Class",
            cta_href: "/contact",
            align: "left",
          },
        },
        {
          id: "classes-schedule",
          type: "rich-text",
          props: {
            html:
              "<h2>Weekly Class Schedule</h2><table><thead><tr><th>Time</th><th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Sat</th><th>Sun</th></tr></thead><tbody>" +
              "<tr><td>5:30 AM</td><td>HIIT Ignite</td><td>Strength Lab</td><td>HIIT Ignite</td><td>Strength Lab</td><td>HIIT Ignite</td><td>—</td><td>—</td></tr>" +
              "<tr><td>9:00 AM</td><td>Power Yoga Flow</td><td>Studio Cycle</td><td>Power Yoga Flow</td><td>Studio Cycle</td><td>Power Yoga Flow</td><td>Strength Lab</td><td>Recovery &amp; Mobility</td></tr>" +
              "<tr><td>12:00 PM</td><td>Studio Cycle</td><td>Boxing Conditioning</td><td>Studio Cycle</td><td>Boxing Conditioning</td><td>Studio Cycle</td><td>HIIT Ignite</td><td>—</td></tr>" +
              "<tr><td>5:30 PM</td><td>Strength Lab</td><td>HIIT Ignite</td><td>Strength Lab</td><td>HIIT Ignite</td><td>Boxing Conditioning</td><td>—</td><td>—</td></tr>" +
              "<tr><td>6:45 PM</td><td>Boxing Conditioning</td><td>Power Yoga Flow</td><td>Boxing Conditioning</td><td>Power Yoga Flow</td><td>Studio Cycle</td><td>—</td><td>—</td></tr>" +
              "</tbody></table><p>New classes drop every Sunday at 6pm — book up to 7 days ahead through the front desk or by calling (303) 555-0148.</p>",
            max_width: "wide",
          },
        },
        {
          id: "classes-descriptions",
          type: "rich-text",
          props: {
            html:
              "<h2>Class Descriptions</h2>" +
              "<h3>HIIT Ignite</h3><p>45 minutes of max-effort interval work — think sled pushes, kettlebells, and sprints — designed to torch calories and build explosive power. Scalable for every fitness level.</p>" +
              "<h3>Power Yoga Flow</h3><p>A heated, strength-focused vinyasa flow that builds mobility, balance, and mental clarity. No prior yoga experience needed.</p>" +
              "<h3>Strength Lab</h3><p>Barbell-driven programming with coached form cues. Four rotating lift days a week keep your body guessing and your numbers climbing.</p>" +
              "<h3>Studio Cycle</h3><p>Rhythm-based rides lit in neon, paced by our coaches' curated playlists. Low-impact, high-output, zero experience required.</p>" +
              "<h3>Boxing Conditioning</h3><p>Bag work, footwork drills, and conditioning circuits taught by a real boxing coach — no sparring, all sweat.</p>" +
              "<h3>Recovery &amp; Mobility</h3><p>Foam rolling, guided stretching, and breathwork to keep you training pain-free week after week.</p>",
            max_width: "medium",
          },
        },
        {
          id: "classes-cta",
          type: "cta",
          props: {
            heading: "Not Sure Where To Start?",
            body: "Book a free class and our coaches will point you to the right fit.",
            button_label: "Book Your Free Class",
            button_href: "/contact",
            variant: "muted",
          },
        },
        richFooter("classes-footer"),
      ],
    },
    {
      slug: "trainers",
      title: "Trainers",
      seo: {
        title: "Meet Our Coaches | Pulse Fitness Studio",
        description:
          "Meet the certified coaches behind Pulse Fitness Studio in Denver, real trainers who know your name, your goals, and how to get you there safely.",
      },
      sort_order: 2,
      blocks: [
        navBar("trainers-nav"),
        {
          id: "trainers-founder-hero",
          type: "split-hero",
          props: {
            eyebrow: "Meet The Founder",
            heading: "Jordan Ellis Built Pulse On One Rule: Coach, Don't Just Supervise",
            body:
              "Jordan opened Pulse Fitness Studio in 2017 after a decade of competitive Olympic lifting convinced her that most gyms in Denver were long on equipment and short on real coaching. She's NASM-certified, USAW Level 2, and still teaches Strength Lab three mornings a week.",
            primary_cta_label: "Book a Free Class",
            primary_cta_href: "/contact",
            secondary_cta_label: "See the Schedule",
            secondary_cta_href: "/classes",
            image_asset_id: "",
            image_alt: "Jordan Ellis, founder and head coach of Pulse Fitness Studio, coaching a strength class",
            variant: "image-right",
          },
        },
        {
          id: "trainers-coaches",
          type: "rich-text",
          props: {
            html:
              "<h2>The Coaching Team</h2>" +
              "<h3>Sam Rivera — Strength Lab Coach</h3><p>CSCS-certified and a former Division I strength &amp; conditioning assistant, Sam builds every Strength Lab block around safe, progressive overload — so PRs come without the burnout.</p>" +
              "<h3>Nadia Okafor — Power Yoga Flow Coach</h3><p>An E-RYT 500 teacher with 12 years in heated vinyasa, Nadia blends breathwork with strength-focused sequencing that leaves you sore in places you forgot you had.</p>" +
              "<h3>Theo Marchetti — Cycle &amp; Boxing Conditioning Coach</h3><p>A USA Boxing-certified coach and former amateur boxer, Theo builds the playlists and the punch combos — expect no-nonsense conditioning and a killer sound system.</p>",
            max_width: "medium",
          },
        },
        {
          id: "trainers-cta",
          type: "cta",
          props: {
            heading: "Train With Us",
            body: "Every class at Pulse is coached — never just supervised. Come meet the team in person.",
            button_label: "Book a Free Class",
            button_href: "/contact",
            variant: "primary",
          },
        },
        richFooter("trainers-footer"),
      ],
    },
    {
      slug: "pricing",
      title: "Pricing",
      seo: {
        title: "Membership Pricing | Pulse Fitness Studio",
        description:
          "Compare Pulse Fitness Studio membership plans in Denver, from drop-in classes to unlimited monthly access. Your first class is always free to try.",
      },
      sort_order: 3,
      blocks: [
        navBar("pricing-nav"),
        {
          id: "pricing-hero",
          type: "hero",
          props: {
            eyebrow: "Membership",
            title: "Simple Pricing, Serious Results",
            subtitle: "Pick the plan that fits your life — every tier includes your first class free.",
            cta_label: "Get Started Today",
            cta_href: "/contact",
            align: "center",
          },
        },
        {
          id: "pricing-tiers",
          type: "feature-grid",
          props: {
            eyebrow: "Pricing",
            heading: "Membership Tiers",
            items: [
              {
                icon: "bolt",
                title: "Drop-In Class",
                body: "$28 per class. Perfect for visitors and the class-curious.",
              },
              {
                icon: "star",
                title: "Unlimited Monthly",
                body: "$159/month. Unlimited classes, no contract, cancel anytime.",
              },
              {
                icon: "award",
                title: "Annual All-Access",
                body: "$1,490/year (avg. $124/mo). Best value for regulars — includes 2 guest passes a month.",
              },
              {
                icon: "heart",
                title: "Student & Military",
                body: "$119/month with valid ID. Because showing up shouldn't cost extra.",
              },
            ],
          },
        },
        {
          id: "pricing-cta",
          type: "cta",
          props: {
            heading: "Your First Class Is Free",
            body: "Try any class on us before you commit to a membership — no credit card required.",
            button_label: "Claim Your Free Class",
            button_href: "/contact",
            variant: "primary",
          },
        },
        richFooter("pricing-footer"),
      ],
    },
    {
      slug: "contact",
      title: "Contact",
      seo: {
        title: "Contact & Free Trial | Pulse Fitness Studio",
        description:
          "Book a free trial class at Pulse Fitness Studio in Denver, CO. Call (303) 555-0148 or send a message; our team usually replies within a few hours.",
      },
      sort_order: 4,
      blocks: [
        navBar("contact-nav"),
        {
          id: "contact-hero",
          type: "hero",
          props: {
            eyebrow: "Say Hello",
            title: "Let's Get You Moving",
            subtitle: "Book your free trial class below, or reach out with any questions — we usually reply within a couple hours.",
            cta_label: "Call the Studio",
            cta_href: "tel:+13035550148",
            align: "left",
          },
        },
        {
          id: "contact-phone",
          type: "phone_number",
          props: {
            number: "+13035550148",
            display: "(303) 555-0148",
          },
        },
        {
          id: "contact-crm-form",
          type: "crm_form",
          props: {
            embed_code:
              '<form action="/api/leads" method="post" class="pulse-trial-form">' +
              '<input type="hidden" name="_page" value="/contact" />' +
              '<label style="position:absolute;left:-9999px" aria-hidden="true">Leave this field empty<input type="text" name="website" tabindex="-1" autocomplete="off" /></label>' +
              "<h3>Request Your Free Trial Class</h3>" +
              '<label>Full name<input type="text" name="name" required /></label>' +
              '<label>Email<input type="email" name="email" required /></label>' +
              '<label>Phone<input type="tel" name="phone" required /></label>' +
              "<label>Preferred class<select name=\"preferred_class\">" +
              "<option>HIIT Ignite</option><option>Power Yoga Flow</option><option>Strength Lab</option>" +
              "<option>Studio Cycle</option><option>Boxing Conditioning</option><option>Recovery &amp; Mobility</option>" +
              "</select></label>" +
              '<button type="submit">Claim My Free Class</button>' +
              "</form>",
            label: "Free Trial Class Request",
          },
        },
        {
          id: "contact-info",
          type: "rich-text",
          props: {
            html:
              "<h2>Visit Us</h2><p>2020 Larimer Street<br>Denver, CO 80205</p>" +
              "<h3>Hours</h3><p>Monday–Friday: 5:00am–9:00pm<br>Saturday: 7:00am–3:00pm<br>Sunday: 8:00am–1:00pm</p>" +
              "<p>Free street parking is available along Larimer after 6pm and all day Saturday–Sunday; a pay lot sits directly behind the studio.</p>",
            max_width: "medium",
          },
        },
        richFooter("contact-footer"),
      ],
    },
  ],
};
