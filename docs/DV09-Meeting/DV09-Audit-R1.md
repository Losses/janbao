# DV09 - Audit Round 1

5 independent role-less auditors examined `docs/DV09-Plan.md` against the codebase at `master` (`0a03874`). Result: **0/5 PASS** (all FAIL, high confidence). Each auditor returned the organic verdict `has-special-cases`. Blocking issues summarized below; the convergent diagnosis drove the Round-1 revision.

## Tally

| Auditor | Verdict | Blocking | Concerns | Organic           | Confidence |
| ------- | ------- | -------- | -------- | ----------------- | ---------- |
| 1       | FAIL    | 5        | -        | has-special-cases | high       |
| 2       | FAIL    | 3        | -        | has-special-cases | high       |
| 3       | FAIL    | 2        | -        | has-special-cases | high       |
| 4       | FAIL    | 3        | -        | has-special-cases | high       |
| 5       | FAIL    | 3        | -        | has-special-cases | high       |

Result line: **0/5 PASS → revised.**

## Convergent blockers

### B1 - FAB layer placement incompatible with the primary user flow (CRITICAL, 5/5)

The plan mounted `FloatingActionButtonLayer` from `(tabs)/+layout.svelte`. Verified against source: `(tabs)/` contains only `+page.svelte`, `activity/`, `messages/inbox/`. The four FAB-relevant destination routes are TOP-LEVEL, not under `(tabs)/`:

- `/discussion/[discussionId]/[slug]/[[page=page]]/+page.svelte:1-3,907-918` - renders its OWN `<DualColumnLayout><GesturePageLayout centerTab={0}>`.
- `/messages/[id]/[[page=page]]/+page.svelte:1-3,143-181` - renders its OWN `<DualColumnLayout><GesturePageLayout centerTab={2}>`.
- `/post/discussion/+page.svelte:2,114-316` - top-level, NO GesturePageLayout.
- `/messages/new/+page.svelte` - top-level, NO GesturePageLayout.

`MobileTabPager` is imported and rendered ONLY by `(tabs)/+layout.svelte:22,129`. The memory note `mobile-thread-overlay-persistent-pager.md` is SUPERSEDED 2026-06-27 (`.mobile-tab-pager-viewport` is null on thread pages). Consequences the plan did not account for:

- Tapping the FAB (`goto('/post/discussion')` / `goto('/messages/new')`) leaves the `(tabs)` tree, so the FAB layer unmounts at the route swap with no 200ms scale-out.
- Tapping a discussion card (`/`→`/discussion/*`) unmounts the FAB synchronously at route swap.
- Back-swipe thread→list has no FAB layer in the DOM until the list route mounts, by which point `backMorph` has already settled.
- Deep-link to `/discussion/*` or `/messages/[id]` never mounts the FAB layer at all.

**Verified-TRUE facts carried forward:** root `src/routes/+layout.svelte:22,43-44` initializes both pager stores via `initMobilePagerStore()` / `initSearchPagerStore()` and has `page` from `$app/state`; `mobile-pager.svelte.ts:97-120` exposes `getMobilePagerStore()` with a module-level `globalMobilePagerFallback` set on init, so the store is reachable from any component without `getContext`; `AppShell.svelte:1-13,56-59` is rendered by the root layout specifically so Header "survives navigation across the (tabs) branch and standalone pages (discussion thread, search, profile, ...)". AppShell is the correct sibling mounting point for the FAB layer, mirroring Header.

### B2 - Subsystem-B signal source wrong (HIGH/CRITICAL, 5/5)

The plan derived `foregroundFraction = backMorph` for thread/conversation overlay coverage. Verified false for the FAB-critical routes. In `GesturePageLayout.svelte:338-360` the publish `$effect` checks `if (centerTab !== undefined)` FIRST and returns at line 359 after `pager.set({..., backMorph: null})` (line 356). Both FAB-critical thread routes pass `centerTab` (discussion `centerTab={0}`, messages `centerTab={2}`), so `backMorph` is permanently `null` for them. The `backMorph: progress` / `backMorph: 1` writes (lines 386-400) are reachable ONLY when `centerTab === undefined` (deep pages like bookmarks, search, profile).

The continuous progress IS published for centerTab routes, but on a different field: `fractionalIndex` (line 353, `progressVal` mapped from `dragOffset` during drag, and from `snapIndex`/`rightTab` at rest). Re-derivation must read `fractionalIndex`, not `backMorph`.

