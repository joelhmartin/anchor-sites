# Adding a block type

This is how the routine will add every block from Phase 2 onward. Read it
before opening a new folder under `src/blocks/`.

A block is the smallest unit the renderer + editor know about. Each block
type contributes four things to the system:

1. A **Zod schema** — single source of truth for validation, TypeScript
   typing, editor form fields (Phase 5), and AI prompt shapes (Phase 6).
2. A **React component** — pure function of props, server-rendered.
3. A **CSS file** — `ac-` prefixed classes, CSS custom properties for
   theming, no `font-family` declarations.
4. A **registry entry** — registers the schema + component + editor metadata
   under a stable type string.

> If you find yourself adding anything else (a database table, a custom
> save hook, a runtime dependency), it's not a block — it's a plugin
> (D-016, Phase 7.5).

## Folder layout

Every block lives in `src/blocks/<type>/` with four files:

```
src/blocks/<type>/
  schema.ts        # Zod schema + inferred TypeScript type
  component.tsx    # the React component
  styles.css       # ac- prefixed CSS, theme custom properties only
  index.ts         # imports + registerBlock() side-effect call
```

## Step 1 — Author the Zod schema

`src/blocks/<type>/schema.ts`:

```ts
import { z } from "zod";

export const myBlockSchema = z.object({
  // EVERY field must have a .default(...) so an empty `props: {}` validates.
  // The editor relies on this — it can render the form before any value exists.
  title: z.string().min(1).default("Headline"),
  subtitle: z.string().default(""),
  // Use z.enum() over z.string() for closed sets so the editor knows to
  // render a select instead of a free-text input. Document the choices in
  // the field name itself (snake_case) so the AI prompt is readable.
  variant: z.enum(["primary", "muted"]).default("primary"),
  // URLs: prefer z.string() with a free shape so internal anchors like
  // `#contact` and tel: / mailto: URIs all validate. z.string().url() is
  // too strict.
  link_href: z.string().default("#"),
});

export type MyBlockProps = z.infer<typeof myBlockSchema>;
```

**Rules of thumb:**

- **Every field has `.default()`.** No exceptions — even required-looking
  fields. The editor needs `{}` to validate so a freshly-inserted block
  doesn't immediately render `<BlockError>`.
- **`z.enum()` for closed sets** (alignments, variants, sizes). The editor
  uses this to pick the control type in Phase 5.
- **No `z.string().url()`** unless you genuinely mean "must be a full URL".
  `#anchor`, `tel:+15555550123`, and `mailto:x@y.com` are common and valid.
- **Snake case for field names.** They surface in the AI prompts and the
  editor form labels; snake reads cleanest in both.

## Step 2 — Write the component

`src/blocks/<type>/component.tsx`:

```tsx
import type { MyBlockProps } from "./schema.js";

export function MyBlock({ title, subtitle, variant, link_href }: MyBlockProps) {
  return (
    <section className={`ac-myblock ac-myblock--${variant}`}>
      <div className="ac-myblock__inner">
        <h2 className="ac-myblock__title">{title}</h2>
        {subtitle && <p className="ac-myblock__subtitle">{subtitle}</p>}
        <a className="ac-myblock__link" href={link_href}>Read more</a>
      </div>
    </section>
  );
}
```

**Rules of thumb:**

- **Pure function of props.** No `useState`, no `useEffect`, no `useRef`,
  no `useContext`. The same input must produce the same output forever —
  the AI editor (Phase 6) treats blocks as values, not stateful machines.
- **`ac-` prefix on every class.** The block name is the root: `ac-myblock`.
  Children use BEM-style suffixes: `ac-myblock__title`,
  `ac-myblock--primary`. This is the public API consumers can target.
- **No inline styles** beyond CSS custom-property fallbacks. All visual
  styling lives in `styles.css`.

## Step 3 — Write the CSS

`src/blocks/<type>/styles.css`:

```css
.ac-myblock {
  background: var(--theme-main, #111);
  color: #fff;
  padding: 3rem 1.5rem;
}
.ac-myblock--muted {
  background: var(--theme-accent, #f5f5f5);
  color: #1a1a1a;
}
.ac-myblock__inner {
  max-width: 60rem;
  margin: 0 auto;
}
.ac-myblock__title {
  font-size: 1.75rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
}
.ac-myblock__subtitle {
  font-size: 1rem;
  opacity: 0.85;
  margin: 0 0 1.5rem;
}
.ac-myblock__link {
  display: inline-block;
  padding: 0.625rem 1.25rem;
  border-radius: 0.375rem;
  background: var(--theme-accent, #f6b93b);
  color: #1a1a1a;
  text-decoration: none;
}
```

