import { create } from "zustand";

/**
 * Blog posts store — local state with seed data.
 * Swap methods for API calls when backend is ready.
 */

const SEED_POSTS = [
  {
    id: "1",
    slug: "lorem-ipsum-dolor-sit-amet",
    title: "Lorem Ipsum Dolor Sit Amet Consectetur",
    date: "2026-03-10",
    author: "member-one",
    category: "General",
    tags: ["lorem", "ipsum", "placeholder"],
    image: "https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=1260&h=750&q=80",
    excerpt: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    body: `## Lorem Ipsum Dolor Sit Amet

Consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

### Praesent Commodo Cursus

Maecenas sed diam eget risus varius blandit sit amet non magna:

- **Lorem ipsum** dolor sit amet consectetur adipiscing elit
- **Sed do eiusmod** tempor incididunt ut labore et dolore
- **Ut enim ad minim** veniam quis nostrud exercitation

### Donec Sed Odio Dui

Vestibulum id ligula porta felis euismod semper:

- Cras mattis consectetur purus sit amet fermentum
- Integer posuere erat a ante venenatis dapibus
- Nullam quis risus eget urna mollis ornare vel eu leo
- Aenean lacinia bibendum nulla sed consectetur

### Maecenas Faucibus Mollis

Nullam id dolor id nibh ultricies vehicula ut id elit. Duis mollis, est non commodo luctus, nisi erat porttitor ligula, eget lacinia odio sem nec elit.

Donec ullamcorper nulla non metus auctor fringilla. Morbi leo risus, porta ac consectetur ac, vestibulum at eros. Fusce dapibus, tellus ac cursus commodo, tortor mauris condimentum nibh.`,
    readTime: 4,
    published: true,
    featured: true,
  },
  {
    id: "2",
    slug: "maecenas-sed-diam-eget-risus",
    title: "Maecenas Sed Diam Eget Risus Varius Blandit",
    date: "2026-03-18",
    author: "member-two",
    category: "Updates",
    tags: ["lorem", "update", "placeholder"],
    image: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1260&h=750&q=80",
    excerpt: "Praesent commodo cursus magna, vel scelerisque nisl consectetur et. Donec sed odio dui. Maecenas faucibus mollis interdum.",
    body: `## Praesent Commodo Cursus Magna

Vel scelerisque nisl consectetur et. Donec sed odio dui. Maecenas faucibus mollis interdum. Nullam id dolor id nibh ultricies vehicula ut id elit.

### Vestibulum Id Ligula

Cras mattis consectetur purus sit amet fermentum:

- Integer posuere erat a ante venenatis dapibus
- Nullam quis risus eget urna mollis ornare
- Aenean lacinia bibendum nulla sed consectetur
- Donec ullamcorper nulla non metus auctor fringilla

### Fusce Dapibus Tellus

Morbi leo risus, porta ac consectetur ac, vestibulum at eros:

- Cum sociis natoque penatibus et magnis dis parturient
- Etiam porta sem malesuada magna mollis euismod
- Vivamus sagittis lacus vel augue laoreet rutrum

## Nulla Vitae Elit Libero

Donec id elit non mi porta gravida at eget metus. Vivamus sagittis lacus vel augue laoreet rutrum faucibus dolor auctor. Aenean eu leo quam. Pellentesque ornare sem lacinia quam venenatis vestibulum.`,
    readTime: 5,
    published: true,
    featured: false,
  },
  {
    id: "3",
    slug: "donec-ullamcorper-nulla-non-metus",
    title: "Donec Ullamcorper Nulla Non Metus Auctor Fringilla",
    date: "2026-03-24",
    author: "member-one",
    category: "Insights",
    tags: ["lorem", "insights", "placeholder"],
    image: "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1260&h=750&q=80",
    excerpt: "Cras mattis consectetur purus sit amet fermentum. Vestibulum id ligula porta felis euismod semper. Nullam quis risus eget urna mollis.",
    body: `## Cras Mattis Consectetur

Vestibulum id ligula porta felis euismod semper. Nullam quis risus eget urna mollis ornare vel eu leo. Integer posuere erat a ante venenatis dapibus posuere velit aliquet.

### Aenean Lacinia Bibendum

Donec sed odio dui. Maecenas faucibus mollis interdum:

- Praesent commodo cursus magna vel scelerisque
- Nullam id dolor id nibh ultricies vehicula
- Duis mollis est non commodo luctus

### Vivamus Sagittis Lacus

Etiam porta sem malesuada magna mollis euismod:

**Fusce dapibus.** Tellus ac cursus commodo, tortor mauris condimentum nibh, ut fermentum massa justo sit amet risus.

**Morbi leo risus.** Porta ac consectetur ac, vestibulum at eros. Cum sociis natoque penatibus et magnis dis parturient montes.

**Aenean eu leo quam.** Pellentesque ornare sem lacinia quam venenatis vestibulum. Nulla vitae elit libero, a pharetra augue.

## Nullam Quis Risus

Donec id elit non mi porta gravida at eget metus. Aenean eu leo quam. Pellentesque ornare sem lacinia quam venenatis vestibulum.`,
    readTime: 5,
    published: true,
    featured: false,
  },
];

let nextId = 4;

export const usePostsStore = create((set, get) => ({
  posts: SEED_POSTS,

  createPost: (data) => {
    const id = String(nextId++);
    const slug =
      data.slug ||
      data.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    const readTime = data.readTime || Math.max(1, Math.round((data.body || "").split(/\s+/).length / 200));
    const post = { ...data, id, slug, readTime, published: data.published ?? false, featured: data.featured ?? false };
    set((s) => ({ posts: [...s.posts, post] }));
    return post;
  },

  updatePost: (id, data) => {
    set((s) => ({
      posts: s.posts.map((p) => (p.id === id ? { ...p, ...data } : p)),
    }));
  },

  deletePost: (id) => {
    set((s) => ({ posts: s.posts.filter((p) => p.id !== id) }));
  },
}));
