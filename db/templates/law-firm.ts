import type { TemplateSeed } from "./types.js";

/**
 * Law Firm template (Task C5-C14, slug `law-firm`).
 *
 * Fictional business: Ashford & Voss LLP, a litigation and estate-planning
 * firm founded in 1988, practicing out of a historic office on Chippewa
 * Square in Savannah, Georgia. Founding partners Katherine Ashford
 * (business & civil litigation) and Desmond Voss (estate planning &
 * probate), with two associates rounding out the practice.
 *
 * Design reference: a refined professional-services layout in the vein of
 * Tailwind UI's free "law firm" / professional-services marketing
 * sections — a restrained, authority-first hero (no imagery competing with
 * the headline), a plain feature grid for practice areas, and a full-bleed
 * stats band for firm credentials — recomposed with a deliberately
 * conservative, established-firm rhythm (long-form rich-text practice
 * detail and attorney bios instead of card grids) rather than the punchier,
 * CTA-forward pattern used for contractor/retail templates.
 *
 * Brand tokens: deep ink-forest (`--theme-main`) for chrome/nav/footer,
 * an aged brass (`--theme-accent`) for CTAs and small accents, and a warm
 * parchment (`--theme-surface`) for body copy — a law-library palette
 * meant to read as established rather than trendy. The token schema
 * (`src/blocks/brand-tokens.ts`) only accepts CSS color values (hex /
 * rgb() / hsl() / var() / basic named colors) — there is no font-family
 * token, so the "serif-adjacent" feel called for in this task is carried
 * entirely through copy voice and restrained CTA density, not a type
 * token (none exists to set).
 *
 * Imagery: no `image` blocks are authored, and no `split-hero` is used for
 * attorney bios (split-hero renders its heading as an `<h1>`, which would
 * put a second `<h1>` on a page that already opens with a page-level
 * `hero` — see attorneys page below, which uses `rich-text` bios instead
 * so every page keeps exactly one `<h1>`). The AI agent imports real
 * photography post-creation (starter.ts precedent) — `cover` is the only
 * image-shaped field this template supplies content for.
 */
