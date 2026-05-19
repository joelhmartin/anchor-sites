// Task 1.0 stub. Real template rendering + Resend HTTP call lands in Task 1.9.
// Keeping the signature stable so callers don't change when 1.9 wires it up.

export type SendArgs = {
  to: string;
  subject: string;
  body: string;
  template?: string;
  vars?: Record<string, string>;
};

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function sendEmail(args: SendArgs): Promise<SendResult> {
  if (!process.env.RESEND_API_KEY) {
    console.log("[email:stub]", { to: args.to, subject: args.subject });
    return { ok: false, error: "RESEND_API_KEY not set — stub logged only" };
  }
  return { ok: false, error: "send() not implemented until Task 1.9" };
}
