# DV09 - Mobile Floating Action Button (FAB)

**Status:** 5/5 PASS (FINAL, unconditional). Round 5. Approved for implementation (includes scroll-driven translateY hide-on-scroll via scroll-chrome headerHeight getter).
**Scope:** Mobile only (`max-width: 767px`). Desktop keeps current behavior (no pager, no FAB).
**Last architecture verify:** 2026-06-29, against `master` at `0a03874`. Round-1 audit: `docs/DV09-Meeting/DV09-Audit-R1.md`. Round-2 audit: `docs/DV09-Meeting/DV09-Audit-R2.md`. Round-3 audit: `docs/DV09-Meeting/DV09-Audit-R3.md`. Round-4 audit: `docs/DV09-Meeting/DV09-Audit-R4.md`.

**Round 4 spec change (owner-locked, supersedes the R3 "always visible" lock in §2.2):** the FAB now hides on scroll-down and reappears on scroll-up, sliding off the bottom of the viewport via `translateY`, echoing the Header's hide-on-scroll motion. The mechanism reads the existing `scroll-chrome` store; see §4.12. Everything else from R3 (AppShell placement, module-singleton track store, foregroundFraction scale, A/B/C taxonomy) is unchanged.

**Round 4 revision (post-audit, path 2):** the R4 audit (3/5 PASS, 2/5 FAIL, all 5 convergent — see `docs/DV09-Meeting/DV09-Audit-R4.md`) identified the path-1 choice (read `--header-height` via `getComputedStyle`) as wrong on three grounds: CSS custom properties are not Svelte-reactive; per-frame `getComputedStyle` is a forced-reflow antipattern that needs a duplicate ResizeObserver; and the "diff empty" justification misread the R3 organic-clean gate (which is "no FAB tokens", not "zero diff"). The revision switches to path 2: `scroll-chrome.svelte.ts` gains ONE line, a `get headerHeight() { return headerHeight; }` getter mirroring the existing `translateY` getter, and the FAB reads `scrollChrome.headerHeight` directly. `headerHeight` is a general scroll-chrome field (per the store docstring at `scroll-chrome.svelte.ts:9-11`), not an FAB token, so this satisfies the actual R3 gate. See §4.12.2 and §4.11.

## 1. Goal

Add a circular Action Button (FAB) floating at the bottom-right corner on the two list pages:

- **Discussions list** (mobile tab 0, route `/`) → taps to **create a discussion** (`goto('/post/discussion')`, VERIFIED route).
- **Messages inbox** (mobile tab 2, route `/messages/inbox`) → taps to **start a new message** (`goto('/messages/new')`, VERIFIED route).

No FAB on the Activity tab (tab 1) and no FAB on any detail/thread/conversation/compose page.

The hard requirement is the show/hide animation: during any route or tab change, the FAB scale must occupy the first 50% of the transition when disappearing (scale 1→0) and the last 50% when appearing (scale 0→1), with continuity across drag and snap.

## 2. Confirmed requirements (owner-locked)

1. **Mobile-only.** Desktop has no pager/gesture and keeps current behavior. The FAB and its scale animation exist only on mobile.
2. **Hide-on-scroll via translateY, echoing the Header.** (Round 4 supersedes the R3 "always visible" lock.) The FAB slides off the bottom of the viewport on scroll-down and back in on scroll-up. The slide is a NEW independent `translateY` driver; the existing route-transition `scale` machinery is UNCHANGED and the two compose as a single `transform: scale(s) translateY(y)`. Source for the scroll signal is the existing `scroll-chrome` store; no new store. Full mechanism, orthogonality rationale, pointer-events gating, tab-bar/edge geometry, and edge cases: §4.12.
3. **Symmetric scale model (UNCHANGED from R3).** `FAB scale = clamp(2 · foregroundFraction − 1, 0, 1)`, where `foregroundFraction ∈ [0,1]` is "how much this list page is the foreground surface" (1 = fully foreground, 0 = fully covered/away). Disappear in the first half, appear in the last half. This is continuous and works identically for drag and snap when `foregroundFraction` is continuous.

Visual spec (mapped to source in section 3.3).

## 3. Architecture context (verified inventory, post-R1)

### 3.1 Route topology (the central R1 correction)

The FAB-relevant routes split into two mount families. VERIFIED by `find src/routes -type d` and the page imports:

- **`(tabs)/` group** contains only `+page.svelte`, `activity/`, `messages/inbox/`. `(tabs)/+layout.svelte:22,129` is the SOLE importer and renderer of `MobileTabPager`. The tab-pager track exists only on `/`, `/activity`, `/messages/inbox`.
- **Top-level routes (NOT under `(tabs)/`):**
  - `/discussion/[discussionId]/[slug]/[[page=page]]/+page.svelte:1-3,907-918` renders its OWN `<DualColumnLayout><GesturePageLayout centerTab={0}>`.
  - `/messages/[id]/[[page=page]]/+page.svelte:1-3,143-181` renders its OWN `<DualColumnLayout><GesturePageLayout centerTab={2}>`.
  - `/post/discussion/+page.svelte:2,114-316` — top-level, NO GesturePageLayout (compose form).
  - `/messages/new/+page.svelte` — top-level, NO GesturePageLayout (compose form).

The memory note `mobile-thread-overlay-persistent-pager.md` is SUPERSEDED 2026-06-27. The `(tabs)` layout does NOT wrap thread/conversation/compose routes; `MobileTabPager` is unmounted the instant a user leaves `/`, `/activity`, or `/messages/inbox`. This drives the placement decision in §4.1.

### 3.2 Files read (post-R1)

- `src/routes/+layout.svelte` VERIFIED — initializes both pager stores at module-eval (`initMobilePagerStore(); initSearchPagerStore();` lines 22, 43-44), has `page` from `$app/state`, and renders `<AppShell>` wrapping `children` for every non-`/entry` route (`showShell` gate, line 112). Root layout is the correct ancestor of both the `(tabs)` branch and the top-level thread/compose routes.
- `src/routes/+layout.server.ts:40,112` VERIFIED — computes `isMobile` from the UA (`/mobile|android|iphone|ipad|phone/i.test(ua)`); exposes it on `LayoutData`.
- `src/lib/components/templates/AppShell.svelte:1-13,56-59` VERIFIED — rendered by the root layout specifically so `Header` "survives navigation across the `(tabs)` branch and standalone pages (discussion thread, search, profile, ...)". Root `<div class="flex min-h-screen flex-col">` then `<Header>` then `<div class="app-shell-content">{children}</div>`. AppShell is the sibling mounting point for the FAB layer (mirrors Header).
- `src/lib/stores/mobile-pager.svelte.ts:44-77,97-120` VERIFIED — `createPagerStore()` factory, closure-scoped `$state`. `initMobilePagerStore()` sets a module-level `globalMobilePagerFallback` and `window.__primaryPager`, so `getMobilePagerStore()` is reachable from AppShell (or any component) WITHOUT `getContext`, including across the route boundary. Fields: `fractionalIndex`, `dragging`, `active`, `backMorph: number | null`, `targetIndex`.
- `src/lib/components/templates/GesturePageLayout.svelte` VERIFIED — the publish `$effect` (lines 338-410) branches on `centerTab`:
  - `centerTab !== undefined` (the thread/conversation case, lines 340-359): publishes `fractionalIndex = progressVal` (continuous, mapped from `dragOffset` during drag, from `snapIndex`/`rightTab` at rest), `dragging`, `active: true`, and **`backMorph: null`** (line 356). Returns at line 359.
  - `centerTab === undefined` (deep pages: bookmarks, search, profile, lines 361-409): publishes `backMorph: progress` during drag, `backMorph: 1` on commit, `backMorph: 0` at rest.
  - **R1 correction:** `backMorph` is permanently `null` for the FAB-critical thread/conversation routes. The continuous signal for those routes lives on `fractionalIndex`, not `backMorph`.
