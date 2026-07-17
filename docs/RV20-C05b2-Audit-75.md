# RV20-C05b2 - Audit Round 75

Result: **A PASS-WITH-CONCERNS (1 medium + 1 informational); B PASS-WITH-CONCERNS
(1 CONCERN, comment accuracy).** Counter stays **0/5**. A found a real
medium-severity state-machine lifecycle bug in the finish-then-new path (A1);
B found a stale module docstring (B1). Both fixed.

## A's findings

1. **Reset microtask clobbers the finish-then-new queued-nav transition (MEDIUM,
   FIXED).** The state machine's `reset` reducer guarded only `kind === 'intent'`
   (a new gesture during the landing microtask). But the finish-then-new queued-nav
   replay dispatches synchronously from `'landing'` through `'intent'` to
   `'transitioning'` before the landing microtask's `reset` drains. The `reset`
   then fired against `'transitioning'`, clobbering it to at-rest. The
   `#publication` went to `plan: null, inFlight: false` while the executor's rAF
   kept sliding, so the FAB/Header/pager froze mid-slide for ~200ms. Fixed: the
   `reset` guard now also blocks `'transitioning'` (the reset must not overwrite
   an in-flight transition). The normal landing path (`'landing'` → `'at-rest'`)
   is unaffected. State-machine test updated: reset from `'landing'` → at-rest;
   new test: reset from `'transitioning'` → no-op.
2. **onInterrupt call-site guard vs reducer guard inconsistency (INFORMATIONAL).**
   The call-site gates on `inFlight` (excludes `'landing'`); the reducer gates on
   `!== 'transitioning'` (also excludes `'landing'`). No reachable trajectory
   lands in the synchronous window where a gesture pointerdown arrives during
   `'landing'`. Latent inconsistency; no observable failure.

## B's finding

1. **Module docstring claims popstate/failed-preload as interruption sources
   (COMMENT, FIXED).** The docstring said "The orchestrator's SvelteKit interop
   wiring (§9) surfaces popstate-as-interruption and failed-preload-as-interruption
   events into the reducer." The sole producer of the `interrupt` event is a
   gesture re-grab (`#beginGesture`); popstate and failed-preload are handled by
   the SvelteKit nav hooks. Reworded.

## Gate outputs (post-fix, independently re-run 2026-07-17)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    378 pass / 0 fail
$ bun run test:e2e                    203 passed + 1 flaky (exit 0)
```

R76 audits this state.
