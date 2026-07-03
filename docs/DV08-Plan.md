# DV08 - Mobile Search Redesign

**Status:** Draft under 5-agent audit loop. Round 1 + Round 2: 0/5 PASS → revised (see `DV08-Journal.md`, `DV08-Audit-R1.md`, `DV08-Audit-R2.md`).
**Scope:** Mobile only (`max-width: 767px`). Desktop `/search` is unchanged.
**Last architecture verify:** 2026-06-28, against `master` at `648f59b`.

## 1. Goal

Replace the current mobile `/search` with a gesture-first search surface built from patterns that already exist in this codebase:

1. **An in-place App Bar transformation** into a _search mode_ (a third header mode beside _root_ and _deep_), driven by the same layered-`translateY` morph discipline as the deep-page hamburger↔back-arrow morph.
2. **A horizontal scope pager** (`SearchScopePager`) with a stretchy underline tab strip (`SearchTabBar`), siblings of `MobileTabPager` / `MobileTabBar`, consuming the same `detectSwipe` primitive (extended with two general optional parameters) and a factored pager-store factory.
3. **Reuse of the existing swipe-back-with-preview** machinery (`GesturePageLayout` already wraps `/search`) so left-swiping the leftmost scope returns to the source tab with identical visuals (preview, or `LoadingChip`).

**Organic-integration mandate.** The shared primitives (`swipe.ts`, `GesturePageLayout.svelte`, `navigation-logic.ts`, `navigation.svelte.ts`, `tab-config.ts`) receive **no `/search` or `scope` tokens and no feature-specific branches** - only general capabilities (a `shouldClaim` predicate, an `exclusive` flag on `detectSwipe`; a mechanical `deepMorph→backMorph` rename) and unchanged logic. The new code follows existing patterns: a mode resolver that mirrors `deep-header-config`; sibling components that mirror `MobileTabBar`/`MobileTabPager`; a factory store; `detectSwipe` params reusable by any nested pager. `/search`-specific wiring lives in the search route, the mode resolver, and the new siblings.

## 2. Confirmed requirements (from the user)

1. Tapping the App Bar search icon **changes the route** (navigates to `/search`). Search mode is URL-derived.
2. In search mode there is **no hamburger, no back-arrow**; the relocated search icon is **non-functional** (no back, no drawer). Exit from `/search` is **only** via the leftmost-scope left-swipe.
3. `?scope=` is retained (deep-linkable, shareable); the pager is a UX layer, URL drives `activeIndex`.
4. Stretchy underline: the edge toward the drag direction (leading) reaches the target first; the trailing edge follows.

Other: "push the entire App Bar left" = horizontal reflow of the header's internal layers (search icon right→left, input expanding), not a rigid translate. Search tabs continue the top bar color (`bg-neutral`), underline marks the active scope. Filter icon → modal, no confirm button, flat list of sort options.

## 3. Architecture context (verified R1+R2)