- `src/lib/components/templates/GesturePageLayout.svelte:240-247,249,258,869-873` VERIFIED — `shouldAnimateEnter()` returns true when reached from the list via the nav stack (`navStore.direction === 'forward'`, stack depth ≥ 2, prev path = `resolvedLeftHref`). `snapIndex` inits to 0 on mobile+entering, then a single rAF flips `snapIndex = ACTIVE` (1). The CSS `transition-transform duration-200` then animates the GPL track from the list-preview position to the thread position over 200ms. **The GPL track IS animating during forward thread-enter**, so a sampler on it can drive the FAB scale-out. There IS no `OverlayLayer.svelte`; the thread overlay is GesturePageLayout's center `.gpl-card` panel.
- `src/lib/components/templates/GesturePageLayout.svelte:538-586` VERIFIED — `startPendingNavPoll()` is the existing rAF-on-track-transform pattern. `RAF_POLL_TIMEOUT_MS = TRACK_TRANSITION_MS * 4 = 800ms` (line 285). Each tick reads `new DOMMatrix(getComputedStyle(trackEl).transform).m41` and compares to a target px (line 577-578). This is the exact pattern the FAB sampler mirrors.
- `src/lib/components/templates/MobileTabPager.svelte:81-92,167-178` VERIFIED — publishes `fractionalIndex = activeIndex − (dragOffset ?? 0) / viewportWidth` continuously during drag (line 87). On commit, `dragOffset` resets to `null` so `fractionalIndex` jumps to the integer `activeIndex` while the CSS `transition-transform duration-200` animates the track; the store value is NOT tweened during snap. `switchTo(index)` (line 167) sets `activeIndex` and calls `navStore.navigateForward`; the track then animates via CSS transition. Track element is the `<div class="flex w-[300%] ... transition-transform duration-200" style={trackStyle}>` (line 347). **R2 correction:** the track div has NO `bind:this` and there is NO `trackEl` variable in the component (`grep bind:this` returns only `deepPreviewEl` at line 401); the track style is the derived string `trackStyle:132-136`. The §4.5 / §5 revision adds the binding honestly.
- `src/lib/utils/tab-config.ts:33-47` VERIFIED — Discussions `isActive: (p) => p === '/' || p.startsWith('/discussion')`; Messages `isActive: (p) => p.startsWith('/messages')`. So `getCurrentTabIndex('/discussion/...') === 0` and `getCurrentTabIndex('/messages/123') === 2`. The tab index alone is ambiguous between a list and its overlay; `overlayActive` (a path predicate) must be evaluated FIRST.
- `src/lib/components/organisms/Header.svelte:568,572` VERIFIED — mobile bar wrapper `bg-neutral text-neutral-content shadow-md`, `sticky top-0 z-40 ... md:mt-6 md:px-6`. Uses CSS-only mobile gating (`md:` breakpoints, `md:hidden`); does NOT read `isMobile` from JS. The FAB layer mirrors this (CSS mobile gate, no JS `isMobile`).
- `src/lib/components/organisms/Header.svelte:529-540,535` VERIFIED (R4) — ResizeObserver on `headerEl` calls `scrollChrome.setHeaderHeight(height)` (line 534) AND writes `document.documentElement.style.setProperty('--header-height', \`${height}px\`)`(line 535) in the same callback. Header's ResizeObserver is the source of truth for`headerHeight`in the store (the FAB reads it via the new`scrollChrome.headerHeight`getter, §4.12.2 path 2; the`--header-height` CSS var remains Header's own write and is NOT read by the FAB).
- `src/lib/components/organisms/Header.svelte:57,62` VERIFIED (R4) — `const scrollChrome = getScrollChromeStore();` and `const translateY = $derived(scrollChrome.translateY);`. The FAB layer uses the SAME two-line read pattern plus the new `headerHeight` getter; reactive tracking of the closure `$state` is proven (R3 §4.5).
- `src/lib/stores/scroll-chrome.svelte.ts:58,61,65,107-116,185-190,210-232` VERIFIED (R4) — `TOP_THRESHOLD = 8` (line 58); `let translateY = $state(0)` (line 61); `let headerHeight = $state(56)` (line 65, seeded non-zero, division-safe); the `translateY` clamp to `[-headerHeight, 0]` lives at lines 108-112; `setHeaderHeight` re-clamps `translateY` at lines 187-189; the public surface (lines 210-232) exposes `hidden`, `translateY`, `scrolling`, `override` as getters plus the writer functions (`setHeaderHeight`, `start`, `show`, `setScrollContainer`, `setOverride`, `holdThroughNavigation`, `releaseNavigation`). `headerHeight` is currently NOT exposed as a getter; the R4 revision (§4.12.2 path 2) adds it as a one-line `get headerHeight() { return headerHeight; }` mirroring `translateY` at `:215-217`.
- `src/lib/components/templates/AppShell.svelte:45,57` VERIFIED (R4) — `getScrollChromeStore().start()` runs in `onMount` (line 45); `<Header {t} ... />` is the sibling the FAB layer will sit next to (line 57). The FAB layer reads `scroll-chrome` at the same low coupling Header does (the store is a module singleton reachable from anywhere).
- `src/lib/components/organisms/MobileTabBar.svelte:79` VERIFIED (R4) — `<nav class="flex items-center justify-center gap-1">` row of pills, rendered inside Header at `Header.svelte:620`. NOT a bottom bar; no `position: fixed`, no `bottom-0`, no own z-index. The Round-4 brief's "FAB slides through the MobileTabBar" premise is corrected in §4.12.6.
- `src/routes/(tabs)/+layout.svelte:108` VERIFIED (R4) — reads `window.scrollY` (the list routes scroll the window; not under `fixed-viewport`). The default scroll listener at `scroll-chrome.svelte.ts:145-146` (`window.addEventListener('scroll', ...)`) therefore fires on `/`, `/activity`, `/messages/inbox` and drives `scrollChrome.translateY`. The FAB's `p` derivation tracks.
- `src/lib/components/organisms/MobileTabBar.svelte:91` VERIFIED — active pill `bg-neutral-content/15 text-accent`. The pill background is `bg-neutral-content/15`; the active icon/text color is `text-accent`.
- `src/lib/actions/swipe.ts:71-81,366,416` VERIFIED — `isInteractive` returns true for `[data-gesture-disabled], [data-no-swipe]` ancestors (line 73); 40px left/right edge dead-zone (line 366); `isInteractive` is consulted in the deciding phase (line 416) so a drag starting on a `[data-no-swipe]` element yields and the pager does not claim it.
- `src/lib/utils/gesture-constants.ts` VERIFIED — `HEADER_MORPH_THRESHOLD = 0.2`, `PILL_EXPANSION_THRESHOLD = 0.5`, `TRACK_TRANSITION_MS = 200`.
- `src/app.css:52-55,244-294` VERIFIED — `--color-accent: #ffee88`, `--color-neutral: #111`, `--color-accent-content: #111`, `--color-neutral-content: #ffffff`. `html.fixed-viewport` locks html/body via `position: fixed; top:0; left:0; right:0; bottom:0; overflow:hidden` (lines 244-255). A `position: fixed` descendant of AppShell still anchors to the viewport under this lock (the lock fixes the html/body box, not the containing-block semantics for fixed descendants of a non-transformed ancestor).

### 3.3 Visual tokens (VERIFIED)

The owner's brief maps the FAB colors to the ActionBar (MobileTabBar) styling. Precise mapping against verified source:

- **FAB background** = active pill icon color = `text-accent` → `--color-accent: #ffee88`. Token: `bg-accent`.
- **FAB icon color** = ActionBar's own background = `bg-neutral` → `--color-neutral: #111`. `--color-accent-content: #111` is the daisyUI accent-content pairing and resolves to the same value. Token: `text-accent-content`.
- **FAB shadow** = ActionBar's shadow = `shadow-md` (Header mobile wrapper, line 572).
- **FAB shape** = `rounded-full` (circular).

### 3.4 z-index ladder (VERIFIED, post-R1)

| Layer                          | z-index  | Source                                  |
| ------------------------------ | -------- | --------------------------------------- |
| MobileTabPager viewport        | auto     | in-flow under DualColumnLayout main     |
| Pager right-edge reserve strip | z-30     | `(tabs)/+layout.svelte:132`             |
| LoadingChip overlay (GPL)      | z-30     | `GesturePageLayout.svelte` chip section |
| Header                         | z-40     | `Header.svelte:568` (`sticky z-40`)     |
| Drawer scrim + drawer panel    | z-50     | `DualColumnLayout.svelte:300,318`       |
| **FloatingActionButtonLayer**  | **z-35** | AppShell (sibling of Header)            |

z-35 places the FAB above list content and the GPL loading-chip (z-30), below the Header (z-40, never visually overlaps since FAB is bottom-right and Header is top), and below the drawer (z-50) so opening the drawer covers it. The FAB at `bottom-1rem right-1rem` overlaps the right-edge reserve strip (`z-30 w-8 inset-y-0`) horizontally at the corner; the strip is `pointer-events: none` for taps (it exists only for the OS back-gesture), so the overlap does not steal FAB taps.

## 4. Design

### 4.1 Placement: AppShell, sibling to Header (R1 B1 fix)

**Decision: `FloatingActionButtonLayer` is rendered by `AppShell.svelte`, as a sibling of `Header`.** The root layout already mounts AppShell specifically so Header survives navigation across the `(tabs)` branch and standalone pages; the FAB layer rides the same lifecycle. The layer is therefore mounted on `/`, `/activity`, `/messages/inbox`, `/discussion/*`, `/messages/[id]`, `/post/discussion`, `/messages/new`, and every other non-`/entry` route. It NEVER unmounts during list↔thread↔compose nav.

The layer is mobile-only via a CSS gate (`md:hidden` on the layer root), matching Header's mobile mechanism. No JS `isMobile` read; this removes the Round-0 SSR-vs-post-hydration FAB-pop issue (the `(tabs)` layout's `isMobile = $state(data.isMobile ?? false)` flipped in onMount, which would have popped the FAB without an entry animation on deep-link-to-list).

The layer reads:

- `page.url.pathname` (from `$app/state`, available in AppShell).
- `getMobilePagerStore()` (reachable via the module fallback set by `initMobilePagerStore()` in the root layout; no `getContext` hazard across the route boundary).
- `getNavigationStore()` for the cross-tab chip-exit contract (§4.7).

The `(tabs)/+layout.svelte` receives NO FAB edit. The `(tabs)` mobile branch continues to render only `DualColumnLayout` + `MobileTabPager` + the right-edge reserve strip.

