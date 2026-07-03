# DV17 - Search tap-enter/exit: Page slide and Header track share one morph signal (tap/gesture isomorphism)

**Status:** Round 10 revised (R0-R8 history in `docs/DV17-Meeting/DV17-Audit-R1..R9.md`; R9 1/5 PASS exposed NB24/25: the pre-nav `tapMorph`-as-`morph` design eliminated the EXIT Tab descent). Plan update history lives in `docs/DV17-Meeting/DV17-Plan-Journal.md`.
**Scope:** Mobile only (`max-width: 767px`), the root ↔ `/search` transition, BOTH directions. Desktop unaffected.
**Related:** DV08 delivered the mobile `/search` redesign; `search-enter-exit-morph-asymmetry` memory records the enter/exit mirror fix (`startSearchScrub`). DV17 corrects a tap desync uncovered while reviewing that fix.

## 1. Goal

Make the Header search-track `translateX` and the GesturePageLayout Page-panel `translateX` play as one synchronized motion on a tap ENTER `/` → `/search` AND tap EXIT `/search` → `/`. Today the Header track completes its slide in ~83ms while the Page panel slides over 200ms.

The structural requirement is the **tap/gesture isomorphism invariant**: a tap must use the same signal shape as a drag. On a drag the Page panel reads `visualDragOffset` (`GesturePageLayout.svelte:446-454`), `dragOffset` with `W * HEADER_MORPH_THRESHOLD` headroom subtracted, so the Page slide and the Header track slide both occupy `morph` `[0.2, 1]` and move together. A tap has no equivalent headroom on the Page side, so the two slides run on independent clocks.

Both directions must be synchronized, WITHOUT regressing master's MobileTabBar Tab descent (Round 9 NB24/25).

## 2. Defect and evidence

**Symptom.** Mobile, tap the search button on `/` to enter `/search` (or tap back to `/`): the Header search track (`div.flex.w-[200%]` translateX, `Header.svelte:802`, `trackStyle` `:636`) reaches rest well before the Page panel. Track ~83ms; Page ~200ms.

**Location.** Page panel: `snapIndex 0 → ACTIVE` via `enterRaf` (`:920-924`), CSS `duration-200` (`:973`), `trackTranslateX = -${snapIndex * STEP_PERCENT}%` (`:469`); full-range, no headroom. Header track: `startSearchScrub` rAF eases `morph 1 → 0` over 200ms (`:434-457`, `:156-159`); `searchProgress` (`:626-633`) maps `morph [0.2, 1]`; `(1-t)^3` crosses 0.2 at t≈0.415 (~83ms).

**Why the drag does not desync.** `visualDragOffset` (`:446-454`) subtracts the headroom; Page `trackTranslateX` reads it (`:468`); `backMorph` from the same drag progress. Both slides occupy `morph [0.2, 1]`.

**Why prior coverage missed it.** `e2e/search-enter-exit-asymmetry.spec.ts` asserts ordering, not sync. DV17 adds the sync assertion (§7).

## 3. Architecture context (verified inventory)

### 3.1 The drag path: one signal, headroom-segmented (the reference)

`visualDragOffset = Math.max(0, dragOffset − W·0.2)/0.8` (`:452`). Page `trackTranslateX` reads it (`:468`); Header `morph` reads `pager.backMorph` (`Header.svelte:150`). Both slides occupy `morph [0.2, 1]`.

### 3.2 The tap path: two independent clocks (the defect)

Page: `snapIndex` jump + CSS `duration-200`; full-range, no headroom. Header track: `startSearchScrub` eases `morph`, `searchProgress` consumes `morph [0.2, 1]`. Separate clocks.

### 3.3 morph consumers (TWO groups with OPPOSITE timing needs - Round 9 finding)

- **Track/Tab group:** `searchProgress` (`:626-633`) → Header track `translateX` (`trackStyle` `:636`) + search button (`searchButtonStyle` `:650`); `tabProgress` (`:634`) → SearchTabBar `max-height` (`tabBarStyle` `:657`). These need the morph signal PRE-nav on exit (Page/track sync).
- **Layer group:** `rootLayerStyle` (`:575-581`), `layerDownStyle` (`:582-586`), `iconProgress` (`:194`). These need the morph signal POST-nav (the Tab descent on exit; the icon flip).
  Both groups read `morph` today. Round 9 tried to drive `morph` from a pre-nav `tapMorph` on exit, which froze the layer group (pre-nav `isSearch=true` → `rootLayerStyle='transform:none'`) and eliminated the descent. Round 10 gives each group its own signal.

### 3.4 morph's branches (`Header.svelte:146-185`) - UNCHANGED in DV17

Four branches: drag → `pager.backMorph` (`:150`); tap → scrub rAF (`:156-159`); settle (`:167-176`); rest (`:181`). DV17 does NOT add a `tapMorph` arm to `morph` (the layer group keeps reading master-shaped `morph`).