- `tab-config.ts` - `GLOBAL_PREFIXES` includes `/search` → `getCurrentTabIndex('/search') === -1`.
- `search/+page.svelte:100` - already wrapped in `<GesturePageLayout fallbackRoute="/">`; back-swipe preview/chip already works.
- `dao/search.ts` - `searchDiscussions/Activities/Messages/Users`; non-discussions DAOs fall back to `newest` for `sort='replies'` (clamp is UX-only).
- `Header.svelte` - `morph = pager.deepMorph ?? (deepMode ? 0 : 1)`; two stacked `translateY` layers; `sticky` in `AppShell`, outside the gesture track.
- `mobile-pager.svelte.ts` - module-scoped `$state` singleton; writers `MobileTabPager` + `GesturePageLayout`; readers `Header` + `MobileTabBar` (complete set).
- `GesturePageLayout.svelte` - owns the back-swipe pager; publishes `deepMorph` (`0` at rest on deep pages, ramps `0→1` during back-swipe); registers `centerEl` with `scrollChrome` via its `$effect`; `centerEl` is `.detail-scroll-pane` (`overflow-y:auto`).
- `swipe.ts` - `detectSwipe` phase machine `idle/deciding/swipe/ignore`; `onDown` sets `primaryPointerId` + `phase='deciding'` (guarded by `if (phase !== 'idle') return` and a 40px edge dead-zone); the deciding→swipe transition claims on horizontal ratio and calls `node.setPointerCapture`; the steady-state swipe move path runs `preventDefault(); recordSample(); params.onMove(dx)` with **no** stop-propagation; listeners are registered in the bubble phase. `DualColumnLayout`'s main `detectSwipe` is **disabled on `/search`** → the only overlapping pair on `/search` is `SearchScopePager` (inner) + `GesturePageLayout` (ancestor). Lesson `c05594c`: two stacked `detectSwipe` nodes race to `setPointerCapture` on the same bubbled touch; resolution was to disable one. Captured pointer events fire at the capture target and bubble **up** to its ancestors (never down to descendants); `setPointerCapture` on a second node **transfers** capture (exclusive per pointerId).
- `scroll-chrome.svelte.ts` - `setScrollContainer(el)` swaps the listener (last call wins); `null` reverts to `window`.
- `list-cache.svelte.ts` - per-tab list cache pattern (mirrored by a new `search-cache`).

## 4. Design

### 4.1 Header search mode - (mode, backMorph) layer table

New pure util `src/lib/utils/header-mode.ts`:

```ts
export type HeaderMode = 'root' | 'deep' | 'search';
export function resolveHeaderMode(pathname: string): HeaderMode {
	if (pathname === '/search' || pathname.startsWith('/search')) return 'search';
	if (getCurrentTabIndex(pathname) === -1) return 'deep';
	return 'root';
}
```

`/search` moves from _deep_ to _search_; all other `getCurrentTabIndex===-1` routes stay _deep_. This resolver mirrors `deep-header-config.ts` (a path-derived header discriminator) - a new util, not a `/search` branch in any shared primitive.

`morph = pager.backMorph ?? (mode === 'root' ? 1 : 0)` (at rest on `/search`, `backMorph` is `0` - or `null` before `GesturePageLayout` mounts; both resolve to `morph=0` in search mode). Three stacked layers in the header center, each absolutely positioned, cross-faded by `translateY`, `transition: ${dragging ? 'none' : 'transform 200ms ease-out'}`, `pointer-events` gated. Layer state is a pure function of `(mode, morph)`:

| Layer                                                            | root                     | deep                                          | search                                        |
| ---------------------------------------------------------------- | ------------------------ | --------------------------------------------- | --------------------------------------------- |
| `rootLayer` (tabs + right search icon)                           | `translateY(0)`, pe auto | `translateY(-(1-morph)*100%)`, pe `morph>0.5` | `translateY(-(1-morph)*100%)`, pe `morph>0.5` |
| `deepLayer` (back-arrow + title)                                 | hidden                   | `translateY(morph*100%)`, pe `morph<0.5`      | hidden                                        |
| `searchLayer` (magnifier-left + input + filter + `SearchTabBar`) | hidden                   | hidden                                        | `translateY(morph*100%)`, pe `morph<0.5`      |

`deepLayer` and `searchLayer` share the same `translateY(morph*100%)` discipline (in place at `morph=0`, slid off at `morph=1`) and are mutually exclusive by mode - no conflict at `morph=0`. The left slot is mode-gated: root/deep → `BurgerArrowIcon` (unchanged), search → **decorative magnifier** (`aria-hidden`, `tabindex=-1`, non-interactive). The right `<a href="/search">` renders only in root mode. `SearchTabBar` is a child of `searchLayer` so it rides the morph slide-out (no freeze). SSR: `mode` is path-derived, so a deep link to `/search` SSRs with `searchLayer` in place.

### 4.2 SearchScopePager and the boundary handoff