### 4.2 The signal problem (central design finding)

The symmetric formula `scale = clamp(2·foregroundFraction − 1, 0, 1)` requires `foregroundFraction` to be **continuous during the 200ms snap**, not only during the drag. Verified source shows BOTH candidate store fields are discontinuous at snap:

- **`fractionalIndex`** jumps to the integer target the instant `dragOffset` resets to `null` (MobileTabPager.svelte:87 with `dragOffset ?? 0`; GesturePageLayout.svelte:353 with `progressVal` from `snapIndex`). The CSS transition animates the track transform; the store value does not.
- **`backMorph`** publishes `backMorph: 1` immediately on commit (GesturePageLayout.svelte:398), not tweened. AND it is permanently `null` for the FAB-critical centerTab routes (§3.2).

If the FAB scale reads either store field directly, it teleports at commit. A continuous signal must be derived by sampling the live track transform during the CSS transition (mirroring `startPendingNavPoll`, §3.2).

### 4.3 Transition taxonomy and signal sources (R1 B2, B4 fix)

There are exactly three transition families. Each has a different signal source:

**Family A — Tab swipe or tab tap (route stays inside `(tabs)`).** The MobileTabPager track animates (`transition-transform duration-200`) during both drag-release snap and `switchTo()` tap. `fractionalIndex` is continuous during drag (dragOffset feeds it 1:1) and step-valued during snap. **Signal:** a rAF sampler on the MobileTabPager track transform, armed at commit and disarmed at `transitionend` or wall-clock cap. The FAB-scale for tab N reads `tabFraction(N) = clamp(1 − |sampledFractionalIndex − N|, 0, 1)`.

**Family B — Thread/conversation enter or exit (route crosses the `(tabs)` ↔ top-level boundary, but a GesturePageLayout is mounted on the destination).** VERIFIED: on forward list→thread enter, `shouldAnimateEnter()` returns true and the GPL track animates from the list-preview position to the thread position over 200ms (snapIndex 0→ACTIVE via rAF, CSS transition animates the track, §3.2). On back-swipe thread→list, the GPL track animates from thread position toward the list-preview position. In BOTH directions the GPL writes the primary pager store (`fractionalIndex`, `dragging`) and its track transform is animating. **Signal:** a rAF sampler on the GesturePageLayout track transform. The list's foreground fraction during a thread transition is `1 − threadCoverProgress`, where `threadCoverProgress ∈ [0,1]` is derived from the GPL track's sampled position (0 = list fully visible, 1 = thread fully covers).

**Family C — Compose route-swap (route crosses into `/post/discussion` or `/messages/new`).** VERIFIED: neither page imports GesturePageLayout or MobileTabPager. There is no pager, no track, no animating transform. There is no signal to sample. **Signal:** P2 — a CSS/Svelte transition on the FAB scale itself, armed on `beforeNavigate` (when leaving a list route toward a compose route) and `afterNavigate` (when returning). The FAB atom has `transition: transform 200ms ease-out` and the layer swaps a `data-fab-state` attribute (`visible` ↔ `hidden`) mapped to `scale(1)` and `scale(0)`.

P2 is correct ONLY for family C. P1 (rAF sampler) is correct for A and B because the track is already animating under a CSS transition and the sampler follows its rendered m41, inheriting the same easing for free (no double-animation). P2 in family A or B would make the FAB scale run on a second, unsynchronized clock and would not stay locked to the gesture.

**Continuity at family boundaries.** A tab swipe that crosses into a thread route (Family A→B) hands off across the route swap. The MobileTabPager unmounts (its writer clears the module track store), the destination GesturePageLayout mounts and begins its enter animation (its writer sets the module track store to its own track). The two events are NOT frame-synchronized: there is a gap where the old track has unbound and the new track has not yet bound. The sampler arms when the module store's track becomes non-null and disarms when it goes null. During the no-track gap the scale holds its last value. This is sound because a route swap that crosses the family A→B boundary does not happen mid-gesture on the lost track: the gesture commits, THEN the route swaps. So at the moment the old track unbinds the gesture had already settled, and the held value is the post-commit resting fraction. The new track's enter animation then drives the FAB scale through its own Family-B shape.

### 4.4 foregroundFraction model

`foregroundFraction` for a given list is derived per the active family:

- **Family A (tab surface):** `tabFraction(i) = clamp(1 − |sampledFractionalIndex − i|, 0, 1)`. Discussions FAB reads `tabFraction(0)`; Messages FAB reads `tabFraction(2)`. Activity (tab 1) has no FAB.
- **Family B (thread/conversation overlay):** the list's foreground fraction is `1 − threadCoverProgress`, where `threadCoverProgress` is derived from the GPL track's sampled position. At rest on the list, `threadCoverProgress = 0` → fraction 1. At rest on the thread, `threadCoverProgress = 1` → fraction 0. During enter/exit, the sampler interpolates.
- **Family C (compose):** `foregroundFraction` is driven by the P2 CSS transition on the FAB scale itself (no separate fraction field; the scale transition IS the fraction).

**Route gating (R1 B2 fix):** the layer decides which family governs and which FAB (if any) renders from `page.url.pathname` via a new runes-free util `src/lib/utils/fab-routes.ts`:

```ts
export function isOverlayRoute(pathname: string): boolean {
	// Thread or conversation route (covers the list with an overlay).
	return /^\/discussion\//.test(pathname) || /^\/messages\/\d/.test(pathname);
}
export function isComposeRoute(pathname: string): boolean {
	return pathname === '/post/discussion' || pathname === '/messages/new';
}
export function isDiscussionsListRoute(pathname: string): boolean {
	return pathname === '/';
}
export function isMessagesListRoute(pathname: string): boolean {
	return pathname === '/messages/inbox';
}
```

These are evaluated in priority order in the layer: `isOverlayRoute` → scale 0 (no FAB); `isComposeRoute` → scale 0 (no FAB); `isDiscussionsListRoute` → Discussions FAB; `isMessagesListRoute` → Messages FAB; otherwise → no FAB. The `overlayActive` predicate is evaluated BEFORE any tab-index consultation, so a deep-link to `/discussion/<id>` SSRs with the FAB at scale 0 (no flash of 1) even though `getCurrentTabIndex('/discussion/<id>') === 0`.

### 4.5 The sampler and its placement (R2 B1 fix — module-singleton track store)

The sampler lives ENTIRELY inside FAB-named code. The active track element reaches the sampler via a module-level reactive store that mirrors the codebase's existing pager/nav store pattern (the pattern that ALREADY makes the pager and nav stores reachable from AppShell without `getContext`).

Verified pattern (`src/lib/stores/mobile-pager.svelte.ts:89-120` and `src/lib/stores/navigation.svelte.ts:264-295`):

- A closure-scoped `$state` holding the value.
- A module-level fallback variable (`globalMobilePagerFallback` / `globalNavStoreFallback`) and a `window.__primaryPager` / `window.__navStore` mirror.
- An `initX()` function that runs `setContext` AND assigns the module fallback AND the `window.__` slot, called once from `+layout.svelte:42-44`. (The new track store does NOT use `setContext` — see below — because the consumer is an ancestor of the writers. It reuses only the module-fallback + `window.__` + init-at-root + getter portions of the pattern.)
- A `getX()` function that tries `getContext` and falls back to the module singleton, so callers outside the component tree (or, critically, in an ancestor of the writer) can still reach the live value.

The reactive read works exactly the way `getMobilePagerStore().fractionalIndex` in a `$derived` tracks: the getter reads the closure `$state`, Svelte's reactivity sees the read, and the dependent `$derived` / `$effect` re-runs when the `$state` changes.

**New store:** `src/lib/stores/active-gesture-track.svelte.ts` mirrors this pattern for a single live `HTMLElement | null`:

- Module-scoped `let activeTrack = $state<HTMLElement | null>(null)` and a `let globalActiveGestureTrackFallback` / `window.__activeGestureTrack` mirror.
- `initActiveGestureTrack()` runs once from `+layout.svelte:42-44` alongside the existing `initNavigationStore()` / `initMobilePagerStore()` / `initSearchPagerStore()` calls.
- `setActiveGestureTrack(el: HTMLElement)` and `clearActiveGestureTrack()` writers (the descendants call these on bind / destroy).
- `getActiveGestureTrack(): HTMLElement | null` getter that returns the closure `$state`, so a `$derived`/`$effect` reading it tracks.

`getContext` / `setContext` are NOT used for this value, because the FAB layer in AppShell is an ANCESTOR of the track-owning descendants and Svelte context flows parent → child only (`node_modules/svelte/types/index.d.ts:497,503,512`: "available to children of the component"; `node_modules/svelte/src/internal/client/context.js` walks the `.parent` chain upward). The module singleton is the only mechanism consistent with the existing pager/nav reachability story.

**Writers (descendants):**

