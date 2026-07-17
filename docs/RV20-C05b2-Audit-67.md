# RV20-C05b2 - Audit Round 67

Result: **A PASS-WITH-CONCERNS (3 CONCERN, all comment accuracy); B PASS (no
defect).** Counter stays **0/5**. R67 is extremely close to clean: B returned a
full PASS, and A found no logic bug, no state leak, no architecture violation.
A's three findings are residual docstring precision. All fixed (comment-only).

## A's findings

1. **Tap-scrub docstring "frame-synced" claim (COMMENT, FIXED).** The tap-scrub
   state block said its rAF is "frame-synced with the NavPipelineHost Page panel
   the executor drives." Wrong on two counts: the tap-scrub arms only when
   `pager.transitionTarget === null` (no pipeline transition in flight), so there
   is no executor slide to sync with; and it uses `TITLE_CROSSFADE_MS` (200ms)
   while a forward-enter slide uses `COMMIT_T_DEFAULT_MS` (300ms). Reworded: the
   scrub runs on its OWN rAF, independent of the executor's slide.
2. **Deep-to-deep "All detail -> detail navs intercepted" over-generalised
   (COMMENT, FIXED).** The `isDeepToDeep` check requires `isNavPipelineRoute(to)`.
   A detail -> non-pipeline-detail nav (e.g. `/profile` -> `/offline/bookmarks`,
   where the target has tag 'detail' but is not a pipeline route) fails the check
   and falls through. Reworded to say "detail -> detail nav between two PIPELINE
   routes."
3. **Cross-reference omitted a clear-site (COMMENT, FIXED).** In the
   `#lastDispatchWasDeepToDeep` docstring, the parenthetical comparing it to
   `#lastLandWasPipelineCommit` listed three clear sites, omitting `unmount`.
   Fixed (four sites).

## B's verdict

**PASS, no defect.** B verified every trajectory, every clear-site, every §5
invariant, and the comment accuracy. No logic bug, no state leak, no architecture
violation, no spec-code drift.

## Gate outputs (post-fix, 2026-07-17)

Comment-only fixes; the e2e gate is unchanged from the R65 post-fix run.

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    378 pass / 0 fail
$ bun run test:e2e                    202 passed + 2 flaky (exit 0, R65 post-fix run)
```

R68 audits this state.
