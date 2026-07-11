# RV20-C05b1 - Audit Round 71 (architect-run, 2 independent auditors)

Result: **A PASS-WITH-CONCERNS (2 LOW); B PASS-WITH-CONCERNS (1 LOW).** Zero
MED/HIGH. Counter stays 0/5.

Both auditors verified UNIFY, the unified following-visual model, the bidirectional
re-grab, the cross-type interrupt handoff, the coverProgress continuity, the FAB
kind resolution, the scrollChrome.show on back-swipe (R70 fix confirmed), and the
pager cleanup on unmount. Both were run with a clean, role-less, non-leading
prompt that **explicitly forbade reading the Journal and all
`RV20-C05b1-Audit-*.md` files**.

## Fixes

- **B C1 (LOW) - the release-gate offset used the classifier's last-pointermove
  offset, not detectSwipe's final-release delta:** the orchestrator overrode
  `velocity` and `reversed` from detectSwipe's release signals but not `offset`,
  so a finger that moved between the last `pointermove` and the `pointerup` could
  cross the commit threshold in GPL but not in the pilot (narrow: typically <2px
  for a touch lift). FIX: `onPointerUp` now overrides `offset = x - startX`
  (matching the pointermove computation with the release x), making the commit
  gate byte-identical to GPL's `deltaX >= SWIPE_COMMIT`.
- **A C1 (LOW) - `resetPagerStore` docstring omitted the `mount()` call site:**
  the method is called from both `mount()` (at-rest publish with fresh mount
  inputs) and the host's at-rest `$effect`. FIX: the docstring now names both
  sites.

## Documented (non-defect)

- **A C2 (LOW) - stale `pager.fractionalIndex` at the cross-tab route-swap
  boundary:** the same class as the R68 MED, now mitigated by the unmount pager
  cleanup (`active: false` -> the FAB falls back to the URL-derived tab index) +
  Svelte 5's batched flush (the page.url change + onDestroy run in the same
  commit, so the FAB sees the final state). A pre-existing concern with the
  shared pager-store singleton (GPL routes share it too), not introduced by the
  pilot; zero-frame in practice.

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    424 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab    92 passed
```

Consecutive pass votes: **0** (both PWC with LOW; the offset override + docstring
fixed; R72 audits the post-fix state).
