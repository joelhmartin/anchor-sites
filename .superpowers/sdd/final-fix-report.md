# Final-fix report — remove-kinsta-dns branch

## FIX 1 — docs/provisioning.md accuracy

Changed two passages:

1. **Manual mode description** (Authentication § DNS provider section, ~line 97):
   - Before: "the orchestrator surfaces the required records and verifies them by live DNS lookup, leaving the actual record creation to the operator."
   - After: `ensureRecord` returns `"external"` without writing anything; orchestrator reports `dns` step as `"skipped"` with the required records in detail; live-DNS verification is a separate Phase 10 concern via `verifyRecord`, not part of provisioning.

2. **Failure modes table** (Idempotency notes section, ~line 241):
   - Before: "verifies by live DNS lookup. Returns `dns: error` if records are not yet resolvable; the operator must add them manually and re-run."
   - After: `dns` step is `"skipped"`, detail lists records to set at registrar, orchestrator never errors on DNS in manual mode; re-running is safe.

## FIX 2 — relativeName wrong-zone guard

File: `src/server/dns/provider.ts`

Changed final fallback in `relativeName` from `return f;` to:
```ts
throw new Error(`relativeName: ${JSON.stringify(fqdn)} is not within zone ${JSON.stringify(zone)}`);
```

File: `src/server/dns/provider.test.ts`

Added test:
```ts
it("throws when the fqdn is not within the zone", () => {
  expect(() => relativeName("foo.example.com", "anchorcorps.com")).toThrow(/not within zone/);
});
```

## FIX 3 — manual-mode orchestrator integration test

File: `tests/integration/provisioning.test.ts`

Added test `"manual-mode provider: dns step is 'skipped' with detail listing records"`:
- Injects `DnsProvider` with `id: "manual"`, `ensureRecord` returns `"external"`
- Asserts: `dnsStep.status === "skipped"`, `dnsStep.detail` matches `/manually/i`
- Asserts: `manualDns.ensureRecord` called with zone `"anchorcorps.com"` and CNAME record

## Test results

```
npx vitest run src/server/dns
  ✓ godaddy.test.ts (10 tests)
  ✓ manual.test.ts  (7 tests)
  ✓ provider.test.ts (8 tests)   ← includes new throw test
  ✓ resolve.test.ts (7 tests)
  32 passed

TEST_DATABASE_URL=... npx vitest run tests/integration/provisioning.test.ts
  ✓ 8 tests passed   ← includes new manual-mode test
```

## tsc --noEmit

Clean — no output.

## grep kinsta

```
grep -rli kinsta . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=.superpowers
```

Results:
- `.git` — worktree gitdir pointer file containing path `remove-kinsta-dns` (unavoidable artifact, not source code)
- `docs/superpowers/plans/2026-06-28-gcloud-dns-remove-kinsta.md` — design doc (expected)
- `docs/superpowers/specs/2026-06-28-gcloud-dns-remove-kinsta.md` — design doc (expected)

No kinsta references in source, tests, or other docs.