- `MobileTabPager.svelte` gains `let trackEl = $state<HTMLElement | null>(null)` + `bind:this={trackEl}` on the line-347 track div (currently the only `bind:this` in the file is `deepPreviewEl` at line 401; the track div has no binding), and calls `setActiveGestureTrack(trackEl)` in a `$effect` that reads `trackEl`, and `clearActiveGestureTrack()` in `onDestroy` (browser-guarded per memory `svelte-ondestroy-runs-in-ssr`). 4 lines (declaration + bind + set + clear), not 1.
- `GesturePageLayout.svelte` already has `let trackEl = $state<HTMLElement | null>(null)` (line 250) and `bind:this={trackEl}` (line 918); it adds only `setActiveGestureTrack(trackEl)` in the existing bind `$effect` and `clearActiveGestureTrack()` in `onDestroy`. 1 publication line plus the matching clear.

**Reader (FAB layer):**

`FloatingActionButtonLayer.svelte` reads `const track = $derived(getActiveGestureTrack())` (or the same read inside a `$effect`) and runs the rAF sampler against `track` when non-null. The sampler writes only to the FAB-scale store (a leaf writer). No pager store is mutated. The sampler is armed/disarmed by a `$effect` that reads `pager.dragging` (Family A/B drag ongoing) and a `committed` flag derived from `pager.fractionalIndex` settling (Family A/B snap ongoing); it does NOT write `snapFraction` synchronously inside that `$effect` (memory `svelte-effect-fetch-loop`). The arm/disarm effect is plain `$effect` (not `$effect.pre`) to avoid the same-flush re-run risk (memory `svelte-effect-pre-same-flush-rerun`). [UNVERIFIED — Round 3 auditor to confirm empirically that the plain `$effect` does not same-flush re-arm and strand a sampler.]

Retarget sequencing across a route swap is specified in §4.3: the sampler arms when the store's track becomes non-null and disarms when it goes null; during the no-track gap the scale holds its last value.

### 4.6 The FAB-scale store (R2 simplification — one sampler, per-FAB derivation)

A single sampler in the FAB layer reads the active track (the module store from §4.5) and writes one continuous `sampledFractionalIndex` per frame. Each FAB derives its own scale from that single source via the pure function in `src/lib/utils/fab-scale.ts`:

- `tabFraction(sampledFractionalIndex, tabIndex) = clamp(1 − |sampledFractionalIndex − tabIndex|, 0, 1)` (Family A: tab surface coverage of tab `tabIndex`).
- `threadCoverProgress = pxToFraction(m41, trackEl.offsetWidth)` (Family B: GPL track position; list foreground = `1 − threadCoverProgress`).
- `scaleFromFraction(f) = clamp(2 · f − 1, 0, 1)`.

Per-FAB `foregroundFraction` is the per-family fraction above (Family A reads `tabFraction(sampledFractionalIndex, tabIndex)`; Family B reads `1 − threadCoverProgress`). The per-surface store from Round 1 is dropped: it was over-specified because the route gate in §4.4 already selects which FAB renders, and the per-FAB derivation is pure. There is no second writer ambiguity because there is one sampler and one reader-selected FAB.

The FAB-scale store `src/lib/stores/fab-scale.svelte.ts` still exists as a thin reactive holder for the layer's currently-active `scale` (so the atom re-renders on sampler output) and for the Family-C `composeFraction` (driven by the P2 CSS transition's `data-fab-state` swap, not the sampler). `foregroundFraction = dragging ? dragFraction : samplerActive ? snapFraction : composeActive ? composeFraction : (routeIsList ? 1 : 0)`.

The pure functions (`tabFraction`, `scaleFromFraction`, `pxToFraction`) are runes-free so unit-testable under `bun test` (memory `bun-test-no-runes-loader`).

### 4.7 Cross-tab chip-exit contract (R2 navInFlight gap fix)

When a cross-tab tap routes through the GPL LoadingChip overlay (`cross-tab-exit-preview-wrong`), no list is foreground and the chip (z-30) covers the pager. The FAB at z-35 would render ABOVE the chip. Contract: the layer reads `getNavigationStore()` and forces `scale = 0` DIRECTLY (not via `foregroundFraction`) while `navStore.pendingNav !== null || navStore.navInFlight`.

The OR form is required because `executePendingNav` (`navigation.svelte.ts:191-219`) clears `#pendingNav` (line 194) and sets `#navInFlight = true` (line 195) BEFORE `goto`/`history.back` resolves, and `handleAfterNavigate` (line 131-137) is what clears `#navInFlight = false` (line 133). Between `executePendingNav` and `afterNavigate`, `pendingNav === null` but `navInFlight === true` and the chip preload is still in flight. `GesturePageLayout.svelte:99-100,371-372` already uses exactly this OR form; the FAB layer mirrors it.

VERIFIED both fields exposed: `navigation.svelte.ts:95-97` (`get navInFlight`) and `:103-105` (`get pendingNav`). The layer short-circuits to `scale = 0` (does not route through `foregroundFraction`) because the source-list fraction is still 1 during a chip exit and would otherwise keep the FAB visible above the chip.

### 4.8 z-index, fixed-viewport interaction, and gesture safety (R2 deferred items resolved)

- **z-index under AppShell stacking context.** AppShell's root `<div class="flex min-h-screen flex-col">` is the stacking-context host. The FAB layer is `position: fixed; bottom: 1rem; right: 1rem; z-index: 35` as a sibling of Header. Under `html.fixed-viewport`, html/body are `position: fixed` (app.css:244-255), which fixes the html/body BOX; a `position: fixed` descendant of a non-transformed ancestor still anchors to the viewport, so the FAB stays pinned at bottom-right on locked-viewport routes. **Existence proof:** `Header.svelte:568,572` is `sticky top-0 z-40` at the SAME AppShell DOM level (sibling of the FAB layer) and does not drift under the fixed-viewport lock. If a device test contradicts this for `position: fixed` specifically, the layer portals to `document.body` (fallback noted, not the default path).
- **Right-edge reserve strip.** The strip (`z-30 w-8 inset-y-0`, `(tabs)/+layout.svelte:132`) is `pointer-events: none`-equivalent for taps (it exists for the OS back-gesture). The FAB at `right-1rem` overlaps its corner; the FAB's `onclick` wins because the strip does not handle pointer events. The FAB carries `data-no-swipe` (swipe.ts:73) so a horizontal drag starting on the FAB yields and the OS back-gesture takes over.
- **`onclick`.** `onclick` calls `goto(target)`; no `stopPropagation`. A tap is a single pointerdown+up with no horizontal move, so `suppressNextClick` is never armed.
- **`pointer-events` when scaled out OR translated off-screen.** The FAB atom uses a derived class `pointer-events-none` when `scale < 0.01 || p >= 0.99` (the second condition is the R4 translateY gate; see §4.12.7). Not a per-frame inline mutation. `aria-hidden` mirrors the combined condition.

### 4.9 Timing / easing parity

For Families A and B, the FAB scale reads the rAF sampler. `transition: none` is set on the FAB transform while `dragging || samplerActive`. The sampler reads the live `getComputedStyle(trackEl).transform` m41 each tick; the track's transform is itself eased by the CSS `transition-transform duration-200`, so the FAB scale's easing is automatically the CSS easing of the track. No double-animation. No separate CSS transition on the FAB transform during drag/snap.

For Family C (compose), the FAB transform HAS a CSS transition (`transform 200ms ease-out`) and the layer swaps `data-fab-state` on `beforeNavigate`/`afterNavigate`. This is the only family where the FAB scale runs on its own CSS clock; it is acceptable because there is no sibling track to synchronize with.

At rest (`!dragging && !samplerActive && !composeActive`), `foregroundFraction` is constant (1 when the list is foreground, 0 otherwise) and the FAB transform is held with `transition: none` (Families A/B) or the resting `data-fab-state` class (Family C).

### 4.10 Lifecycle / gotchas (from memory)

- **`$effect`-mutates-tracked-state loop** (`svelte-effect-fetch-loop`): the sampler writes `snapFraction` inside a rAF callback, NOT inside a `$effect` that reads `fractionalIndex`. The arm/disarm `$effect` reads `dragging` and the `committed` flag and starts/stops the rAF; it does not write `snapFraction` synchronously.
- **Lazy-getter mutation** (`svelte-state-unsafe-mutation-lazy-getter`): the FAB-scale store's `scale` getter is pure (reads `dragFraction`/`snapFraction`/`composeFraction`); no mutation inside the getter.
- **`$effect.pre` same-flush re-run** (`svelte-effect-pre-same-flush-rerun`): the arm/disarm `$effect` is plain `$effect` (not `.pre`); verify empirically it does not same-flush re-arm and strand a sampler.
- **Resize mid-transition** (`resize-strands-snapindex-at-zero`): the sampler reads the live track width each frame (m41 is in px); a resize during snap changes the target px, but the sampler compares against the live target, not a captured one. The FAB scale follows m41, which already accounts for the new width. The layer unmounts on `md:` (CSS) when resized to desktop, so no orphan FAB persists on desktop.
- **HMR** (`svelte-script-module-cache-survives-hmr`): the sampler rAF id is held in component-local `$state` and cancelled in `onDestroy`. HMR disposes the component and the rAF is cancelled.
- **`onDestroy` runs in SSR** (`svelte-ondestroy-runs-in-ssr`): the rAF teardown in `onDestroy` is guarded with `browser` from `$app/environment` so it does not touch `cancelAnimationFrame` during SSR.
- **Deep-link to a thread**: AppShell mounts the FAB layer on `/discussion/<id>`. `isOverlayRoute('/discussion/<id>')` returns true → scale 0, no FAB rendered. SSR renders scale 0 (the path predicate is runes-free and runs server-side). No flash of 1.
- **Deep-link to a list** (`/`): AppShell mounts the FAB layer on `/`. `isDiscussionsListRoute('/')` returns true → Discussions FAB at scale 1. Because the layer is CSS-gated (not JS `isMobile`), there is no onMount flip and no post-hydration pop.
- **Back-swipe thread→list preview**: during the back-swipe, the GPL track sampler drives `threadCoverProgress` from 1 toward 0; the Discussions FAB scales in over the second half of the back-swipe. The list preview's own FAB is the same atom (single layer in AppShell), so there is no duplicate.

