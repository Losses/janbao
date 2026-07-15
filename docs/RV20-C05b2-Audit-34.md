# RV20-C05b2 - Audit Round 34

Result: **A PASS-WITH-CONCERNS (1 CONCERN); B PASS-WITH-CONCERNS (1 CONCERN).**
Counter stays **0/5**. Two concerns; CONCERN 1 was a real visible regression
unmasked by the R33 F4 fix. Both fixed. Two reflection items resolved (F5
independently re-examined; the deferred `snippet` field verified against the
spec).

## A's finding

### CONCERN 1 (functional, fixed) - double slide on intra-tree forward deep-to-deep

A forward deep-to-deep nav between two siblings under the same parent
(`/profile/settings` -> `/profile/password`, `/admin` -> `/admin/backups`)
played TWO slides: the orchestrator's deep-to-deep interception slide on the
source host, then the destination host's `playEnterAnimation` (its `shouldEnter`
heuristic `stack[length-2].pathname === leftHref` is true because the source deep
page is the destination's back-target). This was unmasked by the R33 F4 fix
(`configure` resets the executor): before F4 the destination's enter no-op'd on
the stale executor state, which inadvertently masked the double slide.

Fixed with a handshake: a new orchestrator field `#lastDispatchWasDeepToDeep`,
set in the deep-to-deep interception branch, exposed via the publication
(`lastDispatchWasDeepToDeep`), read by the destination host's `shouldEnter`
(suppresses `playEnterAnimation`), and cleared in `#landAtRest` (which always
runs for a deep-to-deep target since the guard requires `isNavPipelineRoute(to)`).
The field intentionally survives `releaseInputs` / `configure` /
`notifyHeaderState` so it is still true at the destination's onMount. A new
preventive e2e `e2e/intra-tree-deep-to-deep.spec.ts` asserts exactly one slide
phase.

## B's finding

### B1 (comment accuracy, fixed) - centerTab Header mode

Two comments claimed `backMorph: null` keeps the Header in "back-arrow mode" on
centerTab (thread) routes; the Header is in ROOT mode end to end (tab bar
visible, hamburger icon, drawer toggle) - a third comment already said so. Both
corrected to "root mode end to end".

## Reflection items (resolved this round)

- **F5 re-examination**: the FAB continuity gap (tab-to-tab gesture interrupting
  a family-swap ease) was independently re-examined. Four alternative fixes were
  attempted and rejected: (A) direct seed of `trackFractionalIndex` corrupts
  `effectiveKind` at the kind-swap boundary; (B) keeping `familySwapScale` for
  one frame delays the snap by one frame and violates 1:1 tracking; (C) a lerp
  blend violates 1:1 tracking for its duration; (D) a separate-field lerp either
  violates 1:1 (continuous) or only delays the snap (static). Root cause: the
  family-swap ease drives the FAB via `familySwapScale`; the finger-driven
  Family-A gesture drives it via `trackFractionalIndex`; the two are consumed by
  different formulae and no continuous bridge preserves both `effectiveKind`
  (which reads `trackFractionalIndex`) and the 1:1 finger-tracking invariant. The
  infeasibility is independently confirmed (not a deferred fix); the existing
  documentation stands.
- **`snippet` field**: DV20-Plan section 7 mandates `snippet?: Snippet` in the
  `PageCacheEntry` shape. The field is retained for spec compliance (with doc
  comments noting section 7 mandates it and no production caller currently writes
  it); it is not dead code to delete.

## Gate outputs (post-fix, independently re-run by the orchestrator)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    409 pass / 0 fail
$ bun run test:e2e                    202 passed + 1 flaky (fab.spec.ts:432,
                                     the pre-existing CDP touch flake; +1 from
                                     the new intra-tree-deep-to-deep spec)
```

The CONCERN 1 handshake is e2e-safe (the new intra-tree spec passes; fresh
forward enters and deep-to-deep slides are unchanged). No behavioral regression.

R35 audits the post-R34-fix state.
