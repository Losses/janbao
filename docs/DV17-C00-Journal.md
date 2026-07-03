# DV17-C00 - Implementation Journal

Development log for the DV17 search tap-enter/exit Page/track sync fix. Spec: `docs/DV17-Plan.md` (5/5 PASS FINAL, after 11 audit rounds; `docs/DV17-Meeting/DV17-Audit-R11.md`). After implementation, a 5-agent role-less open-ended audit runs; each round's verdicts are recorded in `docs/RV17-C00-Audit-NN.md`. Work is "done" only when a round returns 5/5 unconditional accept.

## Phase map

1. **Pager store** (`mobile-pager.svelte.ts`): `tapMorph` field + `setTapMorph` field-level setter + `set` preservation rule.
2. **Header** (`Header.svelte`): DECOUPLE - `searchProgress`/`tabProgress` read `tapMorph` with `morph` fallback; layer group (`rootLayerStyle`/`layerDownStyle`/`iconProgress`) stays on master `morph`. Effect E retained master-shaped + ENTER `tapMorph` rAF. `beforeNavigate` EXIT `tapMorph` rAF. NB26 regrouped clear watch + orphan cancel. Drag-cancel. Track/Tab style CSS gates add `tapMorph !== null`.
3. **GPL** (`GesturePageLayout.svelte`): `tapVisualOffset` headroom branch in `trackTranslateX` + CSS `duration-200` suppression while `pager.tapMorph !== null`. Consumes `pager.tapMorph` only (no `resolveHeaderMode`, no `/search` token).
4. **E2E** (`search-enter-exit-asymmetry.spec.ts`): ENTER + EXIT sync assertions; MobileTabBar `translateY` trajectory (NB27); CALIBRATION failing on master; first-frame sampler.
5. **Verify**: `bun run check`, `bun run lint`, `bun test src/`, `bunx playwright test`.
6. **Audit loop**: 5-agent open-ended audit → `RV17-C00-Audit-NN.md` per round → loop until 5/5.

## Log

### Implementation

**Phase 1 - `src/lib/stores/mobile-pager.svelte.ts`**: added the `tapMorph: number | null` field (optional on `PagerUpdate`, required on `PagerStore`), a closure `$state`, a `get tapMorph()` getter, a `SetTapMorphFn` type + `setTapMorph(value)` field-level setter, and the `set` preservation rule `update.tapMorph !== undefined ? update.tapMorph : tapMorph` (the drag `$effect`'s `pager.set` calls omit `tapMorph` and preserve an in-flight scrub).

**Phase 2 - `src/lib/components/organisms/Header.svelte`** (DECOUPLE + publishers):

- `searchProgress`/`tabProgress` now read `trackMorph = pager.tapMorph !== null ? pager.tapMorph : morph`, so the track/Tab group follows the tap signal pre-nav (exit) and post-nav (enter), with a `morph` fallback at rest and during the drag.
- Effect E (`:408-432`) is RETAINED master-shaped: it still starts `startSearchScrub` (the morph scrub for the layer group - `rootLayerStyle`/`layerDownStyle`/`iconProgress` keep reading `morph`, so the Tab descent descent is preserved on enter, exit, and `/search → /activity`). It ADDITIONALLY starts the ENTER `tapMorph` rAF when `curIsSearch` (enter-only; the EXIT tapMorph is owned by the `beforeNavigate` below).
- Added `startTapScrub(from, to, source, target)`: writes `pager.tapMorph` linearly over `TITLE_CROSSFADE_MS`, sets the start value synchronously (NB21/NB17), latches `scrubSource`/`scrubTarget`/`scrubTerminal`.
- Added a Header `beforeNavigate` (EXIT pre-nav publisher): arms ONLY on `isSearch && navigation.to.url.pathname === '/'` (NB15 pathname-strict), short-circuits on `navStore.navInFlight` (NB22 redispatch), calls `startTapScrub(0, 1, '/search', true)`.
- Added the NB26 clear watch (`$effect.pre`): clears `tapMorph` + cancels the orphan rAF when `((tapMorph===scrubTerminal && currentHasTabs===scrubTarget) || currentPath!==scrubSource)` - immediate recovery on a mid-scrub redirect, holds the EXIT terminal pre-nav, jump-free at nav-land.
- Added the NB13 drag-cancel (`$effect.pre`): a `dragging` flip cancels the tapMorph rAF and clears `tapMorph`.
- Track/Tab style gates (`trackStyle`/`searchButtonStyle`/`tabBarStyle`) add `|| pager.tapMorph !== null`. `slideT` and `iconProgress` keep master gates (layer group).
- `onDestroy` cancels `tapScrubRafId` and clears `tapMorph`.

**Phase 3 - `src/lib/components/templates/GesturePageLayout.svelte`**: added `tapVisualOffset = W · max(0, (pager.tapMorph − HEADER_MORPH_THRESHOLD)/(1 − HEADER_MORPH_THRESHOLD))` and a `tapVisualOffset !== null` branch in `trackTranslateX` (ahead of the `snapIndex` fallback, behind the `swipeNeedsLoadingAtStart` branch), mirroring `visualDragOffset`; the CSS suppression gate adds `|| pager.tapMorph !== null`. GPL consumes `pager.tapMorph` only (no `resolveHeaderMode`, no `/search` token).

**Phase 4 - `e2e/search-enter-exit-asymmetry.spec.ts`**: ENTER test samples `contentTx` (`withContent: true`) and asserts `|trackNorm − pageNorm| < 0.2` (DV17 CALIBRATION: master fails at ~0.5 since the Header track scrubs ~83ms cubic while the Page panel CSS-slides ~200ms; DV17 drives both from linear `tapMorph` → maxDelta 0.000). Added a tap-EXIT test (`page.goBack()`) asserting the same sync band across the pre-nav `/search` window. Added a sampler `rootLayerY` field (Header rootLayer `translateY`) and an NB27 test asserting no pre-nav MobileTabBar descent (rootLayer frozen in search mode; guards a `tapMorph`-into-`rootLayerStyle` regression) and post-nav rest at `translateY(0%)`. NB27 debug found the tap-EXIT path runs the Effect B settle (morph→1); Effect E is skipped via the `settling` guard, so there is no `-100%→0%` descent on this path - MobileTabBar shows in place; the DV17 decouple is unaffected (the layer group reads master `morph`).

### Verify

- `bun run check`: **0 errors / 0 warnings** (1430 files).
- `bun run lint`: eslint **0 errors** on the DV17 src files; similarity-ts type-duplicates **0** (the 47 similar-type pairs are pre-existing `BookmarkListItem`/`OfflineBookmarkView` etc., informational). The chain's non-zero exit is the pre-existing prettier nit on `DV13/14/15` docs (not touched by DV17); all DV17 docs are prettier-clean after `prettier --write`.
- `bun test src/`: **202 pass / 0 fail** (1289 expect() calls).
- E2E (`bunx playwright test e2e/search-enter-exit-asymmetry.spec.ts`): **4 pass / 0 fail**. ENTER sync maxDelta **0.000** over 139 frames (Header track and Page panel move in lockstep under the shared `tapMorph`); tap-EXIT sync maxDelta **0.000** over 13 pre-nav frames; EXIT collapse-before-slide and MIRROR ordering assertions pass.
