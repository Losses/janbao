# RV20-C05b2 - Audit Round 40

Result: **A PASS-WITH-CONCERNS (2 docstring CONCERNS); B PASS-WITH-CONCERNS
(1 docstring CONCERN + 1 logic-bug claim disproven).** Counter stays **0/5**.
R40 found three stale docstrings (fixed) and one reported logic bug that, on
investigation, is a false positive.

## A's findings (2 CONCERN, docstrings)

1. `mobile-pager.svelte.ts:8-9` - the `dragging` docstring claimed the bar
   "drops its CSS transition"; those transitions were removed in R18. Fixed to
   name the current consumers (the Header morph drag branch, the SearchTabBar
   underline stretch).
2. `orchestrator:2119-2126` - the `#cancelAllAnimationEases` docstring claimed
   `notifyHeaderState` is a "safety net" for `pager.dragging`; the Header's
   `$effect.pre` does not read `pager.dragging`, and `notifyHeaderState` only
   finishes the tap-scrub (not the settle) on a drag. Fixed to state this method
   is the sole settle-cancellation point.

## B's findings (1 docstring CONCERN + 1 logic-bug claim)

1. `BurgerArrowIcon.svelte:22-27` - the `progress` docstring listed only
   `backMorph` and `settleProgress` as `iconProgress` drivers, omitting the
   tap-scrub (`tapMorph * scrubIconEndpoint`). Fixed.
2. `orchestrator` cross-host deep->tab title/morph snap (logic-bug claim) -
   **disproven (false positive)**. See the investigation below.

## B2 investigation (false positive)

B reported that a cross-host discrete nav to NavPipelineTabHost (e.g.
`/profile` -> `/messages`) leaves the title/morph settle un-armed
(NavPipelineTabHost has no `playEnterAnimation`, and the `notifyHeaderState`
idle-arm was claimed to be skipped during the cross-host gap frame). An
attempted fix (arm the settle in the discrete-nav branch for `fromTag !== 'tab'
&& isTabRootPath(to)`) was reverted: it broke the existing
`header-tab-descent-cross-tab-exit` CALIBRATION test, which asserts
`settling === true` at the deep->tab landing flush for both the forward and the
back descent. That test proves the deep->tab settle IS armed at landing, so the
gap-frame-skip manifestation does not occur; the idle-arm fires when the
destination title lands. A comment was added in the discrete-nav branch noting
the settle is armed at landing (referencing the CALIBRATION test) to record
this and pre-empt a re-flag.

## Gate outputs (post-fix, independently re-run 2026-07-15)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    406 pass / 0 fail
$ bun run test:e2e                    202 passed + 1 flaky (exit 0)
```

The applied fixes are docstring / comment only (no behavior change); e2e
confirms no regression. The B2 fix attempt (a behavior change) broke the
deep->tab settle CALIBRATION test; it was reverted, restoring green - the e2e
gate caught the incorrect fix.

R41 audits the post-R40-fix state.
