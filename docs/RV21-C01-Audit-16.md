# RV21-C01 Audit 16 (R16)

**Date:** 2026-07-28. **Round:** R16. **Counter after:** 0/5 (auditor A BLOCK;
auditor B **PASS** - the third PASS vote, after R10-B and R15-B).

## R16-A F1 (comment accuracy, 3 sites): "non-enter settle reads natural formula" stale after R12-B

Three comments in `nav-pipeline-orchestrator.svelte.ts` (L3685-3688, L800-801,
L2929-2931) claim "for a non-enter settle being re-armed the FAB reads the
natural formula / the re-seed is a no-op". This was correct PRE-R12-B but became
stale when R12-B added the `#enterFabAnchor` re-seed to gesture-release (path 3),
discrete-nav (path 4), and accelerate-in-flight (path 2) settles. For those
settles the FAB layer reads branch 3 (enterAnchor lerp), not branch 5 (natural
formula), and the unconditional re-seed in the mid-settle absorb is required for
boundary continuity, not a no-op. Behaviour is correct; only the comments are
wrong.

**Fix:** rewrite the 3 comments to describe the branch 3 reading + the
required re-seed for anchor-set "non-enter" settles.

## R16-B: **PASS** (no defect)

Third PASS vote. Exhaustively examined morph/title/FAB/search-scrub across every
boundary. All continuity guards pass. Every comment accurate.

## Counter after R16: 0/5.
