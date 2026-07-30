# RV21-C01 Audit 39 (R39)

**Date:** 2026-07-30. **Round:** R39. **Votes:** auditor A BLOCK, auditor
B BLOCK (different magnitude drifts). **Counter after:** 0/5.

## Auditor B finding (CONFIRMED): A-F1

`e2e/messages-back-swipe.spec.ts:1744` + `:1817` cited the audit's probe
`~102deg / ~23px` (journal L2545) instead of the formalized A-F1 guard's
own BEFORE `65.95deg / 14.66px` (journal L2710). Reworded both to the
formalized guard's BEFORE (`~66deg / ~15px`).

## Auditor A finding (CONFIRMED): R23-B F1 (overturns R36's borderline call)

R36 left R23-B F1's `~168px at raw=0.43` as borderline, believing the
goto-injection raw was 0.43. A geometrically verified the formalized test
injects the goto at raw=0.30 (startX=round(0.7*393)=275, endX=0, goto at
i=6 -> x = 275+round((0-275)*6/14)=157, raw=(275-157)/393=0.30; bm\*393 =
117.9px = journal L4739 BEFORE 117.98px). So `0.43 / 168px` is the audit
probe, not the formalized value. The orchestrator re-derived the same
geometry. Fixed 5 sites to `0.30 / ~118px`:
`messages-back-swipe.spec.ts:3206`, `:3214-3215`, `header-probe.ts:193`,
`:197`, `orchestrator:3080`.

`orchestrator:2975` ("the audit's ~168px snap") left unchanged; A
classified it accurate (explicit audit attribution; the audit did
estimate ~168px per journal L4746).

## Verify

`bun run check` 0/0; `bun run lint` exit 0; prettier + em-dash clean on
all three edited files. Comment-only; runtime unchanged.

## Disposition

Counter after R39: 0/5.
