import { describe, expect, it, vi } from "vitest";
import express, { type Request, type Response } from "express";
import request from "supertest";

// Behavioral proof that the signature compare is constant-time (below): wrap
// the real `timingSafeEqual` so the test can assert it was actually reached,
// rather than trusting a source-level grep. Everything else in node:crypto
// passes straight through.
const { timingSafeEqualCalls } = vi.hoisted(() => ({ timingSafeEqualCalls: [] as unknown[][] }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    default: actual,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      timingSafeEqualCalls.push([a, b]);
      return actual.timingSafeEqual(a, b);
    },
  };
});

import {
  PREVIEW_TOKEN_TTL_MS,
  mintPreviewToken,
  previewQueryAuth,
  previewTokenSecret,
  verifyPreviewToken,
} from "./preview-token.js";

/**
 * Studio preview auth (2026-07-30 lovable-workspace, operator-reported prod
 * break). See preview-token.ts's header for the shape and why it exists.
 */

const SECRET_ENV = { BETTER_AUTH_SECRET: "unit-test-session-secret-0123456789" };
const SITE_A = "11111111-1111-4111-8111-111111111111";
const SITE_B = "22222222-2222-4222-8222-222222222222";

function mint(siteId: string, over: { ttlMs?: number; now?: number } = {}) {
  const minted = mintPreviewToken(siteId, { env: SECRET_ENV, ...over });
  if (!minted) throw new Error("mint returned null");
  return minted;
}

describe("previewTokenSecret", () => {
  it("prefers BETTER_AUTH_SECRET", () => {
    expect(previewTokenSecret({ BETTER_AUTH_SECRET: "s1", ADMIN_API_TOKEN: "s2" })).toBe("s1");
  });

  // Every deployment that has an admin surface at all has ADMIN_API_TOKEN
  // (requireAdmin's break-glass path), and the integration suite sets only
  // that. Using it as HMAC *key material* never exposes it — HMAC is one-way
  // — and it means the preview endpoint is never silently unavailable on a
  // deployment that predates BETTER_AUTH_SECRET.
  it("falls back to ADMIN_API_TOKEN when no session secret is configured", () => {
    expect(previewTokenSecret({ ADMIN_API_TOKEN: "s2" })).toBe("s2");
  });

  it("returns null when neither is configured (mint/verify then fail closed)", () => {
    expect(previewTokenSecret({})).toBeNull();
  });
});

describe("mintPreviewToken", () => {
  it("returns an opaque token plus an absolute expiry ~15 min out by default", () => {
    const now = Date.UTC(2026, 6, 30, 12, 0, 0);
    const { token, expiresAt } = mint(SITE_A, { now });
    expect(typeof token).toBe("string");
    expect(token.startsWith("pv1.")).toBe(true);
    expect(PREVIEW_TOKEN_TTL_MS).toBe(15 * 60 * 1000);
    // Second-resolution exp, so allow the sub-second truncation.
    expect(expiresAt).toBeGreaterThan(now + PREVIEW_TOKEN_TTL_MS - 1000);
    expect(expiresAt).toBeLessThanOrEqual(now + PREVIEW_TOKEN_TTL_MS);
  });

  it("never embeds the signing secret, and is URL-safe (it rides in a query param)", () => {
    const { token } = mint(SITE_A);
    expect(token).not.toContain(SECRET_ENV.BETTER_AUTH_SECRET);
    expect(token).toBe(encodeURIComponent(token));
  });

  it("returns null with no secret configured — fail closed, never mint an unverifiable token", () => {
    expect(mintPreviewToken(SITE_A, { env: {} })).toBeNull();
  });

  it("refuses a siteId that would make the compact payload ambiguous", () => {
    expect(mintPreviewToken("has.a.dot", { env: SECRET_ENV })).toBeNull();
    expect(mintPreviewToken("", { env: SECRET_ENV })).toBeNull();
  });
});

