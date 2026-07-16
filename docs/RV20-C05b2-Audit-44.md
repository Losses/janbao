# RV20-C05b2 - Audit Round 44

Result: **A PASS-WITH-CONCERNS (2 CONCERN); B PASS-WITH-CONCERNS (3 CONCERN).**
Counter stays **0/5**. R44's substantive finding was one real defect (A1, the FAB
boundary over-reaction); the other four were already in the corrected state when
the fix was applied. Both auditors verified the architecture and all six Known
conditions are correct.

## A's findings (2 CONCERN)

1. FAB scale dips to 0 during a boundary void-swipe (logic) - on a boundary
   void-swipe the orchestrator publishes `fromPathname === toPathname` with the
   RAW drag progress, and `fabScale(raw, true, true)` ran the icon-handoff
   half-mapping (dips to exactly 0 at progress=0.5), fully hiding the FAB
   mid-rubber-band while the track only rubber-bands ~20%
   (`BOUNDARY_RUBBER_BAND_FACTOR = 0.4`). This was an over-reaction, not
   intended (the e2e `fab-boundary-swipe-sync` only requires variation delta >
   0.1, not a dip to 0). Fixed: for `fromPathname === toPathname` the FAB now
   reacts proportionally to the rubber-band, `1 - progress *
BOUNDARY_RUBBER_BAND_FACTOR` (reaches 0.6 at full drag, matching the track's
   amplitude); real transitions still use `fabScale`. (An earlier attempt to
   "document the dip as intended" was wrong; this is a real defect - the FAB
   unification's change from the attenuated fractionalIndex to raw progress
   caused the over-reaction.)
2. `onSvelteKitAfterNavigate` docstring used `/messages/1` -> `/messages/2` as
   the no-op-reset example (it is a deep-to-deep interception, not a no-op) -
   found already corrected to `/messages/123/p1` -> `/messages/123/p2`.

## B's findings (3 CONCERN)

1. `#onExecutorSettle` null-pending branch comment said "stray settle" - found
   already corrected to describe the enter-completion path.
2. `FAB_KIND_CONFIGS` English fallbacks (`?? 'New discussion'` / `?? 'New
message'`) violated the i18n convention - found already removed (`t.nav.*`
   keys verified present in en.json + zh-CN.json).
3. Redundant local `FabKind` vs imported `FabListKind` - found already unified.

## Fixes

- A1: `FloatingActionButtonLayer.svelte` `scale` `$derived` now special-cases
  `fromPathname === toPathname` (proportional rubber-band reaction); docstring +
  inline comment explain the boundary case. Independently verified: e2e
  `fab-boundary-swipe-sync` passes for both first and last tab; check/lint/unit
  green.
- A2/B1/B2/B3: found already in the corrected state in the tree (applied
  externally between the audit and the fix step); verified present.

## Gate outputs (post-fix, independently re-run 2026-07-15)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    406 pass / 0 fail
$ bun run test:e2e                    202 passed + 1 flaky (exit 0)
```

The flaky test is `fab.spec.ts:435` (Family B back, the known CDP-touch class on
an unchanged real-transition path). The A1 fix was implemented by a fresh-context
sub-agent and independently re-verified (the diff checked, the gate re-run by the
orchestrator).

R45 audits the post-R44-fix state.
