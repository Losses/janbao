# RV21-C01 Audit 136 (R136)

**Date:** 2026-08-06. **Round:** R136. **Votes:** auditor A BLOCK,
auditor B BLOCK. **Counter after: 0/5.**

## Outcome

Two confirmed defects, both in `#republishToPager` / `#resolvePlan` inline
comments. Counter 0/5.

## A -- `orchestrator:4813` (backMorphValue inline headline)

The inline comment's headline read "backMorph: raw slide fraction when the
target is not a tab." This is wrong for the deep-page-source -> tab-root-
target back-swipe (e.g. `/profile` -> `/`): the target `/` IS a tab, but
`backMorphValue = (bidirectional && !targetIsDeepPage) || (fromIdx>=0 && toIdx>=0)
? null : raw` yields `raw` because the SOURCE `/profile` doesn't pill-map
(`fromIdx = -1`). The comment's own example "deep host backward-exit" IS
this `/profile` -> `/` case, contradicting the headline. Fixed: "when not
both endpoints pill-map to a tab" (matches the actual condition).

## B -- `orchestrator:2129` (`#resolvePlan` suppressSlide case 1)

Case 1's condition is `toData.tag !== 'tab'`, which fires for both
`tag === 'detail'` (deep) AND `tag === 'search'`. The description read
"Backward to a deep page ... `backMorph` still drives the Header morph ...
history.back() lands on the deep page" -- all three wrong for the `/search`
sub-case (reachable: `/search` -> `/` then back-swipe; target `/search` is
mode `search` not deep; the morph's `targetIsSearch` skip means `backMorph`
is consumed by `searchProgress`, not the morph; `history.back()` lands on
`/search`). Case 3 (forward `/search`) correctly states the
backMorph-doesn't-drive-morph fact for `/search`, so case 1 was internally
inconsistent. Fixed: "Backward to a non-tab target (a deep page, or
`/search`) ... `backMorph` still drives the Header morph for a deep target
(a `/search` target takes the morph's `targetIsSearch` skip and consumes
`backMorph` via `searchProgress` instead, as in case 3) ... history.back()
lands on the back-target."

## Verify

`bun run check` 0/0; `prettier --check` clean; no U+2014 em-dash;
comment-only changes.

## Disposition

Counter after R136: 0/5. Both findings were genuine (a wrong headline
condition + a non-exhaustive case description inconsistent with its
sibling case). The pool continues to yield ~1-3 confirmed/round.

**No git mutation.** No commits, no branches, no pushes.
