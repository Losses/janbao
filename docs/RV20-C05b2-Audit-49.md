# RV20-C05b2 - Audit Round 49

Result: **A PASS (0 concerns); B PASS-WITH-CONCERNS (4 CONCERN + 1 nitpick).**
Counter stays **0/5** (B's concerns reset the accumulator). R49 was the closest
to a clean round: A returned a clean PASS, and B found four minor comment /
redundancy issues. Both auditors verified the architecture and all six Known
conditions are correct.

## A's verdict: PASS (no defect)

A traced the orchestrator, state machine, executor, FAB/Header reactive readers,
and both host components end to end and found no logic bug, no state leak, no
architectural violation, no inaccurate comment, and no dead code. Three minor
observations (releaseInputs not clearing #liveDragging/#prevWasDrag/#commitStartRaw,
a redundant conjunct in notifyHeaderState, stale Pilot\* type names) were all
below the CONCERN bar.

## B's findings (4 CONCERN, all fixed)

1. `publication` getter docstring (~590-596) claimed hosts read it via `$effect`
   and write the pager store. Inaccurate: the orchestrator writes the pager itself
   via `#republishToPager`; hosts read `publication` via `$derived` and call only
   `resetPagerStore()`. Fixed.
2. `#onExecutorTick` docstring (~1468) referenced `chipProgress` (a deleted field).
   Fixed to `tapMorph`.
3. `NavExecutorTickFn` docstring (nav-executor.svelte.ts ~70) claimed the FAB
   reads the pager store. The FAB reads `publication.progress` directly. Fixed.
4. `#armTapScrubEase` reduced-motion branch (~2092) called `setTapMorph(toValue)`
   then immediately `#finishTapScrubEase()` (which sets it null); the `toValue`
   write was dead (overwritten in the same flush). Removed.
5. nitpick (spec §5 ~228, 232): `coverProgress` reference; fixed to `backMorph`.

## Additional process fix

`docs/RV20-C05b2-Audit-48.md` had four em-dashes (U+2014) that tripped the
project's `local/no-emdash` eslint rule. Fixed (replaced with semicolons). Future
audit docs will avoid em-dashes.

## Gate outputs (post-fix, independently re-run 2026-07-16)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    406 pass / 0 fail
$ bun run test:e2e                    202 passed + 1 flaky (exit 0)
```

The flaky test is `fab.spec.ts:436` (the known CDP-touch class). The fixes were
applied by a fresh-context sub-agent (e2e synchronous) and independently
re-verified by the orchestrator.

R50 audits the post-R49-fix state.