### 3.5 Effect E: the tap scrub trigger (`Header.svelte:408-432`) - RETAINED master-shaped

A `$effect.pre` on `currentHasTabs`/`title`/`isSearch`. Fires on every root↔search flip (`currentHasTabs` flips, `isSearch` flips, title unchanged, no drag, no settle). Its `prevHadTabs`/`prevSearchTitle`/`prevIsSearch` latches capture the transition because Header is AppShell-level and never unmounts. DV17 RETAINS Effect E master-shaped (the Round-8 `if (!curIsSearch) return` enter-only guard is REMOVED) so the morph scrub continues to drive the layer group's Tab descent on enter, exit, AND `/search → /activity`. DV17 ADDS a `tapMorph` rAF started alongside the morph scrub (enter) and in a new `beforeNavigate` (exit), feeding the track/Tab group.

### 3.6 The EXIT topology (Round-5 NB11)

On `/search → /`, the `/search` GPL `beforeNavigate` (`:739-823`) intercepts PRE-nav; `page.url` updates only at nav-land. A post-nav publisher (Effect E) cannot drive the EXIT track/Tab sync (the GPL consumer has unmounted). Round 10 publishes the EXIT `tapMorph` PRE-nav (Header `beforeNavigate`).

### 3.7 Timing constants

`TITLE_CROSSFADE_MS = TRACK_TRANSITION_MS = 200`. The master scrub eases `morph = (1-t)^3` (crosses 0.2 at ~83ms). DV17's `tapMorph` rAF is linear, so the track/Tab group varies over the linear first 80% ≈ 160ms.

### 3.8 The pager store (`mobile-pager.svelte.ts`)

`backMorph` closure `$state<number|null>(null)` (`:54`); `set` (`:58-65`) writes all fields. DV17 adds `tapMorph` + `setTapMorph`.

## 4. Design

### 4.1 The invariant this defect violated

Every slide in the root↔search morph must occupy the same `morph` segment. The drag satisfies it. The tap violates it on both directions. DV17 makes both tap directions satisfy it for the track/Tab group, while leaving the layer group on master's morph scrub (so the Tab descent is preserved).

### 4.2 The structural fix: DECOUPLE the track/Tab group (`tapMorph`) from the layer group (`morph`)

Round 9 drove `morph` from a pre-nav `tapMorph` on exit and lost the Tab descent (the layer group needs post-nav morph). Round 10 keeps the two consumer groups on separate signals:

