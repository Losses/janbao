# DV19 - Forward-swipe preview: reuse getPreviewPanel for the Messages → /search edge

**Status:** Draft under the 5-agent role-less audit loop. Plan update history will live in `docs/DV19-Meeting/DV19-Plan-Journal.md`.
**Scope:** Mobile only. The forward swipe from the Messages tab toward `/search` currently grows a right-edge arrow chip (`ForwardEdgeOverlay`) with no destination preview, asymmetric with the back-swipe (`/search` → Messages) which reveals a live Messages panel via `getPreviewPanel`. DV19 makes the forward edge reveal the destination's preview panel through the SAME `getPreviewPanel` mechanism, so no new preview system is introduced.
**Related:** DV18 delivered the forward-edge (resolveForwardTarget + forwardEdge store + commit); this adds the preview content via the existing preview-panel wheel. `GesturePageLayout.svelte:75-79` is the `getPreviewPanel` to reuse.

## 1. Goal

When the user drags the forward edge of the Messages tab toward `/search`, the destination's preview (the `/search` entry state) slides in 1:1 from the right, reusing `getPreviewPanel` (the same mechanism the back-swipe uses to reveal Messages). On commit, `/search` mounts, matching the preview. No forward-specific preview component system is added; the content comes from `route-config`'s `previewPanel`, parallel to `ProfileMenuPanel` / `ThreadPreviewPanel`.

## 2. Defect and evidence

**Symptom.** A forward swipe on `/messages/inbox` toward `/search` grows `ForwardEdgeOverlay` (a right-edge strip with `mdiArrowRight`), showing no destination content. The back-swipe from `/search` reveals the live Messages list (`GesturePageLayout.svelte:989-1024` renders `getPreviewPanel(resolvedLeftHref)` = the Messages panel). Asymmetric.

**Location.** `ForwardEdgeOverlay.svelte` renders only `<Icon path={mdiArrowRight} />`. `getPreviewPanel` (`GesturePageLayout.svelte:75-79`) is the existing preview-panel resolver but is private to the GPL and searches only `DEEP_ROUTES` (routes with `getParent`), so `/search` (no `getParent`) is unreachable.

**Why reuse, not a new wheel.** The codebase already has the preview-panel mechanism: `route-config.ts:57` `previewPanel?: SvelteComponentType`, resolved by `getPreviewPanel`, rendered by the GPL. Adding a `SearchEntryPreview` outside this mechanism (the rejected DV18-era idea) would be a third preview system alongside `getPreviewPanel` and `deepPageSnapshot`. DV19 reuses `getPreviewPanel`.

## 3. Architecture context (verified inventory)

### 3.1 getPreviewPanel and the previewPanel field

`GesturePageLayout.svelte:75-79`:

```ts
function getPreviewPanel(path) {
	if (!path) return null;
	const match = DEEP_ROUTES.find((r) => r.pattern.test(path));
	return match?.previewPanel ?? MOBILE_TABS[navStore.activeTab]?.panel ?? null;
}
```

`DEEP_ROUTES` = `ROUTE_CONFIGS.filter((r) => r.getParent !== undefined)` (`route-config.ts:205-207`). `previewPanel` is a `BaseRouteConfig` field (`route-config.ts:57`), present on `/profile/[id]`, `/admin`, `/profile/settings`, etc. (`route-config.ts:95,102,112,122,130,137,144,151`). `/search` (`route-config.ts:80-83`) has no `previewPanel` and no `getParent`, so it is invisible to `getPreviewPanel`.

`getRouteRule(path)` (`route-config.ts:298-300`) returns the first `ROUTE_CONFIGS` entry matching `path`. Generalising `getPreviewPanel` to search `ROUTE_CONFIGS` (via `getRouteRule`) instead of `DEEP_ROUTES` is backward-compatible: every existing `previewPanel` lives on a `ROUTE_CONFIGS` entry, so the same panels are found, and `/search` becomes reachable once it carries a `previewPanel`.

### 3.2 Preview panels read page.data (the constraint)

`ProfileMenuPanel.svelte` reads `page.data.targetUser`, `page.data.t` (`:12,16`). The GPL renders these panels while mounted on the deep route, so `page.data` is the route's data. For DV19, the forward-edge overlay renders the preview while still on `/messages/inbox`, where `page.data` is the Messages data. Therefore the `/search` preview panel MUST NOT depend on `page.data`; it renders the static empty entry state (no query, empty results). This matches the `/search` fresh-landing state (no query → empty).

