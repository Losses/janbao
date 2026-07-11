# RV20-C05b1 - Audit Round 73 (architect-run, 2 independent auditors)

Result: **A PASS-WITH-CONCERNS (1 MED + 1 LOW); B PASS (4 LOW, non-blocking).**
Counter resets 2/5 -> 0/5.

Both auditors verified UNIFY, the unified following-visual model, the bidirectional
re-grab, the release gate (final-release offset), the cross-type interrupt handoff,
the coverProgress continuity, the FAB kind resolution, the scrollChrome.show, and
the forward-enter. Both were run with a clean, role-less, non-leading prompt that
**explicitly forbade reading the Journal and all `RV20-C05b1-Audit-*.md` files**.

## MED concern + fix

- **A C1 (MED) - a stale `discreteNavInFlight` flag enabled the FAB's CSS
  transition during a pilot commit, double-easing the FAB scale:** on arrival at
  the conversation the FAB family swaps `list -> overlay`, latching
  `discreteNavInFlight` for 280ms. If the user back-swipes or taps a tab within
  that window, the commit slide has `dragging: false`, `pendingNav: null`, and
  `discreteNavInFlight: stale-true`, so `transitionEnabled = true` and the FAB
  atom's CSS `transition: transform 200ms ease-out` re-eases the rAF-driven
  `coverProgress` (a first-order lag; the FAB reaches only ~63% of its target by
  the end of the commit). FIX: `transitionEnabled` now also gates on
  `pager.transitionTarget === null`: during a pilot transition (the target is
  non-null) the CSS transition is OFF (the rAF is the sole FAB-scale source); at
  rest / on landing (target null) the normal `discreteNavInFlight` / `pendingNav`
  logic applies for the family-swap ease.

## Comment-accuracy fixes

- **B C1 (LOW) - `#dispatchTarget` docstring said "target pathname":** the field
  carries the full URL (pathname + search). FIX: "target URL (pathname + search)."
- **B C2 (LOW) - `#navDispatchInFlight` docstring said "goto":** the flag is also
  set for the `history.back()` / `history.forward()` hop paths. FIX: names all
  three dispatch paths.

## Documented (non-defect)

- **A C2 (LOW) - `goto(target).finally(...)` could clobber a new dispatch's flags
  on instance reuse:** requires two platform flips plus a new dispatch within one
  microtask of the old `goto` resolving. Practically unreachable. The
  `history.back()` / `history.forward()` paths have no promise and no `.finally`.
- **B C3 (LOW) - `pointercancel -> cancelled` unreachable:** `detectSwipe` routes
  `pointercancel` through its `onEnd`; the pilot matches GPL's routing. Defensive
  code for a future integration.
- **B C4 (LOW) - `unmount()` pager reset is the GPL pattern:** byte-for-byte
  match with `GesturePageLayout.svelte:953`. Not a pilot-introduced regression.

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    424 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab    92 passed
```

Consecutive pass votes: **0** (A carried the MED; fixed + the 2 comment LOWs;
R74 audits the post-fix state).
