# RV21-C01 Audit 55 (R55)

**Date:** 2026-07-31. **Round:** R55. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): captured==natural overclaim + cancels

4 comments claimed "For symmetric shapes the captured value equals the
natural formula" (or the asymmetric contrapositive "the lerp is the only
continuity guard because the natural formula disagrees"). The equality
only holds for branch-5 (from-rest) releases; a branch-4 re-grab captures
the dragAnchor-shifted value instead. Also `header-probe.ts:149`
classified "cancels" as no-op -- both-have-FAB cancels at raw > 0.5 cross
the midpoint and the lerp smooths the dip. Rewrote all 4 sites to the
branch-qualified reference style (matching `orchestrator:3494-3498`):
"The captured value equals the displayed FAB at the release raw (branch 5
natural for a from-rest release, branch 4 dragAnchor-shifted for a
re-grab). The re-seed keeps the FAB continuous where the natural formula
would differ, and smooths over the natural handoff dip for both-have-FAB
releases that cross the icon-handoff midpoint (commits at raw < 0.5,
cancels at raw > 0.5); otherwise a no-op."

Sites: `orchestrator:799`, `:3217`, `:3534`, `header-probe.ts:144`.

## Auditor B finding (CONFIRMED): dip-smoothing overclaim + grammar

4 sites claimed the re-seed "smooths over the natural handoff dip"
universally for both-have-FAB shapes. The effect only materialises when
the settle crosses progress=0.5 (commits at raw < 0.5; raw >= 0.5 commits
and cancels at raw <= 0.5 are algebraically no-op). Rewrote to qualify.
Also fixed a grammar fragment at `e2e/messages-back-swipe.spec.ts:270`
("per-frame" -> "per-frame advance").

## Verify

`bun run check` 0/0; prettier + em-dash clean. Comment-only; runtime
unchanged.

## Disposition

Counter after R55: 0/5.
