# RV21-C01 Audit 88 (R88)

**Date:** 2026-08-02. **Round:** R88. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

Three findings, three classes.

## Auditor A (CONFIRMED): `#dragMorphAnchor` field clear-sites omits `unmount`

**F1** `orchestrator:728-730` -- the `#dragMorphAnchor` field docstring
listed only `#armSettleEase` / `#landAtRest` as clear sites. The field is
also cleared by `unmount` (`orchestrator:1429`). Every sibling field
docstring (`#enterFabAnchor`, `#searchAnchor`, `#priorTerminalFabScale`,
`#priorTerminalSearchProgress`), the `dragSearchAnchor`/`enterFabAnchor`/
`searchAnchor` getters, and the `header-probe.ts` DragMorphAnchor/
DragFabAnchor/DragSearchAnchor interfaces all list `unmount`; only this
one field docstring omitted it. Added "`unmount`".

## Auditor B (2 findings, CONFIRMED)

**F1** `mobile-pager.svelte.ts:68-71` -- the `tapMorph` field docstring
said it is "consumed by ... the search-page Page-slide headroom on a
tap". That consumer does not exist (`grep "Page-slide|page-slide|slide
headroom"` returns only this docstring). The actual readers are the
Header's `iconProgress`, `trackMorph`, and `searchProgress` derivations.
Rewrote to name them.

**F2** `scroll-chrome.svelte.ts` -- the exported `hidden` and `scrolling`
reactive flags had ZERO readers (`grep .hidden|.scrolling` outside the
file: none; the store is not exposed on `window`). Dead code in the
pipeline. Removed both: their `$state` declarations, all writes, the
interface entries, the getters, and the cascading dead machinery whose
sole purpose was maintaining `scrolling` -- the `scrollTimeoutId`, the
`setTimeout` that set `scrolling = false`, the `onScrollEnd` function,
and the `scrollend` listener registrations/deregistrations. (Caught a
dangling `removeEventListener('scrollend', onScrollEnd)` in the
old-container cleanup; removed it too.) The live `translateY` /
`headerHeight` / `override` signals (which ARE read by the Header / FAB
layer) are untouched.

## Orchestrator verification

Independently verified all three before editing. A-F1: confirmed
`this.#dragMorphAnchor = null` at `unmount` (`:1429`) and that every
sibling enumeration lists `unmount`. B-F1: confirmed `grep "Page-slide"`
returns only the docstring and that tapMorph's readers are the three
Header derivations. B-F2: confirmed zero external readers of `hidden`/
`scrolling` and that `scrollTimeoutId` exists solely to maintain
`scrolling`. Re-gated after the B-F2 code removal; caught and fixed the
dangling `onScrollEnd` reference; final `bun run check` 0/0.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean. A-F1 +
B-F1 comment-only; B-F2 a code change (dead-state removal, runtime
behavior unchanged -- `translateY` motion is untouched).

## Disposition

Counter after R88: 0/5.