### 4.11 Organic integration (R2 — honest shared-primitive impact)

FAB-specific code (the atom, the layer, the FAB-scale store, the `fab-routes.ts` util, the `fab-scale.ts` pure functions) lives in FAB-named files. The integration into shared primitives is owned honestly, not framed as a general capability:

- `MobileTabPager.svelte` gains `let trackEl = $state<HTMLElement | null>(null)`, `bind:this={trackEl}` on the line-347 track div, `setActiveGestureTrack(trackEl)` in the bind `$effect`, and `clearActiveGestureTrack()` in `onDestroy`. The publication's ONLY consumer in this revision is the FAB sampler. No plausible second consumer exists: `GesturePageLayout.startPendingNavPoll:538-586` samples its own closure `trackEl` and would not migrate to the module store.
- `GesturePageLayout.svelte` adds only `setActiveGestureTrack(trackEl)` in the existing bind `$effect` and `clearActiveGestureTrack()` in `onDestroy` (its `trackEl` already exists at line 250/918).
- `AppShell.svelte` gains ONE line: render `<FloatingActionButtonLayer t={t} />` as a sibling of `<Header>`.
- `scroll-chrome.svelte.ts` gains ONE line (R4 revision, §4.12.2 path 2): a `get headerHeight() { return headerHeight; }` getter on the object returned by `getScrollChromeStore()` at `:210-232`, mirroring the existing `translateY` getter at `:215-217`, reading the closure `$state(56)` at `:65`. The ONLY consumer in this revision is the FAB's `p` derivation (`p = clamp(-scrollChrome.translateY / scrollChrome.headerHeight, 0, 1)`). `headerHeight` is a GENERAL scroll-chrome field, not an FAB token: the store's own docstring at `:9-11` describes it as "the current viewport's header height" attributed to Header's ResizeObserver, and `setHeaderHeight` (the writer, at `:185-190`) is already part of the public surface. Exposing the read parallels the existing `translateY` / `hidden` / `scrolling` / `override` getters.

The audit gate is NOT "zero lines in shared primitives" (impossible given the directional context constraint). The gate is: the diff to each shared primitive contains ONLY the `bind:this` / declaration / publication / clear / getter lines, with NO FAB-named tokens imported or referenced. "No FAB-named tokens" means the strings `fab`, `post`, `messages`, `discussions` do not appear in any new line added to `MobileTabPager.svelte`, `GesturePageLayout.svelte`, `swipe.ts`, `tab-config.ts`, `mobile-tabs.ts`, `navigation-logic.ts`, `navigation.svelte.ts`, `scroll-chrome.svelte.ts`, `Header.svelte`, `MobileTabBar.svelte`, `AppShell.svelte`. For `scroll-chrome.svelte.ts` specifically, the gate is "diff shows ONLY the `get headerHeight() { return headerHeight; }` getter mirroring `translateY` at `:215-217`, no FAB tokens" (R4 revision; the path-1 "diff empty" framing was dropped as a misread of the R3 organic-clean gate — see §4.12.2 and `docs/DV09-Meeting/DV09-Audit-R4.md`). The new module store `active-gesture-track.svelte.ts` is named for the gesture concept (the live track of the active gesture surface), not for the FAB, and lives in `src/lib/stores/` alongside the pager/nav stores that already follow this exact pattern.

DV08 "clean" re-argued against this honest statement: clean = no feature-named tokens enter shared primitives. The publication mechanism is a general store (named for the gesture surface, not the FAB) that happens to have one consumer; that is the same shape as `scroll-chrome.svelte.ts` (a general scroll-tracking store with specific consumers) and the pager/nav stores themselves. The Round-1 "general capability" post-hoc framing is dropped.

### 4.12 Scroll-driven translateY (R4 spec change: hide-on-scroll echoing the Header)

The FAB now hides on scroll-down and reappears on scroll-up, mirroring the Header. The route-transition scale driver (§4.4 / §4.6) is UNCHANGED. The two drivers compose as ONE transform property.

#### 4.12.1 The composed transform

The FAB atom applies a single `transform: scale(s) translateY(y)` where:

- `s = clamp(2 · foregroundFraction − 1, 0, 1)` (the existing R3 formula; UNCHANGED).
- `y = p · (fabHeight + bottomClearance)` (NEW; downward px offset; positive = slides off the bottom).

A single composed `transform` (not two `transform` declarations) is mandatory: CSS allows only one `transform` per rule and the second would overwrite the first. The atom binds `style:transform` to one derived string `scale(${s}) translateY(${y}px)`, exactly as Header binds its single `style:transform="translateY({translateY}px)"` at `Header.svelte:570`.

#### 4.12.2 The scroll signal: read scroll-chrome, mirror Header

The layer reads the existing `scroll-chrome` module-singleton store, exactly as Header does at `Header.svelte:57` (`const scrollChrome = getScrollChromeStore();`) and `:62` (`const translateY = $derived(scrollChrome.translateY);`). No new store. Reading it in a `$derived` tracks the closure `$state` the same way Header's does (R3 reactivity proof in §4.5 covers this read pattern: closure `$state` read through a getter inside a `$derived` re-runs on write).

Verified source for the FAB's two inputs:

- **`scrollChrome.translateY`** is an exposed reactive getter: `scroll-chrome.svelte.ts:215-217` (`get translateY() { return translateY; }`, reading the closure `let translateY = $state(0)` at line 61). VERIFIED.
- **`scrollChrome.headerHeight`** is an exposed reactive getter (R4 revision, path 2): the object returned by `getScrollChromeStore()` at `scroll-chrome.svelte.ts:210-232` gains ONE line, a `get headerHeight() { return headerHeight; }` getter mirroring the existing `translateY` getter at `:215-217`, reading the closure `let headerHeight = $state(56)` at `:65`. The FAB reads `scrollChrome.headerHeight` directly. NO `getComputedStyle`, NO `--header-height` read, NO caching logic.

**Why path 2 (the `headerHeight` getter), not path 1 (read `--header-height` via `getComputedStyle`).** Round 4 audit (3/5 PASS, 2/5 FAIL, all 5 convergent) identified path 1 as wrong on three independent grounds:

1. **CSS custom properties are NOT Svelte-reactive.** `getComputedStyle(document.documentElement).getPropertyValue('--header-height')` is an untracked read. The FAB's `$derived` re-runs only because `scrollChrome.translateY` is also tracked; the Header height is read as a side value, not via a reactive contract.
2. **PERF antipattern.** If read inside the per-scroll-frame `$derived` it forces a style recalc + layout sync on `<html>` every scroll frame. A sound cache invalidation signal would require a `ResizeObserver` on `headerEl`, which `Header.svelte:529-540` ALREADY runs (calling `setHeaderHeight` AND writing `--header-height` in the same callback). Path 1 forces a redundant duplicate observer OR accepts stale `headerHeight` across a Header resize. `Header.svelte:570` itself uses NO per-frame `getComputedStyle`; path 1 would be the only call in the scroll hot path.
3. **The R3 organic-clean gate is misread.** Per `DV09-Audit-R3.md` "Organic integration — CLEAN", the gate is **"no FAB-named tokens (`fab` / `post` / `messages` / `discussions`) enter shared primitives"**, NOT "zero diff to `scroll-chrome.svelte.ts`". `headerHeight` is a general scroll-chrome concept; the store's own docstring at `scroll-chrome.svelte.ts:9-11` describes it as "the current viewport's header height" and explicitly attributes it to Header's ResizeObserver. Exposing it as a getter adds NO FAB token. This is the same honest form R3 endorsed for the `active-gesture-track` store.

**SSR / first-paint.** `headerHeight` is seeded `$state(56)` at `scroll-chrome.svelte.ts:65`, so the getter returns 56 until Header's ResizeObserver fires `setHeaderHeight` with the real value (typically 56 on mobile, taller on desktop). Division by `headerHeight` is defined from first paint. No empty-string → NaN edge (the path-1 failure mode where `--header-height` may not yet be written). On SSR `headerHeight === 56` so the FAB's `p` derivation returns 0 (no scroll) and the FAB rests at `translateY(0)`.

Full audit detail and the 5 verdicts: `docs/DV09-Meeting/DV09-Audit-R4.md`.

#### 4.12.3 The hide-progress derivation

```
p = clamp(-scrollChrome.translateY / scrollChrome.headerHeight, 0, 1)
y = p · (fabHeight + bottomClearance)
```

Both `scrollChrome.translateY` and `scrollChrome.headerHeight` are reactive getters on the same `scroll-chrome` store (`:215-217` and the R4-added `headerHeight` getter at `:210-232` respectively). A `$derived` reading both re-runs on either write.

