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
  const originalKey = process.env.MAILGUN_API_KEY;
  const originalDomain = process.env.MAILGUN_DOMAIN;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (originalKey === undefined) delete process.env.MAILGUN_API_KEY;
    else process.env.MAILGUN_API_KEY = originalKey;
    if (originalDomain === undefined) delete process.env.MAILGUN_DOMAIN;
    else process.env.MAILGUN_DOMAIN = originalDomain;
    vi.unstubAllGlobals();
  });

  it("stub mode: no MAILGUN_API_KEY → logs + returns ok:false, mode:'stub'", async () => {
    delete process.env.MAILGUN_API_KEY;
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

  it("dry-run mode: MAILGUN_API_KEY='dry-run' → ok:true, mode:'dry-run', no fetch", async () => {
    process.env.MAILGUN_API_KEY = "dry-run";
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

  it("api mode: real key + domain → POSTs to mailgun with Basic auth + form body", async () => {
    process.env.MAILGUN_API_KEY = "key-fake-test";
    process.env.MAILGUN_DOMAIN = "mg.anchorcorps.dev";
    process.env.MAILGUN_DEFAULT_FROM = "AnchorCorps Builder <builder@mg.anchorcorps.dev>";
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ id: "<20260518.abc@mg.anchorcorps.dev>", message: "Queued" }), {
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
      expect(res.id).toContain("@mg.anchorcorps.dev");
      expect(res.mode).toBe("api");
    }

    expect(fetchSpy).toHaveBeenCalledOnce();
    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe("https://api.mailgun.net/v3/mg.anchorcorps.dev/messages");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    // HTTP Basic with `api:<key>` base64-encoded.
    const expected = Buffer.from("api:key-fake-test", "utf-8").toString("base64");
    expect(headers.Authorization).toBe(`Basic ${expected}`);
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("to")).toBe("jmartin@anchorcorps.com");
    expect(body.get("subject")).toBe("[Builder] Demo ready: First sites live");
    expect(body.get("from")).toContain("builder@mg.anchorcorps.dev");
    expect(body.get("text")).toContain("Visit muldoon.preview.anchorcorps.dev");
  });

  it("api mode: missing MAILGUN_DOMAIN → ok:false (no HTTP call)", async () => {
    process.env.MAILGUN_API_KEY = "key-fake-test";
    delete process.env.MAILGUN_DOMAIN;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await sendEmail({ to: "x@example.com", body: "hi", subject: "T" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/MAILGUN_DOMAIN/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("api mode: non-2xx response → ok:false with status in error", async () => {
    process.env.MAILGUN_API_KEY = "key-fake-test";
    process.env.MAILGUN_DOMAIN = "mg.example.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Forbidden", { status: 401 })),
    );
    const res = await sendEmail({ to: "x@example.com", body: "hi", subject: "T" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/mailgun 401/);
      expect(res.mode).toBe("api");
    }
  });

  it("rejects when neither template nor body is supplied", async () => {
    delete process.env.MAILGUN_API_KEY;
    const res = await sendEmail({ to: "x@example.com" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/template or body/);
  });
});
