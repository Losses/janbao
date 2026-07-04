# DV19-C00 - Implementation Journal

Implementation of the forward-swipe preview (reuse `getPreviewPanel` for the Messages → `/search` edge), per the R3-approved `docs/DV19-Plan.md` (5/5 PASS, all organic=clean).

## Files

**New:** `src/lib/utils/preview-panel.ts` (the shared `getPreviewPanel`, searches `ROUTE_CONFIGS`); `src/lib/components/panels/SearchPreviewPanel.svelte` (the `/search` empty-entry preview, reads `page.data.t.search`).

**Modified:** `src/lib/utils/route-config.ts` (`SearchPreviewPanel` import + `previewPanel: SearchPreviewPanel` on the `/search` rule); `src/lib/components/templates/GesturePageLayout.svelte` (uses the shared `getPreviewPanel`, passing `navStore.activeTab`); `src/lib/components/atoms/ForwardEdgeOverlay.svelte` (renders `getPreviewPanel(target.href, activeIndex)` in a slide-in container; props `{ target, viewportWidth, activeIndex }`); `src/lib/components/templates/MobileTabPager.svelte` (`forwardTarget` derived + pass props + `swipeEnd` gates `clearReveal` on `target?.kind !== 'deep'`); `src/lib/stores/forward-edge.svelte.ts` (the `commit` bridge: no longer clears `reveal` synchronously; `inFlight` clears on settle; `retractPreview` clears both on `goto` rejection; `onDestroy` `reset()` clears on success).

## The commit-bridge fix

`commit` no longer sets `reveal = null` synchronously. The preview stays visible during the in-flight `goto`, bridging the gap until `MobileTabPager.onDestroy` (`reset()`) clears it at the route swap. On `goto` rejection (no route swap), `retractPreview` clears both. `swipeEnd`'s forward-commit branch gates `clearReveal()` on `target?.kind !== 'deep'`, so it does not defeat the bridge (the R2 blocker).

## Test results

- **Type check (`bun run check`):** 0 errors, 0 warnings across 1436 files.
- **Lint (`bun run lint`):** exit 0. No new similarity duplicates, no eslint errors.
- **Unit test:** `getPreviewPanel` is not unit-testable under `bun:test` (it imports `route-config.ts` which transitively imports `.svelte` panels; bun:test can't load `.svelte` files). Correctness is verified by the impl audit + runtime.

## Organic-clean gate

`MobileTabPager.svelte`'s diff: `forwardTarget` derived + `<ForwardEdgeOverlay target viewportWidth activeIndex />` + `swipeEnd` gate (`target?.kind !== 'deep'`). No `/search` literal, no `search` token. `ForwardEdgeOverlay` calls `getPreviewPanel` (general). `SearchPreviewPanel` is feature-named. `/search`'s `previewPanel` is data. The DV18 organic-clean gate holds.

## Non-blocking items (carried to RV19)

- The GPL `snapIndex 0` enter discontinuity at land (Messages-preview briefly before `/search` slides in; the existing enter pattern, more noticeable after the preview). The cover transition is the achievable symmetry.
- The cancel path is instant-vanish (no retract animation); pre-existing DV18.
- `goto` resolves (not rejects) on load errors; the reject handler is mostly dead; the preview stays until unmount.
