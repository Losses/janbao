# DV05 Journal - Post-Throttle Anti-Duplicate Audit Loop

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
  `fail(429)` (carry-over #4) - an inconsistency every agent flagged as the one
  thing between PASS_WITH_NOTES and UNCONDITIONAL_PASS.
- Fix this round: unify the reply throttle rejection to `fail(429)` and add a
  `failure` branch to the reply `enhance` handler, so all three form-action
  surfaces return the same shape on throttle.
- Gate: re-run check 0 errors + lint exit 0, `prettier --write` on docs.
- Advancing to round 3 targeting 5/5 UNCONDITIONAL_PASS.
