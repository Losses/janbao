# RV20-C05b1 - Audit Round 11 (2-auditor, with e2e gate)

Result: **split** - A PASS-WITH-CONCERNS (1 concern: `dragging` flag),
B FAIL (3 concerns). All fixed.

## Auditor verdicts

- **A: PASS-WITH-CONCERNS.** One concern: `dragging` published `true`
  during tab-click and forward-enter (where GPL publishes `false`),
  causing Header morph to snap at the route swap instead of easing.
  Fixed: `dragging = publication.inFlight && this.#pendingGesture !== null
&& !publication.chipExit` - `#pendingGesture !== null` is true only
  during a live gesture, false for tab-click and enter-animation.
- **B: FAIL.** Three concerns: (C1) `#isEnterAnimation` not cleared
  when a gesture interrupts mid-enter (coverProgress pinned at 0 during
  the gesture). (C2) No e2e for gesture-during-enter. (C3) Docstring
  didn't mention chip-exit/enter coverProgress=0 overrides. All fixed:
  C1: clear in `#beginGesture`. C2: new "back-swipe during forward-
  enter interrupts cleanly" e2e. C3: docstring updated.

## State

check 0, lint 0, 10/10 gesture+tab-click e2e pass, 423 unit pass.

Consecutive pass votes: **0** (R11 split; both auditors had concerns).