**Rules of thumb (architectural anchor #8):**

- **CSS custom properties for colors.** Read `--theme-main`,
  `--theme-accent`, etc. Never hardcode hex codes that should theme per
  site. Always include a fallback in the `var()` call.
- **No `font-family` declarations.** Inherit from the site shell. The SSR
  test asserts this — adding `font-family:` will fail
  `src/blocks/blocks.test.tsx` immediately.
- **Prefer Font Awesome over inline SVG** when an icon is needed.
- **Plain CSS, not CSS Modules.** The `ac-` prefix is the API — hashing
  would defeat it.

## Step 4 — Register the block

`src/blocks/<type>/index.ts`:

```ts
import { registerBlock } from "../registry.js";
import { myBlockSchema } from "./schema.js";
import { MyBlock } from "./component.js";

// Side-effect: registers at import time. `src/blocks/index.ts` is the only
// caller — see step 5.
registerBlock("my-block", {
  schema: myBlockSchema,
  component: MyBlock,
  label: "My Block",
  description: "One-sentence what this block is for.",
  // aiHints surface in Phase 6's prompts. Use them to steer the AI away
  // from common misuse (too many per page, wrong page type, etc.).
  aiHints: "Use as a secondary CTA mid-page. Avoid in headers or footers.",
  // Editor grouping in Phase 5. Existing categories: header, content, cta.
  category: "content",
});

export { myBlockSchema, MyBlock };
```

**Why type strings, not enums:** plugins (D-016) register at runtime via the
same `registerBlock()` API and contribute their own type strings. A static
enum would prevent that.

## Step 5 — Wire into the master block index

`src/blocks/index.ts`:

```ts
// Each import triggers side-effect registration. Keep alphabetical by type
// string so duplicates are caught at code review.
import "./cta/index.js";
import "./hero/index.js";
import "./my-block/index.js";   // <-- add this line
import "./rich-text/index.js";

export * from "./registry.js";
export * from "./types.js";
```

That's the only entry point the server side imports. The page route's
side-effect import (`import "../../blocks/index.js"` in
`src/server/routes/page.ts`) picks up your new block automatically.

## Step 6 — Add the CSS to the client bundle

`src/blocks/styles.ts`:

```ts
// Client-only entry. Imported from src/main.jsx so the SPA bundle picks
// up block CSS. Server SSR doesn't need this — SSR emits class names, not
// bytes, and the browser fetches the CSS via the bundle.
import "./cta/styles.css";
import "./hero/styles.css";
import "./my-block/styles.css";   // <-- add this line
import "./rich-text/styles.css";
```

## Step 7 — Test

Add a section to `src/blocks/blocks.test.tsx`:

```ts
describe("my-block", () => {
  it("validates with empty props (defaults)", () => {
    const parsed = myBlockSchema.safeParse({});
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown variant", () => {
    const parsed = myBlockSchema.safeParse({ variant: "danger" });
    expect(parsed.success).toBe(false);
  });

  it("SSR renders with ac- root class + no font-family", () => {
    const html = renderToString(<MyBlock {...myBlockSchema.parse({ title: "Hi" })} />);
    expect(html).toContain('class="ac-myblock');
    expect(html).not.toMatch(/font-family/);
  });
});
```

Run `npm test`. The block should land green on the first commit.

## Step 8 — (Optional) seed an example

If you want the block to appear in `demo.localhost:3000`, add it to
`db/seed.ts`'s demo page blocks array. Use a stable block `id` (the editor
uses it as a React key). Then re-run `npm run db:seed` (idempotent —
upserts on `pages(site_id, slug)`).

## Common pitfalls

- **Forgetting `.default()` on a schema field.** Block validates fine in
  tests but `<BlockError>` appears in the rendered page because the editor
  inserted it with empty props.
- **Importing the block CSS from the server side.** `tsx` (the Node runtime)
  doesn't handle `.css` imports. `index.ts` must not import `styles.css`;
  only `src/blocks/styles.ts` (client-only) does.
- **Calling `registerBlock` more than once for the same type.** The registry
  throws. If you need to update behavior in a test, use
  `__resetRegistryForTests()` first.
- **Adding `font-family` to the CSS.** Fails the SSR-output anchor test
  immediately. The site shell controls typography.
- **Coupling to a specific framework feature** (`useEffect`, hooks, refs).
  Phase 5 (Puck) and Phase 6 (AI editor) treat blocks as pure renderable
  values — anything stateful gets in the way.

## When this guide isn't enough

- Block needs server routes / a DB table / per-site config → it's a
  **plugin**. See D-016 and wait for Phase 7.5.
- Block needs a custom editor field that Zod can't model (rich text, image
  picker, color picker) → Phase 5 + D-017 (Puck custom field wrappers).
- Block needs to call the CRM / submit a form → use the `crm_form` embed
  block per D-006. The builder never touches PHI.
