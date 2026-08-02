# RV21-C01 Audit 86 (R86)

**Date:** 2026-08-02. **Round:** R86. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

Four findings, three scope-narrowing classes (the same family as R85, in
files the prior sweeps had not reached).

## Auditor A (2 findings, CONFIRMED)

**F1** `orchestrator:847-849` (`#searchAnchor` field docstring,
playEnterAnimation bullet) -- said "a forward-swipe-to-`/search`
commit-to-enter handoff", but the seed (`:1320-1324`) fires for ANY
pipeline-commit-to-enter handoff (`#priorTerminalSearchProgress !== null`,
1 for `/search`, 0 for non-search). This is the sibling of R75-A's
`header-probe.ts:187` fix -- R75-A's sweep missed this orchestrator field
docstring. Rewrote to "any pipeline-commit-to-enter handoff (hold the
stashed terminal searchProgress: 1 for a `/search` commit ..., 0 for a
non-search commit)".

**F2** `orchestrator:2833, 2862` (discrete-nav settle-arm summary) -- said
"Three reach paths" and restated the condition as the 2-clause
`liveDragMorph !== sourceRest || liveDragMorph !== destMorph`. The actual
`if` (`:2969`) is 3-clause (`|| searchAxisNeedsEase`) covering a 4th
search-axis case (documented separately at `:2953-2965`). The summary was
written before the search-axis clause was added. Rewrote "Three reach
paths" -> "Four reach paths (the first three on the morph axis; the
fourth, a search-axis case, is detailed at the arm below)" and the
condition restatement to the full 3-clause form, "covers all four".

## Auditor B (2 findings, CONFIRMED): `detailSearchResolver` scope narrowed

**F1** `nav-resolvers.ts:23` (dispatch table) -- described
`{detail, search}` as "thread<->search", but the resolver is selected for
EVERY detail<->search transition (23 `tag: 'detail'` routes: thread,
profile, bookmarks, admin, notifications, drafts, etc.). Rewrote to
"deep<->search" (matching the table's own "deep-to-deep" convention at
`:19`).

**F2** `nav-resolvers.ts:284` (section header) -- "Thread/profile to
search and back" narrows to two sub-categories. Rewrote to "Deep-to-search
and back (any detail route -- thread, profile, bookmarks, admin, etc. --
to /search)", matching the sibling `detailDetailResolver` header's
(`:216`) "Deep-to-deep (thread to profile, ...)" category-plus-examples
pattern.

## Orchestrator verification

Independently verified all four before editing. A-F1: confirmed the seed
guard is `#priorTerminalSearchProgress !== null` (any pipeline commit) and
that R75-A's `header-probe.ts:187` general form is the accurate sibling.
A-F2: confirmed the actual `if` (`:2969`) is the 3-clause form with
`searchAxisNeedsEase`, and that the 4th case is documented at `:2953-2965`.
B-F1/F2: confirmed `grep -c "tag: 'detail'"` = 23 routes and
`'detail-search': detailSearchResolver` (`:316`) selects for all of them.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R86: 0/5. A-F1 is a residual of the orchestrator's own R75-A
rewrite (the missed field-docstring sibling) -- the same pattern as the
[[docstring-rewrite-must-cover-all-branches]] lesson.
