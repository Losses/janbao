# RV21-C01 Audit 74 (R74)

**Date:** 2026-08-01. **Round:** R74. **Votes:** auditor A BLOCK, auditor
B PASS. **Counter after:** 0/5.

## Auditor A findings (CONFIRMED): `#armSettleEase` duration binary mis-classifies the tab-click case

A new defect class (duration-claim binary), distinct from the R71-R73
null-condition and call-site-enumeration classes.

**F1:** `orchestrator:3181-3186` (`#armSettleEase` docstring `durationMs`
paragraph) said "A non-gesture settle (tab-click, plain title change)
passes `TITLE_CROSSFADE_MS`". False. The slide-tracking arms
(`playEnterAnimation` forward-enter and the `onSvelteKitBeforeNavigate`
discrete-nav arm, which covers tab-click / back-button / deep-to-deep)
call `executor.onCommit(0)` then pass `commitStart.durationMs` -- the
velocity-0 solver default `COMMIT_T_DEFAULT_MS` (300ms), not
`TITLE_CROSSFADE_MS` (200ms). Only the `notifyHeaderState` idle
title-change arm actually passes `TITLE_CROSSFADE_MS`. Rewrote to
enumerate the three real duration patterns: velocity-0 commit (300ms) /
real-velocity clamped (100..600ms) for the slide-tracking arms,
`acceleratedMs` for `#accelerateInFlight`, `TITLE_CROSSFADE_MS` (200ms)
for the absorb and idle title-change arms.

**F2:** `orchestrator:528-530` (settle rAF intro inline comment) restated
the same binary ("velocity-matched commit duration for a gesture-release
settle, `TITLE_CROSSFADE_MS` for a non-gesture settle"). Same fix:
rewrote the parenthetical to name the three duration sources.

## Auditor B: PASS (sampling did not reach the class)

Auditor B PASSed with exhaustive sampling but did not read the
discrete-nav arm's duration-passing code (`onSvelteKitBeforeNavigate`
2820-3043); its read of that method stopped at 2530. The
`#armSettleEase` duration binary is a real inaccuracy A caught and B's
sampling did not reach -- the value of two independent auditors with
different sampling paths. (B's one borderline candidate --
`resetPagerStore` "Called from two sites" vs three code call sites -- was
a defensible generic "host" abstraction covering two sibling host
components on the same functional path, correctly not flagged.)

## Orchestrator verification

Independently verified A's behavioral chain before fixing, not trusting
the enumeration: `COMMIT_T_DEFAULT_MS = 300` (`nav-executor-logic.ts:50`),
the solver returns it for velocity 0 (`:239` / `:251`), the discrete-nav
arm calls `onCommit(0)` (`orchestrator:2823`) -> `:2997` reads
`commitStart.durationMs` (300) -> `:3043` passes it; `playEnterAnimation`
is the same (`:1218` / `:1269` / `:1270`). `TITLE_CROSSFADE_MS = 200`
(`gesture-constants.ts:36`), clamp range 100..600ms. Confirmed all six
`#armSettleEase` callers' duration args before rewriting: `:1270` /
`:3043` / `:3519` pass `commitDurationms`; `:3833` passes `acceleratedMs`;
`:4110` / `:4275` use the default `TITLE_CROSSFADE_MS`.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R74: 0/5 (auditor A's BLOCK resets the counter; auditor B's
PASS does not count toward convergence when the other auditor BLOCKs).
