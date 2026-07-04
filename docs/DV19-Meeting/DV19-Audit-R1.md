# DV19 - Plan Audit Round 1

3 independent role-less auditors examined `docs/DV19-Plan.md` (the forward-swipe-preview-reuses-getPreviewPanel plan) against the codebase. Result: **1/3 PASS, 2/3 FAIL**. Two convergent blockers; the PASS auditor noted the same issues as non-blocking.

## Tally

| Auditor | Verdict | Organic           | Confidence |
| ------- | ------- | ----------------- | ---------- |
| 1       | FAIL    | has-special-cases | high       |
| 2       | FAIL    | clean             | ~78%       |
| 3       | PASS    | clean             | high       |

Result line: **1/3 PASS → revised.**

## Convergent blockers

### R1-B1 (2/3); `getRouteRule` is not exported (`route-config.ts:298`)

The plan's `preview-panel.ts` imported `getRouteRule`, which is declared `function getRouteRule(...)` with no `export`. Build-breaking. Fix: use `ROUTE_CONFIGS.find` directly (no `getRouteRule`). Applied in the R1 revision.

### R1-B2 (the central defect); the commit-bridge flash

`forwardEdge.commit` clears `reveal = null` synchronously (`forward-edge.svelte.ts:84`) before `goto` resolves; `ForwardEdgeOverlay` (`{#if reveal !== null}`) vanishes the instant the finger lifts, exposing bare Messages during the async `goto` gap. The back-swipe bridges its gap with `isTransitioningOut` + 300 ms fade; the forward path has no bridge. The plan's §4.6 claimed "Effect E settles the page seamlessly"; Effect E is the Header morph scrub, not a page-body settle; the claim was wrong.

Auditor 2 also flagged the `snapIndex 0` enter on `/search` (Messages left-preview shows one paint before `/search` slides in); the existing `/search` enter pattern.

### R1-B3 (2/3); `<messagesTabIndex>` placeholder unresolved

§4.4 left `<messagesTabIndex>` undefined. Resolved: `ForwardEdgeOverlay` takes `activeIndex` as a prop.

## Verified-TRUE (carry forward)

`getPreviewPanel` at `GesturePageLayout.svelte:75-79` searches `DEEP_ROUTES`; `previewPanel` is a `BaseRouteConfig` field (`route-config.ts:57`); `/search` (`route-config.ts:80-83`) has no `previewPanel`/`getParent`; `ROUTE_CONFIGS`, `MOBILE_TABS`, `SvelteComponentType` are exported; the generalisation to `ROUTE_CONFIGS.find` is backward-compatible (every existing `previewPanel` is on a `ROUTE_CONFIGS` entry with an anchored, unique pattern); `page.data.t` is root-layout data (`+layout.server.ts:109`, present everywhere); preview panels are prop-less, read `page.data`; the MobileTabPager viewport is `position: relative`; `viewportWidth` is measured (`MobileTabPager.svelte:105,350-361`); the slide-in geometry (overlay `width: reveal`, inner `width: viewportWidth` right-aligned, `overflow: hidden`) reveals the preview 1:1; FAB `z-35` > overlay `z-30`.

## Revision decisions

1. `preview-panel.ts` uses `ROUTE_CONFIGS.find` directly (no `getRouteRule` export).
2. `commit` no longer clears `reveal` synchronously; keeps it during the `goto` gap (cleared by `onDestroy` `reset()` on success, by the reject handler on failure).
3. `ForwardEdgeOverlay` takes `activeIndex`; the `<messagesTabIndex>` placeholder resolved.
4. The handoff narrative corrected (GPL `shouldAnimateEnter` slide, not "Effect E settles the page"); the inner panel `bg-base-100` matches the `/search` surface.