describe("verifyPreviewToken", () => {
  it("accepts a fresh token for the site it was minted for", () => {
    const now = Date.now();
    const { token } = mint(SITE_A, { now });
    expect(verifyPreviewToken(token, SITE_A, { env: SECRET_ENV, now })).toBe(true);
  });

  // The scope check is the whole point of embedding the siteId: an operator
  // with legitimate access to site A must not be able to hand that token's
  // URL to site B's preview and read B's unpublished drafts.
  it("rejects a valid token presented for a DIFFERENT site (scope check)", () => {
    const now = Date.now();
    const { token } = mint(SITE_A, { now });
    expect(verifyPreviewToken(token, SITE_B, { env: SECRET_ENV, now })).toBe(false);
  });

  it("rejects a token whose siteId was swapped in the payload (signature covers the scope)", () => {
    const { token } = mint(SITE_A);
    const forged = token.replace(SITE_A, SITE_B);
    expect(verifyPreviewToken(forged, SITE_B, { env: SECRET_ENV })).toBe(false);
  });

  it("rejects an expired token, exactly at expiry and after", () => {
    const now = Date.now();
    const { token, expiresAt } = mint(SITE_A, { now, ttlMs: 60_000 });
    expect(verifyPreviewToken(token, SITE_A, { env: SECRET_ENV, now: expiresAt - 1 })).toBe(true);
    expect(verifyPreviewToken(token, SITE_A, { env: SECRET_ENV, now: expiresAt })).toBe(false);
    expect(verifyPreviewToken(token, SITE_A, { env: SECRET_ENV, now: expiresAt + 60_000 })).toBe(false);
  });

  it("rejects a token whose exp was extended (signature covers the expiry)", () => {
    const now = Date.now();
    const { token } = mint(SITE_A, { now, ttlMs: 60_000 });
    const [prefix, siteId, exp, sig] = token.split(".");
    const forged = [prefix, siteId, String(Number(exp) + 86_400), sig].join(".");
    expect(verifyPreviewToken(forged, SITE_A, { env: SECRET_ENV, now })).toBe(false);
  });

  it("rejects garbage without throwing", () => {
    for (const bad of [
      "",
      "not-a-token",
      "pv1.",
      "pv1.a.b",
      "pv1.a.b.c.d",
      `pv1.${SITE_A}.notanumber.abc`,
      `pv1.${SITE_A}.9999999999.`,
      undefined,
      null,
      42,
      {},
      ["pv1"],
    ]) {
      expect(verifyPreviewToken(bad, SITE_A, { env: SECRET_ENV })).toBe(false);
    }
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = mintPreviewToken(SITE_A, { env: { BETTER_AUTH_SECRET: "other-secret" } })!;
    expect(verifyPreviewToken(token, SITE_A, { env: SECRET_ENV })).toBe(false);
  });

  it("fails closed when no secret is configured, even for a well-formed token", () => {
    const { token } = mint(SITE_A);
    expect(verifyPreviewToken(token, SITE_A, { env: {} })).toBe(false);
  });

  // Mirrors verifyGithubSignature (routes/git-webhook.ts): the comparison must
  // be `timingSafeEqual` over equal-length buffers, never `===` on the hex/
  // base64 strings, so a wrong signature can't be recovered byte-by-byte from
  // response timing. A length mismatch is short-circuited BEFORE the compare
  // (timingSafeEqual throws on unequal lengths).
  it("uses crypto.timingSafeEqual for the signature compare", () => {
    timingSafeEqualCalls.length = 0;
    const { token } = mint(SITE_A);
    expect(verifyPreviewToken(token, SITE_A, { env: SECRET_ENV })).toBe(true);
    expect(timingSafeEqualCalls.length).toBeGreaterThan(0);

    // A signature of the wrong LENGTH must not reach timingSafeEqual (it
    // THROWS on unequal lengths) — the length guard must reject first.
    timingSafeEqualCalls.length = 0;
    expect(verifyPreviewToken(`pv1.${SITE_A}.9999999999.short`, SITE_A, { env: SECRET_ENV })).toBe(false);
    expect(timingSafeEqualCalls.length).toBe(0);
  });
});

