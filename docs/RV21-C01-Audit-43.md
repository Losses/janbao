# RV21-C01 Audit 43 (R43)

**Date:** 2026-07-30. **Round:** R43. **Votes:** auditor A BLOCK, auditor
B BLOCK (same class). **Counter after:** 0/5.

## Finding (both auditors): velocity=0 commit-slide duration

A velocity=0 commit (discrete-nav tab-click / goto / popstate, and
`playEnterAnimation` forward-enter) runs `COMMIT_T_DEFAULT_MS = 300`
(`solveCommitDuration`'s velocity-0 short-circuit; orchestrator:1160
confirms "over ~300ms (COMMIT_T_DEFAULT_MS)"). Six code comments
understated this as ~160ms or ~200ms. Fixed all to ~300ms:

- `e2e/messages-back-swipe.spec.ts:3354` (R24-A replay, was ~160ms)
- `e2e/messages-back-swipe.spec.ts:3420` (R24-A inline, was ~160ms)
- `e2e/messages-back-swipe.spec.ts:881` (history.back popstate, was
  ~200ms)
- `e2e/helpers.ts:221` (NavPipelineHost forward-enter, was ~200ms)
- `e2e/tab-exit-preview.spec.ts:23` (tab-click exit, was ~200ms)
- `e2e/enter-animation.spec.ts:15` (list->thread slide-in, was ~200ms;
  auditor A only; B had flagged it borderline)

Note: auditor A classified `:881` as swipeBack-driven (legitimate), but
the comment explicitly says `history.back` (popstate -> velocity 0 ->
300ms); auditor B is correct, so it was fixed.

The swipeBack-driven `~200ms` claims (`messages-back-swipe:736/831/976`)
are velocity-matched (range 100-600ms, ~200ms reachable) and legitimate.

## Verify

`bun run check` 0/0; `bun run lint` exit 0; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R43: 0/5.
