# RV05 · Round 1 Audit - Post-Throttle Anti-Duplicate Feature

Scope: full audit of the newly added "prevent duplicate submission" feature
(server-side rate limiting via a new `rate_limits` table + frontend sync locks),
covering all user-content write entry points. Method: 5 parallel independent
full-audit agents (no role assignment), per [[dv04-audit-loop]]. Plan: DV05-Plan.md.

## Round 1 verdicts (5 independent full-audit agents)

- Agent A - concurrency / atomicity: FAIL
- Agent B - error-handling / UX regression: FAIL
- Agent C - boundary / numeric: FAIL
- Agent D - coverage / consistency: FAIL
- Agent E - frontend locks / edit forms: FAIL

Unanimous FAIL with strong consensus.

## CRITICAL - fixed this round

- Missing `rate_limits` migration. The table was declared in `schema.ts` but no
  drizzle migration existed. `getLocalDb` applies SQL files from
  `drizzle/local-migrations/` (it does not push schema diffs), and prod D1 is
  applied manually, so the table existed nowhere. Every `enforcePostThrottle`
  call would throw "no such table: rate_limits" and turn all 5 write surfaces
  into 500s.
  Fix: `bun run db:generate:local` produced `0011_cute_absorbing_man.sql`
  (CREATE TABLE rate_limits with PK over bucket, identifier, window_epoch),
  committed in 9db4515.

## MAJOR - fixed this round

- `POST /api/messages` (create new conversation + first message) was
  unprotected. This is the most severe PM double-submit surface: two POSTs
  spawn two distinct conversations with identical title, recipients, and
  opening message - exactly the failure mode this feature targets - yet it was
  outside the original 5 endpoints.
  Fix: added `post:conversation` throttle in `api/messages/+server.ts` after
  recipient validation and before the transaction, returning `tooManyRequests`;
  added a sync `if (sending) return` guard in `messages/new/+page.svelte send()`.

## MINOR - fixed this round

- Activity surfaces silently swallowed 429. `ActivityComments.submitComment`
  and `activity/+page.svelte submitActivity` only branched on `res.ok`, so a
  throttled user saw nothing. Added an `else if (res.status === 429) alert(...)`
  branch to both.
- `POST_THROTTLE_LIMIT=0` would silently block every submission (count is
  always greater than 0). `getPostThrottleConfig` now requires limit greater
  than or equal to 1; a 0 or misconfig falls back to the default of 1.

## Carry-overs (accepted with rationale - not re-fixed)

- Edit forms (editReply / editMessage / editDiscussion) lack the cancel-lock
  and server throttle. These are UPDATE paths on existing rows (idempotent),
  not CREATE; a double-submit overwrites the same row with identical content -
  no duplicate record, no data loss. Out of scope for "prevent duplicate
  CREATE", matching the feature's stated goal.
- `isSubmitting` is shared between the reply composer and the inline editReply
  form on the discussion page. Pre-existing design; the new cancel-lock does
  not open the race. Not introduced by this change.
- `enforceRateLimit` is near-identical to `enforceThrottle`. Project policy
  explicitly tolerates intentional function-level duplication for isolated
  surfaces; similarity-ts reports it informational only and lint passes.
- Reply action returns `{success:false}` while publish and message return
  `fail(429,...)`. Each shape matches its existing enhance handler's branch.
  (Revisited in round 2 - see RV05-C01-Audit-02.)
- `retryAfter` is not surfaced on the SvelteKit-action paths (only on the 429
  http endpoints). With the default 10s window this is immaterial; noted as a
  future enhancement if windows grow.
- `process.env` fallback in `getPostThrottleConfig` matches the established
  `getDiscussionsLimit` pattern (platform.env in prod, process.env locally).

## Gate (end of round 1)

- `bun run check`: 0 errors. 1 warning on `LexicalEditor.svelte:581` (a11y),
  introduced by the unrelated `8818091 feat: Control + Enter` commit, not by
  this feature.
- `bun run lint`: exit 0.

## Next

Round 2: re-audit with the carry-over list; target 5/5 UNCONDITIONAL_PASS.