- `scrollChrome.translateY ∈ [-headerHeight, 0]` (Header fully shown → 0; Header fully hidden → `-headerHeight`; verified clamp at `scroll-chrome.svelte.ts:108-112`). So `-translateY / headerHeight ∈ [0, 1]`.
- `p = 0` → Header visible → FAB at rest (`y = 0`, no translateY).
- `p = 1` → Header fully hidden → FAB fully off the bottom (`y = fabHeight + bottomClearance`).
- The intermediate values interpolate linearly: as the Header slides up by N px, the FAB slides down by `N · (fabHeight + bottomClearance) / headerHeight` px. The two motions are in lockstep because they share the same source store.

#### 4.12.4 Why scale + translateY is orthogonal (no precedence rule, no conflict)

`scale` and `translateY` are independent CSS transform components applied to the SAME element in a SINGLE `transform` declaration. They compose on different dimensions of the matrix:

- `scale(s)` multiplies both axes uniformly around the transform origin (center, by default).
- `translateY(y)` shifts the rendered box along the viewport Y axis.

A scale does not consume or cancel a translate and vice versa; the order in the string only affects the origin reference frame (translate-then-scale vs scale-then-translate), and for a centered FAB the visual difference is negligible. The route-transition driver (`foregroundFraction` → `s`) and the scroll driver (`scrollChrome.translateY` → `y`) therefore NEVER contend for the same axis. This is the whole reason the owner chose the translateY approach over a scale-based scroll-hide: a scale-based hide would have to share the `scale` channel with the route-transition `scale`, requiring a precedence rule (which wins when both are mid-flight?) and producing visual coupling between unrelated motions. The orthogonal decomposition removes that class of bug entirely.

#### 4.12.5 The Header's scroll tuning is INHERITED, deliberately

Because the FAB's `p` is derived from `scrollChrome.translateY`, the FAB inherits EVERY behavior the Header exhibits:

- `TOP_THRESHOLD = 8` (`scroll-chrome.svelte.ts:58`): near the top, the FAB is always shown.
- Direction hysteresis via the `translateY` accumulator (line 107-114): partial scrolls leave the FAB partially translated, not snapped.
- `holdThroughNavigation` / `releaseNavigation` (line 196-208): programmatic scrolls (hash-enter, swipe-back restore) hold the FAB in place; `releaseNavigation` calls `show()` which pins both Header and FAB at rest.
- `frozen` (line 74): during a frozen navigation the FAB's `p` is held, not re-evaluated.

This is DESIRABLE, not a defect. The intent is to echo the Header's motion in sync; if the Header holds, the FAB holds; if the Header snaps, the FAB snaps. The FAB does NOT introduce its own scroll logic and does NOT re-derive thresholds.

#### 4.12.6 Tab-bar / bottom-edge geometry (verification-corrected)

The Round-4 brief's "FAB slides through the MobileTabBar region" item is based on a false premise. VERIFIED: `MobileTabBar` (`src/lib/components/organisms/MobileTabBar.svelte`) renders a `<nav>` row of pills (line 79) that is INCLUDED IN THE HEADER at `Header.svelte:620`. It is NOT a bottom tab bar; it has no `position: fixed`, no `bottom-0`, and no z-index of its own. There is no bottom tab bar anywhere in the codebase (`rg "fixed.*bottom|bottom-nav"` over `src` returns zero matches in navigation chrome; the only `bottom-0` hits are admin drag-handles and the search-scope underline).

Consequence: the FAB at rest sits at `bottom: 1rem; right: 1rem` (§4.8) with nothing below it but the viewport edge. The slide-down takes the whole button + shadow past the viewport bottom; there is no sibling bottom chrome to occlude or be occluded by. The resting `bottomClearance` is just the 1rem inset (no tab-bar height to add). `fabHeight + bottomClearance` for `size-14` (56px) FAB is `56 + 16 = 72px`, so `y ∈ [0, 72]`.

z-index reconciliation is unchanged from §4.4: the FAB is `z-35`, above list content and the GPL loading-chip (z-30), below the Header (z-40) and the drawer (z-50). Because there is no bottom bar, the slide-down does not interact with any chrome z-index.

[UNVERIFIED — Round 4 auditor to confirm] that the FAB's resting `bottom: 1rem` clears any device safe-area inset at the bottom edge (iOS home indicator). The repo has no `env(safe-area-inset-bottom)` usage today (verified: `rg "safe-area"` returns zero). If a designer requires safe-area clearance, the resting `bottom` becomes `calc(1rem + env(safe-area-inset-bottom))` and `bottomClearance` becomes `1rem + env(safe-area-inset-bottom)`; otherwise the FAB rests at the OS-default bottom inset and the slide-down still clears the viewport.

#### 4.12.7 pointer-events gating (mirror the scale gate, add a translateY gate)

The FAB's existing scale gate (§4.8: `pointer-events: none` when `scale < 0.01`) covers the route-transition-hidden state. A SEPARATE translateY-hidden gate is required so the off-screen button does not intercept touches at the bottom edge:

- `pointer-events: none` when `p >= 0.99` (FAB fully or near-fully translated off-screen).
- This is a derived class on the atom (same pattern as the scale gate), not a per-frame inline mutation.
- `aria-hidden` mirrors BOTH gates: hidden when `scale < 0.01 || p >= 0.99`.

The combined condition: `pointerEventsNone = s < 0.01 || p >= 0.99`.

Because `pointer-events: none` disables hit-testing, "tap FAB while scroll-hidden" cannot occur: by the time the FAB is visibly off-screen (`p >= 0.99`), it is also non-interactive. The button is only tappable when `s >= 0.01 && p < 0.99`, i.e. visible at scale and at its resting translateY.

#### 4.12.8 Edge cases specific to the translateY driver

- **Route-arrival with scroll already past the hide threshold.** When a route restores scroll to a hidden position (e.g. returning to `/` mid-scroll), `scale` animates 0→1 (route arrival) WHILE `translateY` already has `p > 0` (Header already hidden). Because the two are orthogonal, the FAB scale-ins OFF-SCREEN: the scale-up happens at the translated position. This is correct and is the whole point of the orthogonality (§4.12.4); there is no precedence rule to resolve. The FAB then slides in on the next scroll-up.
- **Cross-tab chip-exit / `pendingNav` force-scale-0 (§4.7).** That path sets `scale = 0` directly. At `scale = 0` the FAB is a zero-size point; `translateY` is geometrically irrelevant (a zero-size box translated any distance is invisible regardless). No interaction; the chip-exit path does NOT need to touch `translateY`. Confirmed by the orthogonality argument.
- **Compose route (Family C).** On `/post/discussion` / `/messages/new` the FAB is at `scale = 0` (route gate). `translateY` is irrelevant (same reason). The scroll-chrome read still runs harmlessly; the FAB renders nothing visible.
- **Activity tab (tab 1).** No FAB renders. The scroll-chrome read is a no-op on this route (no consumer of `p`).
- **Scroll during a route transition.** The user can scroll while the snap is animating. `s` updates from the sampler, `y` updates from `scrollChrome.translateY`, both in their own reactivity ticks; the single `transform` string recomputes from both. No lock needed.
- **Resize mid-scroll-hide.** `headerHeight` is read live via the reactive `scrollChrome.headerHeight` getter (`scroll-chrome.svelte.ts:210-232`, reading closure `$state(56)` at `:65`). A resize that changes the Header height re-clamps `scrollChrome.translateY` to the new `[-headerHeight, 0]` range (`setHeaderHeight` at `scroll-chrome.svelte.ts:185-190` re-clamps); the FAB's `$derived` re-runs because both `translateY` and `headerHeight` are tracked reads. `p` recomputes from the new values. No stranded state, no duplicate observer (Header's existing ResizeObserver is the single writer).
- **HMR.** The `scrollChrome` module singleton survives HMR (it is module-scoped `$state`); the FAB's `$derived` re-binds on re-mount. No leak.

## 5. Files

**New:**

- `src/lib/components/atoms/FloatingActionButton.svelte` — circular FAB atom (`btn-circle`-style, `rounded-full`, `size-14`, `bg-accent text-accent-content shadow-md`, `data-no-swipe`, `aria-label`, `onclick`). Accepts `icon`, `href`/`onclick`, `scale` (`s`), and `translateY-hide progress` (`p`) props; binds a SINGLE `style:transform="scale(${s}) translateY(${y}px)"` where `y = p · (fabHeight + bottomClearance)`; derives `pointer-events-none` + `aria-hidden` from `s < 0.01 || p >= 0.99`. Swaps icon by active list.
- `src/lib/components/templates/FloatingActionButtonLayer.svelte` — mobile-only (CSS `md:hidden`) layer rendered by AppShell; reads `page.url.pathname` + primary pager store + navigation store + the active-gesture-track store + the `scroll-chrome` store; derives `s` (foregroundFraction scale) and `p` (R4 scroll-hide progress, §4.12.3); renders zero or one FAB; runs the rAF sampler; gates by `fab-routes.ts` predicates.
- `src/lib/stores/fab-scale.svelte.ts` — reactive holder for the layer's currently-active `scale` (so the atom re-renders on sampler output) and the Family-C `composeFraction`. Pure scale formula `clamp(2·foregroundFraction − 1, 0, 1)`.
- `src/lib/stores/active-gesture-track.svelte.ts` — module-singleton store mirroring `mobile-pager.svelte.ts:89-120` / `navigation.svelte.ts:264-295`: closure `$state<HTMLElement | null>(null)`, `globalActiveGestureTrackFallback` + `window.__activeGestureTrack`, `initActiveGestureTrack()` (called once from root layout), `setActiveGestureTrack(el)` / `clearActiveGestureTrack()` writers, `getActiveGestureTrack()` getter. Named for the gesture concept, not the FAB.
- `src/lib/utils/fab-scale.ts` — pure functions: `tabFraction(fractionalIndex, i)`, `scaleFromFraction(f)`, `pxToFraction(m41, trackWidth)`. Runes-free so unit-testable under `bun test`.
- `src/lib/utils/fab-routes.ts` — pure path predicates: `isOverlayRoute`, `isComposeRoute`, `isDiscussionsListRoute`, `isMessagesListRoute`. Runes-free.

