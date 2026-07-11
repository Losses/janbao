# RV20-C05b1 - Audit Round 70 (architect-run, 2 independent auditors)

Result: **A PASS (2 LOW, documented); B PASS-WITH-CONCERNS (1 MED + 2 comment
LOW).** Counter stays 0/5.

First audit of the Session-19 cleaned state (fab/header optional + omitted,
re-grab bidirectional, pointerDisabled, non-centerTab removed, e2e names). Both
auditors verified UNIFY, the unified following-visual model, the bidirectional
re-grab (rightward absorbed + leftward direct, continuous at 0), the cross-type
interrupt handoff, the coverProgress continuity, and the FAB kind resolution.
Both were run with a clean, role-less, non-leading prompt that **explicitly
forbade reading the Journal and all `RV20-C05b1-Audit-*.md` files**.

## MED concern + fix

- **B C1 (MED) - the back-swipe gesture never showed a scroll-hidden header:**
  the orchestrator's live-drag block published to the pager but never touched the
  scroll-chrome store. If the user had scrolled down (header translated off-screen
  by hide-on-scroll), the header stayed off-screen for the entire back-swipe
  reveal. GPL calls `scrollChrome.show()` in `onSwipeMove`; MobileTabPager does
  the same. Verified independently: the orchestrator had zero `scrollChrome`
  references; the host used it only for `setScrollContainer`. FIX: the
  orchestrator's live-drag block now calls `getScrollChromeStore().show()` on
  each drag-right move (matching GPL's `onSwipeMove`), so the back-arrow + title
  are visible during the reveal.

## Comment-accuracy fixes

- **B C2 (LOW) - "the executor's rAF is the sole writer of the transform
  property":** false. The transform is also written by the SSR seed
  (`initialTrackTransform`), the at-rest `$effect` (re-applies `translateX(-50%)`
  after a settle), and the forward-enter seed (`translateX(0px)`). FIX: the
  comment now states the CSS carries no TRANSITION (true) and names all four
  transform writers.
- **B C3 (LOW) - "The forward-enter forces coverProgress=0":** false.
  `coverProgress` ramps 0->1 during the enter; the FAB stays hidden because the
  FAB layer's family gate (`pilotTransitionListKind === null` for the overlay
  conversation target) short-circuits it to 0. FIX: the comment now describes the
  family-gate mechanism.

## Documented (A, non-blocking)

- **A C1 - the classifier's `pointercancel -> cancelled` case is unreachable
  from the integrated pipeline:** `detectSwipe` routes `pointercancel` through
  its onUp -> finish -> onEnd, and the bridge forwards it as a `pointerup`. The
  orchestrator's class docstring documents this routing honestly. Not a
  divergence (byte-stable with GPL's detectSwipe routing).
- **A C2 - the skeleton `{:else}` branches are unreachable:** the eager-load
  always truthy; the spec-mandated defensive fallback; the in-source comment
  states this verbatim. The skeleton deliverable is met.

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    424 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab    92 passed
```

Consecutive pass votes: **0** (B carried the MED; fixed + the 2 comment LOWs;
R71 audits the post-fix state).
