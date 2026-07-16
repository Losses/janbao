# RV20-C05b2 - Audit Round 48

Result: **A PASS-WITH-CONCERNS (7 CONCERN); B PASS-WITH-CONCERNS (6 CONCERN + 1
nitpick).** Counter stays **0/5**. R48 (stripped prompt) found accumulated dead
code, stale comments, a clock-contract inconsistency, and minor redundancy. All
twelve concerns fixed. Both auditors verified the architecture and all six Known
conditions are correct.

## Findings (all fixed)

**Dead code removed:**

- A1/B1: `NavStateMachine` wrapper getters (`macro`, `activePlan`, `fromPathname`,
  `toPathname`, `direction`) + the public `reset(on)` method; zero callers.
- A2: `orchestrator.inFlight` / `.activePlan` getters; zero callers (consumers
  read `publication.*` directly).
- A7: `OrchestratorState.activePlan`; a redundant mirror of `macro.plan` (set in
  lockstep; only tests read it). Removed from the interface + reducer branches;
  tests updated to read `state.macro.plan`.

**Comments corrected:**

- A3: NavStateMachine class + `dispatch()` docstrings claimed "single mutation
  point" / "single source of truth"; `forceReset()` bypasses `dispatch()`/the
  reducer. Corrected to state two mutation points.
- A5/B1: `reset()` "Exposed for external callers"; no external caller (dead).
  Removed (part of A1).
- A4: `#landAtRest` docstring + the redundant `stateMachine.onLand` call after
  `configure`'s `forceReset` (spurious landing phase on every nav landing). The
  onLand call is retained for the gesture-commit path (where the SM is
  transitioning) but the docstring is corrected.
- B2: `#gestureToTabIndex` docstring omitted `releaseInputs` from the clear sites.
- B3: `#endSettleEase` docstring's causal claim ("rest branch reads
  settleProgress") was wrong; the no-snap is structural (post-landing
  currentHasTabs/title already match the latched values). Corrected.

**Logic / contract / redundancy:**

- B4: the settle + tap-scrub rAF ticks used `performance.now()` directly instead
  of the injected `this.#clock()`, breaking the "one shared clock" contract.
  Fixed: both ticks now use `this.#clock()`.
- A6: the reducer `reset` case preserved `lastIntent` while `forceReset` cleared
  it. Made consistent (reducer `reset` now clears it too).
- B5: redundant `pager.tapMorph !== null` inside an outer `tapMorph !== null`
  guard in `notifyHeaderState`. Removed.
- B6: `unmount` called `setSettleState` twice; the first was subsumed by the
  second. Removed the first.

## Gate outputs (post-fix, independently re-run 2026-07-16)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    406 pass / 0 fail
$ bun run test:e2e                    202 passed + 1 flaky (exit 0)
```

The flaky test is `fab.spec.ts:436` (the known CDP-touch class). The fixes were
applied by a fresh-context sub-agent (e2e synchronous) and independently
re-verified (dead-code greps confirmed, clock fix checked, gate re-run).

R49 audits the post-R48-fix state.
