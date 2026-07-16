# RV20-C05b2 - Audit Round 45

Result: **A PASS-WITH-CONCERNS (1 CONCERN); B PASS (0 concerns).** Counter stays
**0/5** (A's concern resets the accumulator). R45 is the cleanest round so far:
B found no defect, and A found one comment-accuracy issue (two instances). Both
auditors verified the architecture and all six Known conditions are correct.

## A's finding (1 CONCERN, two instances)

1. The FAB `progress`-input docstring (in `FloatingActionButtonLayer.svelte` and
   `fab-scale.ts`) claimed `progress` is "the same 0..1 slide fraction that drives
   the page-track slide". Inaccurate for non-bidirectional hosts (every
   NavPipelineHost route): the FAB reads the orchestrator's RAW drag fraction
   (`publication.progress`) while the page-track reads the threshold-absorbed
   `trackProgress` (the first 20% of drag is a deadzone for the track), so the FAB
   reacts from the first pixel while the track absorbs the deadzone (spec §5 says
   exactly this). Fixed: both docstrings now state the FAB reads the raw drag
   fraction and the page-track threshold-absorbs it on non-bidirectional hosts.

## B's verdict: PASS (no defect)

B traced the gesture slide, settle/tap-scrub eases, the finish-then-new policy,
`shouldEnter`, `playEnterAnimation`, the FAB scale derivation, the Header morph,
`solveCommitDuration` (axis-sign), and the deep-to-deep handshake end to end and
found no logic bug, stale comment, state leak, architectural violation, or dead
code. §13.3/§13.4/§13.5 and §5 hold; all six Known conditions match the code; the
R42/R43/R44 fixes (the FAB boundary proportional reaction included) are correct.

## Gate outputs (post-fix, independently re-run 2026-07-15)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    406 pass / 0 fail
$ bun run test:e2e                    202 passed + 1 flaky (exit 0)
```

The flaky test is `fab.spec.ts:435` (the known CDP-touch class). The fix was
applied and the gate independently re-run by the orchestrator.

R46 audits the post-R45-fix state.
