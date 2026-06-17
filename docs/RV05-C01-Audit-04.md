# RV05 · C01 · Round 4 Audit - Post-Throttle Anti-Duplicate Feature

Round 4 re-audited after the round-3 fail-open + `messages/new` 429 fixes, with the
expanded carry-over list (business-error silence flagged as pre-existing /
DV05-out-of-scope). Plan: DV05-Plan.md.

## Round 4 verdicts (5 independent full-audit agents)

- Agent A - concurrency / atomicity: UNCONDITIONAL_PASS
- Agent B - error-handling / UX: UNCONDITIONAL_PASS
- Agent C - boundary / numeric: UNCONDITIONAL_PASS
- Agent D - coverage / consistency: UNCONDITIONAL_PASS
- Agent E - frontend locks / edit forms: UNCONDITIONAL_PASS

**5/5 UNCONDITIONAL_PASS.** DV05 C01 is complete.

## Verified this round

- R3 MAJOR fix (fail-open): `enforceRateLimit` wraps the counter op in try/catch; on
  any counter-store failure it logs and returns `{blocked:false, retryAfter:0}` so a
  missing migration or transient DB error never turns a write into a 500. Atomicity
  preserved (upsert either completes with the real count or fails open);
  `enforceThrottle` (auth) stays fail-closed.
- R3 MINOR fix (`messages/new` 429 branch): explicit `else if (res.status === 429)`.
- All six UGC create surfaces throttled with distinct buckets, placed after auth +
  validation and before the insert, identifier `user:<id>`.
- All six throttle-hit paths surface a user-visible message and preserve input
  (`fail(429)` → enhance failure alert on the three form-action surfaces;
  `tooManyRequests(429)` → fetch 429 branch on the three endpoints).
- Gates: `bun run check` 0 errors / 0 warnings; `bun run lint` exit 0.

## Carry-overs - all re-validated and accepted (no upgrades)

- Edit forms (UPDATE, idempotent) unthrottled.
- `isSubmitting` shared on the discussion page (pre-existing).
- `enforceRateLimit` vs `enforceThrottle` duplication (intentional isolation; fail-open
  vs fail-closed).
- `retryAfter` dropped on SvelteKit-action paths (immaterial at 10s window).
- `process.env` fallback (local-dev only).
- Prod D1 must apply 0011 manually (deployment workflow; mitigated by fail-open).
- Pre-existing business-error silence on non-throttle paths (`publishFailed`,
  `tooManyRecipients`, activity non-429, editReply/editMessage draft loss) -
  DV05-out-of-scope UX cleanup, not the throttle-hit path.

## Outcome

DV05 C01 (post-throttle anti-duplicate) closed with 5/5 unconditional PASS in 4
rounds (~20 sub-agent audits). The throttle contract - authoritative server-side
fixed-window guard (fail-open on store failure) + client sync-lock, across all six
user-content create surfaces - is complete and release-ready subject to applying the
`0011` migration on production D1.