### 3.3 The forward-edge today (DV18)

`MobileTabPager.svelte` resolves `resolveForwardTarget(activeIndex)` (`forward-edge.ts:37-43`), and on a forward deep drag calls `forwardEdge.setReveal(Math.min(-deltaX, innerWidth*0.6))` (`MobileTabPager.svelte:227`); `forwardEdge.commit(target.href)` on release (`:271`). `ForwardEdgeOverlay.svelte` reads `forwardEdge.reveal` and renders the arrow strip. The `dragging` predicate includes `forwardEdge.reveal` (`:109`). The overlay is `z-30`, below the FAB `z-35`.

### 3.4 The slide-in geometry

`MobileTabPager` measures `viewportWidth` (the pager viewport width, `MobileTabPager.svelte:101` + the `measureViewportWidth` action). The overlay's parent (`.mobile-tab-pager-viewport`) is `position: relative` (`viewportStyle`). A right-anchored overlay of `width: reveal px` with `overflow: hidden`, containing a full-`viewportWidth` panel right-aligned, reveals that panel leftward 1:1 as `reveal` grows: the destination appears to slide in from the right, covering Messages (a cover transition).

## 4. Design

### 4.1 Extract getPreviewPanel to a shared util

New `src/lib/utils/preview-panel.ts`:

```ts
import { ROUTE_CONFIGS, MOBILE_TABS, type SvelteComponentType } from './route-config';

export function getPreviewPanel(
	path: string | null | undefined,
	activeTabIndex: number
): SvelteComponentType | null {
	if (!path) return null;
	const rule = ROUTE_CONFIGS.find((r) => r.pattern.test(path));
	return rule?.previewPanel ?? MOBILE_TABS[activeTabIndex]?.panel ?? null;
}
```

Uses `ROUTE_CONFIGS.find` directly (not the unexported `getRouteRule`), so no export change to `route-config.ts` is needed. Generalised from `DEEP_ROUTES` to `ROUTE_CONFIGS`, backward-compatible: every existing `previewPanel` sits on a `ROUTE_CONFIGS` entry with an anchored, unique pattern, so the same entry is found. `GesturePageLayout.svelte:75-79` replaced with a call to the shared util (passing `navStore.activeTab`); its behavior is unchanged for every existing route.

### 4.2 /search provides a previewPanel

`route-config.ts:80-83`: add `previewPanel: SearchPreviewPanel` to the `/^\/search$/` rule. Import `SearchPreviewPanel` at the top of `route-config.ts` (alongside `ProfileMenuPanel` etc.).

### 4.3 SearchPreviewPanel component

New `src/lib/components/panels/SearchPreviewPanel.svelte`: prop-less, renders the `/search` empty entry state (no `page.data` dependency). Content: a search-bar affordance (a pill with `mdiMagnify` + the placeholder text) + the four scope labels + the empty prompt. This is a faithful representation of `/search`'s fresh landing page content (the Header search input + SearchTabBar + empty scope state). It reads only `t` from the root-layout data (available everywhere via `page.data.t`, same as every panel); NOT `page.data.query`/`scope` (which are `/search`-specific and absent on `/messages/inbox`).

### 4.4 ForwardEdgeOverlay renders the preview panel

`ForwardEdgeOverlay.svelte` gains props `{ target: ForwardTarget | null; viewportWidth: number; activeIndex: number }` (named interface). It resolves `const PreviewPanel = getPreviewPanel(target?.kind === 'deep' ? target.href : null, activeIndex)` and renders it inside the slide-in container. The container is `position: absolute; inset-y: 0; right: 0; width: ${reveal}px; overflow: hidden; z-30; pointer-events: none`, and inside it a full-`viewportWidth` panel `position: absolute; right: 0; inset-y: 0; width: ${viewportWidth}px` so the preview is right-aligned and revealed leftward 1:1 as `reveal` grows. The `mdiArrowRight` affordance and the old `pr-10`/`justify-end` classes are removed (the preview communicates the destination). The inner panel carries its own background (`bg-base-100`, matching the real `/search` page surface, so there is no colour pop at commit).

### 4.5 MobileTabPager passes the target + viewportWidth + activeIndex; swipeEnd gates clearReveal

