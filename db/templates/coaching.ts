import type { TemplateSeed } from "./types.js";

/**
 * Coaching template (Task C5-C14, slug `coaching`).
 *
 * Fictional business: Crossroads Coaching, a life & executive coaching
 * practice run by founder Naomi Reyes (PCC, International Coaching
 * Federation) out of a small office on Pearl Street in Boulder, Colorado.
 * Naomi left an eleven-year operations career to become the coach she
 * wished she'd had during her own career reinvention; she caps her active
 * 1:1 caseload at eighteen clients on purpose.
 *
 * Design reference: Tailwind UI's free "Simple, centered CTA" and
 * "Testimonial" marketing sections, recomposed as a single-accent warm
 * coaching layout — coral/rose on cream, generous whitespace, and a
 * deliberate rhythm break on the About page (a split-hero personal-story
 * block instead of a plain hero) to sell trust rather than a transaction.
 * This evokes Lovable's own "Coaching for people at a crossroads" gallery
 * entry: conversational voice, zero corporate speak, direct emotional
 * language over stock-photo polish.
 *
 * Brand tokens: warm terracotta-coral (`--theme-main`) carries nav/CTA
 * chrome, a deeper rose (`--theme-accent`) marks secondary emphasis, and a
 * warm cream (`--theme-surface`) with dark warm-brown body text
 * (`--theme-on-surface`) keeps the page feeling handwritten rather than
 * corporate. Contrast checked against WCAG AA (4.5:1) for text-on-color
 * pairs: main/on-main ≈ 4.93:1, accent/on-accent ≈ 7.30:1,
 * surface/on-surface ≈ 12.46:1 (WCAG relative-luminance formula).
 *
 * Imagery: no `image` blocks are authored; `split-hero`'s `image_asset_id`
 * is left at the schema's empty-string default per starter.ts precedent —
 * the AI agent imports real photography post-creation. `cover` is the only
 * image-shaped field this template supplies content for.
 */