New `src/lib/components/templates/SearchScopePager.svelte`, inside the `/search` page's `GesturePageLayout` center panel. Viewport `overflow: clip` (per the dev-story lesson - `hidden` is a programmatic-scroll container that causes the `scrollIntoView` page-lock), `height:100%` (fills `centerEl`); track `width:400%`, `transform: translateX(calc(-${activeIndex * 25}% + ${dragOffset}px))`, `transition: none` while `dragging`; four panels mounted simultaneously (never remount, preserve scroll). `activeIndex` from `?scope=`; `detectSwipe` on the viewport.

**Generalizing `detectSwipe`** with two optional, backward-compatible parameters (no `/search` tokens):

```ts
interface DetectSwipeOptions {
	// ... existing onMove/onEnd/disabled ...
	shouldClaim?: (dx: number, dy: number) => boolean; // default () => true
	exclusive?: boolean; // default false
}
```

**`exclusive` contract (precise).** When `exclusive === true`, the action calls `event.stopImmediatePropagation()` on **every `pointermove` it claims** - i.e. the move that triggers the deciding→swipe transition **and** every subsequent move while `phase === 'swipe'` (added to the steady-state move path). It does **not** stop propagation when it **yields** (`shouldClaim === false` → reset to idle), and does **not** stop propagation on `pointerup`/`pointercancel` (so the ancestor still receives the bubbled `pointerup` to reset). `stopImmediatePropagation` is per-event; applying it on every claimed move is what makes it a persistent shield for the duration of the gesture.

`SearchScopePager` passes `shouldClaim = (dx) => hasScopeNeighbor(activeIndex, dx)` (claim iff a neighbor exists in the drag direction; `false` at scope 0 + leftward and at scope 3 + rightward) and `exclusive = true`. `GesturePageLayout`'s `detectSwipe` is **unchanged** (defaults).

**Multi-move pointer-flow trace (inward drag, scope 0 → 1).** Both `detectSwipe` instances receive bubbled events (ancestor is a DOM ancestor of the inner).

