# RV20-C05b2 - Audit Round 54

Result: **A PASS-WITH-CONCERNS (2 CONCERN); B PASS-WITH-CONCERNS (1 CONCERN).**
Counter stays **0/5**. R54 found three comment-accuracy issues. All fixed. Both
auditors verified the architecture and all six Known conditions are correct.

## A's findings (2 CONCERN)

1. BurgerArrowIcon:52-55 comment claimed "SPLAY=7.4...arm=10.49px" but the
   actual constant is SPLAY=8 (8\*1.414=11.31). Fixed: values updated to 8/11.31.
2. `onSvelteKitAfterNavigate` docstring (~1846) claimed a pipeline-to-pipeline
   swap is "skipped" (cleanup via releaseInputs). Wrong: the new host's configure
   re-sets active before afterNavigate, so the call runs through. Fixed: rewritten
   to distinguish pipeline-to-pipeline (runs through) from navigation to a
   non-pipeline route (genuinely skipped).

## B's finding (1 CONCERN)

1. NavStateMachine file docstring (~13) claimed "TWO mutation points" but the
   class has four: dispatch, forceReset, setSettleState, setSearchScrubbing. The
   closing line also under-described the orchestrator's call sites (it also calls
   setSettleState from the settle rAF paths + setSearchScrubbing from tap-scrub).
   Fixed: changed to FOUR + listed all + added the settle/scrub call sites.
   (The inline dispatch() docstring had the same "two" claim; also fixed.)

## Gate outputs (post-fix, independently re-run 2026-07-16)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    406 pass / 0 fail
$ bun run test:e2e                    202 passed + 1 flaky (exit 0)
```

The flaky test is `fab.spec.ts:436` (the known CDP-touch class). Comment-only
changes; e2e confirms no regression.

R55 audits the post-R54-fix state.
