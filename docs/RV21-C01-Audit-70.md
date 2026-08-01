# RV21-C01 Audit 70 (R70)

**Date:** 2026-07-31. **Round:** R70. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): 3 DragFabAnchor null-condition sites

`src/lib/utils/header-probe.ts:86` (interface),
`orchestrator:738` (field), `:950` (getter) said "null when no settle
was in flight" -- but the capture guard adds `publication.inFlight` (the
macro can leave `transitioning` while `settleActive` is still true). R67-B
fixed DragSearchAnchor siblings but missed DragFabAnchor. Added "or
transition" qualifier to all 3.

## Auditor B finding (CONFIRMED): messages-back-swipe:1686 parenthetical

`e2e/messages-back-swipe.spec.ts:1686` parenthetical said the discrete-nav
path "does NOT arm a settle for centerTab routes since `outgoingHasTabs
=== incomingHasTabs === true`" -- the orchestrator never enters the
discrete-nav branch for this click (returns false at the non-interception
gate; destination is not a tab root and not a deep-to-deep). Rewrote to
match the R68 sibling: "the orchestrator does NOT intercept this nav: the
destination is not a tab root and not a deep-to-deep".

## Verify

`bun run check` 0/0; prettier + em-dash clean. Comment-only; runtime
unchanged.

## Disposition

Counter after R70: 0/5.
