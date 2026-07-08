# RV20-C05b1 - Audit Round 30 (architect-run, 2 independent auditors, with e2e gate)

Result: **0/2 PASS**. Auditor A FAIL (5); auditor B PASS-WITH-CONCERNS
(1). R21-R29 fixes held. The serious finding (A-C1) was the THIRD edge-
zone alignment gap: the R29 fix aligned `detectSwipe` + the capture
listener to `<`, but the classifier's `isEdgeReserve` still used `<=`,
so a pointer at exactly x=40 was claimed by detectSwipe + recorded by
the capture but KILLED by the classifier -> the gesture silently
dropped (track never moved; native scroll locked + next click
swallowed). Fixed by aligning all three.

## Architect gate outputs (post-R30-fix, real)

```
$ bun run check          0 errors / 0 warnings (1458 files)
$ bun run lint           EXIT=0 (no em-dashes; 0 type duplicates)
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail (+1 boundary)
$ bun run test:e2e -- 8-spec mobile + desktop sweep    80 passed (2.8m)
```

## Concerns + fixes (all confirmed)

- **A-C1 (isEdgeReserve `<=` vs detectSwipe `<`, correctness)**: the
  classifier's `isEdgeReserve` used inclusive `<=` while `detectSwipe`
  - the capture listener used strict `<`. At x = EDGE_DEAD_ZONE exactly,
    detectSwipe claimed the pointer, the capture recorded it, but the
    classifier's `isEdgeReserve(40)` -> `40 <= 40` -> edge -> returned
    `initialIntentState()` (micro=idle), killing the gesture while
    detectSwipe stayed in `phase='swipe'` (locking scroll + swallowing the
    next click). Fix: `isEdgeReserve` now uses `<` / `>` (matching
    detectSwipe + the capture). All three edge checks agree at the
    boundary. The R29 fix aligned detectSwipe + capture; this aligns the
    third (the classifier). Single-sourced via `EDGE_DEAD_ZONE`.
- **A-C2 (isEdgeReserve docstring)**: said "matching detectSwipe" but
  did not (`<=`). Now accurate (operators match).
- **A-C3 (gesture-constants comment)**: my R29 comment claimed the
  classifier's `isEdgeReserve` "uses `<=` and a different purpose, so
  must NOT be reused here." Wrong (same purpose; the operator was the
  defect). Reworded to state all three use `<` / `>`.
- **A-C4 (isPilotTransition docstring)**: overclaimed "the deep-link
  landing (TO pilot) flows through the orchestrator" (the orchestrator
  is not mounted on a cold deep-link, so the singleton is null + the
  hook falls through to plain nav). Reworded.
- **A-C5 (missing preventive test)**: added a boundary test
  (`isEdgeReserve(EDGE_DEAD_ZONE)` -> false, `isEdgeReserve(W - EDGE)` ->
  false, one-px-inside -> true). Pins the alignment; would have caught
  A-C1.
- **B-C1 (#liveDragging docstring)**: claimed matching GPL's `dragging`
  "prevents the FAB / Header CSS transitions from being disabled during
  the commit slide." The orchestrator does not set `navStore.pendingNav`
  (GPL does), so the FAB's `transitionEnabled` is false during commit.
  Reworded to drop the false claim.

## Edge-zone thread: CLOSED

R23 (primary-pointer guard) -> R29 (capture mirrors detectSwipe's `<`)
-> R30 (classifier `isEdgeReserve` aligned to `<`). All three edge
checks now use the single-sourced `EDGE_DEAD_ZONE` with `<` / `>`,
pinned by the boundary test. The thread is closed.

Consecutive pass votes: **0** (R1-R30 each carried concerns).
