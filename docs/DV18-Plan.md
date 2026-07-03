# DV18 - Mobile: forward swipe past Messages enters Search (virtual forward neighbour)

**Status:** Approved (Round 3, 5/5 PASS, legitimate loop exit). History: R1 (5 auditors, one with a truncated prompt, 0/5 FAIL), R2 (3 auditors, 0/3 FAIL, overturned R1's two CRITICAL blockers), a retracted 3-auditor R3 that falsely declared exit, and the authoritative 5-auditor R3 (5/5 PASS) — in `docs/DV18-Meeting/DV18-Audit-R1.md`, `DV18-Audit-R2.md`, `DV18-Audit-R3.md`; plan update history in `docs/DV18-Meeting/DV18-Plan-Journal.md`. The Round-2 revision removed the Round-1 swap-mask and dynamic-`fallbackRoute` (both based on a misread of `GesturePageLayout.svelte:100` `hasLeft`).
**Scope:** Mobile only (`max-width: 767px`). The forward horizontal gesture on the Messages tab — the direction that currently rubber-bands at the last tab — commits into `/search` instead of dead-ending. Covers the drag reveal, the commit, and the landing transition. Desktop unaffected.
**Related:** DV08 delivered the mobile `/search` redesign; DV09 established the module-store / AppShell-sibling pattern; DV17 fixed the tap↔gesture morph isomorphism for root↔search; the `search-enter-exit-morph-asymmetry` memory records the enter/exit mirror.

## 1. Goal

The three primary tabs are ordered Discussions (0), Activity (1), Messages (2). Messages is the rightmost. On `/messages/inbox`, a forward swipe (finger moves left, `deltaX < 0`) hits a 0.4x rubber-band and snaps back; it has no commit target. DV18 gives that edge a destination: a forward swipe past Messages enters `/search`.

Search stays a deep page, not a fourth tab. The gesture gains a virtual forward neighbour (Messages → `/search`) that participates in the `MobileTabPager` drag as a reveal plus a commit, without joining the tab bar, without eager-loading, and without changing `getCurrentTabIndex` or `isTabRootPath`.

## 2. Defect and evidence

**Symptom.** On `/messages/inbox`, swiping toward the right edge drags a rubber-band that releases back to rest. Nothing commits.

**Location.** `MobileTabPager.svelte:193-198` `follow()` returns `deltaX * 0.4` when `activeIndex >= last && deltaX < 0`. `MobileTabPager.svelte:245-270` `swipeEnd()` gates the forward commit on `activeIndex < last`, which is false at Messages, so `switchTo(activeIndex + 1)` (`:221-225`) is never reached for a fourth target.

**Why search is the natural target.** `/search` is a global deep route with no primary tab (`route-config.ts:80-83`, `tab-config.ts:101-107` `GLOBAL_PREFIXES`). It is reached today only by tapping the Header search button (`Header.svelte:987-988` `<a href="/search">`). Messages is the rightmost tab, so the space past it is the only spatially-coherent gesture slot for entering search.

## 3. Architecture context (verified inventory)

### 3.1 Tab model — Messages is the last tab

`tab-config.ts:58-83` `RAW_TAB_DEFS` order: Discussions, Activity, Messages; the exported `MOBILE_TAB_DEFS` is built at `:86-94`. `getCurrentTabIndex('/search') === -1` (`route-config.ts:318-323`: the `/^\/search$/` rule at `:80-83` has `kind: 'deep'`, no `tab`, and `fabKindToLabelKey('deep')` is `undefined`). `isTabRootPath('/search') === false` (`history-nav.ts:34-39`). DV18 preserves both: search is not a tab and not a tab root.

### 3.2 The MobileTabPager forward edge and its back-edge mirror

`follow()` `:193-198`; `swipeMove()` `:200-220`; `swipeEnd()` `:245-270`; the three-section track `:344-422`. The back-edge already hands off to a deep page when there is no cached snapshot: the `backChipReveal` overlay (`:86`, `:211-212`, `:423-433`) grows from the left edge with the drag and shows a `LoadingChip`, while the track itself does not slide (`dragOffset = null` at `:212`). The forward edge has no such counterpart today; DV18 adds the reveal and the commit. (The back-edge ALSO masks its route swap with `isTransitioningOut` + `setTimeout` + a chip expand-to-full-screen, `:253-264` + `:439-446`. R2 established that the forward edge does NOT need an equivalent mask — see §3.8.)

### 3.3 The pager store

`mobile-pager.svelte.ts:58-109` `createPagerStore()`: closure `$state` fields `fractionalIndex`, `dragging`, `active`, `backMorph`, `targetIndex`, `coverProgress`, `tapMorph`; `set()` preserves `tapMorph` when omitted (`:74-77`); `setTapMorph()` (`:80-82`). The primary pager is written by `MobileTabPager` and `GesturePageLayout`, and read by `Header` and `MobileTabBar`. `MobileTabPager` always publishes `backMorph: null` (`:107`) because tab routes are root-mode.

### 3.4 The Header search layer is URL-gated (the central constraint)

`header-mode.ts:21` `resolveHeaderMode` returns `'search'` for a `/search` pathname. `Header.svelte:73` `isSearch = mode === 'search'`. `Header.svelte:720-728` gate both `searchProgress` and `tabProgress` on `isSearch ? ... : 0`. During a forward drag from Messages, `currentPath` is still `/messages/inbox`, so `isSearch` is false and the Header search layer is hidden. The Header cannot finger-track the search layer during the drag. The search layer appears only after the navigation lands and `isSearch` flips, via the existing Effect E path (§3.5). DV18 does not change this.

### 3.5 How `/search` is entered today (the reference for the land transition)

The mobile search entry is the plain link `Header.svelte:987-988` `<a href="/search">`. On tap, SvelteKit navigates; at land `currentHasTabs` flips true→false and `isSearch` flips false→true. Effect E (`Header.svelte:417-448`) then starts the morph scrub (branch 1b, `:165-168`) and the `tapMorph` scrub (`startTapScrub` `:479-499`); `trackMorph = pager.tapMorph !== null ? pager.tapMorph : morph` (`:719`) drives `searchProgress`/`tabProgress`. DV18's swipe-commit lands through this same Effect E path. Effect E's guards (`:433-439`): skip unless `currentHasTabs` flipped; skip unless `isSearch` flipped; skip if the title changed; skip if `dragging`; skip if `settling`; skip if `lastGestureMorph` above epsilon. R1/R2 verified that neither `/messages/inbox` nor `/search` sets `page.data.headerTitle` and neither appears in `deep-header-config.ts` ENTRIES, so `Header.svelte:76` resolves `title` to `''` on both; the title guard passes. `dragging` is false at land because the forward-edge state clears at commit (§4.3); `lastGestureMorph` stays 0 because `MobileTabPager` publishes `backMorph: null` and Effect A reads `pager.backMorph ?? 0`.

### 3.6 `/search` is a GesturePageLayout deep page; back-swipe returns to the source via `hasLeft` (R2 correction)

`routes/search/+page.svelte:45-53` mounts `<GesturePageLayout fallbackRoute="/">`. Back-swipe from `/search` is owned by that GesturePageLayout (`swipeEnd` `:699-716`, `beforeNavigate` `:751-835`).

`GesturePageLayout.svelte:100` `hasLeft = !!left || (navStore.activeTab >= 0 && navStore.activeTab <= 2)`. `/search` is a `GLOBAL_PREFIXES` route, so `getTabFromPath('/search', activeTab)` returns the launcher's `activeTab` (`navigation-logic.ts:47-54`), and `handleBeforeNavigateNav` keeps `activeTab` at the launching tab on a forward push (`navigation-logic.ts:137-163`). `hasLeft` is therefore TRUE for `/search` reached from any tab. The `swipeEnd` branch taken is the `hasLeft` one (`:704-716`): `committedLeft = resolvedLeftHref` = `navStore.backTarget` (`:116-124`) = the launching page (`/messages/inbox` for a DV18 entry); `setPendingNav(resolvedLeftHref, 'link')` → `executePendingNav` → `hopForHref('/messages/inbox')` → `'back'` → `history.back()`. The back-swipe round-trip to the source therefore already works today; DV18 does not touch `/search`'s back-swipe. The static `fallbackRoute="/"` is only the no-`backTarget` fallback (a deep-link with no source); the `else navigateBackward(fallbackRoute)` branch at `:711-713` is unreachable for `/search`.

### 3.7 Forward navigation semantics — the commit is a guaranteed push

`navigateForward` (`navigation.svelte.ts:244-253`) is the wrong dispatcher for the forward-neighbour commit. It calls `hopForHref('/search')` (`history-nav.ts:51-67`), which returns `'back'` when the previous entry's pathname is `/search` and `'forward'` when the next entry is — both occur in the common flow `/` → tap search → `/search` → tap Messages → forward-swipe. A hop moves the history cursor and strands the source instead of pushing `/search` onto the stack with the source behind it. The forward-neighbour commit therefore calls `goto(forwardDeepNeighbour)` directly — a guaranteed push — the same shape as every forward deep entry (a card tap is an `<a>` link, i.e. a push). `goto` triggers the root layout's `beforeNavigate`/`afterNavigate` hooks (`routes/+layout.svelte`), which call into `navStore.handleBeforeNavigate`/`handleAfterNavigate`, so the virtual stack updates normally (the same-tab forward push at `navigation-logic.ts:155-161` appends `/search` to `stacks[activeTab]`, which is what makes `backTarget` the launching page in §3.6).

### 3.8 `/search` slides in on enter — no swap-mask needed (R2 correction)

`GesturePageLayout.svelte:237-244` `shouldAnimateEnter()` returns TRUE for `/search` reached by a forward push from Messages. With `hasLeft` true (§3.6) and `resolvedLeftHref` = `backTarget` = `/messages/inbox`, every guard passes: `!leftNeedsLoading`, `hasLeft && resolvedLeftHref`, `direction === 'forward'`, `activeStack.length >= 2`, `prevPath === resolvedLeftHref`. `snapIndex` inits at 0 (`:261`) and `enterRaf` flips it to `ACTIVE` (`:932-946`); the CSS `transition-transform duration-200` slides the GPL track, and the `tapMorph`-driven slide (`GesturePageLayout.svelte` Page-panel headroom, per DV17) runs alongside. So `/search` slides in on enter exactly as a thread does on a card tap. This incoming motion covers the `MobileTabPager`-unmount → `/search`-mount swap, the same way thread-enter covers the list→thread swap. No `isForwardTransitioningOut` mask, no `setTimeout`, and no `.transitioning` overlay CSS is required (R1 added these on the wrong premise that `shouldAnimateEnter()` is false; R2 overturned that). The route leaves the `(tabs)` tree (`(tabs)/+layout.svelte:90-102,114-116`), so `MobileTabPager` unmounts (`onDestroy` `:148-157` releases `viewportLock`, clears `scrollChrome`/`activeGestureTrack`) and `/search` mounts fresh at the top level.

## 4. Design

### 4.1 The invariant

Search remains a deep page. The forward gesture at the last tab gains a virtual deep neighbour that participates in the `MobileTabPager` drag as a reveal plus a commit, without becoming a tab-bar panel, without eager-loading, and without altering `getCurrentTabIndex` or `isTabRootPath`. The drag reveal mirrors the back-edge chip-overlay reveal (`:209-213`, `:423-433`); the commit is a direct `goto` push that lands `/search` with its existing GPL enter-slide (§3.8) and the existing Effect E Header transition (§3.5).

### 4.2 Data-driven neighbour mapping — four `tab-config.ts` edits

`tab-config.ts` is the pure source. Add an optional `forwardDeepNeighbour?: string` to `TabDef` (`:34-47`) AND to `TabDefData` (`:49-56`); set it to `'/search'` on the messages entry in `RAW_TAB_DEFS` (`:75-83`); AND add `forwardDeepNeighbour: tab.forwardDeepNeighbour` to the explicit field list in the `MOBILE_TAB_DEFS` map at `:86-94`. The map is NOT a spread, so omitting the last step silently drops the field. `MOBILE_TABS` (`route-config.ts:362-367`) spreads `...tab`, so once the field reaches `MOBILE_TAB_DEFS`, it propagates to `MOBILE_TABS` automatically. `MobileTabPager` reads `MOBILE_TABS[MOBILE_TABS.length - 1].forwardDeepNeighbour`. Only Messages carries the field; Discussions and Activity keep their existing inter-tab forward swipes.

### 4.3 The drag reveal — a right-edge search peek overlay

During a forward drag at the last tab when a `forwardDeepNeighbour` exists, `swipeMove` takes a new branch modelled on the no-snapshot back-chip path (`:209-213`): the track does not slide (`dragOffset = null`), and a right-edge overlay grows with the drag. A new `searchPeekReveal` state (the mirror of `backChipReveal` at `:86`) holds `Math.min(-deltaX, window.innerWidth * 0.6)` pixels of width anchored to the right edge. The overlay shows a search affordance: the magnifier icon plus the search prompt. On cancel (drag returns below threshold, or the `reversed` flag fires) the overlay clears and the track stays at rest.

The `dragging` predicate at `MobileTabPager.svelte:105` (`dragOffset !== null || backChipReveal !== null`) gains `|| searchPeekReveal !== null`, so `pager.dragging` is true for the forward drag. The overlay clears at commit, so `dragging` flips to false before the navigation lands and Effect E's `dragging` guard passes (§3.5).

The overlay z-index mirrors the back-chip's `z-30` (`:425`), BELOW the FAB atom (`z-35`, `FloatingActionButtonLayer.svelte:425`), so the messages list FAB stays visible above it during the drag (consistent with §4.7). The search affordance is inset at least 40 px from the right edge so it clears the OS-back reserve strip (`w-8` = 32 px, `(tabs)/+layout.svelte:104`), which paints over the rightmost 32 px. The `detectSwipe` `edgeDeadZone` (40 px, `swipe.ts:366`) is a separate touch-start filter on the finger's `pointerdown`, not a region the overlay paints into; the inset is justified by the reserve strip alone. `pointer-events: none`.

### 4.4 The commit — a direct `goto` push

`swipeEnd` (`:245-270`) gains one branch ahead of the existing forward guard: when `activeIndex === last` and `MOBILE_TABS[last].forwardDeepNeighbour` is set and `deltaX <= -SWIPE_COMMIT` and `!reversed`, it clears `searchPeekReveal` (so `dragging` flips false) and calls `goto(forwardDeepNeighbour)` — a guaranteed push (§3.7). No `setTimeout`, no transition mask. `/search` mounts and slides in via its GPL enter-slide (§3.8); the Header transitions to search mode at land via Effect E (§3.5). The existing `activeIndex < last` forward branch (`:248`) is unchanged for Discussions and Activity. The existing `else` cancel branch (`:265-269`) and the deep-preview settle (`:251-264`) ALSO clear `searchPeekReveal`, so the overlay never leaks on a below-threshold or reversed release. The new forward branch in `swipeMove` (`:200-220`) must be ordered BEFORE the existing else's `follow(deltaX)` call (`:217`), and `swipeMove`'s else branch (`:214-218`) must clear `searchPeekReveal` (mirroring `backChipReveal = null` at `:216`) so a forward-then-reversed drag tears down the peek as soon as `deltaX` flips positive, not only at release.

Re-entry guard: `goto` itself does NOT flip `navStore.navInFlight` (only `executePendingNav` does, `navigation.svelte.ts:191-219`, which DV18 does not call), so the store flag cannot gate a second commit. A local `forwardGotoInFlight` flag (named to avoid collision with `navStore.navInFlight`), set synchronously in the commit branch before `goto`, makes a second forward commit during the in-flight navigation a no-op. `MobileTabPager` has no `afterNavigate` and unmounts when the route leaves `(tabs)` for `/search`, so the flag dies with the component instance; on a fresh tab visit a new instance starts with the flag false. The flag's read site is the top of the forward-commit branch (return early when already true).

### 4.5 The land transition — the existing Effect E path, unchanged

DV18 adds no new Header morph arm and no new pager-store field. At land, `currentHasTabs` and `isSearch` flip; Effect E (`Header.svelte:417-448`) runs the morph scrub and the `tapMorph` scrub exactly as it does for the tap path. R1/R2 verified all guards pass (§3.5). The Header search layer animates in over roughly 200 ms, identical to a tap-enter.

### 4.6 Back-swipe from `/search` — unchanged (R2 correction)

The back-swipe round-trip already works (§3.6): `/search`'s GPL `swipeEnd` takes the `hasLeft` branch and returns to the launching page via `history.back()`. DV18 touches neither `/search`, `SearchScopePager`, nor the back-swipe. (R1 proposed a dynamic `fallbackRoute`; R2 established it is dead code because the `hasLeft` branch never reads `fallbackRoute` for `/search`.)

### 4.7 FAB and coverProgress — corrected framing

`/search` is route-config family `overlay` / kind `deep` (`route-config.ts:80-83`). During the forward drag the URL is still `/messages/inbox` (family `list`, kind `messages`), so the visible FAB is the messages list FAB. The Family A sampler reads the track `m41`; with `dragOffset = null` the sample stays at the messages tab index, so `tabFraction` returns 1 and the FAB stays at scale 1 for the whole drag (visible above the `z-30` peek overlay). At land, `family` swaps `'list' → 'overlay'`, `discreteNavInFlight` latches 280 ms (`FloatingActionButtonLayer.svelte:242-254`), and the atom CSS-eases scale 1 → 0 over ~200 ms. There is no flash; the scale-down is CSS-only at land, not gesture-tracked. The forward drag publishes `coverProgress` by omission → `null` (`mobile-pager.svelte.ts:73`), which Family A ignores anyway.

### 4.8 What is explicitly rejected

- **Promote search to a fourth tab.** A fourth pill crowds the bar; the `(tabs)` eager page-1 load has no search shape; `isTabRootPath('/search')` would flip true and regress `backSwipeShouldPopHistory`. Search is query-driven, not a paginated list.
- **Finger-track the Header search layer during the drag.** Impossible today: the layer is URL-gated on `isSearch` (§3.4). Forcing it would require decoupling the layer from the URL, a DV17-scale change outside this scope.
- **Repurpose the backward gesture (finger moves right).** That is the working Messages → Activity back gesture; hijacking it breaks the spatial tab order and conflicts with the system back gesture at the right edge.
- **`navigateForward` for the forward commit.** Its `hopForHref` optimisation moves the cursor instead of pushing when `/search` is adjacent (§3.7).
- **A swap-mask on the forward commit.** `/search` slides in on enter (§3.8), so a mask is unnecessary and would only add latency. (Rejected in R2; R1 had proposed one on a wrong premise.)

### 4.9 Lifecycle / gotchas

- **SSR.** `forwardDeepNeighbour` is pure data on `TabDef` / `TabDefData`, so it is present at module eval with no DOM. `MobileTabPager` renders only inside `(tabs)/+layout.svelte:90` `{#if isMobile}`, and `isMobile` defaults false in SSR, so the pager, the peek overlay, and the commit branch do not run server-side. `searchPeekReveal` and `forwardGotoInFlight` init to `null` / `false`, so the overlay's `{#if searchPeekReveal !== null}` renders nothing on SSR. No hydration mismatch.
- **HMR.** `searchPeekReveal` and `forwardGotoInFlight` are component-local `$state` in `MobileTabPager`; HMR disposes the component and the state resets. They are NOT module singletons, so there is no stale-state survival across HMR (unlike the pager/nav stores). The `goto` is only ever called from a user gesture, never at module load, so HMR cannot fire a stray navigation.
- **Resize mid-drag.** `searchPeekReveal = Math.min(-deltaX, window.innerWidth * 0.6)` reads `window.innerWidth` fresh on each `swipeMove`, so a viewport resize during the drag self-corrects the overlay width on the next move. The overlay is right-anchored; only its width changes.
- **`onDestroy` / the route swap.** When the forward commit's `goto('/search')` lands, the route leaves `(tabs)` and `MobileTabPager.onDestroy` (`:148-157`) releases `viewportLock`, nulls the `scrollChrome` container, and calls `clearActiveGestureTrack()`. `searchPeekReveal` and `forwardGotoInFlight` die with the component instance; a fresh tab visit starts a new instance with both at rest. `pager.dragging` is set false by the `onMount` return-teardown (`:140-141`) as well as by the `dragging` predicate clearing at commit.
- **Second pointer / OS back-button during a forward drag.** `detectSwipe` (`swipe.ts`) tracks a single primary pointer and guards on `phase !== 'idle'`, so a second finger does not start a competing gesture. The right-edge OS-back reserve strip (`(tabs)/+layout.svelte:104`) and the 40 px `edgeDeadZone` (`swipe.ts:366`) keep the system back-gesture from racing the forward swipe.
- **Mid-gesture reversal.** A forward-then-reversed drag clears `searchPeekReveal` in `swipeMove`'s else branch the moment `deltaX` turns positive (§4.4), so the peek does not linger during the reversal; the release then runs the existing cancel path.

## 5. Files

**Modified:** `tab-config.ts` (the `forwardDeepNeighbour` field on `TabDef` and `TabDefData`; the messages `RAW_TAB_DEFS` value; the `MOBILE_TAB_DEFS` map field list — four sites, §4.2); `MobileTabPager.svelte` (read the neighbour; the `swipeMove` forward-edge branch with the `searchPeekReveal` overlay; the `dragging` predicate term at `:105`; the `swipeEnd` forward-commit branch that clears the peek state and calls `goto`; the overlay markup).

**Unchanged (verified):** `Header.svelte` (lands through the existing Effect E), `mobile-pager.svelte.ts`, `GesturePageLayout.svelte`, `routes/search/+page.svelte` (the back-swipe round-trip already works via `hasLeft`, §3.6), `SearchScopePager.svelte`, `navigation.svelte.ts`, `history-nav.ts`, `route-config.ts`, `header-mode.ts`, `MobileTabBar.svelte`, `FloatingActionButtonLayer.svelte`, `(tabs)/+layout.svelte`, `app.css`.

## 6. Edge cases

1. Forward swipe Messages → search commit: peek overlay grows, the overlay clears and `goto('/search')` fires, `/search` slides in via its GPL enter-slide, the Header transitions at land via Effect E.
2. Forward drag released below `SWIPE_COMMIT`: overlay clears, track stays at rest, no navigation.
3. Forward drag reversed (finger returns past the start within one gesture): `reversed` is true, no commit.
4. Second commit during an in-flight navigation: the local `forwardNavInFlight` flag (§4.4) makes it a no-op.
5. Back-swipe from `/search` entered via Messages: the `hasLeft` branch returns to `/messages/inbox` via `history.back()` (§3.6).
6. `/search` deep-linked with no source: `hasLeft` is still true (the `activeTab` fallback), `navStore.backTarget` is `/` (`seedStackForLanding` seeds a two-entry virtual stack `[root, '/search']`, so `backTargetFor` returns the root). The `hasLeft` back-swipe branch sets `pendingNav` to `/`; with no real previous browser-history entry, `hopForHref('/')` resolves to `'push'` and the dispatch is `goto('/')` (a push, not `history.back()`). The user lands on `/`.
7. Forward edge active only at `activeIndex === last`; Discussions and Activity forward swipes are untouched.
8. Messages list FAB visible at scale 1 during the drag (above the `z-30` overlay), eases to 0 at land (§4.7).
9. SSR: `forwardDeepNeighbour` is pure data; the overlay and the commit branch are mobile-runtime only. No SSR impact.

## 7. Testing plan

**E2E** (CDP touch, dedicated webServer port, `__navReady` gate, per the `e2e-playwright-nixos-gotchas` memory):

- Forward swipe Messages → search commits to `/search` (URL assertion plus the search layer visible). Start the drag at least 40 px from the right edge (the `detectSwipe` `edgeDeadZone`, `swipe.ts:366`).
- Forward drag below threshold snaps back with no navigation.
- Reversed forward drag does not commit.
- Back-swipe from `/search` entered via Messages returns to `/messages/inbox` (the `hasLeft` path, unchanged).
- The Header search layer appears at land: sample the search track `translateX` trajectory to confirm Effect E fired and the layer animated (not a static jump).
- `/search` slides in on enter: sample the GPL Page-panel `translateX` trajectory to confirm the enter-slide played (no bare-Messages frame between the peek clearing and `/search` mounting).
- No FAB flash across the swap; the messages FAB eases 1 → 0 at land.

**Unit.** `tab-config.ts` exposes `forwardDeepNeighbour` on the messages def and it propagates through `MOBILE_TAB_DEFS` and `MOBILE_TABS` (pure, runes-free, runnable under `bun:test`). Extract the forward-commit predicate to a pure helper and test it (last tab + neighbour set + `deltaX`/`reversed` cases).

**Audit gates (organic-clean enforcement).** The implementation diff must satisfy:

- `git diff -- Header.svelte GesturePageLayout.svelte mobile-pager.svelte.ts SearchScopePager.svelte routes/search/+page.svelte route-config.ts header-mode.ts navigation.svelte.ts navigation-logic.ts history-nav.ts MobileTabBar.svelte FloatingActionButtonLayer.svelte FloatingActionButton.svelte 'src/routes/(tabs)/+layout.svelte' app.css` — empty. No DV18 token (`search`, `forward`, `neighbour`, `peek`) enters any of these.
- `git diff -- tab-config.ts` — shows ONLY the four `forwardDeepNeighbour` sites (`TabDef`, `TabDefData`, the messages `RAW_TAB_DEFS` entry, and the `MOBILE_TAB_DEFS` map field list). No logic change, no `search`/`peek` string tokens beyond the one `'/search'` value on the messages entry.
- `git diff -- MobileTabPager.svelte` — shows ONLY: the `searchPeekReveal` state declaration; the `dragging` predicate term at `:105`; the `swipeMove` forward-edge branch and the `searchPeekReveal` clear in its else branch; the `swipeEnd` forward-commit branch (the `forwardGotoInFlight` guard, the `searchPeekReveal` clear, the `goto`); and the peek overlay markup. No `GesturePageLayout`/`Header`/`/search` import beyond what exists.
  No `if (pathname === '/search')` style special case appears anywhere in the diff; the only `/search` literal is the messages tab's `forwardDeepNeighbour` value.

**Audit loop.** Five open-ended role-less auditors, identical prompt, no pre-announcement, loop until 5/5 unconditional PASS (the DV04 / DV09 pattern).

## 8. Out of scope

`/search` as a real tab. Finger-tracking the Header search layer during the drag (URL-gated; DV17-scale). Forward virtual neighbours for other tabs. Unifying `MobileTabPager` `fractionalIndex` with the GesturePageLayout morph. A `leftSection`/`rightSection` snippet on `/search` (not needed; the `activeTab` fallback in `hasLeft` already drives the enter-slide and the back-swipe).

## 9. UNVERIFIED items for Round 3

R1/R2 resolved (now stated as fact in §3): the Header search layer is URL-gated and cannot finger-track during the drag (§3.4); Effect E fires on the swipe-commit land with the title-unchanged premise holding (§3.5); `shouldAnimateEnter()` returns `true` for `/search` and `/search` slides in on enter (§3.8); `hopForHref('/search')` is not always `'push'`, so the commit uses `goto` (§3.7); the back-swipe round-trip to the source already works via `hasLeft` (§3.6).

- **The enter-slide covers the swap.** Confirm empirically that the `/search` GPL enter-slide (`snapIndex` 0 → `ACTIVE` + the `tapMorph` slide) plays immediately on mount with no bare-Messages frame between the peek overlay clearing and `/search` mounting (sample the Page-panel `translateX`; compare to the thread-enter trajectory).
- **The `goto` push and the nav-store stack.** Confirm `goto('/search')` from Messages pushes `/search` with `/messages/inbox` behind, `handleBeforeNavigateNav` appends `/search` to `stacks[2]`, and `backTarget` is `/messages/inbox` (which `hasLeft`/`resolvedLeftHref` read for the back-swipe, §3.6).
- **The `dragging` flush.** Confirm `searchPeekReveal` clearing at commit flips `pager.dragging` to false in the same flush as (or before) the navigation lands, so Effect E's `dragging` guard passes.
- **The peek overlay z-index and reserve-strip inset.** Confirm the `z-30` overlay sits below the messages FAB (`z-35`) and the ≥40 px right-edge inset keeps the affordance clear of both the OS-back reserve strip and the `edgeDeadZone`.
- **The `forwardNavInFlight` re-entry guard.** Confirm a second forward commit during an in-flight `goto('/search')` is a no-op (the local flag, since `goto` does not flip `navStore.navInFlight`) and does not strand state.
