# RV21-C01 Audit 81 (R81)

**Date:** 2026-08-01. **Round:** R81. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A findings (CONFIRMED): `/discussion/*` is not a "True deep page" example

Both `resetPagerStore` and `#republishToPager` enumerate "True deep page
(`fromTabIndex === -1`)" examples including `/discussion/*` outside the
centerTab shape.

**F1:** `orchestrator:4530-4534` (`resetPagerStore` else-branch comment).
**F2:** `orchestrator:4698-4700` (`#republishToPager` deep-page-mode
bullet).

`/discussion/*` is doubly wrong as a `fromTabIndex === -1` example:
(1) `/discussion/*` routes mount with `centerTab={0}`
(`discussion/[discussionId]/[slug]/[[page=page]]/+page.svelte:852`), so
they take the centerTab branch and never reach the deep-page else-branch;
(2) even a hypothetical non-centerTab `/discussion/*` pill-maps to
discussions (`route-config.ts:113` `/^\/discussion\//` -> 'discussions';
`getCurrentTabIndex` -> 0), not -1. Removed `/discussion/* outside the
centerTab shape` from both enumerations. The remaining examples
(`/profile/*`, `/bookmarks`, `/search`) are correct: they pill-map to
'active', and `getCurrentTabIndex` returns -1 for
`pillTarget === 'active' || 'none'` (`route-config.ts:298`).

## Auditor B finding (CONFIRMED): `NavExecutorTickFn` type lists `tapMorph` it does not publish

**F1:** `nav-executor.svelte.ts:70-79` (`NavExecutorTickFn` type docstring)
said the per-frame commit callback publishes to "the pager store (which
the Header, via `backMorph` / `tapMorph`, ... read)". The callback
(`#onExecutorTick` -> `#publish` -> `#republishToPager`) writes only
`backMorph` (and `fractionalIndex` / `dragging` / `active` / `targetIndex`
/ `transitionTarget`); `tapMorph` is published only by the separate
tap-scrub rAF's `setTapMorph`. Same class as R80's `#onExecutorTick` fix
(the sibling site in the callback TYPE docstring, which R80 missed).
Removed `/ \`tapMorph\``.

## Orchestrator verification

Independently verified all three before fixing. A-F1/F2: confirmed
`/discussion/*` mounts `centerTab={0}` and that `getCurrentTabIndex`
returns -1 only for `pillTarget === 'active' || 'none'` (so `/profile/*`,
`/bookmarks`, `/search` -> -1 via 'active'; `/discussion/*` -> 0 via
'discussions'). B-F1: confirmed the callback chain writes no `tapMorph`
(R80 verification) and that this is the type-docstring sibling R80 missed.
Sibling sweeps: A's class ("True deep page" examples) -> two sites, both
fixed; B's class (commit-callback docstrings listing `tapMorph`) ->
`nav-executor.svelte.ts:73` only (R80 already fixed the orchestrator
sibling). No missed siblings.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
Comment-only (orchestrator + nav-executor docstrings); runtime unchanged.

## Disposition

Counter after R81: 0/5.
