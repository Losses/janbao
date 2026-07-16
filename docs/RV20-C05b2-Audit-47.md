# RV20-C05b2 - Audit Round 47

Result: **A PASS-WITH-CONCERNS (4 CONCERN); B PASS-WITH-CONCERNS (2 CONCERN).**
Counter stays **0/5**. R47 (the first round with the stripped, mechanism-free
audit prompt) found a dead-state field, a narrow state leak, and stale comments.
Both auditors verified the architecture and all six Known conditions are correct.
The stripped prompt worked: the auditors found the dead state (via grep) and the
leak (via trace) independently, without being led.

## A's findings (4 CONCERN)

1. `pager.coverProgress` is dead state (logic/dead code): published at 7 sites,
   stored in the pager, but NO consumer reads it (the Header reads `backMorph`,
   the FAB reads `publication.progress`). Removed entirely (field + 7 publish
   sites + ~10 stale comments across src/lib).
2. `nav-executor-logic.ts:406` docstring claimed the Header reads
   `pager.coverProgress` (it reads `backMorph`). Fixed (part of the coverProgress
   removal).
3. `mobile-pager.svelte.ts:22-25` docstring listed `coverProgress` as a Header
   morph signal. Fixed (part of the removal).
4. `releaseInputs` cleared `#enterAnimationArmedSettle` but NOT
   `#isEnterAnimation` (narrow state leak: an in-flight enter abandoned by a
   non-intercepted nav leaves `#isEnterAnimation` stale, early-returning
   `updateViewport` / `updateBackTarget` / `onSvelteKitAfterNavigate`). Fixed:
   `releaseInputs` now clears `#isEnterAnimation` too.

## B's findings (2 CONCERN)

1. `playEnterAnimation` plan-literal comment (~805-810) claimed the Header morph
   is "driven by `backMorph`" during the enter; actually the settle ease is armed
   (`settleActive`), so the morph uses the settle branch, not `backMorph`. Fixed.
2. `#pendingGesture` / `PendingGestureTransition` docstrings said "back-swipe" but
   the field also carries forward swipes on a bidirectional host. Fixed to "swipe".

## Additional cleanup (the stale deleted-mechanism comment class)

While removing `coverProgress`, a grep sweep found the broader stale-FAB-mechanism
class in e2e test comments (`familySwapScale`, `trackFractionalIndex`,
`foregroundFraction`, `TRACK_TRANSITION_MS`, `restingScale`, `tabFraction` across
`fab.spec.ts`, `helpers.ts`, `tab-host-swipe.spec.ts`, `reproduce-new-mobile-bugs`,
`fab-deep-real-interaction`). All rewritten to the current `fabScale(publication.
progress, fromHasFab, toHasFab)` mechanism. `grep` for all deleted-mechanism names
in both `src/lib` and `e2e/` now returns 0.

## Gate outputs (post-fix, independently re-run 2026-07-16)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    406 pass / 0 fail
$ bun run test:e2e                    202 passed + 1 flaky (exit 0)
```

The implementation was delegated to fresh-context sub-agents (e2e run
synchronously) and independently re-verified by the orchestrator (the coverProgress

- deleted-mechanism greps confirmed 0; the gate re-run on the clean final tree).

R48 audits the post-R47-fix state.