export const coaching: TemplateSeed = {
  slug: "coaching",
  name: "Coaching",
  description:
    "A life & executive coaching site — an emotionally direct hero, client outcomes, transparent program pricing, and a low-friction free-call booking flow.",
  category: "Coaching",
  sort_order: 70,
  brand_tokens: {
    "--theme-main": "#B54F35",
    "--theme-on-main": "#FFFBF5",
    "--theme-accent": "#8B3A46",
    "--theme-on-accent": "#FFFBF5",
    "--theme-surface": "#FBF3EA",
    "--theme-on-surface": "#3A2A22",
  },
  cover: {
    stock_query: "warm coaching conversation",
    alt: "Two people in a warm, sunlit conversation across a small table, evoking a one-on-one coaching session",
  },
  pages: [
    // ---------------------------------------------------------------
    // HOME — emotionally direct hero, how-it-works, client outcomes.
    // ---------------------------------------------------------------
    {
      slug: "home",
      title: "Home",
      sort_order: 0,
      seo: {
        title: "Crossroads Coaching | Life & Executive Coaching in Boulder",
        description:
          "Crossroads Coaching is Naomi Reyes' Boulder, Colorado coaching practice, helping professionals move through hard crossroads with clarity and a workable plan.",
      },
      blocks: [
        {
          id: "home-nav",
          type: "nav-bar",
          props: {
            brand_name: "Crossroads Coaching",
            links: [
              { label: "Home", href: "/" },
              { label: "Programs", href: "/programs" },
              { label: "About", href: "/about" },
              { label: "Book a Call", href: "/book-a-call" },
            ],
            cta_label: "Book a Free Call",
            cta_href: "/book-a-call",
            variant: "cta",
          },
        },
        {
          id: "home-hero",
          type: "hero",
          props: {
            eyebrow: "Life & Executive Coaching · Boulder, CO",
            title: "You didn't get this far to stay stuck.",
            subtitle:
              "Crossroads Coaching helps driven people figure out the next right move — in their career, their relationships, or the life they're quietly unhappy in. No jargon, no fluff. Just honest conversation and a plan you'll actually follow through on.",
            cta_label: "Book a Free Call",
            cta_href: "/book-a-call",
            align: "center",
          },
        },
        {
          id: "home-how-it-works",
          type: "feature-grid",
          props: {
            eyebrow: "How It Works",
            heading: "Four steps, no guesswork",
            items: [
              {
                icon: "📞",
                title: "Book a Free Call",
                body: "We'll spend 20 minutes on the phone talking about what's actually going on — no pitch, no pressure. You'll know by the end whether this is a fit.",
              },
              {
                icon: "🧭",
                title: "We Build Your Plan",
                body: "Your first session maps where you are, where you want to be, and the two or three things actually in your control between here and there.",
              },
              {
                icon: "🗓️",
                title: "Weekly or Biweekly Sessions",
                body: "We meet on a steady rhythm — video or in person at the Boulder office — and every session ends with something concrete to carry into the week.",
              },
              {
                icon: "📈",
                title: "Momentum That Sticks",
                body: "Most clients notice the shift by week six: clearer decisions, fewer spirals, and a plan they trust enough to actually run.",
              },
            ],
          },
        },
        {
          id: "home-outcomes",
          type: "testimonial-carousel",
          props: {
            heading: "What changes for people who do this work",
            autoplay: false,
            interval_ms: 6000,
            items: [
              {
                quote:
                  "Naomi didn't tell me what to do. She asked the one question I'd been avoiding for two years, and everything moved after that.",
                author: "Grace Okonkwo",
                role: "Nonprofit Executive Director",
                avatar: "",
              },
              {
                quote:
                  "I hired a coach to fix my time management. Six months later I'd left the job that was making me miserable and started the consultancy I'd been talking about since 2019.",
                author: "Daniel Prescott",
                role: "Independent Consultant, former VP of Operations",
                avatar: "",
              },
              {
                quote:
                  "The intensive gave me more clarity in two days than eighteen months of on-and-off therapy. Different tool, same toolbox — turns out I needed both.",
                author: "Renee Castillo",
                role: "Small Business Founder",
                avatar: "",
              },
            ],
          },
        },
        {
          id: "home-cta",
          type: "cta",
          props: {
            heading: "Ready to stop white-knuckling it alone?",
            body: "Book a free 20-minute call. If it's not a fit, I'll tell you — and probably point you somewhere better.",
            button_label: "Book a Free Call",
            button_href: "/book-a-call",
            variant: "primary",
          },
        },
        {
          id: "home-footer",
          type: "rich-footer",
          props: {
            brand_name: "Crossroads Coaching",
            tagline: "Coaching for people at a crossroads.",
            columns: [
              {
                heading: "Explore",
                links: [
                  { label: "Programs", href: "/programs" },
                  { label: "About Naomi", href: "/about" },
                  { label: "Book a Call", href: "/book-a-call" },
                ],
              },
              {
                heading: "Get in Touch",
                links: [
                  { label: "Book a Free Call", href: "/book-a-call" },
                  { label: "Call (720) 555-0134", href: "tel:+17205550134" },
                ],
              },
            ],
            social_links: [
              { platform: "instagram", href: "#" },
              { platform: "linkedin", href: "#" },
            ],
            hours: "Mon–Thu 9am–5pm MT · Fri by appointment",
            small_print: "1901 Pearl Street, Boulder, CO 80302 · © 2026 Crossroads Coaching. All rights reserved.",
          },
        },
      ],
    },
    // ---------------------------------------------------------------
    // PROGRAMS — 1:1 / group / intensive, rich-text with pricing.
    // ---------------------------------------------------------------
    {
      slug: "programs",
      title: "Programs",
      sort_order: 1,
      seo: {
        title: "Programs & Pricing | Crossroads Coaching",
        description:
          "Explore Crossroads Coaching's 1:1, group, and intensive coaching programs in Boulder, Colorado, with transparent, flat, outcome-based pricing for each option.",
      },
      blocks: [
        {
          id: "programs-nav",
          type: "nav-bar",
          props: {
            brand_name: "Crossroads Coaching",
            links: [
              { label: "Home", href: "/" },
              { label: "Programs", href: "/programs" },
              { label: "About", href: "/about" },
              { label: "Book a Call", href: "/book-a-call" },
            ],
            cta_label: "Book a Free Call",
            cta_href: "/book-a-call",
            variant: "cta",
          },
        },
        {
          id: "programs-hero",
          type: "hero",
          props: {
            eyebrow: "Programs & Pricing",
            title: "Three ways to work together",
            subtitle:
              "One-on-one for depth, group for community, an intensive for when you need clarity now. Every program is priced around the outcome, not the clock.",
            cta_label: "Book a Free Call",
            cta_href: "/book-a-call",
            align: "left",
          },
        },
        {
          id: "programs-1on1",
          type: "rich-text",
          props: {
            html:
              "<h2>1:1 Coaching</h2><p>This is the core of the practice: one hour, every week or every other week, just you and me. We start with a 90-minute deep-dive session to map the real terrain — the decision you're avoiding, the pattern you're stuck in, the version of your life you keep putting off — then build a working plan from there.</p><p>Sessions run by video or in person at the Boulder office. Most clients start with a three-month container and continue month-to-month after that, because momentum is easier to keep than to rebuild.</p><ul><li><strong>Biweekly</strong> — $650/month, three-month minimum</li><li><strong>Weekly</strong> — $950/month, three-month minimum</li></ul>",
            max_width: "medium",
          },
        },
        {
          id: "programs-group",
          type: "rich-text",
          props: {
            html:
              "<h2>Group Coaching — The Crossroads Circle</h2><p>A cohort of six to eight people, all navigating their own version of a crossroads, meeting for eight weeks over video. Group coaching does something 1:1 sessions can't: it shows you that you're not the only competent adult who feels quietly behind. Each cohort is built around a theme — career transitions, founder burnout, or the return-to-work chapter after a major life change — and enrollment is capped so everyone gets real airtime.</p><p><strong>The Crossroads Circle</strong> — $1,200 for the full eight-week cohort. Three cohorts run each year: spring, fall, and a January reset cohort.</p>",
            max_width: "medium",
          },
        },
        {
          id: "programs-intensive",
          type: "rich-text",
          props: {
            html:
              "<h2>The Two-Day Intensive</h2><p>For when you don't have three months — you have a decision in front of you and you need clarity now. The Two-Day Intensive is a private, single-client deep dive held at the Boulder office (or, for out-of-town clients, over two consecutive video sessions): six focused hours across two days, structured around one specific decision or transition.</p><p>Most clients leave with a written plan, not just a good conversation. Past intensives have helped clients decide whether to take a promotion, leave a marriage, exit a business partnership, or finally start the thing they'd been circling for years.</p><p><strong>The Two-Day Intensive</strong> — $2,400 flat, includes a 30-day follow-up check-in call.</p>",
            max_width: "medium",
          },
        },
        {
          id: "programs-pricing-philosophy",
          type: "rich-text",
          props: {
            html:
              "<h2>Why we price it this way</h2><p>I don't bill by the hour, and I don't run introductory-rate funnels that jump in price after month two. Every program above is priced as a flat, transparent number because coaching only works if you're thinking about the work — not doing math about whether this session was worth it. If cost is the thing standing between you and a decision that matters, say so on the free call. I hold two subsidized spots per cohort for exactly that conversation.</p>",
            max_width: "medium",
          },
        },
        {
          id: "programs-cta",
          type: "cta",
          props: {
            heading: "Not sure which program fits?",
            body: "Tell me what's going on and I'll tell you honestly which one makes sense — including if the answer is none of them yet.",
            button_label: "Book a Free Call",
            button_href: "/book-a-call",
            variant: "primary",
          },
        },
        {
          id: "programs-footer",
          type: "rich-footer",
          props: {
            brand_name: "Crossroads Coaching",
            tagline: "Coaching for people at a crossroads.",
            columns: [
              {
                heading: "Explore",
                links: [
                  { label: "Programs", href: "/programs" },
                  { label: "About Naomi", href: "/about" },
                  { label: "Book a Call", href: "/book-a-call" },
                ],
              },
              {
                heading: "Get in Touch",
                links: [
                  { label: "Book a Free Call", href: "/book-a-call" },
                  { label: "Call (720) 555-0134", href: "tel:+17205550134" },
                ],
              },
            ],
            social_links: [
              { platform: "instagram", href: "#" },
              { platform: "linkedin", href: "#" },
            ],
            hours: "Mon–Thu 9am–5pm MT · Fri by appointment",
            small_print: "1901 Pearl Street, Boulder, CO 80302 · © 2026 Crossroads Coaching. All rights reserved.",
          },
        },
      ],
    },
    // ---------------------------------------------------------------
    // ABOUT — personal story split-hero; coaching is a trust purchase.
    // ---------------------------------------------------------------
    {
      slug: "about",
      title: "About",
      sort_order: 2,
      seo: {
        title: "About Naomi Reyes | Crossroads Coaching",
        description:
          "Meet Naomi Reyes, PCC, founder of Crossroads Coaching in Boulder, Colorado — a coach who left her own operations career to help others navigate theirs.",
      },
      blocks: [
        {
          id: "about-nav",
          type: "nav-bar",
          props: {
            brand_name: "Crossroads Coaching",
            links: [
              { label: "Home", href: "/" },
              { label: "Programs", href: "/programs" },
              { label: "About", href: "/about" },
              { label: "Book a Call", href: "/book-a-call" },
            ],
            cta_label: "Book a Free Call",
            cta_href: "/book-a-call",
            variant: "cta",
          },
        },
        {
          id: "about-story",
          type: "split-hero",
          props: {
            eyebrow: "About Naomi",
            heading: "I've been at the crossroads too.",
            body:
              "I spent eleven years climbing an operations ladder I wasn't sure I even wanted — right up until the week I resigned from a VP role with no plan and a toddler at home. What got me through wasn't a productivity hack. It was a coach who asked better questions than I was asking myself. I got certified through the ICF in 2015 and started Crossroads Coaching in Boulder in 2016, because I wanted to be that person for other people standing where I was standing.",
            primary_cta_label: "See How We'd Work Together",
            primary_cta_href: "/programs",
            secondary_cta_label: "Book a Free Call",
            secondary_cta_href: "/book-a-call",
            image_asset_id: "",
            image_alt: "Naomi Reyes, founder of Crossroads Coaching, in her Boulder office",
            variant: "image-right",
          },
        },
        {
          id: "about-how-i-work",
          type: "rich-text",
          props: {
            html:
              "<h2>How I work</h2><p>I'm Naomi Reyes, a Professional Certified Coach (PCC) through the International Coaching Federation, with a decade-plus of coaching practice built on the ground of my own career reinvention. Before coaching, I ran operations for a mid-size logistics company in Denver — which means I've sat in the rooms where big decisions get made, and I know what it costs to keep making them on autopilot.</p><p>My style is warm, but I don't let you off the hook. I ask direct questions, I remember what you told me three sessions ago, and I'll call it when I hear you talking yourself out of the thing you actually want. Coaching with me isn't a place to vent for an hour and feel better — it's a place to get honest and leave with a next step.</p>",
            max_width: "medium",
          },
        },
        {
          id: "about-who-i-work-with",
          type: "rich-text",
          props: {
            html:
              "<h2>Who I work with</h2><p>Most of my clients are mid-career professionals and small-business owners somewhere between 32 and 55 — people who are good at their jobs and quietly aware that being good at the job isn't the same as living the life they meant to build. Career changers, new executives figuring out how to lead instead of do, founders who've stopped enjoying the thing they started. If that's you, we'll get along.</p><p>I keep a limited caseload on purpose — no more than eighteen active 1:1 clients at a time — so every session gets my full attention, not a rotation.</p>",
            max_width: "medium",
          },
        },
        {
          id: "about-cta",
          type: "cta",
          props: {
            heading: "Curious if we'd click?",
            body: "The free call is the easiest way to find out. No pitch — just a conversation.",
            button_label: "Book a Free Call",
            button_href: "/book-a-call",
            variant: "muted",
          },
        },
        {
          id: "about-footer",
          type: "rich-footer",
          props: {
            brand_name: "Crossroads Coaching",
            tagline: "Coaching for people at a crossroads.",
            columns: [
              {
                heading: "Explore",
                links: [
                  { label: "Programs", href: "/programs" },
                  { label: "About Naomi", href: "/about" },
                  { label: "Book a Call", href: "/book-a-call" },
                ],
              },
              {
                heading: "Get in Touch",
                links: [
                  { label: "Book a Free Call", href: "/book-a-call" },
                  { label: "Call (720) 555-0134", href: "tel:+17205550134" },
                ],
              },
            ],
            social_links: [
              { platform: "instagram", href: "#" },
              { platform: "linkedin", href: "#" },
            ],
            hours: "Mon–Thu 9am–5pm MT · Fri by appointment",
            small_print: "1901 Pearl Street, Boulder, CO 80302 · © 2026 Crossroads Coaching. All rights reserved.",
          },
        },
      ],
    },
    // ---------------------------------------------------------------
    // BOOK-A-CALL — low-friction crm_form + what-to-expect FAQ.
    // ---------------------------------------------------------------
    {
      slug: "book-a-call",
      title: "Book a Call",
      sort_order: 3,
      seo: {
        title: "Book a Free Call | Crossroads Coaching",
        description:
          "Book a free 20-minute call with Crossroads Coaching in Boulder, Colorado to see whether life or executive coaching with Naomi Reyes is the right fit for you.",
      },
      blocks: [
        {
          id: "book-a-call-nav",
          type: "nav-bar",
          props: {
            brand_name: "Crossroads Coaching",
            links: [
              { label: "Home", href: "/" },
              { label: "Programs", href: "/programs" },
              { label: "About", href: "/about" },
              { label: "Book a Call", href: "/book-a-call" },
            ],
            cta_label: "Book a Free Call",
            cta_href: "/book-a-call",
            variant: "cta",
          },
        },
        {
          id: "book-a-call-hero",
          type: "hero",
          props: {
            eyebrow: "Book a Free Call",
            title: "Let's spend 20 minutes on the phone.",
            subtitle:
              "No pitch, no pressure, no obligation. Tell me what's going on, ask me anything, and we'll both know by the end whether this is a fit.",
            cta_label: "Call (720) 555-0134",
            cta_href: "tel:+17205550134",
            align: "left",
          },
        },
        {
          id: "book-a-call-phone",
          type: "phone_number",
          props: {
            number: "+17205550134",
            display: "(720) 555-0134 — call or text, Mon–Thu 9am–5pm MT",
          },
        },
        {
          id: "book-a-call-form",
          type: "crm_form",
          props: {
            embed_code:
              "<form action=\"/api/leads\" method=\"post\" class=\"crossroads-call-form\"><input type=\"hidden\" name=\"_page\" value=\"/book-a-call\"><label style=\"position:absolute;left:-9999px\" aria-hidden=\"true\">Leave this field empty<input type=\"text\" name=\"website\" tabindex=\"-1\" autocomplete=\"off\"></label><label>Full Name<input type=\"text\" name=\"name\" required></label><label>Email<input type=\"email\" name=\"email\" required></label><label>Phone<input type=\"tel\" name=\"phone\" required></label><label>What's going on right now?<textarea name=\"details\" rows=\"4\" required></textarea></label><label>Best day/time to call<input type=\"text\" name=\"preferred_time\" placeholder=\"e.g. Tuesday afternoons\"></label><button type=\"submit\">Request My Free Call</button></form>",
            label: "Free Call Request",
          },
        },
        {
          id: "book-a-call-faq",
          type: "faq-accordion",
          props: {
            heading: "What to expect",
            multiple: false,
            items: [
              {
                question: "Is this therapy?",
                answer:
                  "No. Coaching is forward-focused — we work on decisions, patterns, and next steps, not diagnosing or treating mental health conditions. If something bigger is going on, I'll say so on the call and point you toward a therapist I trust.",
              },
              {
                question: "What happens on the free call?",
                answer:
                  "We talk for about 20 minutes about what's bringing you to coaching right now. I'll ask a few direct questions, explain how I work, and tell you honestly whether I think we're a fit — including if I don't.",
              },
              {
                question: "Do I need to prepare anything?",
                answer:
                  "No prep required. Show up with whatever's actually on your mind — a decision you're stuck on, a pattern you're tired of, or just a general sense that something needs to change.",
              },
              {
                question: "How soon can we start?",
                answer:
                  "Most clients begin their first full session within a week or two of the free call, depending on caseload — active 1:1 clients are capped at eighteen so every session gets real attention.",
              },
              {
                question: "What if it's not the right fit?",
                answer:
                  "Then I'll tell you plainly, and if I know a coach or therapist who'd serve you better, I'll make the introduction. A wrong-fit client isn't good for either of us.",
              },
            ],
          },
        },
        {
          id: "book-a-call-footer",
          type: "rich-footer",
          props: {
            brand_name: "Crossroads Coaching",
            tagline: "Coaching for people at a crossroads.",
            columns: [
              {
                heading: "Explore",
                links: [
                  { label: "Programs", href: "/programs" },
                  { label: "About Naomi", href: "/about" },
                  { label: "Book a Call", href: "/book-a-call" },
                ],
              },
              {
                heading: "Get in Touch",
                links: [
                  { label: "Book a Free Call", href: "/book-a-call" },
                  { label: "Call (720) 555-0134", href: "tel:+17205550134" },
                ],
              },
            ],
            social_links: [
              { platform: "instagram", href: "#" },
              { platform: "linkedin", href: "#" },
            ],
            hours: "Mon–Thu 9am–5pm MT · Fri by appointment",
            small_print: "1901 Pearl Street, Boulder, CO 80302 · © 2026 Crossroads Coaching. All rights reserved.",
          },
        },
      ],
    },
  ],
};

export default coaching;