**Verified-TRUE facts carried forward:** `tab-config.ts:33-47` defines Discussions `isActive: (p) => p === '/' || p.startsWith('/discussion')` and Messages `isActive: (p) => p.startsWith('/messages')`, so `getCurrentTabIndex('/discussion/...') === 0` and `getCurrentTabIndex('/messages/123') === 2`. The tab index alone is therefore ambiguous between a list and its overlay; the layer must gate on a path predicate (`overlayActive`) BEFORE consulting the tab index.

### B3 - `OverlayLayer.svelte` does not exist (HIGH, auditor 2)

The plan referenced `OverlayLayer.svelte` as the thread overlay component. Verified: `ls src/lib/components/templates/` returns `AppShell, DesktopSearch, DiscussionListPage, DualColumnLayout, GesturePageLayout, MobileTabPager, SearchScopePager, SingleColumnLayout`. No OverlayLayer. The thread overlay IS `GesturePageLayout.svelte` itself; its center `.gpl-card` panel (the opaque `bg-base-100` section) is what covers the list. The thread route's GesturePageLayout mounts a TRANSIENT left-preview panel during a back-swipe (GesturePageLayout.svelte:923-957 region), not a persistent MobileTabPager.

### B4 - Forward route-swap has no continuous signal in some cases (HIGH, auditors 4, 5)

Tap-FAB→compose and tap-card→thread are SvelteKit route swaps, not pager snaps. Three sub-cases verified against source:

- **Thread enter (`/`→`/discussion/*`):** GesturePageLayout's `shouldAnimateEnter()` (line 240) returns true when reached from the list via the nav stack; `snapIndex` inits to 0 and a single rAF (lines 869-873) flips it to `ACTIVE`. The CSS `transition-transform duration-200` then animates the GPL track from the list-preview position to the thread position over 200ms. **The GPL track IS animating during forward thread-enter**, so a sampler on that track CAN drive the FAB scale-out. (Auditor 4 B2's claim that forward nav has no track is incorrect for thread-enter; it IS correct for compose.)
- **Compose (`/`→`/post/discussion`, `/messages/inbox`→`/messages/new`):** verified no GesturePageLayout is imported by either page. No pager, no track, no animating transform. There is no signal to sample.
- **Tab tap (switchTo):** `MobileTabPager.svelte:167-178` sets `activeIndex` and calls `navStore.navigateForward`; the track animates via CSS transition. A track sampler covers this.

P1 (rAF track sampler) is viable for tab swipes, tab taps, thread enter AND thread back-swipe (GPL writes the primary store during both). P1 is NOT viable for compose route-swaps. P2 (CSS/Svelte transition on the FAB scale itself) is the only path for compose.

### B5 - Shared-primitive pollution (HIGH, auditors 1, 2, 5)

The plan added `use:trackSnapProgress` to `MobileTabPager.svelte` and `GesturePageLayout.svelte` feeding a store named `fab-scale.svelte.ts`. The action name and store name are FAB-specific; the wiring injects FAB tokens into the mandated shared primitives. Auditor 5 notes the file name `fab-scale.svelte.ts` itself contradicts the "clean" bar. Auditor 1 notes `trackEl` is local to MobileTabPager and never `bind:this`-exported, so the `use:` action would have to modify the shared component.

The "general capability" framing was post-hoc: only consumer is FAB. Either the sampler must be wired without shared-component edits, or the "general" claim must be dropped and the integration owned honestly.

## Non-blocking concerns (carried forward, not all individually enumerated)

