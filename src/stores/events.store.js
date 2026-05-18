import { create } from "zustand";

/**
 * Events store — local state with seed data.
 * Swap the methods for API calls when backend is ready.
 */

const SEED_EVENTS = [
  {
    id: "1",
    slug: "lorem-ipsum-community-event",
    title: "Lorem Ipsum Community Event",
    date: "2026-04-12",
    time: "8:00 AM",
    location: "City, ST",
    image: "https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=800&q=80",
    excerpt: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    body: `## About This Event

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.

### What to Expect

- **8:00 AM** — Lorem ipsum dolor sit amet
- **8:15 AM** — Consectetur adipiscing elit
- **8:30 AM** — Sed do eiusmod tempor incididunt
- **9:30 AM** — Ut labore et dolore magna aliqua

### Who Should Attend

Praesent commodo cursus magna, vel scelerisque nisl consectetur et. Donec sed odio dui. Maecenas faucibus mollis interdum.

### What to Bring

- Vestibulum id ligula porta felis euismod
- Cras mattis consectetur purus sit amet
- Integer posuere erat a ante venenatis

Nullam quis risus eget urna mollis ornare vel eu leo.`,
    category: "Community",
    published: true,
  },
  {
    id: "2",
    slug: "praesent-commodo-workshop",
    title: "Praesent Commodo Workshop",
    date: "2026-04-19",
    time: "10:00 AM – 12:00 PM",
    location: "City, ST",
    image: "https://images.unsplash.com/photo-1591115765373-5207764f72e7?auto=format&fit=crop&w=800&q=80",
    excerpt: "Maecenas sed diam eget risus varius blandit sit amet non magna. Integer posuere erat a ante venenatis dapibus.",
    body: `## About This Event

Maecenas sed diam eget risus varius blandit sit amet non magna. Integer posuere erat a ante venenatis dapibus posuere velit aliquet.

### Topics Covered

- Donec ullamcorper nulla non metus auctor fringilla
- Vestibulum id ligula porta felis euismod semper
- Cras mattis consectetur purus sit amet fermentum
- Nullam quis risus eget urna mollis ornare
- Aenean lacinia bibendum nulla sed consectetur

### Format

Praesent commodo cursus magna, vel scelerisque nisl consectetur et. Donec sed odio dui.

### Details

- **Date:** April 19, 2026
- **Time:** 10:00 AM – 12:00 PM
- **Location:** City, ST
- **Cost:** Free
- **RSVP:** hello@example.com`,
    category: "Workshop",
    published: true,
  },
  {
    id: "3",
    slug: "vestibulum-networking-evening",
    title: "Vestibulum Networking Evening",
    date: "2026-05-03",
    time: "7:00 PM",
    location: "City, ST",
    image: "https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=800&q=80",
    excerpt: "Cras mattis consectetur purus sit amet fermentum. Vestibulum id ligula porta felis euismod semper.",
    body: `## About This Event

Cras mattis consectetur purus sit amet fermentum. Vestibulum id ligula porta felis euismod semper. Nullam quis risus eget urna mollis ornare vel eu leo.

### Why Attend

Donec ullamcorper nulla non metus auctor fringilla. Morbi leo risus, porta ac consectetur ac, vestibulum at eros.

### Details

- **Date:** May 3, 2026
- **Doors:** 7:00 PM
- **Program:** 8:00 PM – 10:30 PM
- **Location:** City, ST
- **Cost:** Free

### What to Expect

- Praesent commodo cursus magna
- Vel scelerisque nisl consectetur
- Donec sed odio dui maecenas
- Aenean lacinia bibendum nulla

Nullam id dolor id nibh ultricies vehicula ut id elit.`,
    category: "Social",
    published: true,
  },
];

let nextId = 4;

export const useEventsStore = create((set, get) => ({
  events: SEED_EVENTS,

  getPublishedEvents: () =>
    get()
      .events.filter((e) => e.published)
      .sort((a, b) => new Date(a.date) - new Date(b.date)),

  getEventBySlug: (slug) => get().events.find((e) => e.slug === slug),

  getEventById: (id) => get().events.find((e) => e.id === id),

  createEvent: (data) => {
    const id = String(nextId++);
    const slug =
      data.slug ||
      data.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    const event = { ...data, id, slug, published: data.published ?? false };
    set((s) => ({ events: [...s.events, event] }));
    return event;
  },

  updateEvent: (id, data) => {
    set((s) => ({
      events: s.events.map((e) => (e.id === id ? { ...e, ...data } : e)),
    }));
  },

  deleteEvent: (id) => {
    set((s) => ({ events: s.events.filter((e) => e.id !== id) }));
  },
}));
