# DV05 C01 Journal - Post-Throttle Anti-Duplicate Audit Loop

Method: 5 parallel independent full-audit agents (no roles), loop until 5/5
unconditional PASS. See [[dv04-audit-loop]]. Plan: DV05-Plan.md.

## Round 1

- 5 agents (concurrency, error-UX, boundary, coverage, frontend-locks).
- Verdict: 5/5 FAIL, unanimous.
- CRITICAL (5/5): missing `rate_limits` drizzle migration - table declared in
  schema but no SQL file, so every throttle call would throw "no such table".
- MAJOR: `POST /api/messages` conversation-create unprotected (most severe PM
  double-submit surface, outside the original 5 endpoints).
- Fixes: generated `0011_cute_absorbing_man.sql` (committed 9db4515); added
  `post:conversation` throttle + `messages/new` client `sending` lock; 429
  feedback on both activity surfaces; `limit >= 1` guard.
- Carry-overs documented (edit-form UPDATE idempotency, isSubmitting sharing,
  enforceRateLimit duplication, reply `{success:false}` shape, retryAfter on
  action paths, process.env fallback).
- Gate: check 0 errors (1 unrelated a11y warning from the Control+Enter
  commit), lint exit 0.

## Round 2

- 5 agents re-audited with round-1 fixes + the carry-over list.
- Verdict: 5/5 PASS_WITH_NOTES - no CRITICAL/MAJOR, all carry-overs
  re-validated as accepted. Consensus remaining item: the reply action returns
  `{success:false}` for the throttle hit while publish and message use
  `fail(429)` - an inconsistency every agent flagged as the one thing between
  PASS_WITH_NOTES and UNCONDITIONAL_PASS.
- Fix this round: unify the reply throttle rejection to `fail(429)` and add a
  `failure` branch to the reply `enhance` handler, so all three form-action
  surfaces return the same shape on throttle.
- Gate: re-run check 0 errors + lint exit 0, `prettier --write` on docs.
- Advancing to round 3 targeting 5/5 UNCONDITIONAL_PASS.

## Round 3

- 5 agents. Verdict: 1/5 UNCONDITIONAL_PASS (Agent A), 4/5 PASS_WITH_NOTES. No
  CRITICAL. One MAJOR (Agent B): `enforceRateLimit` unguarded insert meant a
  prod D1 that hadn't applied 0011 would throw "no such table" and 500 every
  write surface.
- Fixes: fail-open try/catch around the counter op (a best-effort anti-duplicate
  guard must never take down writes; `enforceThrottle` stays fail-closed);
  `messages/new` explicit 429 branch (unblocks Agent C).
- New carry-over: pre-existing business-error silence on several form/fetch
  handlers (`publishFailed`, `tooManyRecipients`, activity non-429,
  editReply/editMessage draft loss) - these are on the business-error path, not
  the throttle-hit path, pre-date DV05, and belong to a separate UX cleanup.
- Gate: check 0 errors / 0 warnings, lint exit 0.
- Advancing to round 4 targeting 5/5 UNCONDITIONAL_PASS.

## Round 4

- 5 agents with the expanded carry-over list (business-error silence flagged as
  pre-existing / DV05-out-of-scope).
- Verdict: **5/5 UNCONDITIONAL_PASS**.
- R3 fixes verified (fail-open + `messages/new` 429), no regression. All six
  throttle-hit paths surface a message and preserve input; gates green (check
  0/0, lint exit 0). All carry-overs re-validated, none upgraded.
- **DV05 C01 COMPLETE 2026-06-17** — closed in 4 rounds (~20 sub-agent audits).
  Release-ready subject to applying the 0011 migration on production D1.
