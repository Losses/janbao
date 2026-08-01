# RV21-C01 Audit 61 (R61)

**Date:** 2026-07-31. **Round:** R61. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): 4 unqualified "re-seed is required" sites

4 comments said "the re-seed is required because/for..." universally,
omitting the "otherwise a no-op" qualifier that R55 siblings
(`orchestrator:3217/3533`, `header-probe.ts:144`) have. A verified
empirically (bun script): both-have-FAB commit at raw=0.6 -> branch-3
lerp is identical to branch-5 natural (max diff 1e-16, no-op). Added
"where the natural formula would differ (otherwise a no-op)" to all 4
sites: `orchestrator:3252` (primary, R60-A rewrite), `:3210`, `:3241`,
`:830`.

## Auditor B finding (CONFIRMED): orchestrator:3254 "holds" -> "interpolates"

R60-A rewrite's parenthetical "the lerp holds the captured value" -- the
branch-3 lerp interpolates captured toward dest (not holds). Rewrote to
"interpolates from the captured value toward dest".

## Verify

`bun run check` 0/0; prettier + em-dash clean. Comment-only; runtime
unchanged.

## Disposition

Counter after R61: 0/5.
