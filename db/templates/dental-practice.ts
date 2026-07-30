import type { TemplateSeed } from "./types.js";

/**
 * Dental Practice template (Task C-dental-practice, category "Medical").
 *
 * Fictional business: Willowbrook Dental & TMJ Care, a family + cosmetic
 * dentistry practice on the riverfront in Chattanooga, TN, with a dedicated
 * TMJ / orofacial-pain program.
 *
 * Design reference: MUI's free "Marketing page" template
 * (mui.com/material-ui/getting-started/templates/marketing-page/) crossed
 * with Tailwind UI's "Salient" landing-page patterns — a clean, sectioned
 * marketing layout (hero band, icon feature grid, stat band, testimonial
 * carousel, FAQ, closing CTA) that reads clinical without feeling cold.
 *
 * Palette: calm clinical teal for the primary brand color, a softer sage
 * green for accents/CTAs, and a warm off-white (not stark white) surface so
 * the site feels welcoming rather than sterile.
 */
const navLinks = [
  { label: "Home", href: "/" },
  { label: "Services", href: "/services" },
  { label: "About", href: "/about" },
  { label: "New Patients", href: "/new-patients" },
  { label: "Contact", href: "/contact" },
];

const navBar = (pageSlug: string) => ({
  id: `${pageSlug}-nav`,
  type: "nav-bar",
  props: {
    brand_name: "Willowbrook Dental & TMJ Care",
    links: navLinks,
    cta_label: "Book a Visit",
    cta_href: "/contact",
    variant: "cta",
  },
});

const footer = (pageSlug: string) => ({
  id: `${pageSlug}-footer`,
  type: "rich-footer",
  props: {
    brand_name: "Willowbrook Dental & TMJ Care",
    tagline: "Family, cosmetic & TMJ dentistry on the Chattanooga riverfront.",
    columns: [
      {
        heading: "Explore",
        links: [
          { label: "Services", href: "/services" },
          { label: "About", href: "/about" },
          { label: "New Patients", href: "/new-patients" },
          { label: "Contact", href: "/contact" },
        ],
      },
      {
        heading: "Patient Resources",
        links: [
          { label: "New Patient Forms", href: "/new-patients" },
          { label: "Insurance & Financing", href: "/new-patients" },
          { label: "Emergency Care", href: "/services" },
        ],
      },
    ],
    social_links: [
      { platform: "facebook", href: "https://facebook.com/willowbrookdentaltn" },
      { platform: "instagram", href: "https://instagram.com/willowbrookdentaltn" },
    ],
    hours: "Mon–Thu 7:30am–5pm · Fri 8am–1pm · Sat–Sun Closed",
    small_print: "© 2026 Willowbrook Dental & TMJ Care. All rights reserved.",
  },
});

