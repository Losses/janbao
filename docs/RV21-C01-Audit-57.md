# RV21-C01 Audit 57 (R57)

**Date:** 2026-07-31. **Round:** R57. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): orchestrator:3501-3504 R55 sibling

`orchestrator:3501-3504` said "dropping the FAB to branch 5 ... disagrees
for asymmetric shapes (from-only-FAB, to-only-FAB, boundary, suppressed,
enterAnchor)". Boundary/suppressed are branch 1/2 (do not drop to 5);
enterAnchor is not a live shape during a gesture release; from-only /
to-only at-rest releases have captured==natural. Rewrote to
branch-qualified ("for a branch-4 re-grab the post-arm FAB would drop to
branch 5, disagreeing with the dragAnchor-shifted value").

## Auditor B finding (CONFIRMED): 6 stale "L2803" line-number references

R32/R34 classified "L2803" non-blocking ("reader finds capture within 10
lines"). R50-A dead-code removal shifted the capture from L2814 to L2792;
L2803 is now executable code (the `direction` parameter), 11 lines away,
outside the capture block's documentation comment. The non-blocking
conditions no longer hold. Removed all 6 "L2803" references (replaced
with name-based "the discrete-nav capture site" to avoid future drift):
`orchestrator:1789/4359/4369/4399`,
`e2e/messages-back-swipe.spec.ts:3586/3655`.

## Verify

`bun run check` 0/0; prettier + em-dash clean. Comment-only; runtime
unchanged.

## Disposition

Counter after R57: 0/5.
