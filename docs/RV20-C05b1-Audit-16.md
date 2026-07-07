# RV20-C05b1 - Audit Round 16 (2-auditor, with e2e gate)

Result: **split** - A PASS (zero concerns, 187 e2e green), B
PASS-WITH-CONCERNS (1 concern: tab-click-during-gesture-commit resets
startProgress to 0, snapping the track backward from mid-commit
position). Fixed.

## Auditor verdicts

- **A: PASS.** Zero concerns. The R15 ordering fix verified correct:
  `wasEnterAnimation` captured before clearing. Geometry confirmed
  (`p = 1 - enterProgress`). 77/77 e2e green. UNIFY intact. Lifecycle
  complete.
- **B: PASS-WITH-CONCERNS.** One concern: the `startProgress` fix
  only handled the forward-enter case (`wasEnterAnimation`). When a
  tab-click interrupts a **gesture commit** (back-swipe mid-animation),
  `wasEnterAnimation` is false, `startProgress` stays 0, and the track
  snaps from the mid-commit position to -W (backward jump). GPL
  smoothly redirects via CSS transition. Pre-existing (since Session 3),
  not introduced by R16.

## Fix

Added an `else if` branch: when `#publication.inFlight && plan !== null`
(a gesture commit is in flight), read `this.#executor?.state.progress`
and pass it directly as `startProgress`. The back-swipe and tab-exit
plans share geometry (axis, distance, restingTranslate), so the
progress transfers without inversion.

## State

check 0, lint 0, 8/8 gesture e2e pass.

Consecutive pass votes: **0** (R16 split; B's concern reset).
