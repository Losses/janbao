# RV20-C05b1 - Audit Round 62 (architect-run, 2 independent auditors)

Result: **A PASS-WITH-CONCERNS (1 MED + 2 LOW); B PASS (5 LOW, all non-blocking).**
The MED resets the consecutive-pass counter 2/5 -> 0/5.

Both auditors verified UNIFY (no bridge), no forbidden patterns (no `setTimeout`
/ CSS `transition` / `transitionend` / `pendingNav` in the pilot's path), the
all-rAF executor, §9 coordinator-does-not-bypass, the back-swipe / chip-exit /
forward-enter geometry, the interrupt handoff (B verified the cross-geometry
restingTranslate 0 vs -W handoff, the sub-threshold commit, the re-grab, and the
`recoverDesktopFlipNav` gate), and comment accuracy. Both were run with a clean,
role-less, non-leading prompt that **explicitly forbade reading the Journal and
all `RV20-C05b1-Audit-*.md` files**; neither saw prior-round results.

## MED concern + fix

- **A C1 (MED) - missing scroll capture / restoration on the left + centre
  panels:** GPL restores each panel's scroll position from the page cache
  (`leftScrollTop` / `currentScrollTop` `$derived` + a restore `$effect` + an
  `onscroll` capture on each `<section>`). NavPipelineHost had none of this, so a
  back-swipe preview rendered the inbox at `scrollTop 0` instead of its cached
  position (a real regression for a spec-required transition; the e2e suite
  checked the slide trajectory but not the preview's scroll). FIX: ported GPL's
  pattern - a `leftEl` ref + bind, `leftScrollTop` / `currentScrollTop` `$derived`
  (left gated to `!chipExit`, since during a chip-exit the left panel renders the
  TARGET's panel, not the back-target), two restore `$effects` (set `scrollTop`
  immediately + on the next frame; setting `scrollTop` programmatically does not
  fire `onscroll`, so it cannot loop), and two `onscroll` capture handlers (left
  captures to `leftHref`, centre to `page.url.pathname`). The left panel's content
  comes from the conversation route's own `data.inbox` server load; the inbox list
  from the inbox route's `data.conversations` server load - both SSR-embedded.
  Verified by a new e2e (`messages-back-swipe` "restores the inbox scroll
  position") that shrinks the viewport so the inbox overflows, scrolls it, then
  asserts the conversation page's left panel restores the cached `scrollTop`.

## LOW findings (all documented NON-defects; no spec violation)

- **A C2 / B C3 - chip-exit skeleton branches unreachable** (recurring): the
  root layout's `Promise.allSettled` returns truthy `EMPTY_*` on rejection, so
  `page.data.*` is always truthy and the `{:else}` skeleton branches never fire.
  Honest defensive code for a future non-eager-loaded target (5b2+); the cached
  panel path IS reached. No change.
- **A C3 / B C2 - `initialTrackTransform` is fixed regardless of `shouldEnter`:**
  the host renders `translateX(-50%)` for all mobile mounts, then overrides to
  `translateX(0px)` in `onMount` for the forward-enter. A paint between initial
  render and `onMount` could flash centre for one frame. Masked in practice by
  Svelte 5's synchronous mount cycle (the forward-enter e2e's first sample is
  ~0). Documented; not fixed this round (masked, very low priority).
- **B C1 - no `resetPagerStore` on unmount:** GPL's `onMount` cleanup resets the
  pager; the pilot's `unmount` does not. Masked by the FAB atom's
  `discreteNavInFlight` latch; no visible defect. No change.
- **B C4 - stale `isGesturePageLayoutRoute` name/comment for the pilot:** returns
  `true` for `/messages/<id>` (correct - disables DualColumnLayout's competing
  tab-swipe), though the pilot now mounts NavPipelineHost, not GPL. Behavior
  correct; name/comment misleading. Dissolves in 5b3. No change.
- **B C5 - expected content swap on gesture-during-chip-exit interrupt:**
  documented expected behavior (the panel reflects the new in-flight transition);
  the e2e suite excludes this race as too tight to test. Not a defect.

## Opportunistic cleanup (convergence reset made it moot)

- **chipExitState symmetry:** `playEnterAnimation` set `#publication.chipExit =
false` but not `#chipExitState`. Added `this.#chipExitState = false;` so the
  `#chipExitState` / `#publication.chipExit` sync invariant holds at every
  publication-write site. No behavior change (already false from the constructor
  on a fresh mount); code-aesthetics only. (The owner had asked about doing this;
  the R62 MED reset made the "freeze state during convergence" objection moot.)

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- tab-click-transition tab-exit-preview messages-back-swipe fab    91 passed
```

Consecutive pass votes: **0** (A carried the MED; fixed; R63 audits the
post-fix state).