describe("previewQueryAuth middleware", () => {
  function app(opts: { env?: NodeJS.ProcessEnv } = {}) {
    const a = express();
    const admin = (_req: Request, res: Response) => {
      res.status(401).json({ error: "unauthorized" });
    };
    a.get(
      "/api/sites/:siteId/preview",
      previewQueryAuth(admin, { env: opts.env ?? SECRET_ENV }),
      (req: Request, res: Response) => res.json({ ok: true, user: req.studioUser?.id }),
    );
    return a;
  }

  it("authorizes the request when ?token= is a valid preview token for :siteId", async () => {
    const { token } = mint(SITE_A);
    const res = await request(app()).get(`/api/sites/${SITE_A}/preview?token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toBe("preview-token");
  });

  it("falls through to the admin gate for a token scoped to another site", async () => {
    const { token } = mint(SITE_A);
    const res = await request(app()).get(`/api/sites/${SITE_B}/preview?token=${token}`);
    expect(res.status).toBe(401);
  });

  it("falls through to the admin gate with no token at all", async () => {
    const res = await request(app()).get(`/api/sites/${SITE_A}/preview`);
    expect(res.status).toBe(401);
  });

  // D808 — an expired credential inside an iframe must render a human
  // recovery page, not raw JSON: after the 15-min TTL a sibling-link click
  // (still carrying the ORIGINAL token) used to fill the frame with
  // {"error":"unauthorized"} and no way back.
  describe("[D808] expired-token recovery page", () => {
    it("serves a styled 401 HTML page for an expired preview token on an HTML-accepting request", async () => {
      const { token } = mint(SITE_A, { now: Date.now() - PREVIEW_TOKEN_TTL_MS * 2 });
      const res = await request(app())
        .get(`/api/sites/${SITE_A}/preview?token=${token}`)
        .set("Accept", "text/html,application/xhtml+xml");
      expect(res.status).toBe(401);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.text).toContain("Preview expired");
      expect(res.text).not.toContain("<script");
    });

    it("keeps the JSON 401 for API-shaped requests with the same expired token", async () => {
      const { token } = mint(SITE_A, { now: Date.now() - PREVIEW_TOKEN_TTL_MS * 2 });
      const res = await request(app())
        .get(`/api/sites/${SITE_A}/preview?token=${token}`)
        .set("Accept", "application/json");
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "unauthorized" });
    });

    it("also covers a token scoped to another site (the iframe's stale-link case)", async () => {
      const { token } = mint(SITE_A);
      const res = await request(app())
        .get(`/api/sites/${SITE_B}/preview?token=${token}`)
        .set("Accept", "text/html");
      expect(res.status).toBe(401);
      expect(res.text).toContain("Preview expired");
    });

    it("does NOT intercept a non-preview-shaped ?token= even when HTML is accepted (admin-gate path)", async () => {
      const res = await request(app())
        .get(`/api/sites/${SITE_A}/preview?token=static-admin-token`)
        .set("Accept", "text/html");
      // Falls through to the injected admin gate (JSON 401 in this harness).
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "unauthorized" });
    });

    it("a VALID token is untouched by the recovery path", async () => {
      const { token } = mint(SITE_A);
      const res = await request(app())
        .get(`/api/sites/${SITE_A}/preview?token=${token}`)
        .set("Accept", "text/html");
      expect(res.status).toBe(200);
    });
  });

  // Backward compat: the static ADMIN_API_TOKEN in ?token= is not a preview
  // token, so it must reach requireAdmin via tokenFromQuery's header shim
  // (curl/dev workflows and the legacy paste-token Studio login depend on it).
  it("lifts a non-preview ?token= into the X-Admin-Token header for requireAdmin", async () => {
    const a = express();
    a.get(
      "/api/sites/:siteId/preview",
      previewQueryAuth(
        (req: Request, res: Response) => res.json({ header: req.headers["x-admin-token"] }),
        { env: SECRET_ENV },
      ),
      (_req: Request, res: Response) => res.json({ ok: true }),
    );
    const res = await request(a).get(`/api/sites/${SITE_A}/preview?token=static-admin-token`);
    expect(res.body.header).toBe("static-admin-token");
  });

  // D117 (W2-SEC) — in production the shim is off: a long-lived admin token
  // must never authenticate FROM A URL there (access logs, history,
  // Referers). pv1/ptv1 tokens — the only credentials prod puts in preview
  // URLs — are unaffected, and X-Admin-Token as a HEADER keeps working.
  describe("[D117] the legacy query-token lift is non-production only", () => {
    it("does NOT lift ?token= into the header in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      try {
        const a = express();
        a.get(
          "/api/sites/:siteId/preview",
          previewQueryAuth(
            (req: Request, res: Response) =>
              res.status(401).json({ header: req.headers["x-admin-token"] ?? null }),
            { env: SECRET_ENV },
          ),
        );
        const res = await request(a).get(`/api/sites/${SITE_A}/preview?token=static-admin-token`);
        expect(res.status).toBe(401);
        expect(res.body.header).toBeNull();
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("a valid pv1 preview token still authorizes in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      try {
        const { token } = mint(SITE_A);
        const res = await request(app()).get(`/api/sites/${SITE_A}/preview?token=${token}`);
        expect(res.status).toBe(200);
        expect(res.body.user).toBe("preview-token");
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});

// -----------------------------------------------------------------------------
// Template-scoped preview tokens (W1.1, 2026-07-30 product-audit remediation).
// Same HMAC family, distinct `ptv1` prefix — a template token must never
// authorize a site preview and vice versa (the prefix is inside the MAC'd
// payload, so cross-scope replay fails the signature/prefix checks).
// -----------------------------------------------------------------------------

import {
  mintTemplatePreviewToken,
  templatePreviewQueryAuth,
  verifyTemplatePreviewToken,
} from "./preview-token.js";

const TPL_A = "33333333-3333-4333-8333-333333333333";
const TPL_B = "44444444-4444-4444-8444-444444444444";

function mintTpl(templateId: string, over: { ttlMs?: number; now?: number } = {}) {
  const minted = mintTemplatePreviewToken(templateId, { env: SECRET_ENV, ...over });
  if (!minted) throw new Error("mint returned null");
  return minted;
}

describe("template preview tokens", () => {
  it("mints a ptv1-prefixed token verifiable only for that template", () => {
    const now = Date.now();
    const { token } = mintTpl(TPL_A, { now });
    expect(token.startsWith("ptv1.")).toBe(true);
    expect(verifyTemplatePreviewToken(token, TPL_A, { env: SECRET_ENV, now })).toBe(true);
    expect(verifyTemplatePreviewToken(token, TPL_B, { env: SECRET_ENV, now })).toBe(false);
  });

  it("never cross-authorizes between site and template scopes", () => {
    const now = Date.now();
    const site = mint(TPL_A, { now }); // a site token whose id happens to equal the template id
    const tpl = mintTpl(TPL_A, { now });
    expect(verifyTemplatePreviewToken(site.token, TPL_A, { env: SECRET_ENV, now })).toBe(false);
    expect(verifyPreviewToken(tpl.token, TPL_A, { env: SECRET_ENV, now })).toBe(false);
  });

  it("rejects expiry extension, wrong secret, garbage, and expired tokens", () => {
    const now = Date.now();
    const { token, expiresAt } = mintTpl(TPL_A, { now, ttlMs: 60_000 });
    const [prefix, id, exp, sig] = token.split(".");
    const forged = [prefix, id, String(Number(exp) + 86_400), sig].join(".");
    expect(verifyTemplatePreviewToken(forged, TPL_A, { env: SECRET_ENV, now })).toBe(false);
    expect(verifyTemplatePreviewToken(token, TPL_A, { env: SECRET_ENV, now: expiresAt })).toBe(false);
    expect(
      verifyTemplatePreviewToken(
        mintTemplatePreviewToken(TPL_A, { env: { BETTER_AUTH_SECRET: "other" } })!.token,
        TPL_A,
        { env: SECRET_ENV },
      ),
    ).toBe(false);
    for (const bad of ["", "ptv1.", "ptv1.a.b", undefined, null, 42]) {
      expect(verifyTemplatePreviewToken(bad, TPL_A, { env: SECRET_ENV })).toBe(false);
    }
  });

  it("fails closed with no secret", () => {
    expect(mintTemplatePreviewToken(TPL_A, { env: {} })).toBeNull();
    const { token } = mintTpl(TPL_A);
    expect(verifyTemplatePreviewToken(token, TPL_A, { env: {} })).toBe(false);
  });
});

describe("templatePreviewQueryAuth middleware", () => {
  function app() {
    const a = express();
    const admin = (_req: Request, res: Response) => {
      res.status(401).json({ error: "unauthorized" });
    };
    a.get(
      "/api/templates/:id/preview",
      templatePreviewQueryAuth(admin, { env: SECRET_ENV }),
      (req: Request, res: Response) => res.json({ ok: true, user: req.studioUser?.id }),
    );
    return a;
  }

  it("authorizes with a valid template token for :id", async () => {
    const { token } = mintTpl(TPL_A);
    const res = await request(app()).get(`/api/templates/${TPL_A}/preview?token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toBe("preview-token");
  });

  it("falls through to the admin gate for another template's token or no token", async () => {
    const { token } = mintTpl(TPL_A);
    expect((await request(app()).get(`/api/templates/${TPL_B}/preview?token=${token}`)).status).toBe(401);
    expect((await request(app()).get(`/api/templates/${TPL_A}/preview`)).status).toBe(401);
  });

  // D808 — same recovery page as the site preview (same iframe constraints).
  it("[D808] serves the recovery page for an expired template token on an HTML request", async () => {
    const { token } = mintTpl(TPL_A, { now: Date.now() - PREVIEW_TOKEN_TTL_MS * 2 });
    const res = await request(app())
      .get(`/api/templates/${TPL_A}/preview?token=${token}`)
      .set("Accept", "text/html");
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("Preview expired");
  });
});
