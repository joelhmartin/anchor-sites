import type { TemplateSeed } from "./types.js";

/**
 * Nonprofit template (Task C-nonprofit, per-file template library).
 *
 * Fictional business: Fulton Roots, a food-security and youth-mentoring
 * nonprofit serving Richmond, Virginia's East End (Church Hill, Fulton, and
 * Union Hill), founded in 2012.
 *
 * Design reference: Tailwind UI's free marketing sections — the dark
 * "stats with large numbers" panel and the "simple centered CTA" — recomposed
 * as an impact-forward nonprofit layout: a mission-first hero instead of a
 * product pitch, a year-in-numbers stat band standing in for feature copy,
 * and first-person beneficiary/volunteer stories (testimonial-carousel)
 * driving the donate CTA instead of client testimonials.
 *
 * Brand tokens: a hopeful teal (`--theme-main`) for trust/chrome and a warm
 * amber (`--theme-accent`) for every donate/volunteer call-to-action, on a
 * white surface. Contrast ratios computed against WCAG's relative-luminance
 * formula (all comfortably clear the 4.5:1 AA text threshold):
 *   - main #0f766e / on-main #ffffff       -> 5.48:1
 *   - accent #b45309 / on-accent #ffffff   -> 5.02:1
 *   - surface #ffffff / on-surface #1f2937 -> 14.67:1
 *   - muted #eef7f6 / on-muted #334155     -> 9.50:1
 *
 * Imagery: every `image_asset_id` field is left at the schema default (empty
 * string) — no asset exists at authoring time; the AI agent imports real
 * photos post-creation (see starter.ts / restaurant.ts precedent — `cover`
 * is the only image-shaped field this template supplies content for).
 */
