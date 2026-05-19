import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderTemplate, sendEmail, type EmailTemplate } from "./send.js";

const ALL_TEMPLATES: EmailTemplate[] = [
  "phase-started",
  "phase-completed",
  "demo-milestone",
  "blocker",
  "daily-digest",
];

describe("email template rendering", () => {
  it.each(ALL_TEMPLATES)("renders %s with var substitution", async (name) => {
    const { subject, body } = await renderTemplate(name, {
      phase_number: "1",
      phase_name: "Foundation",
      phase_goal: "Block-driven multi-tenant rendering",
      estimated_duration: "4–6 work blocks",
      baseline_pass: "64",
      baseline_fail: "0",
      phase_md_url: "PHASE-01-foundation.md",
      plan_md_url: "PLAN.md",
      commit_sha: "abc1234",
      next_phase_number: "2",
      summary_bullets: "- thing",
      demo_urls: "https://example.com",
      test_count: "64",
      test_pass_rate: "100",
      test_delta: "+10",
      next_phase_preview: "Global components",
      demo_title: "First multi-tenant pages",
      demo_action: "Visit URL",
      demo_changes: "- new",
      demo_limitations: "- none",
      next_milestone: "production",
      blocker_summary: "needs GCP",
      context: "deploy",
      attempts: "tried",
      specific_question: "creds?",
      workaround: "wait",
      unblocked_tasks: "1.9, 1.10",
      blocker_id: "B-001",
      date: "2026-05-18",
      completed_tasks: "- 1.7",
      in_progress_tasks: "- 1.8",
      open_blocker_count: "1",
      blocker_summaries: "B-001 GCP",
      next_task: "1.9",
      test_pass: "64",
      test_total: "64",
      commit_count: "8",
    });

    expect(subject).toMatch(/\[Builder\]/);
    expect(subject).not.toMatch(/\{\{/);
    expect(body.length).toBeGreaterThan(20);
    // Sample-check: a hardcoded subject fragment for one template.
    if (name === "phase-started") {
      expect(subject).toContain("Phase 1 started: Foundation");
    }
  });

  it("leaves unknown vars as literal placeholders (so tests catch missing data)", async () => {
    const { body } = await renderTemplate("phase-started", { phase_number: "1" });
    expect(body).toContain("{{phase_goal}}");
  });

  it("throws on an unknown template", async () => {
    // @ts-expect-error — intentional bad arg
    await expect(renderTemplate("does-not-exist", {})).rejects.toThrow(/ENOENT|missing/i);
  });
});

describe("sendEmail modes", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  const originalKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it("stub mode: no RESEND_API_KEY → logs + returns ok:false, mode:'stub'", async () => {
    delete process.env.RESEND_API_KEY;
    const res = await sendEmail({
      to: "jmartin@anchorcorps.com",
      template: "blocker",
      vars: { blocker_summary: "x", context: "", attempts: "", specific_question: "", workaround: "", unblocked_tasks: "", commit_sha: "", blocker_id: "", phase_md_url: "" },
    });
    expect(res.ok).toBe(false);
    expect(res.mode).toBe("stub");
    expect(logSpy).toHaveBeenCalledWith("[email:stub]", expect.objectContaining({
      to: "jmartin@anchorcorps.com",
      subject: expect.stringMatching(/\[Builder\] ⚠ Blocker:/),
    }));
  });

  it("dry-run mode: RESEND_API_KEY='dry-run' → ok:true, mode:'dry-run', no fetch", async () => {
    process.env.RESEND_API_KEY = "dry-run";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await sendEmail({ to: "x@example.com", body: "hi", subject: "Test" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.id).toMatch(/^dry-run-/);
      expect(res.mode).toBe("dry-run");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("api mode: real key → POSTs to resend with Bearer auth + rendered template", async () => {
    process.env.RESEND_API_KEY = "re_fake_test_key";
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ id: "msg_42" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await sendEmail({
      to: "jmartin@anchorcorps.com",
      template: "demo-milestone",
      vars: {
        demo_title: "First sites live",
        demo_action: "Visit muldoon.preview.anchorcorps.dev",
        demo_changes: "- multi-tenant rendering",
        demo_limitations: "- editor not built yet",
        next_milestone: "save endpoint",
        commit_sha: "abc1234",
        phase_md_url: "PHASE-01-foundation.md",
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.id).toBe("msg_42");
      expect(res.mode).toBe("api");
    }

    expect(fetchSpy).toHaveBeenCalledOnce();
    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_fake_test_key");
    const body = JSON.parse(init.body as string);
    expect(body.to).toBe("jmartin@anchorcorps.com");
    expect(body.subject).toBe("[Builder] Demo ready: First sites live");
    // Body content comes from the template, not subject vars.
    expect(body.text).toContain("Visit muldoon.preview.anchorcorps.dev");
    expect(body.text).toContain("multi-tenant rendering");
  });

  it("api mode: non-2xx response → ok:false with status in error", async () => {
    process.env.RESEND_API_KEY = "re_fake_test_key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad token", { status: 401 })),
    );
    const res = await sendEmail({ to: "x@example.com", body: "hi", subject: "T" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/resend 401/);
      expect(res.mode).toBe("api");
    }
  });

  it("rejects when neither template nor body is supplied", async () => {
    delete process.env.RESEND_API_KEY;
    const res = await sendEmail({ to: "x@example.com" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/template or body/);
  });
});
