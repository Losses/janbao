# RV05 · C01 · Round 3 Audit - Post-Throttle Anti-Duplicate Feature

Round 3 re-audited after the round-2 reply fail(429) unification. Plan: DV05-Plan.md.

## Round 3 verdicts (5 independent full-audit agents)

- Agent A - concurrency / atomicity: UNCONDITIONAL_PASS
- Agent B - error-handling / UX: PASS_WITH_NOTES
- Agent C - boundary / numeric: PASS_WITH_NOTES
- Agent D - coverage / consistency: PASS_WITH_NOTES
- Agent E - frontend locks / edit forms: PASS_WITH_NOTES

1/5 UNCONDITIONAL_PASS. No CRITICAL. One MAJOR (Agent B) plus MINOR notes.

## Fixed this round

- **MAJOR (Agent B): prod migration-missed → 500.** `enforceRateLimit` did an unguarded
  `insert(rateLimits)`, so a prod D1 that hadn't applied 0011 would throw "no such table"
  and 500 every write surface. Fix: wrapped the counter op in try/catch **fail-open** -
  if the counter store is unavailable the request is allowed through and logged
  (`throttle.ts`). Rationale: post rate-limiting is a best-effort guard against duplicate
  submission, not a correctness gate; it must never take down writes. `enforceThrottle`
  (auth) stays fail-closed.
- **MINOR (Agent C): `messages/new` 429 branch.** `send()` now has an explicit
  `else if (res.status === 429)` branch, so Agent C advances to UNCONDITIONAL_PASS.

## New carry-over (pre-existing, DV05-out-of-scope - not introduced by this feature)

Several form/fetch handlers do not surface **business-validation** errors (the throttle-
hit path is correct everywhere; this is about _other_ `{success:false}` / non-2xx returns):

- `post/discussion` enhance handles only `redirect` + `failure`, so `publishFailed`
  (a `{success:false}` return) is silent.
- `PrivateMessageWindow` compose enhance success branch doesn't check
  `success === false`, so `tooManyRecipients` / `contentTooLarge` clear the input silently.
- `ActivityComments` / `activity` only branch on `res.ok` + `429`, so other non-2xx
  (400/403/404) are silent.
- `editReply` / `editMessage` enhances silently drop the edit draft on a
  `{success:false}` return.

These are **pre-existing** UX bugs on the business-error path, not the throttle-hit path,
and not introduced or worsened by DV05. They belong to a separate UX-cleanup task (the
DV04 system audit surface), and are recorded here so agents do not re-report them as
DV05 defects. The throttle contract itself (authoritative fixed-window server guard +
client sync-lock, fail-open on store failure) is complete.

## Carry-overs - all still accepted

- Edit forms (UPDATE, idempotent) not throttled.
- `isSubmitting` shared on the discussion page (pre-existing).
- `enforceRateLimit` vs `enforceThrottle` duplication (intentional isolation).
- `retryAfter` dropped on SvelteKit-action paths (immaterial at 10s window).
- `process.env` fallback (local-dev only).
- Prod D1 must apply 0011 manually (deployment workflow, now also mitigated by fail-open).

## Gate (end of round 3)

- `bun run check`: 0 errors / 0 warnings.
- `bun run lint`: exit 0.

## Next

Round 4: re-audit with the expanded carry-over list; target 5/5 UNCONDITIONAL_PASS.
