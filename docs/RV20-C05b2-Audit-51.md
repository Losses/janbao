# RV20-C05b2 - Audit Round 51

Result: **A PASS-WITH-CONCERNS (1 CONCERN); B PASS-WITH-CONCERNS (5 CONCERN).**
Counter stays **0/5**. R51 found two real logic bugs (flag-leak on cancelled
goto), two stale comments, and two dead-code/state items. All six fixed. Both
auditors verified the architecture and all six Known conditions are correct.

## A's finding (1 CONCERN)

1. Mid-settle re-arm comment (~2299-2308) claimed the morph "continues from the
   in-flight position." Inaccurate: the re-arm builds new latched endpoints, so
   the morph value can jump when they differ. Fixed: rewritten to state
   `settleProgress` continues but the morph re-evaluates against the new endpoints.

## B's findings (5 CONCERN)

1. `#lastDispatchWasDeepToDeep` lifecycle docstring (~558-568) had a wrong
   clear-site list for `#lastLandWasPipelineCommit`. Fixed.
2. [LOGIC] `#lastDispatchWasDeepToDeep` can leak past a cancelled goto (a
   superseding nav cancels the goto before landing; `#landAtRest` never runs;
   the stale flag suppresses a later forward-enter slide). Fixed: the supersede
   branch in `onSvelteKitBeforeNavigate` now clears it.
3. [LOGIC] `#lastLandWasPipelineCommit` can leak past a cancelled goto (stale
   flag skips a tap-scrub arm). Fixed: same supersede branch clears it.
4. Dead code: `isAtRest` / `isInFlight` / `isCommitting` exported helpers (zero
   production callers). Removed; tests updated to inline `macro.kind` / `macro.sub`
   checks.
5. Dead state: `lastIntent` in `OrchestratorState` (zero production readers;
   diagnostic-only). Removed from the interface, `initialOrchestratorState`, and
   the reducer branches; tests updated.

## Gate outputs (post-fix, independently re-run 2026-07-16)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    406 pass / 0 fail
$ bun run test:e2e                    202 passed + 1 flaky (exit 0)
```

The flaky test is `fab.spec.ts:436` (the known CDP-touch class). The fixes were
applied by a fresh-context sub-agent (e2e synchronous) and independently
re-verified (the supersede-branch flag clears confirmed, the dead-code removal
greps confirmed, the gate re-run).

R52 audits the post-R51-fix state.
