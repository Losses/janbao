# RV21-C01 Audit 02 (R2)

**Date:** 2026-07-26. **Round:** R2. **Counter after:** 0/5 (auditor A BLOCK;
auditor B BLOCK). **Gate at audit time:** `bun run check` 0/0; `bun run lint`
exit 0; `bunx tsc -p scripts/tsconfig.json` exit 0; `bun test src/lib` 552/0;
full e2e 218/0 (after the R1 fix).

Both auditors BLOCKed, and both stated explicitly that the BEHAVIOUR is correct
and the gates are green: the R1 morph-continuity fix is structurally sound
(continuous at every gesture shape they exercised). All R2 findings are stale
code comments, siblings of the R1 rewrite, which changed the morph mechanism
from `settleProgress` to `settleMorphFraction` + the latched `startMorph` /
`destMorph` pair but updated only the three comments the R1 auditors had named.
This is the recurring comment-sibling long tail (the R1 sweep was too narrow).

## The class (every comment describing the pre-R1 morph mechanism)

The morph derivation's settle branch now reads
`settleLatched.startMorph + (settleLatched.destMorph - settleLatched.startMorph) * settleMorphFraction`
(not `settleProgress` directly; not `current*(1-p)+target*p`). Comments that
still cite the old field names / formulas / labels are the class. Seed sites
(R2-A 1 to 5, R2-B F1 to F9, deduped):

- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts`: the `centerTab`
  docstring (`backMorph: 0` should be `null`); the idle title-change arm
  (`destMorph` is the destination's at-rest morph, not the source's); the
  `playEnterAnimation` "eased by settleProgress" line.
- `src/lib/components/organisms/Header.svelte`: the `targetIsSearch` skip
  comment ("animates continuously into search-mode" - it is HELD, destMorph =
  startMorph); the settle-branch parenthetical ("destMorph = the destination's
  at-rest morph" - wrong for the /search hold); the `rootLayerStyle` comment
  ("morph reads settleProgress during a settle" - reads settleMorphFraction).
- `src/lib/components/atoms/BurgerArrowIcon.svelte`: the `iconProgress` signal
  chain ("settleProgress during a settle" - settleMorphFraction).
- `e2e/deep-to-deep-gesture-morph-spike.spec.ts`: the preamble ("Effect B",
  "branch 2", `current*(1-p)+target*p`, "derives from settleProgress",
  "Effect B never fires") - describes the eliminated defect mechanism.
- `e2e/header-tab-descent-cross-tab-exit.spec.ts`: "the morph derivation reads
  settleProgress".
- `e2e/search-back-hamburger-flash.spec.ts`: the `iconProgress` formula omits
  `&& currentHasTabs`; "branch 1b of the morph derivation" (no such branch).
- `e2e/search-enter-exit-asymmetry.spec.ts`: "master morph" / "Effect B settle".
- `e2e/tab-host-swipe.spec.ts`: "`pager.backMorph ?? 1` fallback" (no such
  expression; the fallback is `currentHasTabs ? 1 : 0`).

**Severity:** concern each (code-comment accuracy in `.ts` / `.svelte` /
`.svelte.ts` / `.test.ts` / `.spec.ts` is always a concern).

## Fixes for R3 (CMA, binding exhaustive sweep)

Rewrite EVERY comment in the class to the current mechanism. This is NOT a
narrow "fix the 13 named sites" pass: grep the whole navigation/animation layer
(`src/lib/{stores,components,utils}` AND `e2e/`) with several broad phrasings
that each cover the class differently - `settleProgress`, `settleMorphFraction`,
`Effect B`, `branch 1b`, `master morph`, `pager.backMorph ?? 1`,
`current*(1-p)`, `target = targetHasTabs`, `reads settleProgress`,
`derives from settleProgress`, `animates continuously`, `backMorph: 0` - union
the hits, read each, and rewrite every stale one. A sibling the sweep misses is
a defect in the fix.

## Out-of-scope observations (nitpicks)

- Journal `.md` prose paraphrasing the old mechanism. `.md`-only, nitpicks.
- A latent one-frame icon snap on `/search -> tab-root` discrete nav (pre-Fix-B
  behaviour, not introduced by this cycle; `search-back-hamburger-flash` covers
  the back-swipe EXIT). Recorded for a possible future cycle, not a finding.
