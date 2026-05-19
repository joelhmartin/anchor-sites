import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const STATE_PATH = path.join(REPO_ROOT, ".routine", "STATE.json");

export type RoutineState = {
  notify_email: string;
  current_phase: number;
  current_phase_file: string;
  current_task: string | null;
  phase_started_at: string | null;
  last_commit_sha: string | null;
  last_email_sent_at: string | null;
  emails_sent: Array<{ at: string; type: string; subject: string }>;
  demo_milestones_sent: string[];
  blockers_open: number;
  tests: {
    baseline_count: number;
    current_pass: number;
    current_fail: number;
    current_skipped: number;
    last_run_at: string;
  };
  phase_2_approved: boolean;
  // Allow other top-level keys to coexist (e.g., the `_comment` field).
  [key: string]: unknown;
};

export async function readState(filePath: string = STATE_PATH): Promise<RoutineState> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as RoutineState;
}

/**
 * Atomic write: serialize, write to a sibling tempfile, then rename onto the
 * target. POSIX rename is atomic when src and dst are on the same filesystem
 * — so a reader will see either the old or new file, never a partial JSON.
 *
 * The tempfile name embeds the pid + a counter so concurrent writes within
 * the same process don't collide.
 */
let tempCounter = 0;
export async function writeStateAtomic(
  state: RoutineState,
  filePath: string = STATE_PATH,
): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${tempCounter++}.tmp`);
  const json = JSON.stringify(state, null, 2) + "\n";
  await writeFile(tmp, json, "utf-8");
  await rename(tmp, filePath);
}

/**
 * Read → mutate → atomic write. The mutator is given the parsed state and
 * may either return a new state object or mutate in place and return void
 * (in which case the original object is written).
 */
export async function updateState(
  mutator: (state: RoutineState) => RoutineState | void,
  filePath: string = STATE_PATH,
): Promise<RoutineState> {
  const current = await readState(filePath);
  const next = mutator(current) ?? current;
  await writeStateAtomic(next, filePath);
  return next;
}
