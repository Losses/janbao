# RV21-C01 Audit 95 (R95)

**Date:** 2026-08-02. **Round:** R95. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

Four findings, all stale references to the `(searchScrubbing &&
currentHasTabs)` clause that R94 removed from `iconProgress`. R94's grep
was too narrow (didn't match line-wrapped text, didn't search `e2e/`).

## Findings (both auditors, CONFIRMED)

**A-F1 / B-F1** `orchestrator:4286-4287` (`notifyHeaderState` idle-arm
comment) -- referenced "the `isSearch || (searchScrubbing &&
currentHasTabs)` clause" (line-wrapped across two lines, which R94's grep
missed). Updated to "the `isSearch` clause ... (the `isSearch ? 0`
fallback)".

**A-F2** `e2e/search-back-hamburger-flash.spec.ts:13` -- the header
docstring quoted the OLD code form verbatim (`return isSearch ||
(searchScrubbing && currentHasTabs) ? 0 : 1 - morph`). Updated to the
simplified form.

**A-F3** `e2e/search-back-hamburger-flash.spec.ts:22-25` -- described
the freeze as "`isSearch` OR (`searchScrubbing` && `currentHasTabs`)".
Updated to "`isSearch` (search-mode rest)" only.

**A-F4** `e2e/search-back-hamburger-flash.spec.ts:396-401` -- the
OVER-FREEZE comment block argued the `(searchScrubbing && currentHasTabs)`
clause was a "defensive correctness refinement". Updated to describe
the simplified `isSearch ? 0` freeze.

B's sweep was scoped to `src/lib/` and found only the orchestrator site;
A's broader sweep (including `e2e/`) found the 3 additional sites.

## Orchestrator verification

Independently verified all 4 with a broad grep
(`grep -rnE "searchScrubbing && |&& currentHasTabs|isSearch \|\|.*searchScrubbing"
src/ e2e/`). Post-fix: the only `currentHasTabs` hit is
`orchestrator:4021` (`atTerminal && currentHasTabs === this.#scrubTargetTabs`
-- a DIFFERENT condition, the tap-scrub finish guard, not the iconProgress
clause). All stale references to the removed clause are gone. `bun run
check` 0/0; prettier + em-dash clean.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean; broad
grep confirms no stale `(searchScrubbing && currentHasTabs)` references
remain in `src/` or `e2e/`. Comment-only; runtime unchanged.

## Disposition

Counter after R95: 0/5. These were the orchestrator's own R94 residuals
-- stale references to the removed dead clause. Lesson reinforced: when
removing a code clause, sweep ALL comment references (including
line-wrapped text and `e2e/` scope), not just `src/lib/`.
