import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readState, updateState, writeStateAtomic, type RoutineState } from "./routine-state.js";

const seedState: RoutineState = {
  notify_email: "test@example.com",
  current_phase: 1,
  current_phase_file: "PHASE-01-foundation.md",
  current_task: "1.1",
  phase_started_at: "2026-05-18T00:00:00Z",
  last_commit_sha: null,
  last_email_sent_at: null,
  emails_sent: [],
  demo_milestones_sent: [],
  blockers_open: 0,
  tests: {
    baseline_count: 0,
    current_pass: 0,
    current_fail: 0,
    current_skipped: 0,
    last_run_at: "2026-05-18T00:00:00Z",
  },
  phase_2_approved: false,
};

describe("routine-state atomic writes", () => {
  let dir: string;
  let statePath: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "anchor-state-"));
    statePath = path.join(dir, "STATE.json");
    await writeStateAtomic(seedState, statePath);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("read-back returns the seeded state verbatim", async () => {
    const got = await readState(statePath);
    expect(got).toEqual(seedState);
  });

  it("writes trailing newline + 2-space indent (stable diffs)", async () => {
    const raw = await readFile(statePath, "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('  "current_phase"');
  });

  it("updateState applies a mutator and persists the result", async () => {
    const next = await updateState((s) => {
      s.current_task = "1.9";
      s.tests.current_pass = 76;
      return s;
    }, statePath);
    expect(next.current_task).toBe("1.9");
    expect(next.tests.current_pass).toBe(76);

    const reread = await readState(statePath);
    expect(reread.current_task).toBe("1.9");
    expect(reread.tests.current_pass).toBe(76);
  });

  it("concurrent updateState calls don't corrupt the file (last write wins)", async () => {
    await Promise.all([
      updateState((s) => {
        s.emails_sent.push({ at: "t1", type: "phase-started", subject: "1" });
      }, statePath),
      updateState((s) => {
        s.emails_sent.push({ at: "t2", type: "demo-milestone", subject: "2" });
      }, statePath),
      updateState((s) => {
        s.emails_sent.push({ at: "t3", type: "blocker", subject: "3" });
      }, statePath),
    ]);

    // The file must still be valid JSON — that's the atomic guarantee. The
    // contents may reflect only the last write (this is read-mutate-write with
    // no locking), but it must never be corrupted mid-stream.
    const reread = await readState(statePath);
    expect(reread.notify_email).toBe("test@example.com");
    expect(Array.isArray(reread.emails_sent)).toBe(true);
    expect(reread.emails_sent.length).toBeGreaterThanOrEqual(1);
  });
});
