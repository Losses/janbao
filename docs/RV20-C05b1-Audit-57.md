# RV20-C05b1 - Audit Round 57 (architect-run, 2 independent auditors)

Result: **A PASS-WITH-CONCERNS (9 low); B PASS-WITH-CONCERNS (1 MED + 2
low).** The MED was a real commit/cancel conflation bug in
`recoverDesktopFlipNav`.

## Concerns + fixes

- **recoverDesktopFlipNav dispatches during cancel slide (B C1, MED):** the
  method gated on `phase === 'committing'` but onCancel delegates to
  onCommit (flipping progressDirection to 1), so a cancel slide also enters
  the 'committing' phase. A desktop flip during a cancel would dispatch the
  back-target, navigating the user to a destination they explicitly
  cancelled. FIX: added `progressDirection !== 0` gate (only commits
  dispatch; cancels skip). Updated the docstring to say "COMMIT transition"
  and document the cancel exclusion.

## Documented / low

- skeleton branches unreachable (A C1): eager-load fallback; spec-mandated.
- hardcoded direction='backward' (A C2): correct for 5b1 (centerTab=2); 5b2.
- playEnterAnimation chipExitState drift (A C3): unreachable (mount resets).
- easing curve s(u)=2u-u² vs GPL CSS (A C4): within e2e tolerance.
- deactivate timing (A C5): no behavioral impact.
- state machine not the actual authority (A C6): publication is; §13.5.
- content swap on interrupt (A C7): documented.
- deep-link e2e hardcodes /messages/1 (A C8): test reliability.
- GPL-match comment overstated (A C9 / B C1 docstring): fixed in the MED
  docstring rewrite above.
- tab-exit-preview first assertion unguarded for GPL (B C2): test passes;
  structural fragility.
- hardcoded chip-exit targets (B C3): documented 5b2.

## Gate outputs (real, post-fix)

```
$ bun run check          0 errors / 0 warnings (1461 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- 8-spec pilot sweep    81 passed
```

Consecutive pass votes: **0** (R57 B carried the MED; fixed; R58 audits
the post-fix state).
