# RV21-C01 Audit 46 (R46)

**Date:** 2026-07-30. **Round:** R46. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED; overturns R45): swipe-commit duration

The CDP swipe helpers (`swipeExact` / `swipeBack` / `swipeHorizontal` in
`e2e/helpers.ts`) dispatch `timestamp: 0`. Chrome sets `event.timeStamp
= 0` for those, so `releaseVelocity` sees `dt = 0` and returns 0, so the
commit runs `onCommit(0)` -> `COMMIT_T_DEFAULT_MS = 300`. The project's
own comment at `e2e/messages-back-swipe.spec.ts:1347` states this, and
that file's velocity test passes explicit `Date.now()/1000` timestamps to
avoid it.

R45 changed the `SETTLE_PER_TICK_CLAMP_FACTOR` docstring from 300ms to
200ms (trusting `fab-release-snap`'s own 200ms comments, which are
themselves wrong for the same reason): the wrong direction. Reverted that
docstring to the correct 300ms (cap ~0.097, `2*cap ≈ 0.193 < 0.2`).
Fixed 12 sibling `~200ms` swipe-commit-duration comments across
`e2e/fab-release-snap.spec.ts` (4), `e2e/header-title-replay.spec.ts` (2),
`e2e/fab.spec.ts` (3), `e2e/messages-back-swipe.spec.ts` (3). R42's
"swipeBack-driven ~200ms is velocity-matched, legitimate" classification
was wrong for the same reason; those 3 sites are now 300ms.

Legitimate `~200ms` retained: `TITLE_CROSSFADE_MS` title crossfade /
tap-scrub, sampler-window budgets, drag wall-clock, the velocity test's
`+-200ms` sampling window.

## Auditor B finding (CONFIRMED): orchestrator unmount comment duration

`orchestrator:1416` said `playEnterAnimation`'s settle runs a "200ms
title crossfade"; `playEnterAnimation` is `onCommit(0)` -> 300ms. Removed
the specific figure ("run a title crossfade").

## Verify

`bun run check` 0/0; `bun run lint` exit 0; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R46: 0/5.