1. `pointerdown p`: inner `onDown` → `deciding`, `primaryPointerId=p`; bubbles → ancestor `onDown` → same.
2. `move #1`: inner `onMove` (target phase) → horizontal → `shouldClaim=true` → claim (`setPointerCapture(p)`, `phase='swipe'`); `exclusive` → `stopImmediatePropagation()`. The move does **not** bubble; ancestor stays `deciding`.
3. `move #2..N`: captured by inner → fire at inner → bubble up; inner `onMove` (`swipe`) → `exclusive` → `stopImmediatePropagation()`. **The ancestor never sees a move**, so it never re-enters `deciding`→`swipe` and never calls `setPointerCapture` → **no `c05594c` race, no capture transfer, no strand.** Inner drives the scope track 1:1.
4. `pointerup`: captured → fires at inner, bubbles to ancestor (up is **not** stop-prop'd). Inner `onUp` → reset to idle; ancestor `onUp` (`primaryPointerId===p`, `phase==='deciding'`) → reset to idle. Both clean.

**Boundary drag (scope 0 + leftward = back-swipe).**

1. `pointerdown p`: both → `deciding`.
2. `move #1`: inner `onMove` → horizontal → `shouldClaim=false` → **reset to idle** (yield; no capture, **no** stop-prop). Move bubbles to ancestor.
3. ancestor `onMove` (`deciding`) → horizontal → default `shouldClaim=true` → claim (`setPointerCapture(p)`, `phase='swipe'`); runs its **existing** back-swipe (preview/chip, unchanged).
4. `move #2..N`: captured by ancestor → fire at ancestor, bubble up. Inner (descendant) does not receive them - but inner is already idle. No strand.
5. `pointerup`: ancestor resets.

The right end (scope 3 + rightward) yields symmetrically; `SearchScopePager` adds a local `follow()`-style rubber-band (like `MobileTabPager`) so the right end feels symmetric to the left (where the ancestor's back-swipe provides the edge feedback). `SearchScopePager.onMove` calls `scrollChrome.show()` (as `MobileTabPager` does) - the ancestor's `onMove` is shielded during inward drags, so the inner must reveal the header itself.

**Vertical scroll + scroll-chrome (single-owner; fixes R2 B6, R3 X+Y).** Two problems and their fixes:

1. **Height chain (R3 Y).** `centerEl` (`.detail-scroll-pane`, `h-full`) wraps `.gpl-card` (padding only, no height) which wraps the pager viewport. Without a definite height on `.gpl-card`, the pager viewport's `height:100%` resolves to content height and the panel never scrolls. Fix: a targeted CSS rule in `app.css` - `html.fixed-viewport .gpl-card:has([data-search-scope-pager]) { height: 100%; }` - gives `.gpl-card` a definite height only when it contains the scope pager (the `:has()` selector is already used elsewhere in the codebase). The pager viewport carries `data-search-scope-pager` and is `height:100%`. Each scope panel: `width:25%`, `height:100%`, `overflow-y:auto`, class `scroll-pane` (so `app.css`'s `padding-top: var(--header-height)` keeps content clear of the fixed header), `p-3` inside. Now the active panel is a definite-height scroller and `centerEl` is inert (its child fills it exactly).

2. **Single-owner scroll-container registration (R3 X).** Svelte 5 does not guarantee parent/child `$effect` order (the `html-data-theme-single-owner` lesson), so two `$effect`s both calling `scrollChrome.setScrollContainer` race on mount. Fix: route through ONE `$effect` via an override, mirroring the page-theme single-owner pattern. `scroll-chrome.svelte.ts` gains a reactive `override: HTMLElement | null` (+ `setOverride`); `GesturePageLayout`'s `centerEl` `$effect` is the **sole** caller of `setScrollContainer`, registering `scrollChrome.override ?? centerEl` (it reads `override`, so it re-runs when the override changes); `SearchScopePager`'s single `$effect` (keyed on `activeIndex` + the active panel el) calls `scrollChrome.setOverride(activePanelEl)` and clears it on unmount - it never calls `setScrollContainer` itself. Deterministic: no matter which effect flushes first, when `SearchScopePager` sets the override, `GesturePageLayout`'s effect re-runs and registers the panel; `centerEl` is never the registered element on `/search`. The override is a general capability (any nested scroller owner can claim the container) - no `/search` tokens in `scroll-chrome` or `GesturePageLayout`.

### 4.3 Stretchy underline (corrected math)

`SearchTabBar`: four equal-width cells (`c = W/4`). Underline driven by `fractionalIndex` (`f`) and `dragging` from the search store; `dragDir` is **derived locally** in `SearchTabBar` from the `fractionalIndex` delta (`sign(f − prevF)`, reset on drag end) - no store field, no `PagerUpdate` change. `L = 0.5`.

```ts
function underline(a, t, dir): { left; width } {
	const lag = Math.max(0, (t - L) / (1 - L)); // 0 until t>L, then 0..1
	let lo, hi;
	if (dir > 0) {
		lo = a * c + lag * c;
		hi = (a + 1 + t) * c;
	} // rightward: leading=right races
	else {
		lo = (a - t) * c;
		hi = (a + 1) * c - lag * c;
	} // leftward: leading=left races
	return { left: clamp(lo, 0, W - c), width: clamp(hi - lo, c, W) };
}
// dir>0: a=floor(f), t=f−a. dir<0: a=ceil(f), t=a−f.
// Resting (dir 0): { left: round(f)*c, width: c } with transition.
```

Rightward (`a=floor(f)`, `t=f−a`): t=0 → `[a*c,(a+1)*c]` w=c; t=0.5 → `[a*c,1.5c]` w=1.5c; t=1 → `[(a+1)*c,(a+2)*c]` w=c.
Leftward (`a=ceil(f)`, `t=a−f`): t=0 → `[a*c,(a+1)*c]` w=c; t=0.5 → `[(a−0.5)*c,(a+1)*c]` w=1.5c; t=1 → `[(a−1)*c,a*c]` w=c.
`width ≥ c` everywhere; `width === c` at integers; `width > c` for `t∈(0,1)` on **both** directions (the leftward trailing edge anchors at the source **right** edge `(a+1)*c`, moving left as it catches up - fixes R2 B4). Boundary clamp: `f≤0` → cell 0; `f≥3` → cell 3. `transition: ${dragging ? 'none' : 'left 200ms ease-out, width 200ms ease-out'}`.

### 4.4 Filter sort sheet

New `SearchSortSheet.svelte` (patterned on `ConfirmationModal.svelte`), no confirm button - flat list, single-tap selects + closes. Options adapt to the active scope (`replies` only when `scope==='discussions'`). `sort` is global; selecting updates `?sort=` (`replaceState`) → re-runs the load. The `sort='replies'` → non-discussions clamp is UX-only (DAO default-branch already falls back); the load normalizes the URL so `?sort=` never reads `replies` on a non-discussions scope.

### 4.5 Header input → URL `q`

Controlled input in `searchLayer`: bound to `page.url.searchParams.get('q') ?? ''`; on input, debounce ~250ms then `goto('/search?q=…&scope=…&sort=…&page=1', { replaceState: true, noScroll: true })`; Enter submits immediately. Empty query → active scope renders `EmptyState`. **Keyboard mitigation:** the input is in the sticky header (outside the locked flow); the scope panels are `overflow-y:auto` with `height:100%`. A `VisualViewport` resize listener sets an `--avail-height` CSS var on the scope pager viewport so the active panel's scroll area accounts for the soft keyboard (the `html.fixed-viewport` lock otherwise uses the layout viewport). Must-verify on device; if unstable, fall back to no-autofocus (user taps to focus). All `window`/`visualViewport` usage `browser`-guarded.

### 4.6 Data loading (active scope only + search-cache; fixes R2 perf concern)

`search/+page.server.ts` loads the **active** scope only (as today), at `?scope=`/`?sort=`/`?page=`. A new `search-cache` store (sibling of `list-cache`) holds the last-fetched results **keyed by `(scope, q, sort)`** (not scope alone - fixes R3 Z), so already-visited scopes preserve their results when swiped back to. Each entry stores its source `(q, sort)`; a panel treats a cached entry as a miss when its `(q, sort)` ≠ the current URL's, so a `q` or `sort` change never serves stale results. The cache is populated append-only: an `$effect` keyed on `page.data` writes `cache[activeScope, currentQ, currentSort] = page.data.<activeScope results>` whenever the active scope's load arrives (no "snapshot-before-overwrite" race - each scope's data is cached at the moment it is active). Switching scope sets `?scope=X&page=1` (page resets) and loads X; the cache serves X's entry immediately if its `(q, sort)` matches, else the panel shows a `LoadingChip` until the load completes. Per-keystroke cost is **1×** (not 4× - no eager four-scope load). `SearchLoadData` gains per-scope `{ results, page, totalPages, total, usedFallback }` meta for the active scope (the cache holds the rest). Permission handling unchanged (guest: activities/messages empty, users gated); empty scopes render `EmptyState`, no tab hidden (keeps the 4-cell stretch math stable).

### 4.7 Pager store (factory, closure-scoped $state)

`mobile-pager.svelte.ts` becomes a factory. `$state` is declared **inside** `createPagerStore()` (one set per call - fixes R1 B2). Two instances created once at module load:

```ts
export function createPagerStore(): PagerStore {
	let fractionalIndex = $state(0);
	let dragging = $state(false);
	let active = $state(false);
	let backMorph = $state<number | null>(null); // renamed from deepMorph
	/* ...set + getters... */
}
const primaryPager = createPagerStore();
const searchPager = createPagerStore();
export const getMobilePagerStore = () => primaryPager;
export const getSearchPagerStore = () => searchPager;
```

`deepMorph → backMorph` is a strict field rename preserving the `0`/`null` contract. Writers: `MobileTabPager` + `GesturePageLayout` → primary; `SearchScopePager` → search (writes `backMorph=null` always; only `fractionalIndex`/`dragging`). Readers: `Header` + `MobileTabBar` → primary; `SearchTabBar` → search (+ locally-derived `dragDir`). The `PagerUpdate` interface gains only the `deepMorph→backMorph` rename; `dragDir` is **not** added (derived in `SearchTabBar`). During a `/search` back-swipe, the primary `backMorph` drives the header morph while the search store is untouched.

## 5. Files

**New:** `header-mode.ts`; `SearchScopePager.svelte`; `SearchTabBar.svelte`; `SearchSortSheet.svelte`; `search-cache.svelte.ts`.

**Modified:**

- `swipe.ts` - add two general optional params (`shouldClaim`, `exclusive`); apply `exclusive`'s `stopImmediatePropagation` on every claimed pointermove (the deciding→swipe transition **and** the steady-state swipe move path); no new thresholds, no `/search` tokens.
- `mobile-pager.svelte.ts` - factory; `deepMorph`→`backMorph`.
- `Header.svelte` - `mode` resolver; three layers with the (mode, morph) table; mode-gated left slot + right search icon; `SearchTabBar` inside `searchLayer`; `backMorph` read.
- `MobileTabBar.svelte` - `deepMorph`→`backMorph` read.
- `MobileTabPager.svelte` - `deepMorph`→`backMorph` write.
- `GesturePageLayout.svelte` - (a) **mechanical rename** (`deepMorph`→`backMorph` at every `pager.set()` site in the deep-page publish branch and the commit/cancel/cleanup paths; `0`/`null` at-rest contract preserved); (b) the `centerEl` scroll-chrome `$effect` is the sole `setScrollContainer` caller and now registers `scrollChrome.override ?? centerEl` (one-line generalization; no `/search`/`scope` tokens, no feature branch). (Line numbers are cited non-positionally - they drift across commits.)
- `scroll-chrome.svelte.ts` - add a reactive `override: HTMLElement | null` (+ `setOverride`); a nested scroller owner claims the container via the override (general capability; no `/search` tokens).
- `app.css` - one targeted rule: `html.fixed-viewport .gpl-card:has([data-search-scope-pager]) { height: 100%; }` (fixes the height chain; `:has()` is already used in the codebase).
- `search/+page.svelte` - replace form/select/single-list with `SearchScopePager`; input removed (now in header); active-scope `Paginator` per scope; `search-cache` wiring.
- `search/+page.server.ts` - per-scope active meta in `SearchLoadData`; `sort` URL normalization.

**Unchanged (verification targets):** `tab-config.ts`, `navigation-logic.ts`, `navigation.svelte.ts`, `dao/search.ts`. `GesturePageLayout.svelte` receives no `/search`/`scope` tokens and no new conditional.

## 6. Edge cases & risks

1. **Boundary handoff** - `exclusive` shields every claimed move (4.2 trace); verify with a CDP-touch e2e that inward drags switch scope (multi-move, not just the first) and boundary drags produce the existing preview/chip; assert the ancestor's `onMove` is never invoked after the inner claims.
2. **`c05594c` race** - avoided: the ancestor never sees a move during an inward drag, so it never calls `setPointerCapture`, so there is no capture transfer.
3. **Stranding** - inner keeps capture throughout an inward drag (ancestor never steals it); both reset on the bubbled `pointerup`. No strand.
4. **Multi-touch** - `if (phase !== 'idle') return` guards each instance; `exclusive` shields the ancestor. Test-gate.
5. **Vertical scroll / scroll-chrome (single-owner)** - each scope panel is its own `overflow-y:auto` `scroll-pane` scroller (definite height via the `.gpl-card:has([data-search-scope-pager]) { height:100% }` rule); `GesturePageLayout`'s `centerEl` `$effect` is the sole `setScrollContainer` caller, registering `scrollChrome.override ?? centerEl`; `SearchScopePager` sets the override to the active panel. No parent/child effect-order race, no double-registration, no revert-to-window mid-switch.
6. **`overflow: clip`** on the viewport (not `hidden`); panels scroll internally.
7. **search-cache keying** - keyed by `(scope, q, sort)`; a `q`/`sort` change evicts mismatched entries (no stale results). Unit-tested.
8. **SSR / hydration** - `mode` path-derived; `backMorph` defaults per mode; deep-link SSRs in search mode. `window`/`visualViewport` usage `browser`-guarded.
9. **Empty / forbidden scopes** - `EmptyState`; no tab hidden.
10. **`sort=replies` cross-scope** - UX-only; URL normalized in the load.
11. **Per-keystroke cost** - 1× (active scope only + `search-cache`); the LIKE fallback is capped (`LIKE_FALLBACK_LIMIT=200`) and the FTS path paginates returned rows, but the underlying MATCH hit scan may still be large for a common trigram - verify the per-query cost on a large corpus. Debounce + the cache bound the churn.
12. **Keyboard vs `html.fixed-viewport`** - `VisualViewport`-driven `--avail-height`; must-verify on device.
13. **Desktop untouched** - new components mobile-only; desktop `/search` keeps form+select.
14. **Resize desktop↔mobile on `/search`** - `SearchScopePager` mobile-only (not mounted on desktop); `activeIndex` init guards on `isMobile` (cf. `4912122`).
15. **`resolveDeepHeaderTitle('/search')`** - dead config in search mode; remove it.
16. **a11y** - search-mode magnifier is decorative.
17. **`?page=` semantics** - only the `/search` route's `?page=` is managed here (other routes' `?page=` is independent); scope switch resets `?page=1`.

## 7. Testing plan

- **Unit (`bun test`)** - `resolveHeaderMode`; the (mode, morph) layer-style function over all combinations; `underline()` over `f∈[0,3]` asserting `width ≥ c`, `width === c` at integers, `width > c` for `t∈(0,1)` on **both** directions, and the exact edge positions at t=0.5 (rightward `lo=a*c, hi=(a+1.5)*c`; leftward `lo=(a-0.5)*c, hi=(a+1)*c`); `createPagerStore()` two instances independent; `sort` URL normalization.
- **E2E (Playwright; NixOS gotchas)** - tap search → `/search` + header in search mode; multi-move inward swipe switches scope (underline stretches leading-edge-first, `?scope=` updates, panels preserve scroll); leftward swipe at scope 0 → back-swipe with preview/chip, lands on source tab; inward scope drag does **not** trigger back-swipe and does **not** strand; filter sheet (replies only on discussions); input live-search; keyboard opens without collapsing the viewport; resize desktop↔mobile.
- **Audit gates** - `git diff -- swipe.ts` shows only the two new optional params + the exclusive stop-prop on claimed moves (no `/search`/`scope` tokens); `git diff -- GesturePageLayout.svelte` shows only the `deepMorph`→`backMorph` identifier swap plus the single `scrollChrome.override ?? centerEl` line in the `centerEl` `$effect` (no `/search`/`scope` tokens, no feature branch); `git diff -- scroll-chrome.svelte.ts` shows only the added `override`/`setOverride`; `tab-config.ts` / `navigation-logic.ts` / `navigation.svelte.ts` diffs empty.
- **Unit (extra)** - `search-cache` keyed by `(scope, q, sort)`: a `q` or `sort` change evicts mismatched entries.

## 8. Out of scope

Desktop `/search` redesign; search history; per-scope sort; new searchable entities / FTS tables; offline search.
