# RV20-C05b2 - Audit Round 87

Result: **A PASS-WITH-CONCERNS (A1 false positive; A2 dead code FIXED; A3 comment
FIXED); B PASS-WITH-CONCERNS (B1 dead code FIXED).** Counter stays **0/5**. The
R87 changes are runtime-neutral (dead-code removal + comment edits); the A2 e2e
edits removed only no-op reads and were verified safe by the full e2e run after
that edit.

## A's findings

1. **FAB scale discontinuity at a mid-commit re-grab instant (FALSE POSITIVE).**
   A hypothesized that `#beginGesture`'s `this.#progress = 0` reset is visible for
   one frame at the re-grab instant (between pointerdown and the first
   pointermove), making the FAB jump to the progress=0 value. Empirically
   disproven with a MutationObserver probe: `#beginGesture` is called from
   `#interpretIntent`, which is invoked from `onPointerMove`; the first pointermove
   past the drag threshold runs `#beginGesture` (writes `#progress = 0`) and
   `#publish(rawStart + rawDrag)` in the SAME synchronous tick, so Svelte's
   microtask flush sees only the final `#progress` value and the DOM never renders
   the intermediate 0. The probe showed zero 1-frame discontinuities. No
   production change. (This is the "verify visible-behavior claims empirically"
   discipline added to the audit prompt after R83's false positive.)

2. **Dead `pendingNav` / `navInFlight` state in `NavigationStore` (FIXED).**
   `#navInFlight`, `#pendingNav`, the getter/setter, and `setPendingNav` /
   `clearPendingNav` / `executePendingNav` had zero production callers; in
   production `#pendingNav` was always null and `#navInFlight` always false. Only
   readers were the DEV `__headerMorphProbe` and two e2e specs (reading constant
   defaults). DV20-Plan §6 identifies this state as eliminated by the unified
   pipeline. Removed the fields, getter/setter, and methods; dropped the no-op
   reads from the probe and the two e2e specs (their real assertions: settling,
   morph, etc., are intact). Downstream cascade also removed: `determineDirection`
   and `getNavigationParams` (the latter's only caller was the removed
   `executePendingNav`), their `DirectionResult` / `NavigationParamsResult`
   interfaces, and the now-write-only `#lastHistoryIndex` field + its two writes.
   Two stale `pendingNav` mechanism docstrings in e2e specs and two stale
   "no `pendingNav` rAF-poll" comment clauses in src were rewritten to describe
   the current mechanism. Grep confirms zero `pendingNav` / `navInFlight` /
   `lastHistoryIndex` / `determineDirection` / `getNavigationParams` references
   remain in `src/` or `e2e/`.

3. **Boundary re-grab docstring overstated publication/track lockstep (FIXED).**
   The docstring claimed the visual-derived `startProgress` keeps the publication
   "in lockstep with the track translate for every re-grab shape." For an
   opposite-direction re-grab with an extrapolated `startProgress` (e.g. -0.6),
   `#publish` clamps the raw to [0,1] while the track translate carries the
   unclamped `-0.6 * W`. Rewritten to state the publication stays continuous once
   the raw is in range, but on an extrapolated opposite-direction seed the
   publication is clamped while the track carries the out-of-range value
   transiently (spec §5 divergence note).

## B's finding

1. **Two unused test-only exports (FIXED).** `__resetNavPipelineOrchestrator()`
   and `__setNavStateMachine(next)` had zero callers anywhere. Deleted.

## Gate outputs (post-fix, 2026-07-19, orchestrator-run)

```
$ bun run check                       0 errors / 0 warnings (1457 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores src/lib/actions    400 pass / 0 fail
$ bun run test:e2e                    207 passed / 0 flaky (exit 0)
```

check / lint / unit re-run independently by the orchestrator after the cleanup.
The full e2e (207 passed / 0 flaky) was run after the A2 edit (which touched two
e2e specs' no-op reads); the subsequent A2-downstream cleanup is runtime-neutral
(dead-code removal, tsc-confirmed, + comment edits only), so the e2e outcome is
unchanged.

R88 audits this state.