- **Layer group (`rootLayerStyle`/`layerDownStyle`/`iconProgress`) stays on `morph`.** Master's Effect E morph scrub is RETAINED on every root↔search flip - the Tab descent and the icon flip are unchanged from master.
- **Track/Tab group (`searchProgress`/`tabProgress`) moves to `pager.tapMorph`**, with a fallback to the `morph`-derived value when `tapMorph === null` (at rest and during the drag, so the drag path is unchanged). This gives the track/Tab group the pre-nav sync (DV17's goal) without touching the layer group.

`tapMorph` is published post-nav for enter (Effect E, alongside the morph scrub) and pre-nav for exit (a Header `beforeNavigate`), and consumed by `searchProgress`/`tabProgress` and the GPL Page-slide headroom. `morph` stays master-shaped (no `tapMorph` arm); the two signals never collide.

`searchProgress`/`tabProgress` segmentation is unchanged, so enter (slide-then-expand) and exit (collapse-then-slide) ordering and the mirror are preserved. The tap/gesture isomorphism holds for the track/Tab group.

### 4.3 Why this is structural, not a band-aid

The cause is the tap's lack of a continuous morph signal that the track/Tab group reads, compounded by sharing `morph` with the layer group (which needs different timing). The fix adds the headroom at the same structural point the drag has it, routes the track/Tab group through a dedicated continuous signal (`tapMorph`) published from the topology-correct site per direction, and leaves the layer group on the master signal it already animates correctly. Every instance is covered.

### 4.4 Implementation

1. **`mobile-pager.svelte.ts`.** Add `tapMorph: number | null` (optional on `PagerUpdate`, required on `PagerStore`), closure `$state`, getter, field-level setter `setTapMorph(value)`. `set` preserves `tapMorph` via `update.tapMorph !== undefined ? update.tapMorph : currentTapMorph`.
2. **`Header.svelte` - two publishers, two signals.**
   - **Effect E (RETAINED master-shaped) drives the morph scrub (layer group) AND starts the enter `tapMorph` rAF.** On a root↔search tap it runs the master morph scrub (drives `rootLayerStyle`/`layerDownStyle`/`iconProgress` - Tab descent preserved) AND starts a `tapMorph` rAF interpolating `tapMorph (prevTabs?1:0) → (curTabs?1:0)` linearly. It calls `setTapMorph(scrubFrom)` SYNCHRONOUSLY before the rAF (Round-9 NB21: the track/Tab CSS-suppression gate is true in the same flush). No `if (!curIsSearch) return` guard (Effect E fires on every flip, master-shaped).
   - **`beforeNavigate` (NEW, exit pre-nav) starts the exit `tapMorph` rAF.** Header registers a `beforeNavigate` that arms ONLY on `isSearch && navigation.to.url.pathname === '/'` (Round-8 NB15 pathname-strict, no new `/search` literal). It short-circuits when `navStore.navInFlight` (Round-9 NB22). It calls `setTapMorph(0)` SYNCHRONOUSLY (Round-8 NB17), then the rAF interpolates `tapMorph 0 → 1`. The `/search` GPL is still mounted pre-nav and consumes `tapMorph` for the Page-slide headroom. (The morph scrub for the layer group's exit Tab descent is started by Effect E POST-nav, as master.)
   - **Clear (Round-11 NB26):** a `$effect.pre` watch clears `tapMorph` to `null` AND cancels the orphan rAF when `((tapMorph === scrubTerminal && currentHasTabs === scrubTarget) || currentPath !== scrubSource)`. The regrouped condition (terminal required only for the FIRST disjunct) clears IMMEDIATELY on any navigation away from `scrubSource` - a mid-scrub redirect to a deep route clears without waiting for the rAF terminal, and the cancel tears down the orphan rAF on the persistent Header so the freshly-mounted deep GPL never reads a stale `tapMorph`. ENTER (terminal 0, `/search`): clears at completion (`currentHasTabs=false=scrubTarget`). EXIT (terminal 1): holds pre-nav (`currentPath === '/search' === scrubSource`); clears at nav-land (`currentHasTabs=true=scrubTarget`) OR immediately on a deep-route redirect (`currentPath !== '/search'`).
   - **Drag-cancel (NB13):** a `dragging` flip cancels the `tapMorph` rAF and calls `setTapMorph(null)` (the morph scrub's own drag-handling is unchanged).
3. **`GesturePageLayout.svelte` - Page-slide headroom (consumer only).** `trackTranslateX` gains a `pager.tapMorph !== null` branch ahead of the `snapIndex` fallback: `tapVisualOffset = W · max(0, (tapMorph − HEADER_MORPH_THRESHOLD)/(1 − HEADER_MORPH_THRESHOLD))`, combined `calc(-${ACTIVE * STEP_PERCENT}% + ${tapVisualOffset}px)` (Round-3 NB6 sign `+1` both directions). CSS `duration-200` suppressed while `pager.tapMorph !== null` (parallel gate to `:475`); re-enabled when it clears. GPL does NOT detect, publish, or import `resolveHeaderMode`; reads only `pager.tapMorph`.
4. **`Header.svelte` - morph arm + consumer source change.** `morph` is UNCHANGED (no `tapMorph` arm; master scrub branch `:156-159` retained). `searchProgress` and `tabProgress` switch source: `searchProgress = isSearch ? f(pager.tapMorph !== null ? pager.tapMorph : morph) : 0` (and `tabProgress` likewise); `f` is the same `[0.2,1]`/`[0,0.2]` segmentation. At rest and during the drag (`tapMorph === null`), they read `morph` (master behavior, including the drag's `backMorph`). `startSearchScrub` is RETAINED (it drives the morph scrub for the layer group); its deleted-in-earlier-rounds state is restored. The `searchScrubbing` gates on `slideT`/`trackStyle`/`searchButtonStyle`/`tabBarStyle`/`iconProgress` are KEPT master-shaped for the layer-group styles; the track/Tab styles additionally suppress CSS while `pager.tapMorph !== null`.
5. **`Header.svelte` - gate summary.** Layer-group styles (`rootLayerStyle`/`layerDownStyle` via `slideT`) keep master gates. Track/Tab styles (`trackStyle`/`searchButtonStyle`/`tabBarStyle`) add `|| pager.tapMorph !== null` to their existing suppression gates.

### 4.5 What is explicitly rejected

- **Drive `morph` from `tapMorph` (R0-R9).** Eliminates the layer group's Tab descent (NB24/25). The two groups need opposite timing; decouple them.
- **Extend `TITLE_CROSSFADE_MS`** / **split Tab out of `morph`** / **publish EXIT post-nav** / **ENTER-only scope** (all carried rejections).

### 4.6 Organic integration

Layer group stays on master `morph` (no change). Track/Tab group reads the new general `tapMorph` field. GPL reads only `pager.tapMorph` (no `resolveHeaderMode`, no `/search` token). Header's `beforeNavigate` uses the existing `isSearch` derived + a `'/'` literal. `startSearchScrub` retained. DV08 organic-clean gate holds.

## 5. Files

**Modified:** `mobile-pager.svelte.ts` (tapMorph field + setter + preservation); `Header.svelte` (RETAIN startSearchScrub + morph scrub + Effect E master-shaped; ADD tapMorph rAF started in Effect E + beforeNavigate; ADD clear watch + drag-cancel; switch `searchProgress`/`tabProgress` source to `tapMorph`-with-`morph`-fallback; add `tapMorph` suppression to track/Tab style gates); `GesturePageLayout.svelte` (tapVisualOffset headroom branch + CSS suppression, consuming `pager.tapMorph` only); `e2e/search-enter-exit-asymmetry.spec.ts` (ENTER+EXIT sync assertions, CALIBRATION, first-frame sampler).
**Unchanged:** `gesture-constants.ts`, `SearchTabBar.svelte`, `swipe.ts`, `MobileTabBar.svelte`, `MobileTabPager.svelte`, `tab-config.ts`, `route-config.ts`, `header-mode.ts`, `FloatingActionButtonLayer.svelte`, `FloatingActionButton.svelte`, `app.css`, `(tabs)/+layout.svelte`, `DualColumnLayout.svelte`.

## 6. Edge cases

1. tap enter `/`→`/search`: Effect E morph scrub (Tab layer) + tapMorph rAF (track/Tab); Page slide and Header track sync over `[0.2,1]`; Tab expands `[0,0.2]`. Fixed.
2. tap exit `/search`→`/`: beforeNavigate tapMorph rAF pre-nav (track/Tab sync); Effect E morph scrub post-nav (Tab descent, preserved); Page slide and Header track sync pre-nav. Mirror of case 1. Fixed, no descent regression.
3. drag enter/exit: `tapMorph === null`, track/Tab read `morph = backMorph` (unchanged).
4. interrupted/rapid tap: cancels and restarts the tapMorph rAF from the start value.
5. deep-link `/search`: `tapMorph` null; Effect E first-run skip; no flash.
6. `/search → /activity`: Effect E morph scrub fires (Tab descent preserved, master); tapMorph does not arm (target ≠ `/`); no track/Tab sync (none needed - no Page slide). No regression.
7. resize during rAF: `W` captured once (pre-existing).
8. drag during rAF: `dragging` cancels tapMorph rAF + `setTapMorph(null)`; morph scrub drag-handling unchanged.
9. redirect mid-scrub to deep route: clear watch fires (`currentPath !== scrubSource`); `morph` rests correctly; no stuck leak (NB23).

## 7. Testing plan

- **E2E.** ENTER + EXIT sync assertions (`contentTx` + `trackTx`, `|trackNorm − pageNorm| < 0.1` + single-frame delta); ordering assertions; CALIBRATION failing on master; first-frame sampler (NB3); a tap-EXIT MobileTabBar `translateY` trajectory e2e (Round-11 NB27) asserting a SINGLE post-nav descent `-100%→0%`, NO pre-nav appearance, NO double-appear - matching master (MobileTabBar is in the Header `rootLayer`, covered by the search layer pre-nav when `isSearch === true`; the GPL page-panel track slide does not contain or affect it).
- **Unit.** `tapVisualOffset` headroom; linear tapMorph interpolation; `searchProgress`/`tabProgress` tapMorph-with-morph-fallback.
- **Audit gates / Quality gates / Audit loop** as before (5 open-ended auditors, identical prompt, no pre-announcement, until 5/5).

## 8. Out of scope

Unifying MobileTabPager `fractionalIndex` with GPL/`tapMorph`; non-search morph routes; retiring `family`/Family A sampler.

## 9. UNVERIFIED items for Round 11

- **NB26 regrouped clear.** Confirm `((tapMorph === scrubTerminal && currentHasTabs === scrubTarget) || currentPath !== scrubSource)` clears immediately on a mid-scrub deep-route redirect (orphan rAF cancelled, deep GPL reads `tapMorph === null`), holds the EXIT terminal pre-nav, and clears jump-free at nav-land.
- **NB27 MobileTabBar trajectory.** Confirm the tap-EXIT MobileTabBar `translateY` e2e matches master (single post-nav descent, no pre-nav appearance, no double-appear) - settling whether the GPL track slide affects the Header rootLayer (it does not: MobileTabBar is in the Header, covered by the search layer pre-nav).
- **Carried.** Decouple correctness (`searchProgress`/`tabProgress` tapMorph+`morph` fallback preserves drag + ordering); two-rAF coexistence (morph scrub + tapMorph rAF on enter); EXIT discriminator completeness; drag-clear; first-frame flash-free; `coverProgress`/FAB; `isMobile` gate; documentation (Effect E enter-only, §6 case 6, §1 scope, `W` note, `:817`).