`MobileTabPager.svelte`: add `const forwardTarget = $derived(resolveForwardTarget(activeIndex))` and render `<ForwardEdgeOverlay target={forwardTarget} viewportWidth={viewportWidth} activeIndex={activeIndex} />`. The existing `swipeMove`/`swipeEnd` calls to `resolveForwardTarget(activeIndex)` can read the derived instead (optional; the function is pure and cheap).

The R2 audit found that `swipeEnd` calls `forwardEdge.clearReveal()` synchronously after `commit` (`MobileTabPager.svelte:275`), defeating the commit-bridge (the preview would vanish on release regardless of the `commit` fix). DV19 gates that call: in the forward-commit branch, `clearReveal()` runs only when `target?.kind !== 'deep'`. The deep case lets `commit` own the reveal lifecycle (the preview bridges the `goto` gap; `onDestroy` `reset()` clears it on success, the reject handler on failure). The tab and null cases keep `clearReveal()` (defensive; `swipeMove` only sets `reveal` for the deep case, so it is a no-op there). So:

```
if (target?.kind === 'tab') switchTo(target.index);
else if (target?.kind === 'deep') forwardEdge.commit(target.href);
dragOffset = null;
showDeepPreview = false;
backChipReveal = null;
if (target?.kind !== 'deep') forwardEdge.clearReveal();
```

This is keyed on `target.kind` (the general dispatch), not on a feature token; the organic-clean gate holds.

### 4.6 The animation + the commit-bridge fix

During the forward drag, `forwardEdge.reveal` grows 0 → 0.6·innerWidth; the overlay reveals the `SearchPreviewPanel` 1:1 from the right (cover transition: the preview slides over Messages). On commit, `forwardEdge.commit('/search')` calls `goto('/search')`. The R1 audit found a flash: `commit` cleared `reveal = null` synchronously (`forward-edge.svelte.ts:84`), so the preview vanished the instant the finger lifted, exposing bare Messages during the async `goto` gap. The back-swipe bridges its symmetric gap with `isTransitioningOut` + a 300 ms fade; the forward path had no bridge.

DV19 fixes this in `forward-edge.svelte.ts`: `commit` no longer clears `reveal` synchronously. The preview stays visible during the in-flight `goto`, bridging the gap until `MobileTabPager` unmounts at the route swap (`onDestroy` → `reset()` clears `reveal`). On `goto` rejection (no route swap, `MobileTabPager` stays mounted), `commit`'s reject handler retracts the preview (`reveal = null`). So:

- `void goto(href).then(() => { inFlight = false; }, () => { reveal = null; inFlight = false; })`.
- On success: `reveal` is cleared by `onDestroy` `reset()` at the route swap (which also clears `inFlight`); the resolve handler clears `inFlight` redundantly-safe.
- On failure: the reject handler clears both (`reveal` retracts, guard clears).

At `goto`-land, `MobileTabPager` unmounts (preview goes with it); `/search` mounts and its GPL runs `shouldAnimateEnter` (`snapIndex` 0 → `ACTIVE`), the same enter-slide the tap-search path uses. The Header transitions to search mode via Effect E (the Header morph scrub) at land. So the sequence is: drag (preview 1:1) → release → preview bridges the gap → `/search` mounts and slides in (existing enter pattern) → Header settles. No pre-mount flash; the mount-time enter is the existing `/search` enter.

