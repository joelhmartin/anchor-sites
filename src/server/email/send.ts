import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// .../src/server/email/send.ts → up 3 → repo root
const TEMPLATES_DIR = path.resolve(__dirname, "..", "..", "..", ".routine", "templates");

export type EmailTemplate =
  | "phase-started"
  | "phase-completed"
  | "demo-milestone"
  | "blocker"
  | "daily-digest";

export type SendArgs = {
  to: string;
  /** If omitted, derived from the template's `Subject:` header. */
  subject?: string;
  /** Either `template` (preferred) or raw `body`. */
  template?: EmailTemplate;
  body?: string;
  /** Substituted into `{{key}}` placeholders in the template. */
  vars?: Record<string, string>;
};

export type SendMode = "stub" | "dry-run" | "api";

export type SendResult =
  | { ok: true; id: string; mode: SendMode }
  | { ok: false; error: string; mode: SendMode };

function fill(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_m, key) =>
    key in vars ? vars[key] : `{{${key}}}`,
  );
}

export type RenderedTemplate = { subject: string; body: string };

export async function renderTemplate(
  template: EmailTemplate,
  vars: Record<string, string> = {},
): Promise<RenderedTemplate> {
  const raw = await readFile(path.join(TEMPLATES_DIR, `${template}.md`), "utf-8");
  const filled = fill(raw, vars);
  const match = filled.match(/^Subject:\s*(.+?)\r?\n+([\s\S]+)$/);
  if (!match) {
    throw new Error(`template ${template} is missing a 'Subject:' header`);
  }
  return { subject: match[1].trim(), body: match[2].replace(/^\s+/, "") };
}

/**
 * Send an email via Mailgun's HTTP API (D-023 — chosen for consistency with
 * `anchor-hub`, which already uses Mailgun in the same GCP project).
 *
 * Three modes based on env:
 *   - `MAILGUN_API_KEY` unset → STUB. Logs to console, returns `ok: false`.
 *     Used in development and in CI before Task 1.8 lands secrets in prod.
 *   - `MAILGUN_API_KEY === "dry-run"` → DRY-RUN. Renders template + validates
 *     payload but does not call Mailgun. Used by tests and smoke checks.
 *   - Any other value → API. POSTs to https://api.mailgun.net/v3/<domain>/messages
 *     using HTTP Basic auth (`api:<key>`).
 *
 * `MAILGUN_DOMAIN` must be set when the API key is real — it determines both
 * the endpoint URL and the default From address. `MAILGUN_DEFAULT_FROM`
 * overrides the From header (matches the existing anchor-hub secret name).
 */
export async function sendEmail(args: SendArgs): Promise<SendResult> {
  let subject: string;
  let body: string;

  try {
    if (args.template) {
      const rendered = await renderTemplate(args.template, args.vars ?? {});
      subject = args.subject ?? rendered.subject;
      body = rendered.body;
    } else if (args.body) {
      subject = args.subject ?? "(no subject)";
      body = args.body;
    } else {
      return { ok: false, error: "must supply template or body", mode: "api" };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      mode: "api",
    };
  }

  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const from =
    process.env.MAILGUN_DEFAULT_FROM ??
    (domain ? `AnchorCorps Builder <builder@${domain}>` : "AnchorCorps Builder <builder@example.com>");

  if (!apiKey) {
    console.log("[email:stub]", { to: args.to, subject });
    return { ok: false, error: "MAILGUN_API_KEY not set", mode: "stub" };
  }
  if (apiKey === "dry-run") {
    return {
      ok: true,
      id: `dry-run-${Date.now().toString(36)}`,
      mode: "dry-run",
    };
  }
  if (!domain) {
    return { ok: false, error: "MAILGUN_DOMAIN not set", mode: "api" };
  }

  try {
    const form = new URLSearchParams({
      from,
      to: args.to,
      subject,
      text: body,
    });
    const auth = Buffer.from(`api:${apiKey}`, "utf-8").toString("base64");

    const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `mailgun ${res.status}: ${text}`, mode: "api" };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: data.id ?? "unknown", mode: "api" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      mode: "api",
    };
  }
}