- FAB size `size-14` (56px) has no precedent; `BookmarkButton.svelte:76` uses `btn-circle btn-sm`. Pinned in revision to `size-14` with rationale, marked owner-confirm if designer intent differs.
- z-35 vs reserve strip z-30: FAB at bottom-right overlaps the right-edge reserve strip horizontally; the strip is `w-8` (32px) at `inset-y-0`, FAB is `bottom-1rem right-1rem`, so they share the corner. Acceptable (the strip is `pointer-events: none` for tap, only OS-back uses it).
- z-35 vs cross-tab LoadingChip z-30: FAB would render ABOVE the chip. Contract pinned in revision (FAB forces scale 0 during `navStore.pendingNav !== null`).
- `onDestroy` rAF SSR guard: per memory `svelte-ondestroy-runs-in-ssr`, sampler teardown must be `browser`-guarded.
- Two-writer/one-store contradiction: MobileTabPager sampler and GPL sampler both write `snapFraction` to the FAB-scale store. Resolved in revision via keyed-by-surface (each list has its own slot; only the active surface's sampler writes).
- `pointer-events: none` threshold: specified as a derived class (`scale < 0.01`), not per-frame inline mutation.

## Verified-TRUE claims (carry forward)

`initMobilePagerStore` runs in root layout and sets `globalMobilePagerFallback`; `getMobilePagerStore` is reachable from AppShell without `getContext`; AppShell mounts Header specifically to survive cross-branch nav; Header uses CSS-only mobile gating (`md:` breakpoints), no JS `isMobile`; root layout server computes `isMobile` from UA (`+layout.server.ts:40,112`); `html.fixed-viewport` locks html/body via `position: fixed` (`app.css:244-255`) - a `position: fixed` FAB descendant of AppShell still anchors to the viewport under this lock; `startPendingNavPoll` (GesturePageLayout.svelte:538-586) is the existing rAF-on-track-transform pattern (`RAF_POLL_TIMEOUT_MS = TRACK_TRANSITION_MS * 4 = 800ms`, samples `getComputedStyle(trackEl).transform` m41 each tick); thread route GesturePageLayout runs a 200ms enter animation (snapIndex 0→ACTIVE via single rAF, CSS transition animates the track); compose routes have no pager; `data-no-swipe` marker (swipe.ts:73) is the gesture-yield mechanism; MobileTabBar active pill `bg-neutral-content/15 text-accent` (MobileTabBar.svelte:91); ActionBar wrapper `bg-neutral text-neutral-content shadow-md` (Header.svelte:572); `--color-accent: #ffee88`, `--color-neutral: #111`, `--color-accent-content: #111` (app.css).

## Revision decisions

The Round-1 revision of `docs/DV09-Plan.md` applies the following changes, mapped to blocker IDs:

1. **Placement → root layout (AppShell).** [B1] `FloatingActionButtonLayer` moves from `(tabs)/+layout.svelte` to `AppShell.svelte`, sibling to `Header`. AppShell is rendered by the root layout for exactly this purpose (survives cross-branch nav). The layer reads `page.url.pathname` and the primary pager store (reachable via `getMobilePagerStore()` module fallback). `(tabs)/+layout.svelte` receives no FAB edit. The `(tabs)` mobile-only `isMobile` gate is replaced by a CSS `md:hidden` gate on the layer (matching Header's mobile mechanism), removing the SSR-vs-post-hydration FAB-pop issue (auditor 1 B4).
2. **Signal re-derivation.** [B2] `foregroundFraction` for thread/conversation coverage is derived from `fractionalIndex` (continuously published for centerTab routes at GesturePageLayout.svelte:353), not `backMorph`. `overlayActive` becomes a path predicate in a new runes-free util `fab-routes.ts`: `isOverlayRoute(pathname)` matches `/discussion/` and `/messages/<digit>`, evaluated BEFORE the tab index. The Discussions FAB shows only when `pathname === '/'`; the Messages FAB only when `pathname === '/messages/inbox'`; both hidden on overlay/compose/other routes.
3. **Forward-nav taxonomy.** [B4] Three transition families, each with its signal source: (A) tab swipe/tap → MobileTabPager track sampler; (B) thread enter/exit → GesturePageLayout track sampler (GPL writes the primary store and runs a 200ms enter animation in BOTH forward-enter and back-swipe); (C) compose route-swap → P2 CSS transition on the FAB scale, armed on `beforeNavigate`/`afterNavigate`. P2 is justified ONLY for (C) because there is no animating track on compose routes.
4. **Organic-integration redesign.** [B5] The sampler lives entirely inside the FAB layer. The active track element reaches the sampler via Svelte context keyed by a NON-FAB name (`'activeGestureTrack'`), set by MobileTabPager and GesturePageLayout via a one-line `setContext('activeGestureTrack', trackEl)` with NO FAB import. Shared primitives gain zero FAB tokens; the context key is a general "which track is currently driving the gesture surface" facility. The "general capability" claim is either substantiated by a plausible second consumer or dropped and the integration owned honestly.
5. **Remove OverlayLayer.svelte references.** [B3] Section 3 rewritten against the real component graph: thread route = top-level DualColumnLayout > GesturePageLayout (centerTab set) with a transient left-preview panel during back-swipe; the overlay IS GesturePageLayout's center `.gpl-card`.
6. **Deferred items pinned.** FAB size `size-14` (56px) with rationale, marked owner-confirm; cross-tab chip-exit contract = `navStore.pendingNav !== null` forces scale 0 (verified exposed field); z-index under AppShell stacking context + `fixed-viewport` interaction verified (fixed descendant anchors to viewport); `onDestroy` rAF teardown `browser`-guarded per memory `svelte-ondestroy-runs-in-ssr`.
7. **Two-writer resolution.** [B3-non-blocking] The FAB-scale store is keyed by surface (`'discussions' | 'messages'`); only the active surface's sampler writes its slot. The MobileTabPager sampler and the GPL sampler never both write the same key ambiguously because they govern different surfaces (tab list vs overlay), and the layer gates which FAB renders by route.
