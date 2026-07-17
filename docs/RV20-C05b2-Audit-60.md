# RV20-C05b2 - Audit Round 60

Result: **A PASS-WITH-CONCERNS (3 CONCERN); B PASS-WITH-CONCERNS (3 CONCERN +
1 note).** Counter stays **0/5**. R60 audited the post-R59 tree with the 5b3
deferral web dissolved (#1/#2/#4 deleted, #3 pointercancel fixed, A2 fixed)
and a fresh `shouldCancelOnRelease` primitive. Both auditors verified the core
pipeline (orchestrator singleton, state-machine authority, single-progress FAB
scale, settle/tap-scrub eases, finish-then-new queueing, the non-pipeline-
detour title freeze, pointercancel cancel) clean. The findings are narrow:
two state-leak variants on host destruction, one dead state field, and
spec-wording precision on the drawer.

## A's findings (3 CONCERN)

1. **Spec-code drift: the drawer is a `captureSwipe` consumer, not
   `detectSwipe`.** Known #3 listed `DualColumnLayout`'s drawer among the
   `detectSwipe` consumers of `shouldCancelOnRelease`; the drawer mounts
   `captureSwipe` (`DualColumnLayout.svelte` edge-open + overlay-close). The
   behaviour is correct (both primitives call `shouldCancelOnRelease`); the
   classification was wrong. Fixed: Known #3 now lists `captureSwipe` and
   `detectSwipe` consumers separately.
2. **Drawer CSS transition + over-broad spec wording.** The drawer panel
   carries `transition-transform duration-200` (the post-`captureSwipe` snap),
   and Known #2's "the §5 bar now covers it" could read as claiming
   `DualColumnLayout` has no CSS transition. Fixed: Known #2 now states the
   drawer's snap is a separate `captureSwipe`-driven UI gesture, not part of
   the page-transition animation layer, retained (with `swipe.ts` /
   `DualColumnLayout` deletion tracked under Out of scope). The drawer
   transition is NOT a 5b2 defect (B independently reached the same reading).
3. **`releaseInputs` docstring silent on `#queuedDiscreteNav`.** The queue
   intentionally survives `releaseInputs` (consumed by `#landAtRest` on the
   destination host), but the docstring listed only the settle / tap-scrub
   ease exceptions. Fixed: added a one-line note.

## B's findings (3 CONCERN)

1. **`#liveDragging` leaks across host destruction (LOGIC, FIXED).**
   `releaseInputs` cleared `#pendingGesture` / `#navDispatchInFlight` / the
   enter flags but not `#liveDragging`. A host destroyed mid-drag (an external
   nav to a non-pipeline route while the finger is down) never receives the
   pointerup, so the release path that clears `#liveDragging` does not run;
   the next pipeline host's forward enter then read the stale `true` and
   `#republishToPager` published `pager.dragging = true`, corrupting the
   Header morph / titleView. Fixed: `releaseInputs` clears `#liveDragging`.
2. **`OrchestratorState.startedAt` is dead state (DEAD CODE, FIXED).** Set by
   the reducer on every `intent` / `interrupt` transition and by
   `initialOrchestratorState`; no production reader (the orchestrator's
   `#publication` reads `macro` / from/to/direction only). The reducer's `now`
   parameter existed only to feed it. Fixed: removed `startedAt` from
   `OrchestratorState`, the reducer's `now` parameter, the wrapper's
   `NavClockFn` / `#now` clock threading, and the test's `NOW` fixtures +
   `startedAt` assertion.
3. **`#prevWasDrag` stale across host destruction (minor, FIXED).** Same
   lifecycle gap as #1; self-correcting on the first pointerdown but it
   delayed the next gesture's start by one event. Fixed: `releaseInputs`
   clears `#prevWasDrag`.

## B's note (not a finding)

The drawer's `transition-transform duration-200` / `transition-opacity
duration-200` is retained; B read it as out of 5b2 scope (the Out-of-scope
list tracks `swipe.ts` / `DualColumnLayout` deletion for 5b3), consistent
with A's finding #2 resolution.

## Gate outputs (post-fix, independently re-run 2026-07-16)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    377 pass / 0 fail
$ bun run test:e2e                    202 passed + 1 flaky (exit 0)
```

R61 audits the post-R60-fix state.
