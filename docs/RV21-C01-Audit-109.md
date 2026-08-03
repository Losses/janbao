# RV21-C01 Audit 109 (R109)

**Date:** 2026-08-03. **Round:** R109. **Votes:** auditor A BLOCK, auditor
B PASS. **Counter after: 0/5.**

## Auditor A finding (CONFIRMED): bm===null morph fallback comments cite unreachable direction

**F1** `Header.svelte:260` + `orchestrator:3631` -- both comments cited
"a deep->tab settle interrupted by a tab-to-tab re-grab" as the example
for the bm===null morph-anchor honoring. But deep->tab is unreachable on
any host where bm===null fires: NavPipelineTabHost only arms tab->X
settles (outgoing always = tab); offline LIST routes' new drag targets
don't pill-map (bm!==null). The actually-reachable shape is the opposite
direction: tab->deep prior settle, then re-grab to another tab →
tab-to-tab → bm===null. Fixed: "deep->tab" → "tab->deep" at both sites.

**Counter impact:** R107 (1/5) + R108 (2/5) wiped. Counter resets to 0/5.

## Auditor B: PASS

Exhaustive verification. Every count (5/5/6/6/3/2), every §5 boundary,
every Fix A/B/C/D, every R82-R106 fix verified. Zero concerns.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean; grep
confirms no "deep->tab settle" remains. Comment-only; runtime unchanged.

## Disposition

Counter after R109: 0/5. A pre-existing comment inaccuracy (wrong example
direction in the bm===null morph fallback) reset the convergence climb.
Fixed; R110 starts a new climb.