export const nonprofit: TemplateSeed = {
  slug: "nonprofit",
  name: "Nonprofit",
  description: "An impact-forward nonprofit site — mission hero, year-in-numbers impact stats, program pages, and clear volunteer & donate paths.",
  category: "Nonprofit",
  sort_order: 80,
  brand_tokens: {
    "--theme-main": "#0f766e",
    "--theme-on-main": "#ffffff",
    "--theme-accent": "#b45309",
    "--theme-on-accent": "#ffffff",
    "--theme-surface": "#ffffff",
    "--theme-on-surface": "#1f2937",
    "--theme-muted": "#eef7f6",
    "--theme-on-muted": "#334155",
    "--theme-border": "#d7e8e6",
  },
  cover: {
    stock_query: "community food pantry",
    alt: "Volunteers sorting fresh produce at a community food pantry in Richmond, Virginia",
  },
  pages: [
    // ---------------------------------------------------------------
    // HOME — mission hero, impact stats-band, programs feature-grid, donate cta.
    // ---------------------------------------------------------------
    {
      slug: "home",
      title: "Home",
      sort_order: 0,
      seo: {
        title: "Fulton Roots | Food Security & Youth Mentoring, Richmond",
        description:
          "Fulton Roots feeds families and mentors kids across Richmond's East End — a 501(c)(3) nonprofit running a weekly food pantry and youth mentoring since 2012.",
      },
      blocks: [
        {
          id: "home-nav",
          type: "nav-bar",
          props: {
            brand_name: "Fulton Roots",
            links: [
              { label: "Home", href: "/" },
              { label: "Programs", href: "/programs" },
              { label: "Impact", href: "/impact" },
              { label: "Get Involved", href: "/get-involved" },
              { label: "Contact", href: "/contact" },
            ],
            cta_label: "Donate Now",
            cta_href: "/get-involved",
            variant: "cta",
          },
        },
        {
          id: "home-announcement",
          type: "announcement-bar",
          props: {
            text: "Our Winter Match Campaign runs through December 31 — every gift is doubled up to $50,000.",
            link_label: "Give Today",
            link_href: "/get-involved",
          },
        },
        {
          id: "home-hero",
          type: "hero",
          props: {
            eyebrow: "A Richmond Nonprofit Since 2012",
            title: "Every family fed. Every kid mentored. Every week.",
            subtitle:
              "Fulton Roots runs a weekly food pantry and connects Richmond kids in grades 6-12 with a caring adult mentor — because a full plate and a steady relationship both change what's possible.",
            cta_label: "See Our Programs",
            cta_href: "/programs",
            align: "left",
          },
        },
        {
          id: "home-stats",
          type: "stats-band",
          props: {
            heading: "Twelve years of showing up for the East End.",
            stats: [
              { value: "1,800+", label: "Neighbors fed each month" },
              { value: "640+", label: "Youth mentored since 2012" },
              { value: "92%", label: "Mentees who graduate on time" },
              { value: "12", label: "Years serving Church Hill & Fulton" },
            ],
          },
        },
        {
          id: "home-programs",
          type: "feature-grid",
          props: {
            eyebrow: "What We Do",
            heading: "Four programs, one full-circle mission.",
            items: [
              {
                icon: "heart",
                title: "Fresh Table Pantry",
                body: "A weekly food pantry and mobile market putting fresh produce and shelf-stable staples within walking distance of Church Hill, Fulton, and Union Hill.",
              },
              {
                icon: "book",
                title: "Roots Mentoring",
                body: "One-on-one mentors meet weekly with kids in grades 6-12, building the steady relationship that keeps them in school and looking ahead.",
              },
              {
                icon: "sun",
                title: "Summer Bridge Corps",
                body: "Paid summer jobs, academic catch-up, and college visits keep Richmond teens engaged and earning between school years.",
              },
              {
                icon: "home",
                title: "Family Support Hub",
                body: "Case managers connect families to rent and utility assistance, diapers, ESL classes, and benefits enrollment under one roof.",
              },
            ],
          },
        },
        {
          id: "home-cta",
          type: "cta",
          props: {
            heading: "Your gift feeds a family and funds a mentor.",
            body: "A $50 gift covers a week of groceries for one household or a month of supplies for one mentoring match.",
            button_label: "Donate Now",
            button_href: "/get-involved",
            variant: "primary",
          },
        },
        {
          id: "home-footer",
          type: "rich-footer",
          props: {
            brand_name: "Fulton Roots",
            tagline: "Food security and youth mentoring in Richmond's East End since 2012.",
            columns: [
              {
                heading: "Programs",
                links: [
                  { label: "Fresh Table Pantry", href: "/programs" },
                  { label: "Roots Mentoring", href: "/programs" },
                  { label: "Summer Bridge Corps", href: "/programs" },
                ],
              },
              {
                heading: "Get Involved",
                links: [
                  { label: "Our Impact", href: "/impact" },
                  { label: "Volunteer & Donate", href: "/get-involved" },
                  { label: "Contact", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "facebook", href: "https://facebook.com/fultonrootsrva" },
              { platform: "instagram", href: "https://instagram.com/fultonrootsrva" },
            ],
            hours: "Pantry: Tue & Thu 10am-2pm, 2nd Sat 9am-noon · Office: Mon-Fri 9am-5pm",
            small_print: "Fulton Roots is a 501(c)(3) nonprofit, EIN 54-2093817. © 2026 Fulton Roots.",
          },
        },
      ],
    },
    // ---------------------------------------------------------------
    // PROGRAMS — split-hero intro, rich-text detail on all four programs.
    // ---------------------------------------------------------------
    {
      slug: "programs",
      title: "Programs",
      sort_order: 1,
      seo: {
        title: "Programs | Fulton Roots Richmond",
        description:
          "Explore Fulton Roots' four Richmond programs: the Fresh Table Pantry, Roots Mentoring, Summer Bridge Corps, and the Family Support Hub case-management team.",
      },
      blocks: [
        {
          id: "programs-nav",
          type: "nav-bar",
          props: {
            brand_name: "Fulton Roots",
            links: [
              { label: "Home", href: "/" },
              { label: "Programs", href: "/programs" },
              { label: "Impact", href: "/impact" },
              { label: "Get Involved", href: "/get-involved" },
              { label: "Contact", href: "/contact" },
            ],
            cta_label: "Donate Now",
            cta_href: "/get-involved",
            variant: "cta",
          },
        },
        {
          id: "programs-hero",
          type: "split-hero",
          props: {
            eyebrow: "Our Programs",
            heading: "Four programs built around one family.",
            body: "Most of the families Fulton Roots serves touch more than one program — a mom picking up groceries at the Fresh Table Pantry might also have a son matched with a Roots mentor down the hall.",
            primary_cta_label: "Get Involved",
            primary_cta_href: "/get-involved",
            secondary_cta_label: "See Our Impact",
            secondary_cta_href: "/impact",
            image_asset_id: "",
            image_alt: "A volunteer stocking shelves at the Fresh Table Pantry in Richmond's Church Hill neighborhood",
            variant: "image-right",
          },
        },
        {
          id: "programs-detail",
          type: "rich-text",
          props: {
            html:
              "<h2>Fresh Table Pantry</h2><p>Open every Tuesday and Thursday from 10 AM to 2 PM, and the second Saturday of each month from 9 AM to noon, the Fresh Table Pantry lets families shop a full pantry room by household size rather than take a pre-packed box. A mobile market truck brings the same fresh produce to the Whitcomb Court and Fairmount communities twice a month. No paperwork is required beyond a Richmond address.</p><h2>Roots Mentoring</h2><p>Roots Mentoring matches kids in grades 6 through 12 with a background-checked adult volunteer for a weekly one-hour visit, most often at school during lunch or a free period. Matches commit to a full school year, and four in five pairs continue into a second year. Mentors get training, a program coordinator on call, and a planned group activity every month.</p><h2>Summer Bridge Corps</h2><p>Each June, forty Richmond teens ages 14 to 18 join Summer Bridge Corps for six weeks of paid work experience, math and reading catch-up, and a college campus visit. Past worksites have included the Richmond Public Library, a local health system, and the City of Richmond Parks Department.</p><h2>Family Support Hub</h2><p>Housed inside the same building as the pantry, the Family Support Hub connects families with a case manager who can help apply for SNAP and energy assistance, enroll in free ESL classes, or pick up diapers and school supplies without a separate appointment.</p>",
            max_width: "medium",
          },
        },
        {
          id: "programs-cta",
          type: "cta",
          props: {
            heading: "Want the details on a specific program?",
            body: "Our program coordinators are happy to walk through eligibility, schedules, or how to get a family connected.",
            button_label: "Contact Our Team",
            button_href: "/contact",
            variant: "muted",
          },
        },
        {
          id: "programs-footer",
          type: "rich-footer",
          props: {
            brand_name: "Fulton Roots",
            tagline: "Food security and youth mentoring in Richmond's East End since 2012.",
            columns: [
              {
                heading: "Programs",
                links: [
                  { label: "Fresh Table Pantry", href: "/programs" },
                  { label: "Roots Mentoring", href: "/programs" },
                  { label: "Summer Bridge Corps", href: "/programs" },
                ],
              },
              {
                heading: "Get Involved",
                links: [
                  { label: "Our Impact", href: "/impact" },
                  { label: "Volunteer & Donate", href: "/get-involved" },
                  { label: "Contact", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "facebook", href: "https://facebook.com/fultonrootsrva" },
              { platform: "instagram", href: "https://instagram.com/fultonrootsrva" },
            ],
            hours: "Pantry: Tue & Thu 10am-2pm, 2nd Sat 9am-noon · Office: Mon-Fri 9am-5pm",
            small_print: "Fulton Roots is a 501(c)(3) nonprofit, EIN 54-2093817. © 2026 Fulton Roots.",
          },
        },
      ],
    },
    // ---------------------------------------------------------------
    // IMPACT — year-in-numbers stats-band + first-person stories.
    // ---------------------------------------------------------------
    {
      slug: "impact",
      title: "Impact",
      sort_order: 2,
      seo: {
        title: "Our Impact | Fulton Roots Richmond",
        description:
          "See Fulton Roots' 2025 impact in Richmond's East End — pounds of food distributed, active mentoring matches, and the families and mentees behind the numbers.",
      },
      blocks: [
        {
          id: "impact-nav",
          type: "nav-bar",
          props: {
            brand_name: "Fulton Roots",
            links: [
              { label: "Home", href: "/" },
              { label: "Programs", href: "/programs" },
              { label: "Impact", href: "/impact" },
              { label: "Get Involved", href: "/get-involved" },
              { label: "Contact", href: "/contact" },
            ],
            cta_label: "Donate Now",
            cta_href: "/get-involved",
            variant: "cta",
          },
        },
        {
          id: "impact-hero",
          type: "hero",
          props: {
            eyebrow: "2025 Impact Report",
            title: "A year, in numbers and in people.",
            subtitle:
              "Behind every statistic is a family at the pantry table or a kid meeting a mentor after school. Here's what Fulton Roots and this community built together last year.",
            cta_label: "Support Next Year's Impact",
            cta_href: "/get-involved",
            align: "center",
          },
        },
        {
          id: "impact-stats",
          type: "stats-band",
          props: {
            heading: "2025, by the numbers.",
            stats: [
              { value: "96,000 lbs", label: "Food distributed" },
              { value: "210", label: "Active mentoring matches" },
              { value: "89%", label: "Mentees promoted on time" },
              { value: "1,300", label: "Volunteer hours logged" },
            ],
          },
        },
        {
          id: "impact-stories",
          type: "testimonial-carousel",
          props: {
            heading: "Stories from this year",
            autoplay: true,
            interval_ms: 6000,
            items: [
              {
                quote:
                  "The mobile market meets us right at Fairmount now. I don't have to choose between bus fare and groceries anymore.",
                author: "Dorothy Vance",
                role: "Pantry member, Fairmount",
                avatar: "",
              },
              {
                quote:
                  "My mentor still texts me every week even though I graduated. Roots Mentoring didn't just help me finish high school — it showed me someone would follow through.",
                author: "Malik Sutton",
                role: "Roots Mentoring alum, now at Virginia State University",
                avatar: "",
              },
              {
                quote:
                  "Summer Bridge Corps gave my daughter her first paycheck and her first look at a college campus in the same summer.",
                author: "Tamika Bellamy",
                role: "Parent, Summer Bridge Corps",
                avatar: "",
              },
              {
                quote:
                  "Every one of our mentors shows up because a kid is counting on them — that consistency is the whole program.",
                author: "DeShawn Whitaker",
                role: "Director of Mentoring Programs, Fulton Roots",
                avatar: "",
              },
            ],
          },
        },
        {
          id: "impact-cta",
          type: "cta",
          props: {
            heading: "Help us grow next year's numbers.",
            body: "Every dollar, hour, and referral gets one more Richmond family through the door.",
            button_label: "Get Involved",
            button_href: "/get-involved",
            variant: "primary",
          },
        },
        {
          id: "impact-footer",
          type: "rich-footer",
          props: {
            brand_name: "Fulton Roots",
            tagline: "Food security and youth mentoring in Richmond's East End since 2012.",
            columns: [
              {
                heading: "Programs",
                links: [
                  { label: "Fresh Table Pantry", href: "/programs" },
                  { label: "Roots Mentoring", href: "/programs" },
                  { label: "Summer Bridge Corps", href: "/programs" },
                ],
              },
              {
                heading: "Get Involved",
                links: [
                  { label: "Our Impact", href: "/impact" },
                  { label: "Volunteer & Donate", href: "/get-involved" },
                  { label: "Contact", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "facebook", href: "https://facebook.com/fultonrootsrva" },
              { platform: "instagram", href: "https://instagram.com/fultonrootsrva" },
            ],
            hours: "Pantry: Tue & Thu 10am-2pm, 2nd Sat 9am-noon · Office: Mon-Fri 9am-5pm",
            small_print: "Fulton Roots is a 501(c)(3) nonprofit, EIN 54-2093817. © 2026 Fulton Roots.",
          },
        },
      ],
    },
    // ---------------------------------------------------------------
    // GET INVOLVED — volunteer/donate paths + faq-accordion.
    // ---------------------------------------------------------------
    {
      slug: "get-involved",
      title: "Get Involved",
      sort_order: 3,
      seo: {
        title: "Get Involved | Fulton Roots Richmond",
        description:
          "Volunteer, mentor, or donate to Fulton Roots in Richmond, Virginia — find the path that fits: mentoring, pantry shifts, monthly gifts, or group volunteering.",
      },
      blocks: [
        {
          id: "get-involved-nav",
          type: "nav-bar",
          props: {
            brand_name: "Fulton Roots",
            links: [
              { label: "Home", href: "/" },
              { label: "Programs", href: "/programs" },
              { label: "Impact", href: "/impact" },
              { label: "Get Involved", href: "/get-involved" },
              { label: "Contact", href: "/contact" },
            ],
            cta_label: "Donate Now",
            cta_href: "/get-involved",
            variant: "cta",
          },
        },
        {
          id: "get-involved-hero",
          type: "hero",
          props: {
            eyebrow: "Get Involved",
            title: "There's a place for you at Fulton Roots.",
            subtitle:
              "Whether you have an hour a week, a few dollars a month, or a truckload of canned goods, here's how to plug in.",
            cta_label: "Become a Mentor",
            cta_href: "/contact",
            align: "left",
          },
        },
        {
          id: "get-involved-paths",
          type: "feature-grid",
          props: {
            eyebrow: "Ways to Help",
            heading: "Find the path that fits.",
            items: [
              {
                icon: "heart",
                title: "Become a Mentor",
                body: "Commit one hour a week during the school year to a Richmond student in grades 6-12. Training and ongoing support included.",
              },
              {
                icon: "dollar",
                title: "Give Monthly",
                body: "Recurring gifts of $25, $50, or $100 keep the pantry stocked and mentoring matches funded all year, not just during the holidays.",
              },
              {
                icon: "users",
                title: "Volunteer at the Pantry",
                body: "Sort produce, stock shelves, or greet families on Tuesday and Thursday mornings — no experience needed, just steady hands.",
              },
              {
                icon: "briefcase",
                title: "Corporate & Group Volunteering",
                body: "Bring your team for a half-day pantry shift or sponsor a Summer Bridge Corps work crew for the season.",
              },
            ],
          },
        },
        {
          id: "get-involved-faq",
          type: "faq-accordion",
          props: {
            heading: "Questions About Volunteering & Giving",
            items: [
              {
                question: "Do mentors need a background check?",
                answer:
                  "Yes. Every Roots Mentoring volunteer completes a background check and a two-hour training session before being matched with a student, and our coordinator checks in monthly.",
              },
              {
                question: "Is my donation tax-deductible?",
                answer:
                  "Yes — Fulton Roots is a registered 501(c)(3) nonprofit, and you'll receive a receipt by email for any donation made online or by mail.",
              },
              {
                question: "Can I drop off canned goods instead of donating money?",
                answer:
                  "Absolutely. The pantry accepts non-perishable food donations during open hours, Tuesday and Thursday 10 AM to 2 PM, at our Church Hill location.",
              },
              {
                question: "Does my employer match donations?",
                answer:
                  "Many do. Check with your HR department for a matching-gift form — several Richmond employers, including downtown law firms and hospital systems, match dollar for dollar.",
              },
              {
                question: "What if I can only volunteer occasionally?",
                answer:
                  "Pantry shifts welcome one-time and occasional volunteers; mentoring asks for a full school-year commitment, because consistency is what makes it work for the kids.",
              },
            ],
            multiple: false,
          },
        },
        {
          id: "get-involved-cta",
          type: "cta",
          props: {
            heading: "Ready to start?",
            body: "Tell us how you'd like to help and a Fulton Roots staff member will follow up within two business days.",
            button_label: "Reach Our Team",
            button_href: "/contact",
            variant: "primary",
          },
        },
        {
          id: "get-involved-footer",
          type: "rich-footer",
          props: {
            brand_name: "Fulton Roots",
            tagline: "Food security and youth mentoring in Richmond's East End since 2012.",
            columns: [
              {
                heading: "Programs",
                links: [
                  { label: "Fresh Table Pantry", href: "/programs" },
                  { label: "Roots Mentoring", href: "/programs" },
                  { label: "Summer Bridge Corps", href: "/programs" },
                ],
              },
              {
                heading: "Get Involved",
                links: [
                  { label: "Our Impact", href: "/impact" },
                  { label: "Volunteer & Donate", href: "/get-involved" },
                  { label: "Contact", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "facebook", href: "https://facebook.com/fultonrootsrva" },
              { platform: "instagram", href: "https://instagram.com/fultonrootsrva" },
            ],
            hours: "Pantry: Tue & Thu 10am-2pm, 2nd Sat 9am-noon · Office: Mon-Fri 9am-5pm",
            small_print: "Fulton Roots is a 501(c)(3) nonprofit, EIN 54-2093817. © 2026 Fulton Roots.",
          },
        },
      ],
    },
    // ---------------------------------------------------------------
    // CONTACT — phone_number + crm_form.
    // ---------------------------------------------------------------
    {
      slug: "contact",
      title: "Contact",
      sort_order: 4,
      seo: {
        title: "Contact | Fulton Roots Richmond",
        description:
          "Reach Fulton Roots in Richmond, Virginia. Call (804) 555-0119, send a message online, or stop by our Fulton Center office during pantry or business hours.",
      },
      blocks: [
        {
          id: "contact-nav",
          type: "nav-bar",
          props: {
            brand_name: "Fulton Roots",
            links: [
              { label: "Home", href: "/" },
              { label: "Programs", href: "/programs" },
              { label: "Impact", href: "/impact" },
              { label: "Get Involved", href: "/get-involved" },
              { label: "Contact", href: "/contact" },
            ],
            cta_label: "Donate Now",
            cta_href: "/get-involved",
            variant: "cta",
          },
        },
        {
          id: "contact-hero",
          type: "hero",
          props: {
            eyebrow: "Contact Us",
            title: "Reach the Fulton Roots team.",
            subtitle: "Questions about the pantry, a mentoring match, or how to give — we're glad to help.",
            cta_label: "Call (804) 555-0119",
            cta_href: "tel:+18045550119",
            align: "left",
          },
        },
        {
          id: "contact-phone",
          type: "phone_number",
          props: {
            number: "+18045550119",
            display: "(804) 555-0119 — Office, Mon-Fri 9am-5pm",
          },
        },
        {
          id: "contact-form",
          type: "crm_form",
          props: {
            embed_code: "<form action=\"/api/leads\" method=\"post\" class=\"fulton-roots-contact-form\"><label>Name<input type=\"text\" name=\"name\" required></label><label>Email<input type=\"email\" name=\"email\" required></label><label>Phone<input type=\"tel\" name=\"phone\"></label><label>How can we help?<textarea name=\"details\" rows=\"4\" required></textarea></label><button type=\"submit\">Send Message</button></form>",
            label: "General Inquiry Form",
          },
        },
        {
          id: "contact-hours",
          type: "rich-text",
          props: {
            html: "<h2>Hours &amp; Location</h2><p><strong>Office hours:</strong> Monday-Friday, 9:00 AM - 5:00 PM.<br><strong>Pantry hours:</strong> Tuesday &amp; Thursday 10:00 AM - 2:00 PM, second Saturday of the month 9:00 AM - noon.<br><strong>Address:</strong> 1420 N 28th Street, Richmond, VA 23223, in the Fulton Center building.</p>",
            max_width: "medium",
          },
        },
        {
          id: "contact-footer",
          type: "rich-footer",
          props: {
            brand_name: "Fulton Roots",
            tagline: "Food security and youth mentoring in Richmond's East End since 2012.",
            columns: [
              {
                heading: "Programs",
                links: [
                  { label: "Fresh Table Pantry", href: "/programs" },
                  { label: "Roots Mentoring", href: "/programs" },
                  { label: "Summer Bridge Corps", href: "/programs" },
                ],
              },
              {
                heading: "Get Involved",
                links: [
                  { label: "Our Impact", href: "/impact" },
                  { label: "Volunteer & Donate", href: "/get-involved" },
                  { label: "Contact", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "facebook", href: "https://facebook.com/fultonrootsrva" },
              { platform: "instagram", href: "https://instagram.com/fultonrootsrva" },
            ],
            hours: "Pantry: Tue & Thu 10am-2pm, 2nd Sat 9am-noon · Office: Mon-Fri 9am-5pm",
            small_print: "Fulton Roots is a 501(c)(3) nonprofit, EIN 54-2093817. © 2026 Fulton Roots.",
          },
        },
      ],
    },
  ],
};

export default nonprofit;
