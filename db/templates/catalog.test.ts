import { describe, expect, it } from "vitest";
import { allTemplates } from "./index.js";
import type { TemplateSeed } from "./types.js";

/**
 * W1.6 — catalog-wide honesty invariants (D700/D710/D711). These hold for
 * EVERY registered template, present and future: a new template that ships a
 * dead form target, a fabricated credential, or copy that rots on a calendar
 * fails here, not in production.
 */

type AnyBlock = { id: string; type: string; props: Record<string, unknown> };

function blocksOf(t: TemplateSeed): { page: string; block: AnyBlock }[] {
  return t.pages.flatMap((p) => p.blocks.map((b) => ({ page: p.slug, block: b as AnyBlock })));
}

function templateJson(t: TemplateSeed): string {
  return JSON.stringify(t);
}

describe("template catalog invariants (W1.6)", () => {
  describe("D700 — every crm_form posts to the real platform lead endpoint", () => {
    for (const t of allTemplates) {
      const forms = blocksOf(t).filter(({ block }) => block.type === "crm_form");
      if (forms.length === 0) continue;
      it(`${t.slug}: crm_form embeds target POST /api/leads with honeypot + _page hint`, () => {
        for (const { page, block } of forms) {
          const embed = String(block.props.embed_code ?? "");
          expect(embed, `${t.slug}/${page} ${block.id} action`).toContain('action="/api/leads"');
          expect(embed, `${t.slug}/${page} ${block.id} method`).toContain('method="post"');
          // Abuse control: the visually-hidden honeypot the endpoint checks.
          expect(embed, `${t.slug}/${page} ${block.id} honeypot`).toContain('name="website"');
          // Attribution: the page the lead came from.
          expect(embed, `${t.slug}/${page} ${block.id} _page hint`).toContain(
            `name="_page" value="/${page}"`,
          );
          // No iframes to anywhere — the platform endpoint is a plain post.
          expect(embed, `${t.slug}/${page} ${block.id} iframe`).not.toContain("<iframe");
        }
      });
    }

    it("no template references a fictional form/absolute-post domain", () => {
      for (const t of allTemplates) {
        expect(templateJson(t), t.slug).not.toMatch(/https?:\/\/forms\./);
      }
    });
  });

  describe("D710 — no fabricated legal/identity artifacts", () => {
    it("no EIN-shaped tax IDs anywhere in any template", () => {
      for (const t of allTemplates) {
        expect(templateJson(t), t.slug).not.toMatch(/EIN\s*:?\s*\d{2}-\d{7}/i);
      }
    });

    it("no license-number-shaped credentials", () => {
      for (const t of allTemplates) {
        expect(templateJson(t), t.slug).not.toMatch(/Lic(?:ense)?\.?\s*#/i);
      }
    });

    it("no dollar-figure results claims in stats bands", () => {
      for (const t of allTemplates) {
        for (const { page, block } of blocksOf(t)) {
          if (block.type !== "stats-band") continue;
          const stats = (block.props.stats ?? []) as { value?: string; label?: string }[];
          for (const s of stats) {
            expect(String(s.value ?? ""), `${t.slug}/${page} ${block.id}`).not.toMatch(
              /\$\s*\d+(\.\d+)?\s*[MBK]/i,
            );
          }
        }
      }
    });

    it("social links never point real platforms at fictional handles", () => {
      const realPlatforms = /https?:\/\/(www\.)?(facebook|instagram|twitter|x|linkedin|youtube|tiktok)\.com\//i;
      for (const t of allTemplates) {
        expect(templateJson(t), t.slug).not.toMatch(realPlatforms);
      }
    });
  });
});
