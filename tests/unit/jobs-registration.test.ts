// W2-CONC / D617 + D618 — job registration options.
//
// `registerHandlers` is the one greppable list of every queue this app runs;
// this suite pins the OPTIONS that carry real operational behavior against a
// stub boss (no DB, no pg-boss instance):
//   - D617: SITE_PROVISION registers 3 concurrent workers (each provision
//     attempt holds up to ~4 minutes; the default single slot serialized an
//     N-site burst into ~4N minutes of preview-URL latency).
//   - D618: GIT_EXPORT's queue carries a retry-with-backoff ladder — exports
//     for different sites contend on ONE branch ref, and the default
//     2 immediate retries dropped the loser into invisible `failed`.
import { describe, expect, it } from "vitest";
import type { PgBoss } from "pg-boss";
import {
  registerHandlers,
  GIT_EXPORT,
  SITE_PROVISION,
  AGENT_TURN,
  GIT_EXPORT_RETRY_OPTIONS,
  SITE_PROVISION_LOCAL_CONCURRENCY,
  ALL_QUEUE_NAMES,
} from "../../src/server/jobs/index.js";

type Captured = { name: string; options?: Record<string, unknown> };

function makeStubBoss() {
  const createQueueCalls: Captured[] = [];
  const workCalls: Captured[] = [];
  const boss = {
    async createQueue(name: string, options?: Record<string, unknown>) {
      createQueueCalls.push({ name, options });
    },
    async work(name: string, optionsOrHandler: unknown, maybeHandler?: unknown) {
      const options =
        typeof optionsOrHandler === "function" || maybeHandler === undefined
          ? undefined
          : (optionsOrHandler as Record<string, unknown>);
      workCalls.push({ name, options });
      return `worker-${name}`;
    },
    async schedule() {
      // AUTH_PRUNE cron upsert — irrelevant here.
    },
  } as unknown as PgBoss;
  return { boss, createQueueCalls, workCalls };
}

describe("registerHandlers options (D617/D618)", () => {
  it("D617: SITE_PROVISION registers localConcurrency 3 so provision bursts don't serialize at ~4min each", async () => {
    const { boss, workCalls } = makeStubBoss();
    await registerHandlers(boss);
    const provision = workCalls.find((c) => c.name === SITE_PROVISION);
    expect(provision).toBeTruthy();
    expect(provision!.options).toMatchObject({
      localConcurrency: SITE_PROVISION_LOCAL_CONCURRENCY,
    });
    expect(SITE_PROVISION_LOCAL_CONCURRENCY).toBe(3);
  });

  it("D618: GIT_EXPORT's queue keeps its stately policy AND gains the backoff retry ladder", async () => {
    const { boss, createQueueCalls } = makeStubBoss();
    await registerHandlers(boss);
    const gitExport = createQueueCalls.find((c) => c.name === GIT_EXPORT);
    expect(gitExport).toBeTruthy();
    expect(gitExport!.options).toMatchObject({
      policy: "stately",
      ...GIT_EXPORT_RETRY_OPTIONS,
    });
    // Backoff, not immediate hammering — the ladder's shape is the fix.
    expect(GIT_EXPORT_RETRY_OPTIONS.retryBackoff).toBe(true);
    expect(GIT_EXPORT_RETRY_OPTIONS.retryLimit).toBeGreaterThan(2);
    expect(GIT_EXPORT_RETRY_OPTIONS.retryDelay).toBeGreaterThan(0);
  });

  it("AGENT_TURN keeps its stately policy (dedupe under singletonKey) — regression guard", async () => {
    const { boss, createQueueCalls } = makeStubBoss();
    await registerHandlers(boss);
    const agentTurn = createQueueCalls.find((c) => c.name === AGENT_TURN);
    expect(agentTurn!.options).toMatchObject({ policy: "stately" });
  });

  // D606/D114/D1009: the jobs-health endpoint drives its per-queue report off
  // ALL_QUEUE_NAMES. If a new queue is registered without adding it to that
  // list, the health endpoint goes blind to it — exactly the bug the old
  // hard-coded 4-of-7 list was (site.provision, git.export, git.import
  // invisible). Pin the two against each other so they can't drift.
  it("D606: ALL_QUEUE_NAMES matches exactly the queues registerHandlers creates", async () => {
    const { boss, createQueueCalls } = makeStubBoss();
    await registerHandlers(boss);
    const registered = createQueueCalls.map((c) => c.name).sort();
    expect([...ALL_QUEUE_NAMES].sort()).toEqual(registered);
  });
});
