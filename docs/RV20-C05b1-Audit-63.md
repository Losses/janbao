# RV20-C05b1 - Audit Round 63 (architect-run, 2 independent auditors)

Result: **A PASS (5 LOW, all non-defects); B PASS-WITH-CONCERNS (1 MED + 1
LOW).** Zero HIGH. The MED leaves the counter at 0/5.

Both auditors verified UNIFY (no bridge), no forbidden patterns, the all-rAF
executor, §9, the back-swipe / chip-exit / forward-enter geometry, the interrupt
handoff, the re-entry guard, and the commit/cancel gate. A additionally verified
the cross-geometry interrupt algebra (gesture / enter / chip-exit `1 - p`
inversion lands on the same translateX); B verified `recoverDesktopFlipNav`
land-only-commit gate and that `getCurrentScrollY` reads `.detail-scroll-pane`
(the real centre scroll). Both were run with a clean, role-less, non-leading
prompt that **explicitly forbade reading the Journal and all
`RV20-C05b1-Audit-*.md` files**; neither saw prior-round results.

## MED concern + fix

- **B C1 (MED) - chip-exit inherits the back-target's stale `scrollTop` across
  the content swap:** a consequence of the R62 scroll-restore port. The restore
  `$effect` sets the left `<section>`'s `scrollTop` to the inbox's cached
  position (e.g. 150). When a chip-exit fires, the section's CONTENT swaps
  (MessagesPanel -> ActivityPanel / DiscussionsPanel) but the `<section>` element
  is stable, so its `scrollTop` stays at 150. `leftScrollTop` becomes 0
  (`!chipExit`-gated), so the restore `$effect`'s `> 0` guard skips and leaves
  the stale 150 - the target panel slides in scrolled down, then jumps to 0 when
  the real `/activity` mounts. (GPL cannot have this: its chip-exit reveals a
  LoadingChip, never a panel.) FIX: added a `$effect` that resets
  `leftEl.scrollTop = 0` when `chipExit` is true, so the target panel starts at
  the top. When `chipExit` flips back to false the restore `$effect` re-runs and
  re-applies the inbox position.

## Folded-in cleanup (owner-flagged)

- **`restoreScroll` helper (dedup):** the owner pointed out the left + centre
  restore `$effect` bodies were duplicated. Extracted
  `restoreScroll(el, top): VoidHandler` (set `scrollTop` immediately + on the
  next rAF, with rAF cleanup; no-op return when nothing to apply) so each effect
  is `$effect(() => restoreScroll(leftEl, leftScrollTop))`. The third effect
  (the chip-exit reset) is a one-liner.

## LOW findings (all documented NON-defects; no spec violation)

- **B C2 / A C5 - `pointerDisabled = $derived(() => !isMobile || trackEl ===
null)`** yields a getter function (recurring): correct for the action's
  `disabled: () => boolean` contract; type-checks. Unusual pattern. No change.
- **A C1 - chip-exit FAB (`coverProgress = 0`) is a deliberate spec-compliant
  divergence:** cleaner than GPL (which ramps the source list's FAB toward the
  wrong list); falls under the spec's chip-exit divergence. No e2e asserts the
  chip-exit FAB trajectory. Not a defect.
- **A C2 - chip-exit skeleton branches unreachable** (recurring): documented
  dead code (the eager-load always truthy); spec-mandated fallback for 5b2+. No
  change.
- **A C3 - `#republishToPager` non-centerTab branch unreachable in 5b1:**
  forward-looking for 5b2 deep routes. Harmless. No change.
- **A C4 - `direction: 'backward'` hardcoded for tab-exits:** correct for the
  pilot (centerTab=2; `/` and `/activity` are lower-index). Would derive from
  tab-index for a 5b2 pilot. Out of scope. No change.

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- tab-click-transition tab-exit-preview messages-back-swipe fab    91 passed
```

Consecutive pass votes: **0** (B carried the MED; fixed; R64 audits the
post-fix state).
