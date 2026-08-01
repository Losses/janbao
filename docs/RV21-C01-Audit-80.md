# RV21-C01 Audit 80 (R80)

**Date:** 2026-08-01. **Round:** R80. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor B finding (CONFIRMED): `#onExecutorTick` lists `tapMorph` it does not write

**F1:** `orchestrator:2180-2181` (`#onExecutorTick` docstring) listed
`tapMorph` among the pager fields it "keeps continuous" across the
drag-to-commit boundary. The helper only calls `#publish` ->
`#republishToPager`, which writes `backMorph` / `fractionalIndex` /
`dragging` / `active` / `targetIndex` / `transitionTarget` -- NOT
`tapMorph`. `tapMorph` is written only via the dedicated `setTapMorph`
channel from the tap-scrub rAF (a separate §5 motion channel; write sites
`unmount` / `#armTapScrubEase` / the tick / `#finishTapScrubEase`). It
stays continuous across the boundary only because the pager store
preserves it (does not overwrite), not because of this helper. Removed
`tapMorph` from the enumeration.

## Auditor A finding (CONFIRMED): non-existent `fallbackRoute` prop

**F1:** `e2e/swipe-back-pill-flicker.spec.ts:10` said
`NavPipelineHost fallbackRoute="/"`. `NavPipelineHost` has no
`fallbackRoute` prop (the interface is `readonly leftHref: string`,
`NavPipelineHost.svelte:47`; the bookmarks route uses
`<NavPipelineHost leftHref="/">` at `+page.svelte:53`). `grep -rn
fallbackRoute src/` returns zero hits. The stale name survived a
mechanical rename from the deleted `GesturePageLayout` (which did have a
`fallbackRoute` prop). Rewrote to `leftHref="/"`.

## Orchestrator verification

Independently verified both. B-F1: confirmed `#onExecutorTick` body calls
only `#publish(raw)` and that `tapMorph` is written only via `setTapMorph`
(sites `:1459` / `:3687` / `:3716` / `:3751`), never by
`#republishToPager`. A-F1: confirmed `fallbackRoute` is absent from all of
`src/` (zero hits) and that NavPipelineHost's real prop is `leftHref`
(`:47` interface, `+page.svelte:53` usage). Sibling sweeps: B's class
(fields a helper "keeps continuous" but does not write) -> only `:2180`;
A's class (e2e prop names the source does not define) -> only `:10`. No
missed siblings.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
Comment-only (orchestrator + e2e spec docstrings); runtime unchanged.

## Disposition

Counter after R80: 0/5.
