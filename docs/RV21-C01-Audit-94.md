# RV21-C01 Audit 94 (R94)

**Date:** 2026-08-02. **Round:** R94. **Votes:** auditor A BLOCK, auditor
B PASS. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): dead `(searchScrubbing && currentHasTabs)` clause + phantom comment

**F1** `Header.svelte:322` (`iconProgress` fallback) -- the clause
`(searchScrubbing && currentHasTabs)` was dead code. Every
`setSearchScrubbing` is paired with a `setTapMorph` in the same
synchronous block (`#armTapScrubEase:3705-3706`, `#finishTapScrubEase:
3768-3770`, `unmount:1463-1464`), and Svelte 5 batches `$state` writes to
the next flush, so `searchScrubbing === true && tapMorph === null` is
unreachable. The Header's `$derived` always sees both writes together,
so the fallback's `(searchScrubbing && currentHasTabs)` sub-expression is
always `false`. The R85-B comment describing a "tab-root scrub-arm window
before the first `setTapMorph` tick" documented a phantom state.

**Fix (code):** Simplified the fallback to `isSearch ? 0 : 1 - morph`.
Updated the Header comment (dropped the phantom "scrub-arm window"
clause). Updated the BurgerArrowIcon docstring (dropped the
`(searchScrubbing && currentHasTabs)` condition from the quoted formula).
`grep` confirms no `(searchScrubbing && currentHasTabs)` remains in the
code.

## Auditor B: PASS

Exhaustive sampling (full orchestrator + Header + header-probe + all
count-enumeration cross-checks + §5 boundary traces). Zero concerns. All
R91-R93 fixes verified accurate. B noted the `(searchScrubbing &&
currentHasTabs)` reachability question but deferred (could not confirm
empirically; the clause has no visible effect even if reached). A
confirmed the unreachability.

## Orchestrator verification

Independently verified A-F1: confirmed every `setSearchScrubbing` is
paired with `setTapMorph` on the immediately-following line in the same
synchronous method (`grep setSearchScrubbing|setTapMorph` = 3 paired
sites). The dead clause's removal is safe: on every reachable state it
produces the same value as the simplified form (A confirmed; B noted "no
visible effect even if reached").

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean; `grep`
confirms no `(searchScrubbing && currentHasTabs)` remains. A-F1 a code
change (dead-clause removal); comment updates alongside.

## Disposition

Counter after R94: 0/5. The R85-B "scrub-arm window" documentation was a
misunderstanding of Svelte 5's `$state` batching semantics -- the arm and
the first `setTapMorph` are always observed together by the Header's
`$derived`, so there is no intermediate state. Fixed by removing the dead
clause and its documentation.
