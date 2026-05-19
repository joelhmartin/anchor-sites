import { z } from "zod";

/**
 * Brand token schema (D-029, P3-T3.3).
 *
 * Brand tokens are CSS custom properties the renderer sets at `:root`
 * per-site. They live on `sites.default_brand_tokens` (per-site default)
 * and `pages.brand_tokens_override` (per-page override, P3-T3.4).
 *
 * Keys MUST match `--theme-<kebab>`. Values MUST be one of:
 *   - 3, 4, 6, or 8-digit hex (e.g. `#fff`, `#ffff`, `#ffffff`, `#ffffffaa`)
 *   - `rgb(…)` / `rgba(…)`
 *   - `hsl(…)` / `hsla(…)`
 *   - `var(--…)` reference to another custom property
 *   - Named CSS colors (`red`, `transparent`) — accepted for completeness,
 *     not encouraged.
 *
 * Anything else is rejected so a malformed token can't reach the DB or
 * the SSR'd `<style>` tag. The strict gate is the admin-save layer
 * (P3-T3.4 wires it into page saves; Phase 4 admin UI will wire it for
 * site-row mutations).
 */

const TOKEN_KEY = /^--theme-[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_HSL =
  /^(?:rgba?|hsla?)\(\s*[-0-9.%\s,/]+\s*\)$/i;
const VAR_REF = /^var\(\s*--[a-zA-Z0-9-]+(?:\s*,\s*[^()]+)?\s*\)$/;
const NAMED = new Set([
  "transparent",
  "currentcolor",
  "inherit",
  "initial",
  "unset",
  "revert",
  // Common named colors. Not exhaustive — the schema isn't a full CSS
  // color parser, just a sanity filter. Add as needed.
  "black", "white", "red", "green", "blue", "yellow", "orange",
  "gray", "grey",
]);

function isValidValue(v: string): boolean {
  const trimmed = v.trim();
  if (HEX.test(trimmed)) return true;
  if (RGB_HSL.test(trimmed)) return true;
  if (VAR_REF.test(trimmed)) return true;
  if (NAMED.has(trimmed.toLowerCase())) return true;
  return false;
}

export const brandTokensSchema = z
  .record(z.string(), z.string())
  .superRefine((tokens, ctx) => {
    for (const [key, value] of Object.entries(tokens)) {
      if (!TOKEN_KEY.test(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `key must match --theme-<kebab>`,
        });
      }
      if (!isValidValue(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `value must be hex, rgb()/rgba(), hsl()/hsla(), var(--…), or a basic named color`,
        });
      }
    }
  });

export type BrandTokens = z.infer<typeof brandTokensSchema>;

/**
 * Merge a site default with a per-page override. Page wins per-key; keys
 * absent from the override fall back to the site default. The result is
 * NOT re-validated — both inputs should already have been validated at
 * save time. If either input contains an invalid entry, that entry rides
 * through; the SSR layer treats every value as opaque text it pastes
 * into the `<style>` tag.
 */
export function mergeBrandTokens(
  siteDefault: Record<string, unknown> | null | undefined,
  pageOverride: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const merged: Record<string, string> = {};
  if (siteDefault) {
    for (const [k, v] of Object.entries(siteDefault)) {
      if (typeof v === "string") merged[k] = v;
    }
  }
  if (pageOverride) {
    for (const [k, v] of Object.entries(pageOverride)) {
      if (typeof v === "string") merged[k] = v;
    }
  }
  return merged;
}