export const lawFirm: TemplateSeed = {
  slug: "law-firm",
  name: "Law Firm",
  description:
    "An established litigation and estate-planning firm site — authority hero, practice areas, attorney bios, case results with ethics-safe copy, and a consultation request form.",
  category: "Legal",
  sort_order: 40,
  brand_tokens: {
    "--theme-main": "#1f2d27",
    "--theme-on-main": "#f4ecd8",
    "--theme-accent": "#8a6a3a",
    "--theme-on-accent": "#ffffff",
    "--theme-surface": "#f4ecd8",
    "--theme-on-surface": "#24211b",
    "--theme-muted": "#e6dcc2",
    "--theme-on-muted": "#33301f",
  },
  cover: {
    stock_query: "law office library",
    alt: "Warm, wood-paneled law library with leather chairs and legal volumes, evoking Ashford & Voss LLP's Savannah office",
  },
  pages: [
    // ---------------------------------------------------------------
    // HOME — authority hero, practice-area grid, firm results stats.
    // ---------------------------------------------------------------
    {
      slug: "home",
      title: "Home",
      sort_order: 0,
      seo: {
        title: "Ashford & Voss LLP | Savannah Litigation & Estate Law",
        description:
          "Ashford & Voss LLP is a Savannah, Georgia litigation and estate-planning firm serving clients since 1988, from business disputes to wills, trusts, and probate.",
      },
      blocks: [
        {
          id: "home-nav",
          type: "nav-bar",
          props: {
            brand_name: "Ashford & Voss LLP",
            links: [
              { label: "Home", href: "/" },
              { label: "Practice Areas", href: "/practice-areas" },
              { label: "Attorneys", href: "/attorneys" },
              { label: "Results", href: "/results" },
              { label: "Contact", href: "/contact" },
            ],
            cta_label: "Schedule a Consultation",
            cta_href: "/contact",
            variant: "cta",
          },
        },
        {
          id: "home-hero",
          type: "hero",
          props: {
            eyebrow: "Savannah Litigation & Estate Counsel Since 1988",
            title: "Trusted Counsel for Savannah's Toughest Legal Matters.",
            subtitle:
              "Ashford & Voss LLP has represented Savannah families and businesses for nearly four decades — in the courtroom when a dispute demands it, and at the table when planning an estate for the next generation.",
            cta_label: "Schedule a Consultation",
            cta_href: "/contact",
            align: "left",
          },
        },
        {
          id: "home-practice-grid",
          type: "feature-grid",
          props: {
            eyebrow: "Practice Areas",
            heading: "Focused counsel across litigation and estate matters.",
            items: [
              {
                icon: "shield",
                title: "Business & Commercial Litigation",
                body: "Contract disputes, partnership dissolutions, and business torts, from pre-suit negotiation through trial.",
              },
              {
                icon: "users",
                title: "Personal Injury Litigation",
                body: "Representing injured Savannah-area residents against negligent drivers, property owners, and businesses.",
              },
              {
                icon: "check",
                title: "Estate Planning & Wills",
                body: "Wills, powers of attorney, and healthcare directives drafted to reflect exactly what you intend.",
              },
              {
                icon: "award",
                title: "Trusts & Probate Administration",
                body: "Revocable and irrevocable trusts, plus probate and estate administration for Chatham County families.",
              },
              {
                icon: "heart",
                title: "Elder Law",
                body: "Long-term care planning, guardianship, and Medicaid planning for aging clients and their families.",
              },
              {
                icon: "star",
                title: "Real Estate & Title Disputes",
                body: "Boundary disputes, title defects, and easement litigation for Savannah homeowners and developers.",
              },
            ],
          },
        },
        {
          id: "home-stats",
          type: "stats-band",
          props: {
            heading: "Nearly four decades of results for Savannah clients.",
            stats: [
              { value: "38", label: "Years in practice" },
              { value: "1,200+", label: "Matters resolved" },
              { value: "24", label: "Trial verdicts" },
              { value: "4.9/5", label: "Client rating" },
            ],
          },
        },
        {
          id: "home-cta",
          type: "cta",
          props: {
            heading: "Ready to discuss your case?",
            body: "Every matter starts with a conversation. Tell us what's going on and we'll tell you where you stand.",
            button_label: "Schedule a Consultation",
            button_href: "/contact",
            variant: "primary",
          },
        },
        {
          id: "home-footer",
          type: "rich-footer",
          props: {
            brand_name: "Ashford & Voss LLP",
            tagline: "Litigation and estate-planning counsel serving Savannah, Georgia since 1988.",
            columns: [
              {
                heading: "Practice Areas",
                links: [
                  { label: "Litigation", href: "/practice-areas" },
                  { label: "Estate Planning", href: "/practice-areas" },
                  { label: "Elder Law", href: "/practice-areas" },
                ],
              },
              {
                heading: "Firm",
                links: [
                  { label: "Attorneys", href: "/attorneys" },
                  { label: "Results", href: "/results" },
                  { label: "Contact", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "linkedin", href: "https://linkedin.com/company/ashford-voss-llp" },
              { platform: "facebook", href: "https://facebook.com/ashfordvossllp" },
            ],
            hours: "Mon-Fri 8:30am-5:30pm · Consultations by Appointment",
            small_print: "Georgia Bar Registered · © 2026 Ashford & Voss LLP. Attorney Advertising. Prior results do not guarantee a similar outcome.",
          },
        },
      ],
    },
    // ---------------------------------------------------------------
    // PRACTICE AREAS — detailed rich-text sections, grouped by practice.
    // ---------------------------------------------------------------
    {
      slug: "practice-areas",
      title: "Practice Areas",
      sort_order: 1,
      seo: {
        title: "Practice Areas | Ashford & Voss LLP",
        description:
          "Explore Ashford & Voss LLP's litigation practice — business, injury, and real estate disputes — plus estate planning, trusts, probate, and elder law services.",
      },
      blocks: [
        {
          id: "practice-areas-nav",
          type: "nav-bar",
          props: {
            brand_name: "Ashford & Voss LLP",
            links: [
              { label: "Home", href: "/" },
              { label: "Practice Areas", href: "/practice-areas" },
              { label: "Attorneys", href: "/attorneys" },
              { label: "Results", href: "/results" },
              { label: "Contact", href: "/contact" },
            ],
            cta_label: "Schedule a Consultation",
            cta_href: "/contact",
            variant: "cta",
          },
        },
        {
          id: "practice-areas-hero",
          type: "hero",
          props: {
            eyebrow: "What We Do",
            title: "Two Practices. One Standard of Care.",
            subtitle:
              "We keep our focus narrow on purpose — litigation and estate planning — so every matter gets a partner's attention, not a junior associate learning on your case.",
            align: "center",
          },
        },
        {
          id: "practice-areas-litigation",
          type: "rich-text",
          props: {
            html:
              "<h2>Litigation</h2><p>When a dispute can't be resolved at the table, Ashford &amp; Voss LLP prepares every case as though it will be tried — because in Chatham County Superior Court, sometimes it is. Our litigation team has tried cases to verdict in business, personal injury, and real estate disputes across the Savannah metro.</p>" +
              "<h3>Business &amp; Commercial Litigation</h3><p>We represent Savannah businesses and business owners in contract disputes, partnership dissolutions, non-compete enforcement, and business torts. Founding partner Katherine Ashford has led trial teams in commercial disputes ranging from single-location retailers to regional distributors.</p>" +
              "<h3>Personal Injury Litigation</h3><p>Car and truck collisions, premises liability, and negligence claims against businesses that cut corners on safety. We work on contingency for injury matters and handle every step, from the initial investigation through settlement negotiation or trial.</p>" +
              "<h3>Real Estate &amp; Title Disputes</h3><p>Boundary disputes, easement conflicts, title defects uncovered during a sale, and construction-related claims. Savannah's historic lot lines and older title chains create disputes that newer firms often haven't seen before — we have.</p>",
            max_width: "medium",
          },
        },
        {
          id: "practice-areas-estate",
          type: "rich-text",
          props: {
            html:
              "<h2>Estate Planning &amp; Elder Law</h2><p>Founding partner Desmond Voss built our estate planning practice around a simple premise: a plan is only good if the people you love can actually use it. Every engagement starts with a plain-language conversation about what you want to happen, then translates that into documents that hold up.</p>" +
              "<h3>Wills &amp; Estate Planning</h3><p>Wills, durable powers of attorney, and healthcare directives drafted around your family's actual situation — blended families, out-of-state heirs, and closely held businesses all change what a good plan looks like.</p>" +
              "<h3>Trusts &amp; Probate Administration</h3><p>Revocable living trusts to avoid probate, irrevocable trusts for tax and asset-protection planning, and full probate and estate administration for families settling a loved one's affairs in Chatham County.</p>" +
              "<h3>Elder Law</h3><p>Long-term care planning, Medicaid planning and eligibility, and guardianship or conservatorship proceedings for aging clients and the family members supporting them.</p>",
            max_width: "medium",
          },
        },
        {
          id: "practice-areas-cta",
          type: "cta",
          props: {
            heading: "Not sure which practice fits your situation?",
            body: "Most matters touch more than one area of the law. Tell us what's going on and we'll point you to the right attorney.",
            button_label: "Schedule a Consultation",
            button_href: "/contact",
            variant: "muted",
          },
        },
        {
          id: "practice-areas-footer",
          type: "rich-footer",
          props: {
            brand_name: "Ashford & Voss LLP",
            tagline: "Litigation and estate-planning counsel serving Savannah, Georgia since 1988.",
            columns: [
              {
                heading: "Practice Areas",
                links: [
                  { label: "Litigation", href: "/practice-areas" },
                  { label: "Estate Planning", href: "/practice-areas" },
                  { label: "Elder Law", href: "/practice-areas" },
                ],
              },
              {
                heading: "Firm",
                links: [
                  { label: "Attorneys", href: "/attorneys" },
                  { label: "Results", href: "/results" },
                  { label: "Contact", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "linkedin", href: "https://linkedin.com/company/ashford-voss-llp" },
              { platform: "facebook", href: "https://facebook.com/ashfordvossllp" },
            ],
            hours: "Mon-Fri 8:30am-5:30pm · Consultations by Appointment",
            small_print: "Georgia Bar Registered · © 2026 Ashford & Voss LLP. Attorney Advertising. Prior results do not guarantee a similar outcome.",
          },
        },
      ],
    },
    // ---------------------------------------------------------------
    // ATTORNEYS — roster grid + detailed bios (rich-text, not
    // split-hero, so the page keeps a single <h1>).
    // ---------------------------------------------------------------
    {
      slug: "attorneys",
      title: "Attorneys",
      sort_order: 2,
      seo: {
        title: "Attorneys | Ashford & Voss LLP",
        description:
          "Meet the litigation and estate-planning attorneys of Ashford & Voss LLP in Savannah, Georgia — two founding partners and two associates focused on your case.",
      },
      blocks: [
        {
          id: "attorneys-nav",
          type: "nav-bar",
          props: {
            brand_name: "Ashford & Voss LLP",
            links: [
              { label: "Home", href: "/" },
              { label: "Practice Areas", href: "/practice-areas" },
              { label: "Attorneys", href: "/attorneys" },
              { label: "Results", href: "/results" },
              { label: "Contact", href: "/contact" },
            ],
            cta_label: "Schedule a Consultation",
            cta_href: "/contact",
            variant: "cta",
          },
        },
        {
          id: "attorneys-hero",
          type: "hero",
          props: {
            eyebrow: "Our Attorneys",
            title: "The People Behind Your Case.",
            subtitle:
              "Four attorneys, two practices, and a firm small enough that a partner reviews every matter before it's filed.",
            align: "left",
          },
        },
        {
          id: "attorneys-roster",
          type: "feature-grid",
          props: {
            eyebrow: "Meet the Team",
            heading: "Litigation and estate planning, side by side.",
            items: [
              {
                icon: "shield",
                title: "Katherine Ashford",
                body: "Founding Partner — Business & Civil Litigation. Trying cases in Chatham County since 1988.",
              },
              {
                icon: "check",
                title: "Desmond Voss",
                body: "Founding Partner — Estate Planning & Probate. Plain-language plans for Savannah families.",
              },
              {
                icon: "users",
                title: "Priya Nandakumar",
                body: "Senior Associate — Personal Injury Litigation. Advocating for injured clients since 2014.",
              },
              {
                icon: "heart",
                title: "Julian Ferreira",
                body: "Associate — Trusts, Estates & Elder Law. Focused on long-term care and Medicaid planning.",
              },
            ],
          },
        },
        {
          id: "attorneys-bio-ashford",
          type: "rich-text",
          props: {
            html:
              "<h2>Katherine Ashford</h2><h3>Founding Partner, Business &amp; Civil Litigation</h3><p>Katherine co-founded Ashford &amp; Voss in 1988 after five years with an Atlanta litigation firm, choosing to build a trial practice in the city she grew up in. She has led trial teams in business disputes ranging from single-location retailers to regional distributors, and is known locally for preparing every case as though it will see a jury.</p><p>J.D., University of Georgia School of Law. Admitted to the Georgia Bar and the U.S. District Court for the Southern District of Georgia. Katherine also chairs the firm's pro bono committee, which handles a rotating docket of veterans' benefits appeals.</p>",
            max_width: "medium",
          },
        },
        {
          id: "attorneys-bio-voss",
          type: "rich-text",
          props: {
            html:
              "<h2>Desmond Voss</h2><h3>Founding Partner, Estate Planning &amp; Probate</h3><p>Desmond built the firm's estate planning practice around a simple premise: a plan is only good if the people you love can actually use it. Over more than three decades he has drafted plans for blended families, closely held business owners, and multi-generational Savannah households.</p><p>J.D., Emory University School of Law. Board Certified in Wills, Trusts &amp; Estate Planning Law. Desmond teaches an annual continuing-education course on Georgia probate procedure for the Savannah Bar Association.</p>",
            max_width: "medium",
          },
        },
        {
          id: "attorneys-bio-nandakumar",
          type: "rich-text",
          props: {
            html:
              "<h2>Priya Nandakumar</h2><h3>Senior Associate, Personal Injury Litigation</h3><p>Priya joined the firm in 2014 and has represented injured Savannah-area clients in car and truck collision cases, premises liability claims, and negligence matters against businesses that cut corners on safety. She handles every case personally, from the first client meeting through settlement negotiation or trial.</p><p>J.D., Georgia State University College of Law. Admitted to the Georgia Bar. Priya volunteers with the Georgia Legal Aid clinic's monthly walk-in hours.</p>",
            max_width: "medium",
          },
        },
        {
          id: "attorneys-bio-ferreira",
          type: "rich-text",
          props: {
            html:
              "<h2>Julian Ferreira</h2><h3>Associate, Trusts, Estates &amp; Elder Law</h3><p>Julian focuses on long-term care planning, Medicaid eligibility, and guardianship proceedings for aging clients and the families supporting them. He works closely with Desmond Voss on trust administration and probate matters, and is often the first attorney families speak with after a loved one's diagnosis changes their planning needs.</p><p>J.D., University of South Carolina School of Law. Admitted to the Georgia Bar. Julian is a certified guardian ad litem for Chatham County Probate Court.</p>",
            max_width: "medium",
          },
        },
        {
          id: "attorneys-cta",
          type: "cta",
          props: {
            heading: "Ready to talk to an attorney?",
            body: "Tell us about your situation and we'll connect you with the right person on our team.",
            button_label: "Schedule a Consultation",
            button_href: "/contact",
            variant: "primary",
          },
        },
        {
          id: "attorneys-footer",
          type: "rich-footer",
          props: {
            brand_name: "Ashford & Voss LLP",
            tagline: "Litigation and estate-planning counsel serving Savannah, Georgia since 1988.",
            columns: [
              {
                heading: "Practice Areas",
                links: [
                  { label: "Litigation", href: "/practice-areas" },
                  { label: "Estate Planning", href: "/practice-areas" },
                  { label: "Elder Law", href: "/practice-areas" },
                ],
              },
              {
                heading: "Firm",
                links: [
                  { label: "Attorneys", href: "/attorneys" },
                  { label: "Results", href: "/results" },
                  { label: "Contact", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "linkedin", href: "https://linkedin.com/company/ashford-voss-llp" },
              { platform: "facebook", href: "https://facebook.com/ashfordvossllp" },
            ],
            hours: "Mon-Fri 8:30am-5:30pm · Consultations by Appointment",
            small_print: "Georgia Bar Registered · © 2026 Ashford & Voss LLP. Attorney Advertising. Prior results do not guarantee a similar outcome.",
          },
        },
      ],
    },
    // ---------------------------------------------------------------
    // RESULTS — case results (ethics-safe copy) + testimonials.
    // ---------------------------------------------------------------
    {
      slug: "results",
      title: "Results",
      sort_order: 3,
      seo: {
        title: "Case Results | Ashford & Voss LLP",
        description:
          "See notable litigation outcomes from Ashford & Voss LLP in Savannah, Georgia, and hear from past clients. Prior results do not guarantee a similar outcome.",
      },
      blocks: [
        {
          id: "results-nav",
          type: "nav-bar",
          props: {
            brand_name: "Ashford & Voss LLP",
            links: [
              { label: "Home", href: "/" },
              { label: "Practice Areas", href: "/practice-areas" },
              { label: "Attorneys", href: "/attorneys" },
              { label: "Results", href: "/results" },
              { label: "Contact", href: "/contact" },
            ],
            cta_label: "Schedule a Consultation",
            cta_href: "/contact",
            variant: "cta",
          },
        },
        {
          id: "results-hero",
          type: "hero",
          props: {
            eyebrow: "Case Results",
            title: "Real Outcomes for Real Savannah Clients.",
            subtitle:
              "Every case is different — but our attorneys prepare each one for trial from the first meeting, which shapes how it resolves.",
            align: "left",
          },
        },
        {
          id: "results-stats",
          type: "stats-band",
          props: {
            heading: "Three decades of trial-ready advocacy.",
            stats: [
              { value: "38", label: "Years in practice" },
              { value: "$85M+", label: "Recovered for clients" },
              { value: "24", label: "Trial verdicts" },
              { value: "1,200+", label: "Matters resolved" },
            ],
          },
        },
        {
          id: "results-cases",
          type: "rich-text",
          props: {
            html:
              "<h2>Notable Matters</h2><p><strong>Past results do not guarantee or predict a similar outcome in any future case.</strong> Every legal matter turns on its own facts, and the outcomes described below reflect the specific circumstances of each client's case — they are not a promise about how a different case, including yours, will resolve.</p>" +
              "<h3>Commercial Contract Dispute — Business Litigation</h3><p>Represented a Savannah-based distributor in a breach-of-contract dispute with a former supplier. After a two-week bench trial in Chatham County Superior Court, the court entered judgment in the client's favor, including recovery of lost profits and attorney's fees.</p>" +
              "<h3>Premises Liability — Personal Injury</h3><p>Represented a client injured in a fall at a Savannah retail property due to a known, unrepaired hazard. The matter resolved through a negotiated settlement shortly before trial, after depositions established the property owner's knowledge of the hazard.</p>" +
              "<h3>Contested Probate — Estate Litigation</h3><p>Represented the named executor of an estate against a will contest brought by an excluded heir. The Probate Court upheld the will after a two-day hearing, and the estate was administered according to the decedent's wishes.</p>",
            max_width: "medium",
          },
        },
        {
          id: "results-testimonials",
          type: "testimonial-carousel",
          props: {
            heading: "What our clients say",
            autoplay: false,
            interval_ms: 6000,
            items: [
              {
                quote:
                  "Katherine prepared our case like it was going to trial from day one, and that's exactly why it settled on our terms. She never let the other side underestimate us.",
                author: "Robert Feld",
                role: "Business Litigation Client",
                avatar: "",
              },
              {
                quote:
                  "Desmond sat with my parents for two hours and asked questions no one else had thought to ask. The plan he wrote actually matches how our family works.",
                author: "Alicia Munroe",
                role: "Estate Planning Client",
                avatar: "",
              },
              {
                quote:
                  "Priya called me back the same night I was hurt and walked me through what to expect. She was straightforward the entire way, even when the news wasn't great.",
                author: "Bianca Solis",
                role: "Personal Injury Client",
                avatar: "",
              },
              {
                quote:
                  "Julian helped us navigate my mother's Medicaid application when we didn't know where to start. He explained every form in plain English.",
                author: "Sandra Kowalczyk",
                role: "Elder Law Client",
                avatar: "",
              },
            ],
          },
        },
        {
          id: "results-cta",
          type: "cta",
          props: {
            heading: "Have a legal matter to discuss?",
            body: "Every case is different — the best way to know where you stand is a direct conversation with an attorney.",
            button_label: "Schedule a Consultation",
            button_href: "/contact",
            variant: "primary",
          },
        },
        {
          id: "results-footer",
          type: "rich-footer",
          props: {
            brand_name: "Ashford & Voss LLP",
            tagline: "Litigation and estate-planning counsel serving Savannah, Georgia since 1988.",
            columns: [
              {
                heading: "Practice Areas",
                links: [
                  { label: "Litigation", href: "/practice-areas" },
                  { label: "Estate Planning", href: "/practice-areas" },
                  { label: "Elder Law", href: "/practice-areas" },
                ],
              },
              {
                heading: "Firm",
                links: [
                  { label: "Attorneys", href: "/attorneys" },
                  { label: "Results", href: "/results" },
                  { label: "Contact", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "linkedin", href: "https://linkedin.com/company/ashford-voss-llp" },
              { platform: "facebook", href: "https://facebook.com/ashfordvossllp" },
            ],
            hours: "Mon-Fri 8:30am-5:30pm · Consultations by Appointment",
            small_print: "Georgia Bar Registered · © 2026 Ashford & Voss LLP. Attorney Advertising. Prior results do not guarantee a similar outcome.",
          },
        },
      ],
    },
    // ---------------------------------------------------------------
    // CONTACT — consultation request (crm-form) + office details.
    // ---------------------------------------------------------------
    {
      slug: "contact",
      title: "Contact",
      sort_order: 4,
      seo: {
        title: "Contact | Ashford & Voss LLP",
        description:
          "Schedule a consultation with Ashford & Voss LLP in Savannah, Georgia. Call (912) 555-0148 or send your case details online to reach our litigation team.",
      },
      blocks: [
        {
          id: "contact-nav",
          type: "nav-bar",
          props: {
            brand_name: "Ashford & Voss LLP",
            links: [
              { label: "Home", href: "/" },
              { label: "Practice Areas", href: "/practice-areas" },
              { label: "Attorneys", href: "/attorneys" },
              { label: "Results", href: "/results" },
              { label: "Contact", href: "/contact" },
            ],
            cta_label: "Schedule a Consultation",
            cta_href: "/contact",
            variant: "cta",
          },
        },
        {
          id: "contact-hero",
          type: "hero",
          props: {
            eyebrow: "Schedule a Consultation",
            title: "Let's Talk About Your Case.",
            subtitle:
              "Tell us what's going on and a member of our team will follow up within one business day to schedule a consultation.",
            cta_label: "Call (912) 555-0148",
            cta_href: "tel:+19125550148",
            align: "left",
          },
        },
        {
          id: "contact-phone",
          type: "phone_number",
          props: {
            number: "+19125550148",
            display: "(912) 555-0148 — Office Line, Mon-Fri 8:30am-5:30pm",
          },
        },
        {
          id: "contact-form",
          type: "crm_form",
          props: {
            embed_code:
              "<form action=\"/api/leads\" method=\"post\" class=\"ashford-voss-consultation-form\"><label>Full Name<input type=\"text\" name=\"name\" required></label><label>Phone<input type=\"tel\" name=\"phone\" required></label><label>Email<input type=\"email\" name=\"email\" required></label><label>Practice Area<select name=\"practice_area\"><option>Business Litigation</option><option>Personal Injury</option><option>Estate Planning</option><option>Trusts &amp; Probate</option><option>Elder Law</option><option>Real Estate Dispute</option></select></label><label>Tell us about your situation<textarea name=\"details\" rows=\"4\" required></textarea></label><button type=\"submit\">Request a Consultation</button></form>",
            label: "Consultation Request Form",
          },
        },
        {
          id: "contact-office",
          type: "rich-text",
          props: {
            html:
              "<h2>Visit Our Office</h2><p><strong>Address:</strong> 14 Chippewa Square, Suite 300, Savannah, GA 31401.<br><strong>Office hours:</strong> Monday-Friday, 8:30 AM - 5:30 PM. Consultations available by appointment, including limited evening slots.<br><strong>Parking:</strong> Metered street parking on Chippewa Square, plus the Whitaker Street Garage two blocks north.</p>",
            max_width: "medium",
          },
        },
        {
          id: "contact-footer",
          type: "rich-footer",
          props: {
            brand_name: "Ashford & Voss LLP",
            tagline: "Litigation and estate-planning counsel serving Savannah, Georgia since 1988.",
            columns: [
              {
                heading: "Practice Areas",
                links: [
                  { label: "Litigation", href: "/practice-areas" },
                  { label: "Estate Planning", href: "/practice-areas" },
                  { label: "Elder Law", href: "/practice-areas" },
                ],
              },
              {
                heading: "Firm",
                links: [
                  { label: "Attorneys", href: "/attorneys" },
                  { label: "Results", href: "/results" },
                  { label: "Contact", href: "/contact" },
                ],
              },
            ],
            social_links: [
              { platform: "linkedin", href: "https://linkedin.com/company/ashford-voss-llp" },
              { platform: "facebook", href: "https://facebook.com/ashfordvossllp" },
            ],
            hours: "Mon-Fri 8:30am-5:30pm · Consultations by Appointment",
            small_print: "Georgia Bar Registered · © 2026 Ashford & Voss LLP. Attorney Advertising. Prior results do not guarantee a similar outcome.",
          },
        },
      ],
    },
  ],
};

export default lawFirm;