This is a cover transition, not a literal two-panel slide (the back-swipe slides both panels because the GPL track is `[Messages-preview | /search-center]`; MobileTabPager's tab track cannot host a `/search` panel without a 4th-panel refactor that would destabilise the tab geometry). The cover transition reuses the preview CONTENT (via `getPreviewPanel`) and the existing overlay container; it does not add a preview mechanism.

### 4.7 Organic integration

`MobileTabPager.svelte`'s diff gains the `forwardTarget` derived, the `<ForwardEdgeOverlay target viewportWidth activeIndex />` props, and the `swipeEnd` gate (`target?.kind !== 'deep'` on `clearReveal`); no feature token (`target.href` is data). `ForwardEdgeOverlay` calls `getPreviewPanel` (general); no `/search` literal, no `search` token (the `mdiMagnify` icon and the placeholder text live in `SearchPreviewPanel`, a feature-named panel, parallel to `ProfileMenuPanel`). `/search`'s `previewPanel` is data in `route-config.ts`. The DV18 organic-clean gate holds.

## 5. Files

**New:** `src/lib/utils/preview-panel.ts` (the shared `getPreviewPanel`); `src/lib/components/panels/SearchPreviewPanel.svelte` (the `/search` empty-entry preview, prop-less).

**Modified:** `src/lib/utils/route-config.ts` (`previewPanel: SearchPreviewPanel` on the `/search` rule + the import); `src/lib/components/templates/GesturePageLayout.svelte` (use the shared `getPreviewPanel`, passing `navStore.activeTab`); `src/lib/components/atoms/ForwardEdgeOverlay.svelte` (render `getPreviewPanel(target.href)` in the slide-in container; new props `{ target, viewportWidth, activeIndex }`); `src/lib/components/templates/MobileTabPager.svelte` (`forwardTarget` derived + pass to `ForwardEdgeOverlay`; `swipeEnd` gates `clearReveal()` on `target?.kind !== 'deep'` so the deep commit owns the reveal lifecycle); `src/lib/stores/forward-edge.svelte.ts` (the `commit` bridge fix: no longer clears `reveal` synchronously; clears `inFlight` on settle, retracts `reveal` only on `goto` rejection; `onDestroy` `reset()` clears `reveal` at the route swap).

## 6. Edge cases

1. Forward drag reveals the `SearchPreviewPanel` 1:1; commit lands on `/search` matching the preview.
2. Cancel: `reveal` → 0, the preview retracts, Messages uncovered.
3. Tab without a forward neighbour: `target` is `{kind:'tab'}` or null; `getPreviewPanel(null/...)` returns null; no preview rendered (the overlay is not shown for tab targets; `swipeMove` only sets `reveal` for the deep case).
4. The FAB (`z-35`) stays visible above the overlay (`z-30`) during the drag; at land the family swap eases it to 0.
5. `viewportWidth` 0 before measure: the inner panel width 0 → preview not visible until measured (same as the indicator's behavior); the overlay still grows.
6. SSR: `ForwardEdgeOverlay` renders nothing (`reveal` null at init); `SearchPreviewPanel` is never mounted server-side (inside the mobile-only pager).

## 7. Testing plan

**E2E** (CDP touch, dedicated webServer port, `__navReady`): forward swipe Messages → the `SearchPreviewPanel` content is visible during the drag (assert the preview text/icon appears mid-drag), then `/search` lands. Cancel: the preview retracts. The back-swipe `/search` → Messages still reveals the Messages panel (the shared `getPreviewPanel` is backward-compatible).

**Unit.** `preview-panel.ts` `getPreviewPanel`: returns `SearchPreviewPanel` for `/search`, `ProfileMenuPanel` for `/profile/[id]/[slug]`, the active tab's panel for a tab root or any unmatched path (the fallback), null only for an out-of-range `activeTabIndex`.

**Audit loop.** Five open-ended role-less auditors until 5/5.

## 8. Out of scope

A literal two-panel slide (Messages exits left + `/search` enters right) would require a 4th panel in the MobileTabPager track (destabilising tab geometry) or the reverted overlay-layer architecture. The cover transition reuses `getPreviewPanel` and the existing overlay; the back-swipe's two-panel slide remains the deeper pattern. Finger-tracking the Header search layer during the drag (URL-gated) remains out of scope.

## 9. UNVERIFIED items for Round 2

R1 resolved: `getPreviewPanel` uses `ROUTE_CONFIGS.find` directly (no `getRouteRule` export needed); the commit-flash is fixed by the bridge (`commit` keeps `reveal` during the `goto` gap, cleared by `onDestroy` on success / the reject handler on failure); the `<messagesTabIndex>` placeholder is resolved (`activeIndex` prop); the handoff narrative is corrected (the mount-time enter is the GPL `shouldAnimateEnter` slide, not "Effect E settles the page").

- The commit-bridge: confirm empirically that the preview stays visible during the `goto` gap (no bare-Messages flash), and that `onDestroy` `reset()` clears `reveal`/`dragging` before `/search` mounts and Effect E fires.
- `SearchPreviewPanel` renders without `page.data.query`/`scope` (absent on `/messages/inbox`); confirm it reads only `page.data.t` (root-layout data, present everywhere) and is SSR-safe (no `window`/`document`).
- The slide-in geometry reveals the preview 1:1 without distortion; the inner panel's `bg-base-100` matches the real `/search` surface (no colour pop).
- The cover transition hands off to `/search`'s GPL enter-slide at commit (the brief `snapIndex 0` Messages-preview is the existing enter pattern, same as tap-search).
