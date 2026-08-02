# RV21-C01 Audit 90 (R90)

**Date:** 2026-08-02. **Round:** R90. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

Two findings, two classes (one per auditor).

## Auditor A (CONFIRMED): `settleMorphFraction` "follows it" (= settleProgress) -- R78-B missed sibling

**F1** `e2e/header-tab-descent-cross-tab-exit.spec.ts:168` -- the comment
said "the settle rAF advances `settleProgress`, the derived
`settleMorphFraction` follows it", where "it" = settleProgress (implying
settleMorphFraction is downstream of settleProgress). Same inaccuracy
R78-B fixed at `:24-25` of this file; R78-B's sweep missed this sibling
site. The actual code computes both independently from the rAF's eased
fraction. Rewrote to "advances both `settleProgress` and
`settleMorphFraction` (the eased-timeline fraction the morph derivation
reads, tracked independently of `settleProgress`)".

## Auditor B (CONFIRMED): phantom `unfreeze()` function name

**F1** `scroll-chrome.svelte.ts:97` -- the comment said "unfreeze()
re-syncs the header to the landing position", but no `unfreeze` function
exists (`grep unfreeze src/` = only this comment). The actual unfreeze is
`releaseNavigation()` (`:210`, clears `frozen` + calls `show()`). Rewrote
to "`releaseNavigation()` re-syncs".

## Orchestrator verification

Independently verified both before editing. A-F1: confirmed the comment's
"it" antecedent is settleProgress and that `#settleEasedFraction` (published
as settleMorphFraction) is tracked independently (`:555-563`). B-F1:
confirmed `grep unfreeze` = only the comment and that `releaseNavigation`
(`:210`) is the unfreeze path.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R90: 0/5.
