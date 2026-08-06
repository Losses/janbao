# RV21-C01 Audit 138 (R138)

**Date:** 2026-08-06. **Round:** R138. **Votes:** auditor A BLOCK,
auditor B BLOCK. **Counter after: 0/5.**

## Outcome

Two findings, both residuals of the R137 F1 fix (loose-vs-strict
pill-mapping conflation). Both fixed. Counter 0/5.

**R137 F1 verification:** Both auditors independently confirmed the
`backMorphIsNull` fix is correct (traced both call sites, verified the
null condition matches `#republishToPager`, no snap, no regression).

## A -- stale `isTabToTab` in e2e specs (2 sites)

R137 renamed `isTabToTab` to `backMorphIsNull` in the helper but the
sibling sweep missed 2 e2e spec references:

- `e2e/offline-back-swipe.spec.ts:21`: referenced `isTabToTab` in the
  `dragMorphWasStatic` derivation.
- `e2e/messages-back-swipe.spec.ts:2959`: listed `isTabToTab` as a
  parameter name.

Fixed: both updated to `backMorphIsNull`. (Sibling-sweep miss from R137;
the memory `audit-search-for-similar-bugs` binding requires grepping
sibling paths when renaming a parameter.)

## B -- `/offline/bookmarks` listed as null-`backMorph` case (3 docstrings)

Three docstrings (mobile-pager:29, Header:212, orchestrator:3622) listed
`/offline/bookmarks` as a null-`backMorph` example with "both endpoints
pill-map to a tab" language. But the null condition uses strict `toIdx`
(`#tabIndexFor` = `isTabRootPath`), and `/offline/bookmarks`'s structural
back-target `/offline` is `tag: 'tab'` but NOT a tab root
(`isTabRootPath('/offline') = false`), so `toIdx = -1` and `backMorph =
rawDragFraction` (NOT null). Same loose-vs-strict conflation R137 F1 fixed
in the helper code. Fixed: removed `/offline/bookmarks` from the example
list, changed "pill-maps to the same tab" to "resolves to a tab root,"
clarified "the source pill-maps and the target is a strict tab root."

## Verify

`bun run check` 0/0; `prettier --check` clean on all 5 edited files;
no U+2014 em-dash; `bun test src/lib/stores src/lib/utils` 398/0.

## Disposition

Counter after R138: 0/5. Both findings were residuals of the R137 F1
rename/fix (stale parameter references + loose-vs-strict docstring
conflation). The F1 correctness fix itself was verified correct by both
auditors.

**No git mutation.** No commits, no branches, no pushes.
