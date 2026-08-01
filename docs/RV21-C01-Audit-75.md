# RV21-C01 Audit 75 (R75)

**Date:** 2026-08-01. **Round:** R75. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): SearchAnchor `playEnterAnimation` bullet cites `/search`-only values

**F1:** `header-probe.ts:187-196` (SearchAnchor interface docstring,
`playEnterAnimation` reach-path bullet) cited `start = 1, dest = 1` and
narrowed the trigger to "a forward-swipe-to-`/search` commit-to-enter
handoff". The code guard (`orchestrator:1318`
`if (#priorTerminalSearchProgress !== null)`) fires for EVERY pipeline
commit landing; for a non-search commit the anchor is `{start: 0, dest: 0}`
(stash 0, `resolveHeaderMode(non-search host) === 'search' ? 1 : 0` = 0).
The inline comment at the code site (`orchestrator:1293-1317`) documents
both cases, so the interface docstring contradicted its own code site. Same
class as R72 (claim true for one case, false for a reachable case). Rewrote
the bullet to generalize `start` (1 for `/search`, 0 for non-search) and
`dest` (the host route's at-rest searchProgress), matching the inline
comment.

## Auditor A F2 (reviewed, NOT a defect)

`header-probe.ts:200` parenthetical "(the drag's live `bm`, e.g. 0.30)".
Auditor A flagged it as inaccurate for non-search drags, but the bullet's
trigger is explicitly scoped to "a non-search goto / tab-click / popstate
interrupt of a forward-swipe-to-`/search`" -- at the capture instant
`toPathname` is still `/search`, so `#searchProgressAtSettleInstant` does
return the drag's live bm. The parenthetical references real behaviour for
the bullet's stated scope and neither overclaims nor references absent
behaviour; per the binding criteria it is not a concern. Left unchanged.

## Auditor B finding (CONFIRMED): morph-capture comment lists a `pointercancel` case that is not one

**F1:** `orchestrator:1756-1757` (the `settleMorphAtTakeover` capture
comment in `#beginGesture`) listed "pointercancel during a settle" as one
of three "drag-takes-over-settle boundary" cases the capture covers. But
`#beginGesture` has a single caller (`#interpretIntent:1537`) gated on
`newDragStart = isDrag && !prevWasDrag` (`isDrag` requires micro `drag-right`
/ `drag-left`). A `pointercancel` routes through `detectSwipe`'s onUp
listener (`swipe.ts:327`) -> `onPointerUp` with `shouldCancelOnRelease`
forcing the cancel signal (`swipe.ts:212`; class header `orchestrator:14-17`)
-> the release path (micro `committed` / `cancelled`), never `#beginGesture`.
So the morph capture cannot fire on a `pointercancel`. The other two listed
cases (re-grab mid-commit, gesture-during-forward-enter) are real. Replaced
"pointercancel during a settle" with "re-grab during a cancel-settle" (a
real drag-takes-over-settle boundary: a new pointerdown during a cancel
settle).

## Orchestrator verification

Independently verified both confirmed findings before fixing. A-F1: read
the `playEnterAnimation` seed (`orchestrator:1318-1322`) and confirmed
`start = #priorTerminalSearchProgress` (1 for `/search`, 0 for non-search)
and `dest = resolveHeaderMode(inputs.fromPathname) === 'search' ? 1 : 0`.
B-F1: confirmed `#beginGesture`'s sole caller and its `newDragStart` gate,
the class-header pointercancel-routing note, and `swipe.ts:212` / `:295`
/ `:327`. Re-ran both auditors' sibling sweeps; no missed siblings (A's
class: reach-path bullets citing sub-case-specific values -- only the
`playEnterAnimation` bullet; B's class: "Covers every ... boundary" /
`pointercancel` claims -- only `:1756`).

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R75: 0/5.
