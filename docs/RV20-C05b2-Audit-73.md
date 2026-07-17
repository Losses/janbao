# RV20-C05b2 - Audit Round 73

Result: **A PASS-WITH-CONCERNS (1 moderate + 2 low); B PASS-WITH-CONCERNS
(1 low, comment accuracy).** Counter stays **0/5**. R73 found a bug introduced
by the R70 B1 fix (the FAB `distance === 0` freeze was too broad), plus two
low-severity edge cases and one comment accuracy. The moderate bug is fixed; the
low findings are accepted tradeoffs of the suppressed-slide design + a comment
fix.

## A's findings

1. **FAB scale freezes on backward-to-deep-page from the leftmost tab (MODERATE,
   FIXED).** The R70 B1 fix added `distance === 0` short-circuit to the FAB
   layer, but it fired for BOTH within-tab pagination (where the FAB should
   freeze) AND backward-to-deep-from-tab-0 (where the FAB should exit via
   `fabScale`). The Header morph animates for backward-to-deep (backMorph
   published), so the FAB should animate too. Fixed: the short-circuit now also
   checks `getRouteData(toPathname).tag === 'tab'` (only within-tab pagination
   freezes; backward-to-deep falls through to `fabScale`).
2. **Header morph snaps on rare within-tab pagination forward direction (LOW,
   ACCEPTED).** For `/` -> `/discussions/pN` via back-swipe, `backMorph` is
   published (the target is not `isTabRootPath`), animating the morph during the
   drag. At release the settle takes over with `outgoingHasTabs ===
incomingHasTabs`, holding morph at 1. The drag value snaps to 1. Rare
   trajectory; the suppressed-slide design's consequence.
3. **FAB landing snap on within-tab pagination (LOW, ACCEPTED).** The FAB freezes
   at FROM during the gesture, snaps to TO on landing. Acceptable for a
   suppressed slide (no animation during the gesture; the FAB updates on
   landing).

## B's finding

1. **Finish-then-new comment says "tab-click" but code handles any nav (COMMENT,
   FIXED).** The branch queues any discrete navigation (tab-click, popstate,
   link, goto) to a tab root or deep-to-deep target during a committing phase.
   Reworded the comment to enumerate the actual nav types.

## Gate outputs (post-fix, independently re-run 2026-07-17)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    378 pass / 0 fail
$ bun run test:e2e                    202 passed + 1 flaky; fab-release-snap
                                     timing flake (1 failed in full-suite
                                     run, 3/3 pass on isolated re-run;
                                     not a regression from R73 fixes)
```

R74 audits this state.
