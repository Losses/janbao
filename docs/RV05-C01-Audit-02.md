# RV05 · Round 2 Audit — Post-Throttle Anti-Duplicate Feature

Round 2 re-audited the code after round-1 fixes (migration, conversation
throttle, activity 429 feedback, limit guard) with the carry-over list
attached. Plan: DV05-Plan.md.

## Round 2 verdicts (5 independent full-audit agents)

- Agent A — concurrency / atomicity: PASS_WITH_NOTES
- Agent B — error-handling / UX: PASS_WITH_NOTES
- Agent C — boundary / numeric: PASS_WITH_NOTES
- Agent D — coverage / consistency: PASS_WITH_NOTES
- Agent E — frontend locks / edit forms: PASS_WITH_NOTES

5/5 PASS_WITH_NOTES — no CRITICAL/MAJOR anywhere. All round-1 fixes verified
correct with no regression. Every carry-over was re-validated and accepted.

## Consensus item between PASS_WITH_NOTES and UNCONDITIONAL_PASS

All five agents independently flagged the same single item: the reply action
returns `{success:false}` for the throttle hit while the publish and message
actions return `fail(429,...)` (round-1 carry-over #4). Each surface's enhance
handler handles its own shape correctly, so it is not a correctness bug — but
it is the one remaining inconsistency every agent named as the blocker to
UNCONDITIONAL_PASS.

Fix applied this round (verified in round 3): unify the reply throttle
rejection to `return fail(429, { error })` and add a `failure` branch to the
reply `enhance` handler, so all three form-action surfaces return the same
shape on throttle.

## Carry-overs — all re-validated and accepted (no upgrades)

- Edit forms (UPDATE, idempotent) — confirmed in source: editReply, editMessage,
  editDiscussion are pure UPDATE with no INSERT; double-submit harms nothing.
- `isSubmitting` shared on the discussion page — pre-existing; cancel-lock does
  not open the race (first submit always sees false; Ctrl+Enter routes through
  the same guard).
- `enforceRateLimit` vs `enforceThrottle` duplication — intentional isolation,
  documented in the function comment; lint passes.
- `retryAfter` dropped on action paths — immaterial at the default 10s window;
  the 429 http endpoints still send the Retry-After header.
- `process.env` fallback — local-dev only, prod uses platform.env; matches the
  established pattern.

## Coverage re-verified

All six user-content CREATE surfaces throttled with unique buckets
(`post:discuss`, `post:reply`, `post:message`, `post:conversation`,
`post:activity`, `post:activity_comment`), each placed after auth + content +
permission validation and before the insert. Idempotent paths (bookmarks,
drafts, invitations, uploads, activity joins, register) correctly excluded.

## Ops note (not a code defect)

Production D1 must apply `0011_cute_absorbing_man.sql` manually before deploy
([[prod-d1-migration-manual]]); local libsql auto-applies it.

## Gate (end of round 2)

- `bun run check`: 0 errors (1 unrelated a11y warning on LexicalEditor from the
  Control+Enter commit).
- `bun run lint`: exit 0.

## Next

Round 3: re-audit after the reply fail(429) unification; target 5/5
UNCONDITIONAL_PASS.
