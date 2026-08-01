# RV21-C01 Audit 59 (R59)

**Date:** 2026-07-31. **Round:** R59. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): header-probe:144 single-case parenthetical

`src/lib/utils/header-probe.ts:144` said "it may differ from the natural
formula for a branch-4 re-grab" -- a single-case enumeration that omits
boundary (branch 1) and suppressed (branch 2) gesture releases. R58-B
fixed the sibling at `orchestrator:799` but missed this one. Removed the
parenthetical; the following universal clause "where the natural formula
would differ from the captured value" covers all cases.

## Auditor B finding (CONFIRMED): 2 binary classification sites

Both are siblings of the R58-B fix at `orchestrator:799-801`:

- `orchestrator:3497-3500`: "for shapes where the FAB layer reads branch
  4 ... for branch 5 ..." binary examples (omits 1/2). Rewrote to
  universal "the captured value equals the displayed FAB at the release
  instant (whatever branch won)".
- `orchestrator:4309`: "dragAnchor-shifted (or natural-formula)" (omits
  1/2/3). Rewrote to "the captured displayed-FAB value (whatever branch
  won)".

## Verify

`bun run check` 0/0; prettier + em-dash clean. Comment-only; runtime
unchanged.

## Disposition

Counter after R59: 0/5.
