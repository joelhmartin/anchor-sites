/**
 * AI service configuration (Phase 6 — see DECISIONS D-038).
 *
 * The model pin lives here so the choice is one greppable constant. Sonnet 4.6
 * is the cost/latency sweet spot for schema-validated block edits (operator
 * call, 2026-05-20) and every proposal is re-validated server-side before it
 * can be applied, so a weaker proposal is rejected, never shipped. The
 * `claude-api` skill's hard default is Opus 4.7 — bumping is a one-line change
 * here (the edit contract and endpoint are model-agnostic).
 */
export const AI_MODEL = "claude-sonnet-4-6" as const;

/**
 * Default output cap. Tool-op proposals are small (a handful of ops), so this
 * is comfortably under the ~16K non-streaming SDK-timeout threshold. 6.7 may
 * tune it; callers can raise it per-request.
 */
export const AI_MAX_TOKENS = 4096;

export type AiMode = "stub" | "dry-run" | "api";

/**
 * Mode selection mirrors `src/server/email/send.ts` (D-012) so dev + tests
 * never call the live API and never spend money:
 *   - `ANTHROPIC_API_KEY` unset        → "stub"    (dev default; canned proposal)
 *   - `ANTHROPIC_API_KEY === "dry-run"` → "dry-run" (tests/smoke; canned proposal)
 *   - any other value                  → "api"     (real Anthropic call)
 *
 * The operator prereq (ANTHROPIC_API_KEY in Secret Manager → Cloud Run env)
 * flips prod from stub to api; until then prod runs stub and spends nothing.
 */
export function resolveAiMode(env: NodeJS.ProcessEnv = process.env): AiMode {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return "stub";
  if (key === "dry-run") return "dry-run";
  return "api";
}