**Modified:**

- `src/lib/components/templates/AppShell.svelte` — render `<FloatingActionButtonLayer t={t} />` once, as a sibling of `<Header>` inside the root `<div>`. One line. No desktop change (layer is `md:hidden`).
- `src/routes/+layout.svelte` — add `initActiveGestureTrack();` alongside the existing `initNavigationStore()` / `initMobilePagerStore()` / `initSearchPagerStore()` calls at lines 42-44. One line.
- `src/lib/components/templates/MobileTabPager.svelte` — add `let trackEl = $state<HTMLElement | null>(null)`, `bind:this={trackEl}` on the line-347 track div, `setActiveGestureTrack(trackEl)` in the bind `$effect`, and `clearActiveGestureTrack()` in `onDestroy` (browser-guarded). 4 lines (declaration + bind + set + clear). No logic change to swipe/commit. No FAB import.
- `src/lib/components/templates/GesturePageLayout.svelte` — add `setActiveGestureTrack(trackEl)` in the existing bind `$effect` and `clearActiveGestureTrack()` in `onDestroy` (browser-guarded). 2 lines (set + clear); the `trackEl` declaration (line 250) and `bind:this` (line 918) already exist. No logic change to swipe/commit/backMorph/centerTab publish. No FAB import.

**Unchanged (verification targets):** `swipe.ts`, `tab-config.ts`, `mobile-tabs.ts`, `navigation-logic.ts`, `navigation.svelte.ts`, `scroll-chrome.svelte.ts`, `Header.svelte`, `MobileTabBar.svelte`, `(tabs)/+layout.svelte`, `DualColumnLayout.svelte`, `+layout.server.ts`, `app.css`. No `/post`, `/messages`, `discussions`, `messages`, or `fab` tokens enter any shared primitive. The root `+layout.svelte` gains ONE line (the `initActiveGestureTrack()` call) and no FAB tokens.

**R4 scroll-chrome read adds ONE getter line to `scroll-chrome.svelte.ts` (§4.12.2 path 2).** The FAB reads `scrollChrome.translateY` (existing getter, `scroll-chrome.svelte.ts:215-217`) AND `scrollChrome.headerHeight` (NEW getter, added in this revision, mirroring `translateY` and reading the closure `$state(56)` at `:65`). It does NOT read `getComputedStyle`, does NOT read the `--header-height` CSS custom property, and does NOT add caching logic. The single getter line is the entire diff to `scroll-chrome.svelte.ts`; per §4.11 it does NOT violate the R3 organic-clean gate (no FAB tokens; `headerHeight` is a general scroll-chrome field per the store docstring at `:9-11`). The store's `hidden`, `scrolling`, `holdThroughNavigation`, `releaseNavigation`, `setScrollContainer`, `setOverride`, `frozen`, `TOP_THRESHOLD` behaviors are INHERITED by the FAB through the `translateY` read (§4.12.5); none of them are re-implemented in FAB code.

## 6. Edge cases & risks

1. **Discontinuity at commit (Families A/B)** — addressed by the rAF sampler on the track transform. If the sampler is delayed by a busy frame, the FAB scale may stutter for one frame at commit; acceptable, matches the track's own animation cadence.
2. **Compose route-swap (Family C)** — no track to sample; P2 CSS transition on the FAB scale. List→compose and compose→list are TWO separate 200ms transitions, not one halved motion. Each transition independently satisfies the symmetric model: the disappear transition runs scale 1→0 over its first 50% (which is the entire disappear) and the appear transition runs scale 0→1 over its last 50% (which is the entire appear). There is no combined list→compose→list motion to halve, so the half/half split is per-transition.
3. **Deep-link to a thread** — `isOverlayRoute` returns true → scale 0, no FAB. SSR-correct. Test: navigate directly to `/discussion/<id>`; assert FAB scale === 0 on first paint.
4. **Deep-link to a list** — CSS-gated layer, no JS `isMobile` flip, no post-hydration pop. Test: navigate directly to `/`; assert FAB visible at scale 1 on first paint (after CSS hydration).
5. **Back-swipe preview (thread→list)** — GPL track sampler drives `threadCoverProgress`; Discussions FAB scales in over the second half. Single layer, no duplicate. Test: back-swipe from thread; sample FAB scale across the gesture; assert scale rises over the second half.
6. **Forward thread-enter (list→thread)** — GPL `shouldAnimateEnter` runs the 200ms track animation; sampler drives `threadCoverProgress` from 0 toward 1; Discussions FAB scales out over the first half. Test: tap a discussion card; sample FAB scale across the snap; assert scale crosses 0.5 at ~50%.
7. **Cross-tab chip exit** — layer reads `navStore.pendingNav !== null || navStore.navInFlight`; forces scale 0 directly while either is true. FAB does not render above the chip.
8. **Forward-swipe into tab then back** (`forward-swipe-into-tab-back-to-source-page`) — Family A; the FAB follows `tabFraction`; on the source list it scales out over the first half of the forward swipe and the destination list's FAB scales in over the second half. On back, the inverse.
9. **Resize mid-transition** — sampler reads live width; covered (§4.10). Layer unmounts via CSS on desktop.
10. **HMR** — sampler rAF cancelled in `onDestroy` (browser-guarded); covered.
11. **Activity tab (tab 1)** — no FAB. `isDiscussionsListRoute`/`isMessagesListRoute` return false on `/activity`; layer renders nothing.
12. **Messages conversation ↔ inbox** — symmetric to Discussions↔thread. `/messages/<id>` matches `isOverlayRoute`; `/messages/new` matches `isComposeRoute`; `/messages/inbox` matches `isMessagesListRoute`.
13. **Drawer open** — drawer z-50 covers the FAB z-35. No special handling.
14. **Soft keyboard (compose page)** — FAB is not on the compose page (Family C scale 0). No keyboard interaction.
15. **`pointer-events` when scale 0** — derived `pointer-events-none` class when `scale < 0.01`; `aria-hidden` mirrors it.
16. **a11y** — `aria-label` per active list ("New discussion" / "New message"); `aria-hidden` when scale 0 OR translateY-hidden (`p >= 0.99`).

**R4 (scroll-driven translateY) edge cases** (see §4.12.8 for the full reasoning):

17. **Route-arrival with scroll already hidden** — `scale` 0→1 animates while `p > 0` already; the FAB scale-ins off-screen (orthogonal composition), then slides in on the next scroll-up. Correct by design.
18. **Cross-tab chip-exit (`pendingNav`/`navInFlight`)** — that path forces `scale = 0`; at scale 0 the translateY is geometrically irrelevant (zero-size box). No interaction; chip-exit does not touch `translateY`.
19. **Compose route (Family C)** — FAB at scale 0; translateY irrelevant. scroll-chrome read is a harmless no-op consumer.
20. **Hold-through-navigation / releaseNavigation** — programmatic scrolls (hash-enter, swipe-back restore) hold the FAB in place via the inherited `frozen`/`show()` behavior; the FAB tracks the Header because it reads the same `$state`.
21. **Resize mid-scroll-hide** — `headerHeight` read live via the reactive `scrollChrome.headerHeight` getter; `setHeaderHeight` re-clamps `scrollChrome.translateY` to the new range; `p` recomputes (both `translateY` and `headerHeight` are tracked reads). No stranded state.
22. **Tap FAB while scroll-hidden** — cannot occur; `pointer-events: none` when `p >= 0.99` disables hit-testing before the FAB is visibly off-screen.

## 7. Testing plan

