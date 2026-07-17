# RV20-C05b2 - Audit Round 69

Result: **A PASS-WITH-CONCERNS (2 CONCERN, both logic); B PASS-WITH-CONCERNS
(1 CONCERN, comment accuracy).** Counter stays **0/5**. R69 found two more
consequences of the `/discussions/pN` migration (the gesture path and the
classifier), both real and both fixed. No logic bug outside the migration's
integration gaps.

## A's findings

1. **Within-tab pagination GESTURE back-swipe plays an empty-space slide
   (LOGIC, FIXED).** The R65 B1 fix suppressed the slide for within-tab
   pagination CLICK navs (the `onSvelteKitBeforeNavigate` guard). But the
   GESTURE path (`#resolvePlan`'s `suppressSlide`) had no equivalent check, so a
   back-swipe from `/discussions/pN` to `/` played a slide that revealed empty
   space (panel 0 has no left neighbour). Fixed: `suppressSlide` is OR-extended
   with a within-tab pagination condition (same spatial tab index, both `tag:
'tab'`, different pathname).
2. **`isNavPipelineRoute` misclassified `/discussions/pN` (LOGIC, FIXED).** The
   function strips `/pN` and checks the remainder; `/discussions/pN` -> stripped
   to `/discussions` which is not in any pattern. But `/discussions/pN` is a
   pipeline route (it mounts `NavPipelineTabHost` via the `(tabs)` layout). The
   misclassification caused `#onExecutorSettle` to fire the non-pipeline branch
   (premature settle end + brief title/morph flicker) and `#dispatchNav` to set
   `#lastLandWasPipelineCommit = false` (potential tap-scrub mis-arm). Fixed:
   added `/^\/discussions\/p\d+$/` to the pattern list + test.

## B's finding

1. **`#enterAnimationArmedSettle` docstring incomplete (COMMENT, FIXED).** The
   R68 B1 fix added `#endSettleEase` as a clear-site for the flag, but the
   docstring's clear-site enumeration (sites a-d) was not updated. Added (e)
   `#endSettleEase`.

## Gate outputs (post-fix, independently re-run 2026-07-17)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    378 pass / 0 fail
$ bun run test:e2e                    202 passed + 2 flaky (exit 0)
```

R70 audits this state.