export const dentalPractice: TemplateSeed = {
  slug: "dental-practice",
  name: "Dental & TMJ Practice",
  description: "A warm, clinical family and cosmetic dentistry practice with TMJ care, insurance info, and new-patient forms.",
  brand_tokens: {
    "--theme-main": "#2F6F72",
    "--theme-on-main": "#FFFFFF",
    "--theme-accent": "#4F8B6E",
    "--theme-on-accent": "#FFFFFF",
    "--theme-surface": "#F7F3EC",
    "--theme-on-surface": "#2B2420",
  },
  category: "Medical",
  sort_order: 10,
  cover: {
    stock_query: "modern dental clinic",
    alt: "Bright, modern dental exam room with natural light",
  },
  pages: [
    {
      slug: "home",
      title: "Home",
      sort_order: 0,
      seo: {
        title: "Chattanooga Dentist | Willowbrook Dental & TMJ",
        description:
          "Family, cosmetic, and emergency dentistry plus TMJ care in Chattanooga, TN. Same-day appointments, gentle care, and a team that actually listens.",
      },
      blocks: [
        navBar("home"),
        {
          id: "home-announcement",
          type: "announcement-bar",
          props: {
            text: "New patients: complimentary whitening consultation with your first exam this month.",
            link_label: "Learn more",
            link_href: "/new-patients",
          },
        },
        {
          id: "home-hero",
          type: "hero",
          props: {
            eyebrow: "Chattanooga Family & Cosmetic Dentistry",
            title: "Dental care that actually fits your life.",
            subtitle:
              "General, cosmetic, and emergency dentistry plus dedicated TMJ and jaw pain treatment — all in one riverfront office.",
            cta_label: "Request an Appointment",
            cta_href: "/contact",
            align: "left",
          },
        },
        {
          id: "home-feature-grid",
          type: "feature-grid",
          props: {
            eyebrow: "How we help",
            heading: "Everything your smile needs, under one roof",
            items: [
              { icon: "🦷", title: "General Dentistry", body: "Exams, cleanings, fillings, and crowns to keep your everyday dental health on track." },
              { icon: "✨", title: "Cosmetic Dentistry", body: "Veneers, whitening, and Invisalign for a smile you're excited to show." },
              { icon: "🦴", title: "TMJ & Jaw Pain Relief", body: "Nightguards, therapy referrals, and Botox for jaw tension and TMJ disorders." },
              { icon: "🚨", title: "Same-Day Emergency Care", body: "Toothaches, chipped teeth, and other dental emergencies seen the day you call." },
            ],
          },
        },
        {
          id: "home-stats",
          type: "stats-band",
          props: {
            heading: "Chattanooga trusts Willowbrook",
            stats: [
              { value: "18+", label: "Years serving Chattanooga families" },
              { value: "4,200+", label: "Active patients we see each year" },
              { value: "4.9★", label: "Average rating across 900+ reviews" },
              { value: "Same-day", label: "Emergency slots held most weekdays" },
            ],
          },
        },
        {
          id: "home-testimonials",
          type: "testimonial-carousel",
          props: {
            heading: "What our patients say",
            items: [
              { quote: "I chipped a tooth on a Tuesday morning and they had me in a chair by noon. No lecture about how long it had been since my last cleaning, either.", author: "Rachel Osei", role: "Patient since 2016" },
              { quote: "Dr. Nair is the first dentist who took my jaw pain seriously instead of just telling me to stop grinding my teeth. The nightguard actually worked.", author: "Marcus Webb", role: "TMJ patient" },
              { quote: "We bring all three kids here now. The hygienists are patient with our five-year-old and somehow that never feels like a big deal to them.", author: "Priya Shah", role: "Patient since 2019" },
            ],
            autoplay: true,
            interval_ms: 6000,
          },
        },
        {
          id: "home-cta",
          type: "cta",
          props: {
            heading: "Ready to feel good about your next appointment?",
            body: "Tell us what you need and we'll find a time that works — most requests get a same-week slot.",
            button_label: "Schedule Now",
            button_href: "/contact",
            variant: "primary",
          },
        },
        footer("home"),
      ],
    },
    {
      slug: "services",
      title: "Services",
      sort_order: 1,
      seo: {
        title: "Dental Services | Willowbrook Dental & TMJ Care",
        description:
          "General, cosmetic, and emergency dentistry plus TMJ and jaw pain treatment in Chattanooga. Cleanings, veneers, whitening, and same-day relief.",
      },
      blocks: [
        navBar("services"),
        {
          id: "services-hero",
          type: "hero",
          props: {
            eyebrow: "Our Services",
            title: "Comprehensive dentistry for every stage of life",
            subtitle:
              "From routine cleanings to same-day emergencies to TMJ relief, one Chattanooga office covers it all.",
            cta_label: "See New Patient Info",
            cta_href: "/new-patients",
            align: "center",
          },
        },
        {
          id: "services-overview-grid",
          type: "feature-grid",
          props: {
            heading: "Four ways we take care of you",
            items: [
              { icon: "🦷", title: "General Dentistry", body: "Exams, cleanings, fillings, and crowns to keep your everyday dental health on track." },
              { icon: "✨", title: "Cosmetic Dentistry", body: "Veneers, whitening, and Invisalign for a smile you're excited to show." },
              { icon: "🚨", title: "Emergency Dentistry", body: "Same-day appointments for toothaches, chipped teeth, and other dental emergencies." },
              { icon: "🦴", title: "TMJ & Jaw Pain", body: "Nightguards, therapy referrals, and Botox for jaw tension and TMJ disorders." },
            ],
          },
        },
        {
          id: "services-general-split",
          type: "split-hero",
          props: {
            eyebrow: "General Dentistry",
            heading: "Preventive care that keeps small problems small",
            body: "Twice-a-year cleanings and exams catch cavities and gum trouble long before they turn into root canals. We use digital X-rays — a fraction of the radiation of old film — and walk you through exactly what we see, chair-side, on a screen you can actually read. When something does need fixing, we explain the options before we touch a drill.",
            primary_cta_label: "Book a Cleaning",
            primary_cta_href: "/contact",
            image_alt: "Dental hygienist performing a routine cleaning at Willowbrook Dental",
            variant: "image-right",
          },
        },
        {
          id: "services-cosmetic-split",
          type: "split-hero",
          props: {
            eyebrow: "Cosmetic Dentistry",
            heading: "Smile changes that still look like you",
            body: "Porcelain veneers, professional whitening, and clear Invisalign aligners are our most-requested cosmetic treatments, and every case starts with a no-pressure consultation and a digital preview of your results. Most whitening patients see a noticeable difference in one visit; veneer cases typically take two.",
            primary_cta_label: "Ask About Veneers",
            primary_cta_href: "/contact",
            image_alt: "Before and after smile comparison from a cosmetic dentistry patient",
            variant: "image-left",
          },
        },
        {
          id: "services-emergency-rich",
          type: "rich-text",
          props: {
            html: "<h2>Emergency Dentistry</h2><p>We hold same-day slots every weekday morning specifically for dental emergencies — you don't need to have been seen here before. Call by 9 a.m. and we'll do everything possible to get you in that day.</p><ul><li>Severe toothache or abscess</li><li>Chipped, cracked, or knocked-out tooth</li><li>Lost filling or crown</li><li>Swelling, bleeding, or facial trauma</li></ul><p>If you're unsure whether something counts as an emergency, call anyway — our front desk team is trained to help you figure out how urgent it is.</p>",
            max_width: "medium",
          },
        },
        {
          id: "services-tmj-rich",
          type: "rich-text",
          props: {
            html: "<h2>TMJ &amp; Jaw Pain Therapy</h2><p>Clicking, popping, morning headaches, and a jaw that won't fully open are all signs of temporomandibular joint (TMJ) dysfunction — and it's treatable without surgery for most patients. Dr. Nair starts every case with a full bite and joint evaluation, then builds a plan that may include:</p><ul><li>A custom nightguard to stop nighttime clenching and grinding</li><li>Referral to a TMJ-trained physical therapist</li><li>Botox injections to relax overworked jaw muscles</li><li>Bite adjustment for patients whose teeth don't meet evenly</li></ul><p>Many patients have lived with jaw pain for years before finding us — you don't have to keep living with it.</p>",
            max_width: "medium",
          },
        },
        {
          id: "services-faq",
          type: "faq-accordion",
          props: {
            heading: "Services FAQs",
            items: [
              { question: "Do you accept my dental insurance?", answer: "We're in-network with most major PPO plans, including Delta Dental, Cigna, Aetna, and MetLife. Bring your card to your first visit and our team will verify your benefits before you're seen." },
              { question: "What if I'm in pain right now?", answer: "Call the office and ask for a same-day emergency slot — we hold time in the schedule every day for toothaches, chipped teeth, and jaw pain flare-ups." },
              { question: "Do you treat TMJ without surgery?", answer: "Yes. Most patients respond well to a custom nightguard, targeted physical therapy, and in some cases Botox for jaw muscle tension — we start conservative and go from there." },
              { question: "How long does a routine cleaning take?", answer: "Plan on about 60 minutes for a first visit (exam, X-rays, and cleaning) and 45 minutes for regular six-month cleanings after that." },
              { question: "Do you offer payment plans for cosmetic work?", answer: "Yes — we work with CareCredit and offer in-house payment plans for veneers, whitening, and Invisalign so you can spread out the cost." },
            ],
            multiple: false,
          },
        },
        {
          id: "services-cta",
          type: "cta",
          props: {
            heading: "Not sure which service you need?",
            body: "Tell us what's going on and we'll point you in the right direction — no obligation.",
            button_label: "Ask Us a Question",
            button_href: "/contact",
            variant: "primary",
          },
        },
        footer("services"),
      ],
    },
    {
      slug: "about",
      title: "About",
      sort_order: 2,
      seo: {
        title: "About Us | Willowbrook Dental & TMJ Care",
        description:
          "Meet the Chattanooga dentists behind Willowbrook Dental & TMJ Care: Dr. Meredith Colston and Dr. Rahul Nair, and the story of a practice built on trust.",
      },
      blocks: [
        navBar("about"),
        {
          id: "about-hero",
          type: "hero",
          props: {
            eyebrow: "About Us",
            title: "Care built around Chattanooga families",
            subtitle: "Eighteen years on the riverfront, one patient at a time.",
            align: "left",
          },
        },
        {
          id: "about-story-rich",
          type: "rich-text",
          props: {
            html: "<h2>A practice built around Chattanooga</h2><p>Willowbrook Dental &amp; TMJ Care opened its doors on the Riverfront in 2008 with a simple idea: dental visits shouldn't feel rushed, confusing, or cold. What started as a single-chair family practice has grown into a full-service dental home for more than 4,200 patients — without losing the parts that made it work in the first place.</p><p>We still explain every X-ray in plain English. We still hold same-day slots for the mornings when a filling falls out or a tooth won't stop aching. And in 2019, we added dedicated TMJ and orofacial pain care, because so many of our own patients were living with jaw pain no one else had taken seriously.</p>",
            max_width: "medium",
          },
        },
        {
          id: "about-values-grid",
          type: "feature-grid",
          props: {
            heading: "What guides how we treat you",
            items: [
              { icon: "🤝", title: "Comfort first", body: "Every room, every explanation, every treatment plan is built around one question: what will make this easier for you?" },
              { icon: "📋", title: "Honest treatment plans", body: "We show you the X-ray, explain the options, and never recommend work you don't need." },
              { icon: "⏱", title: "Same-day access", body: "Toothaches and jaw flare-ups don't wait for next Tuesday, so neither do we." },
              { icon: "👨‍👩‍👧", title: "Whole-family care", body: "From a child's first cleaning to a grandparent's dentures, one office grows with you." },
            ],
          },
        },
        {
          id: "about-dr-colston-split",
          type: "split-hero",
          props: {
            eyebrow: "Founder & Family Dentist",
            heading: "Dr. Meredith Colston, DDS",
            body: "Dr. Colston founded Willowbrook Dental in 2008 after ten years practicing in Nashville. A graduate of the University of Tennessee College of Dentistry, she focuses on family and cosmetic dentistry and still sees some of the first patients she ever treated in Chattanooga. Outside the office, she volunteers with the Tennessee Mission of Mercy free dental clinic.",
            primary_cta_label: "Request Dr. Colston",
            primary_cta_href: "/contact",
            image_alt: "Dr. Meredith Colston smiling in an exam room at Willowbrook Dental",
            variant: "image-right",
          },
        },
        {
          id: "about-dr-nair-split",
          type: "split-hero",
          props: {
            eyebrow: "TMJ & Orofacial Pain",
            heading: "Dr. Rahul Nair, DMD",
            body: "Dr. Nair joined Willowbrook in 2021 after a fellowship in orofacial pain and TMJ disorders at the University of Kentucky. He built our TMJ program from the ground up, combining custom nightguards, physical-therapy partnerships, and Botox therapy for patients who've been told to just live with jaw pain.",
            primary_cta_label: "Request Dr. Nair",
            primary_cta_href: "/contact",
            image_alt: "Dr. Rahul Nair reviewing a jaw X-ray with a patient",
            variant: "image-left",
          },
        },
        {
          id: "about-cta",
          type: "cta",
          props: {
            heading: "Meet the team in person",
            body: "The best way to know if we're the right fit is a conversation — come by for a consultation.",
            button_label: "Schedule a Visit",
            button_href: "/contact",
            variant: "primary",
          },
        },
        footer("about"),
      ],
    },
    {
      slug: "new-patients",
      title: "New Patients",
      sort_order: 3,
      seo: {
        title: "New Patients | Willowbrook Dental & TMJ Care",
        description:
          "What to expect at your first visit to Willowbrook Dental in Chattanooga: insurance, financing, forms, and a walkthrough of your exam and consultation.",
      },
      blocks: [
        navBar("new-patients"),
        {
          id: "new-patients-hero",
          type: "hero",
          props: {
            eyebrow: "New Patients",
            title: "Here's exactly what to expect at your first visit",
            subtitle: "No confusing paperwork pile — just a clear plan from the moment you walk in.",
            cta_label: "Fill Out Your Forms",
            cta_href: "#new-patients-forms",
            align: "left",
          },
        },
        {
          id: "new-patients-steps-grid",
          type: "feature-grid",
          props: {
            heading: "Your first visit, step by step",
            items: [
              { icon: "1", title: "Before you arrive", body: "Fill out your new patient forms online, or arrive 15 minutes early to complete them in office. Have your insurance card and ID ready." },
              { icon: "2", title: "Your exam & consultation", body: "Digital X-rays, a full exam, and a conversation about your goals and any pain or concerns — no drilling on day one unless it's an emergency." },
              { icon: "3", title: "Insurance & payment", body: "We verify your benefits before you're seen and walk through any out-of-pocket costs so there's nothing you're finding out later." },
              { icon: "4", title: "Your personalized plan", body: "You'll leave with a written treatment plan and timeline, prioritized by what matters most first." },
            ],
          },
        },
        {
          id: "new-patients-insurance-rich",
          type: "rich-text",
          props: {
            html: "<h2>Insurance &amp; Financing</h2><p>We're in-network with most major PPO plans, including Delta Dental, Cigna, Aetna, MetLife, and Guardian. Out-of-network? We'll still file your claims and help you maximize whatever reimbursement your plan offers.</p><p>For treatment not fully covered by insurance, we offer interest-free in-house payment plans and accept CareCredit for larger cosmetic or restorative cases. Our front desk team can walk you through the numbers before you commit to anything.</p>",
            max_width: "medium",
          },
        },
        {
          id: "new-patients-faq",
          type: "faq-accordion",
          props: {
            heading: "New Patient FAQs",
            items: [
              { question: "What should I bring to my first appointment?", answer: "Bring a photo ID, your insurance card, and a list of any current medications. If you have recent X-rays from a previous dentist, ask them to send those ahead of time." },
              { question: "How early should I arrive?", answer: "Please arrive 15 minutes before your scheduled time to complete or confirm your paperwork, or fill out the new patient forms online ahead of time to skip the wait." },
              { question: "Do you see children?", answer: "Yes — we welcome patients of every age, from a child's first visit through adult and senior care, all in the same office." },
              { question: "Can I get a TMJ evaluation as a new patient?", answer: "Absolutely. Mention jaw pain, clicking, or headaches when you book and we'll add a TMJ screening to your first visit at no extra charge." },
            ],
            multiple: false,
          },
        },
        {
          id: "new-patients-forms",
          type: "crm_form",
          props: {
            embed_code:
              '<iframe title="Willowbrook Dental New Patient Intake Form" src="https://forms.willowbrookdental.com/new-patient-intake" width="100%" height="900" style="border:0;"></iframe>',
            label: "New Patient Forms",
          },
        },
        footer("new-patients"),
      ],
    },
    {
      slug: "contact",
      title: "Contact",
      sort_order: 4,
      seo: {
        title: "Contact Us | Willowbrook Dental & TMJ Care",
        description:
          "Visit Willowbrook Dental & TMJ Care on the Chattanooga riverfront. Office hours, directions, phone number, and a quick way to send us a message online.",
      },
      blocks: [
        navBar("contact"),
        {
          id: "contact-hero",
          type: "hero",
          props: {
            eyebrow: "Contact & Location",
            title: "Come see us on the Riverfront",
            subtitle: "Call, request an appointment online, or stop by — we're two blocks from the Tennessee Aquarium.",
            cta_label: "Call the Office",
            cta_href: "tel:+14235550198",
            align: "left",
          },
        },
        {
          id: "contact-phone",
          type: "phone_number",
          props: {
            number: "+14235550198",
            display: "(423) 555-0198",
          },
        },
        {
          id: "contact-hours-rich",
          type: "rich-text",
          props: {
            html: "<h2>Office Hours</h2><ul><li>Monday–Thursday: 7:30 AM – 5:00 PM</li><li>Friday: 8:00 AM – 1:00 PM</li><li>Saturday &amp; Sunday: Closed</li></ul><h2>Location</h2><p>1425 Riverfront Parkway, Suite 200<br>Chattanooga, TN 37402</p><p>Free parking is available in the Riverfront Parkway garage directly behind our building; validate your ticket at the front desk.</p>",
            max_width: "medium",
          },
        },
        {
          id: "contact-office-image",
          type: "image",
          props: {
            alt: "Willowbrook Dental & TMJ Care reception area overlooking the Tennessee River",
            fit: "cover",
          },
        },
        {
          id: "contact-form",
          type: "crm_form",
          props: {
            embed_code:
              '<iframe title="Contact Willowbrook Dental" src="https://forms.willowbrookdental.com/contact" width="100%" height="700" style="border:0;"></iframe>',
            label: "Send Us a Message",
          },
        },
        footer("contact"),
      ],
    },
  ],
};

export default dentalPractice;
