# RV20-C05b1 - Audit Round 49 (architect-run, 2 independent auditors)

Result: **A PASS-WITH-CONCERNS (3 low); B PASS (1 borderline nitpick).**
The cleanest round since R32. Both verified every trajectory correct; no
substantive defect. B returned VERDICT: PASS.

## Concerns + fixes

- **gesture-path chip-exit cold-cache divergence (A C1, low/unreachable):**
  the gesture's `coordinate()` check could (first-frame cache miss) flip a
  back-target gesture to chip-exit, freezing the FAB at coverProgress=0.
  FIX: gate the gesture chipExit on `to !== inputs.backTarget` (the gesture
  always targets the back-target, so chip-exit is always false; the
  cold-cache miss can no longer flip it).
- **journal "targets fab:false" imprecise (A C2, nitpick):** `/` is
  `fab: true`, not false. FIX: reworded to "matches GPL: coverProgress=0".
- **coordinator docstring "chip-exit with preload" (B nitpick):** clarified
  that the coordinator outputs the preload pathname for a consumer; the 5b1
  orchestrator does not consume it.
- **same-route param change racing a gesture (A C3, low/edge):**
  `onSvelteKitAfterNavigate` calls `#landAtRest` unconditionally; a param
  change mid-gesture would abort it. DOCUMENTED (extremely unlikely edge).

## Gate outputs (real, post-fix)

```
$ bun run check          0 errors / 0 warnings (1461 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- 8-spec pilot sweep    81 passed
```

Consecutive pass votes: **0** (R49 A carried low concerns; all fixed or
documented; R50 audits the post-fix state).