- **Unit (`bun test`)** — `tabFraction(f, i)` over `f∈[0,2]` asserting continuity and the `clamp(1−|f−i|,0,1)` shape; `scaleFromFraction(f)` asserting `f≤0.5 → 0`, `f≥1 → 1`, linear between; `pxToFraction(m41, w)` asserting `m41=0 → 0`, `m41=−w → 1`; `isOverlayRoute` / `isComposeRoute` / `isDiscussionsListRoute` / `isMessagesListRoute` over the route corpus (including `/discussion/<id>/<slug>/p1`, `/messages/123`, `/messages/new`, `/post/discussion`, `/`, `/activity`, `/messages/inbox`, `/profile/...`). Pure functions only (memory `bun-test-no-runes-loader`: no `$state` under bun:test).
- **E2E (Playwright; NixOS gotchas — system chromium via `executablePath`, CDP touch not `page.mouse`, dedicated webServer port, `__navReady`/`__e2eGoto` gates, zombie-SW neuter)** —
  - Discussions list (`/`): FAB visible at scale 1; tap → `/post/discussion` (Family C scale-out observed).
  - Messages inbox (`/messages/inbox`): FAB visible; tap → `/messages/new`.
  - Activity tab (`/activity`): no FAB.
  - Thread deep link (`/discussion/<id>`): FAB scale 0 on first paint (no flash).
  - Forward nav list→thread (Family B): sample FAB scale across the snap; assert scale crosses 0.5 at ~50% of the transition (first-half disappear).
  - Back nav thread→list (Family B): assert scale crosses 0.5 at ~50% (second-half appear).
  - Tab switch Discussions↔Messages via drag (Family A): each FAB scales continuously; no teleport at commit.
  - Tab switch via snap (tap) (Family A): sampler drives scale across the 200ms; no jump.
  - Drawer open: FAB occluded.
  - Cross-tab chip exit: FAB scale 0 during chip (`pendingNav !== null || navInFlight`).
  - Resize mid-snap to desktop: FAB unmounts (CSS), no orphan.
  - Tap on FAB does not trigger a tab swipe (`data-no-swipe`).
  - FAB does not drift under `html.fixed-viewport` lock (device verify; §4.8).
- **E2E (R4 scroll-driven translateY, §4.12):**
  - Scroll-down on `/`: sample the FAB `transform` `translateY` component across the scroll; assert it rises monotonically from 0 toward `fabHeight + bottomClearance` (72px for `size-14` + 1rem inset) in lockstep with the Header's own `translateY` reaching `-headerHeight`.
  - Scroll-up: assert the FAB `translateY` returns to 0.
  - Tap on FAB is impossible once `p >= 0.99`: assert `pointer-events` is `none` on the FAB atom when the Header is fully hidden (use a CDP `evaluate` to read `getComputedStyle(fabEl).pointerEvents`).
  - Compose route (`/post/discussion`): FAB `transform` is `scale(0) translateY(0)` (or no FAB in DOM); the scroll-chrome read does not render a visible FAB.
  - Cross-tab chip-exit: during `pendingNav !== null || navInFlight`, FAB `transform` is `scale(0)`; `translateY` is whatever the scroll state is (irrelevant at scale 0).
  - Route-arrival with restored scroll: navigate list→thread→list with the list scrolled past the hide threshold; assert the FAB does not flash on-screen at arrival (scale-ins off-screen, then slides in on scroll-up).
- **Audit gates** — `git diff -- swipe.ts` empty; `git diff -- tab-config.ts` empty; `git diff -- mobile-tabs.ts` empty; `git diff -- navigation-logic.ts` / `navigation.svelte.ts` empty; `git diff -- scroll-chrome.svelte.ts` shows ONLY the `get headerHeight() { return headerHeight; }` getter mirroring `translateY` at `:215-217` (no FAB tokens; R4 revision per §4.12.2 path 2 — the prior "diff empty" framing was a misread of the R3 organic-clean gate, see `docs/DV09-Meeting/DV09-Audit-R4.md`); `git diff -- Header.svelte` empty; `git diff -- MobileTabBar.svelte` empty; `git diff -- (tabs)/+layout.svelte` empty; `git diff -- DualColumnLayout.svelte` empty; `git diff -- +layout.server.ts` empty; `git diff -- MobileTabPager.svelte` shows ONLY the `let trackEl = $state`, `bind:this={trackEl}`, `setActiveGestureTrack(trackEl)`, and `clearActiveGestureTrack()` lines (no FAB import, no feature branch, no `fab`/`post`/`messages`/`discussions` string tokens); `git diff -- GesturePageLayout.svelte` shows ONLY the `setActiveGestureTrack(trackEl)` and `clearActiveGestureTrack()` lines; `git diff -- AppShell.svelte` shows ONLY the one `<FloatingActionButtonLayer t={t} />` render line; `git diff -- +layout.svelte` (root) shows ONLY the one `initActiveGestureTrack();` call alongside the existing inits. No `setContext` / `getContext` call referencing `'activeGestureTrack'` appears anywhere in the diff.
- **Audit loop** — 5 agents, cycle until 5/5 unconditional PASS (DV04 pattern). `RV09-C[NN]-Audit-[round].md` + `DV09-C[NN]-Journal.md` per cycle.

## 8. Out of scope

- Desktop FAB (desktop has no pager/gesture; current behavior unchanged).
- FAB-specific scroll tuning that diverges from the Header (the FAB inherits the Header's thresholds via the shared `scrollChrome.translateY` read; introducing independent TOP_THRESHOLD / hysteresis for the FAB is out of scope).
- FAB on the Activity tab or any detail/thread/conversation/compose page.
- FAB icon morph / multi-action (speed-dial) behavior.
- Long-press / drag-to-move the FAB.
- Haptic feedback on tap.
- Owner-confirm item: FAB diameter `size-14` (3.5rem / 56px) matches common Material FAB sizing. Marked for designer confirmation before implementation; if a different diameter is specified, only the `size-*` class on the atom changes.

## 9. UNVERIFIED items for Round 3 (R3 resolved or carried)

- **`$effect.pre` same-flush re-run on the arm/disarm effect.** [§4.5] The arm/disarm effect for the rAF sampler is plain `$effect` (not `$effect.pre`) per memory `svelte-effect-pre-same-flush-rerun`. Static reasoning says a plain `$effect` reading `pager.dragging` and a `committed` flag does not same-flush re-run when those deps are stable. Per the cited memory this MUST be verified empirically (remove the guard, run the e2e sampler) before approval — static "it only tracks X" reasoning failed 3 QA agents in DV06. (R3 carried-to-implementation note (b); re-asserted for R4 because R4 does not touch the sampler.)
- **FAB diameter.** [§3.3, §8] `size-14` (56px) has no precedent in the codebase (`BookmarkButton.svelte:76` uses `btn-circle btn-sm`). Owner/designer confirm BEFORE plan approval; a wrong diameter ships as a visible regression. NOTE: the R4 translateY magnitude `fabHeight + bottomClearance` is computed FROM this diameter, so an owner change to the diameter changes the slide distance in lockstep (no separate tuning).
- **FAB drift under `html.fixed-viewport` (device verify).** [§4.8] Reasoned via the Header existence proof (`Header.svelte:568,572` is `sticky z-40` at the same AppShell DOM level and does not drift). A `position: fixed` FAB sibling at `z-35` should behave the same, but a device test on a locked-viewport route confirms it. Portal to `document.body` is the noted fallback. NOTE: under R4 the FAB's `translateY` is applied via the same `style:transform` on the same fixed element, so the drift question is unchanged.

## 9R4. UNVERIFIED items for Round 4

- **Safe-area inset at the bottom edge.** [§4.12.6] The repo has zero `env(safe-area-inset-bottom)` usage today (verified: `rg "safe-area"` over `src` returns nothing). The resting `bottom: 1rem` and the `bottomClearance = 1rem` in `y = p · (fabHeight + bottomClearance)` may clip the iOS home indicator. Auditor/designer to confirm whether `bottom` should be `calc(1rem + env(safe-area-inset-bottom))`; if so, both the resting offset and the slide distance update together. ACCEPTABLE-DEFERRAL.
- **Tab-bar geometry premise corrected.** [§4.12.6] The Round-4 brief assumed a bottom MobileTabBar; source shows `MobileTabBar` is the top-Header pill row (`Header.svelte:620`), with no bottom bar in the codebase. Auditor to re-confirm there is no other bottom-fixed chrome (e.g. a future bottom nav, an OS-level PWA bar) the FAB would slide through. If one is planned, the slide-down z-index reconciliation and `bottomClearance` must be revisited. ACCEPTABLE-DEFERRAL.

## 9.x Resolved (no longer UNVERIFIED)

- **`setContext` with `$state`-bound `trackEl`.** [Round 1 §9 → resolved Round 2] Moot: the context channel is replaced by a module-singleton store (`active-gesture-track.svelte.ts`). The reactive read is exactly the `getMobilePagerStore().fractionalIndex`-in-a-`$derived` pattern (closure `$state` read through a getter), already proven in the codebase.
- **Cross-tab chip-exit contract.** [Round 1 §4.7 → resolved Round 2] Now `pendingNav !== null || navInFlight` (OR form), matching `GesturePageLayout.svelte:99-100,371-372`. Both fields exposed (`navigation.svelte.ts:95-105`).
- **`--header-height` reliably non-empty at first scroll.** [Round 4 §9R4 → resolved Round 4 revision] Dropped under path 2 (§4.12.2). The FAB reads `scrollChrome.headerHeight` (a reactive getter reading the closure `$state(56)` at `scroll-chrome.svelte.ts:65`), NOT `getComputedStyle(...).getPropertyValue('--header-height')`. Division is defined from first paint (seeded 56) and on SSR (returns 56 → `p = 0`). The path-1 empty-string → NaN edge that motivated this UNVERIFIED item no longer exists.
