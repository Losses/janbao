# DV18 - Audit Round 1

5 independent role-less auditors examined `docs/DV18-Plan.md` against the codebase at local `master` (`84099b5`, includes DV16/DV17). Result: **0/5 PASS** (all FAIL, high confidence). Each auditor returned the organic verdict `has-special-cases`. Convergent blockers drove the Round-1 revision.

Auditors ran in isolated git worktrees but read the shared working tree (current master + the uncommitted plan) via absolute paths, so all findings are against the implementation target, not the stale `origin/master` branch point.

## Tally

| Auditor | Verdict  | Blocking | Organic           | Confidence |
| ------- | -------- | -------- | ----------------- | ---------- |
| 1       | FAIL     | 3        | has-special-cases | high       |
| 2       | NOT PASS | 1        | has-special-cases | high       |
| 3       | FAIL     | 2        | has-special-cases | high       |
| 4       | FAIL     | 5        | has-special-cases | high       |
| 5       | FAIL     | 5        | has-special-cases | high       |

Result line: **0/5 PASS → revised.**

## Convergent blockers

### CB1; The forward commit has no swap-mask transition; the flash is guaranteed (5/5, CRITICAL)

The back-edge handoff to a deep page masks the route swap. `MobileTabPager.svelte:253-264` sets `isTransitioningOut = true` then `setTimeout(switchBackward, 300)`, and the `.back-chip-overlay.transitioning` CSS (`MobileTabPager.svelte:423-446`) expands the chip from `${backChipReveal}px` to `width: 100%` and fades `opacity: 1 → 0` over 300 ms. That mask is the only continuity across the ~50–200 ms route swap.

Plan §4.4 specifies the forward commit as: clear `dragOffset`, `searchPeekReveal`, and peek state, then call `navigateForward`. No `isTransitioningOut`, no `setTimeout`, no overlay expansion. The overlay vanishes in a single frame.

Compounding fact (auditors 2, 4, 5): `/search` does NOT slide in to mask the swap. `routes/search/+page.svelte:45-53` renders `<GesturePageLayout fallbackRoute="/">` with no `leftSection`/`rightSection`, so `GesturePageLayout.svelte:237-244` `shouldAnimateEnter()` returns `false` at line 239 (`if (!hasLeft || !resolvedLeftHref) return false;`). `snapIndex` therefore does not init at 0 and no enter animation plays. There is no incoming motion to hide the gap. Plan §3.8/§9 listed this as UNVERIFIED; the verified answer (false) makes the flash certain, not possible.

Failure scenario: forward swipe past threshold → `swipeEnd` clears the peek overlay synchronously and calls the navigation → for the next ~50–200 ms the bare Messages panel shows with the overlay gone → `/search` mounts with no slide → the Header search layer only then begins its post-land `tapScrub` slide-in. The "reveal then commit" symmetry with the back-edge is broken at commit time.

### CB2; Navigation semantics are wrong on two fronts; the round-trip does not hold (5/5, CRITICAL)

**(a) `hopForHref('/search')` is not always `'push'`.** `history-nav.ts:51-67` returns `'back'` when the previous entry's pathname equals the target and `'forward'` when the next entry does. `navigateForward` (`navigation.svelte.ts:244-253`) dispatches `history.back()`/`history.forward()` accordingly. Plan §3.7 asserts "`/search` is not an adjacent history entry from Messages, so the hop resolves to `'push'`"; true only on a fresh history. The common flow `/` → tap search → `/search` → tap Messages tab → forward-swipe makes `/search` the adjacent entry, so the hop returns `'back'`/`'forward'` and the navigation moves the history cursor instead of pushing. The source entry is stranded and the back-swipe target becomes unpredictable.

**(b) Back-swipe from `/search` lands on `/` (Discussions), not the source.** `routes/search/+page.svelte:47` passes a static `fallbackRoute="/"`. `GesturePageLayout.svelte:699-716` `swipeEnd`, when `committedLeft && !hasLeft`, calls `navStore.navigateBackward(fallbackRoute)`. `navigateBackward('/')` (`navigation.svelte.ts:225-239`): `backSwipeShouldPopHistory(0)` returns `false` (the previous entry `/messages/inbox` IS a tab root, `history-nav.ts:99-107`), so the else branch runs `hopForHref('/')` → `'push'` → `goto('/', { replaceState: true })`, then the GPL `beforeNavigate` cross-tab exit resolves to `/`. `history.back()` is never called. Plan §3.6's claim "the entry behind `/search` is `/messages/inbox`, so `history.back()` returns there" is factually wrong. This is the existing behavior of `/search` (a standalone deep page with `fallbackRoute="/"`); it is not introduced by DV18, but DV18's swipe round-trip needs back-swipe to return to Messages, so DV18 owns it.

Failure scenario: forward-swipe Messages → `/search` (push) → back-swipe from `/search` → lands on `/`, not `/messages/inbox`. The spatial model "back = where I came from" is violated.

### CB3; `pager.dragging` predicate omits the forward-edge state (5/5, MEDIUM)

`MobileTabPager.svelte:102-109` publishes `dragging: dragOffset !== null || backChipReveal !== null`. Plan §4.3 keeps `dragOffset = null` for the forward branch (mirroring the no-snapshot back-chip) and adds `searchPeekReveal`, but does not say to add `|| searchPeekReveal !== null` to the `dragging` predicate at `:105`. With the term absent, `pager.dragging === false` for the entire forward drag. Consumers reading `dragging` (`MobileTabBar` pill transitions, `FloatingActionButtonLayer.transitionEnabled`, `Header.slideT`) lose the in-gesture gating the back-edge gets from `backChipReveal`. Auditors 2, 3, 5 noted Effect E still fires at land because the term clears at commit; the defect is the predicate inconsistency and the silent loss of the dragging signal.

### CB4; `forwardDeepNeighbour` propagation requires four edits, not one (4/5, MEDIUM)

`tab-config.ts:34-47` is `TabDef`; `:49-56` is a separate `TabDefData`; `:58-83` `RAW_TAB_DEFS: readonly TabDefData[]`; `:86-94` builds `MOBILE_TAB_DEFS` via an EXPLICIT field list (`href, labelKey, icon, prefixes, isActive, dataKey, listKey`), not a spread. A field added to `TabDef` + `TabDefData` + the messages `RAW_TAB_DEFS` entry, but not to the map callback at `:86-94`, is silently dropped; `MOBILE_TABS[last].forwardDeepNeighbour` resolves to `undefined`, the forward edge stays a dead-end rubber-band, and no type error fires. `MOBILE_TABS` (`route-config.ts:362-367`) does spread `...tab`, so propagation from `MOBILE_TAB_DEFS` onward is automatic once the field reaches the map. Plan §4.2's "add a field, set the messages value" understates the change.

### CB5; §4.7 FAB framing is wrong for the drag phase (3/5, LOW-MEDIUM)

During the forward drag the URL is still `/messages/inbox` (route-config `family: 'list'`, `kind: 'messages'`). The Family A sampler reads the track `m41`; with `dragOffset = null` the sample stays at the messages tab index, so `tabFraction` returns 1 and the FAB scale stays at 1 for the whole drag. At land, `family` swaps `'list' → 'overlay'`, `discreteNavInFlight` latches 280 ms (`FloatingActionButtonLayer.svelte:242-254`), and the atom CSS-eases scale 1 → 0. Plan §4.7 says "the FAB stays hidden during the forward drag"; the messages list FAB is in fact visible at scale 1 during the drag. The behavior is acceptable (a smooth ease at land, no flash); the prose misdescribes it.

## Non-blocking concerns

- **Right-edge reserve strip + edge dead-zone.** `(tabs)/+layout.svelte:104-113` reserves a `w-8` (32 px) `z-30` right-edge strip for the OS back gesture, and `swipe.ts:366-369` rejects any `pointerdown` within 40 px of either edge. A forward swipe must begin at least 41 px from the right edge. The e2e plan (§7) should sample drags starting mid-screen, not at the right edge.
- **Peek overlay z-index.** The overlay sits at `z-30` (matching the back-chip), below the FAB (`z-35`) and below the right-edge reserve strip (`z-30`, painted later, fixed). Either raise the overlay above `z-35` or inset its content at least 32 px from the right edge so the reserve strip does not paint over the search affordance.
- **Citation drift.** `searchProgress`/`tabProgress` at `Header.svelte:720-728` (master shows `:722-728` / `:728`); branch 1b at `:165-168` (master `:160-162`); `MOBILE_TAB_DEFS` cited at `tab-config.ts:58-83` is `RAW_TAB_DEFS`, the export is `:86-94`; the mobile search `<a>` is at `Header.svelte:987-988`; `header-mode.ts:21` matches a `/search` prefix, not only the exact pathname. All substance holds.

## Verified-TRUE claims (carry forward)

Messages is the rightmost tab (`tab-config.ts:58-83`); `follow()` rubber-bands at the forward edge (`MobileTabPager.svelte:193-198`); the forward guard never fires at Messages (`:248`); `getCurrentTabIndex('/search') === -1` (`route-config.ts:318-323`); `isTabRootPath('/search') === false` (`history-nav.ts:34-39`); the Header search layer is URL-gated on `isSearch` and cannot finger-track during a `/messages/inbox` drag (`header-mode.ts:21`, `Header.svelte:73,720-728`); the title-unchanged premise holds; neither `/messages/inbox` nor `/search` sets `page.data.headerTitle` and neither is in `deep-header-config.ts` ENTRIES, so Effect E's title guard (`Header.svelte:436`) passes; Effect E location and guards (`Header.svelte:417-448,433-439`); `MobileTabPager` always publishes `backMorph: null` (`:107`); `set()` preserves `tapMorph` (`mobile-pager.svelte.ts:74-77`); the back-chip mask pattern (`MobileTabPager.svelte:253-264,423-446`) is the correct model for the forward-edge commit; the proposed data field is SSR-safe (MobileTabPager is behind the `isMobile` gate, `(tabs)/+layout.svelte:58,90`).

## Revision decisions

1. **CB1; Add the forward swap-mask.** A new `isForwardTransitioningOut` state. `swipeEnd`'s forward-commit branch sets it, expands the search peek overlay from its current width to `width: 100%` with `opacity: 1 → 0` over ~300 ms (mirroring `.back-chip-overlay.transitioning`), and dispatches the navigation from a matching `setTimeout`. State explicitly that `shouldAnimateEnter()` is `false` for `/search`, so this mask is the sole continuity and is mandatory.
2. **CB2(a); The forward-neighbour commit is a guaranteed push.** The commit calls `goto(forwardDeepNeighbour)` directly (a push), NOT `navigateForward` (which `hopForHref`-optimises to `back`/`forward`). A deep destination must always push the source onto the history behind it. Correct §3.7.
3. **CB2(b); Back-swipe from `/search` returns to the source.** `routes/search/+page.svelte` derives `fallbackRoute` from the navigation source; the entry behind `/search` in history (`previousEntryPathname()` from `history-nav.ts`), defaulting to `'/'` when there is no previous entry. This fixes the DV18 round-trip and the existing tap path (tap-search-from-X then back returns to X). Move `routes/search/+page.svelte` from "Unchanged" to "Modified". Correct §3.6 and §4.6.
4. **CB3; Update the `dragging` predicate.** Add `|| searchPeekReveal !== null` to the `dragging` field at `MobileTabPager.svelte:105`. Pin in §4.3.
5. **CB4; Enumerate every `tab-config.ts` edit.** Add `forwardDeepNeighbour` to `TabDef`, to `TabDefData`, to the messages `RAW_TAB_DEFS` entry, AND to the explicit field list in the `MOBILE_TAB_DEFS` map at `:86-94`. Pin in §4.2 and §5.
6. **CB5; Correct the FAB framing.** State that the messages list FAB is at scale 1 during the drag (the URL is `/messages/inbox`) and CSS-eases to 0 at land via the `discreteNavInFlight` latch on the list→overlay family swap. Not "hidden during the drag". The behavior is acceptable.
7. **Non-blocking.** Acknowledge the 40 px right-edge dead-zone in §7 (sample mid-screen drags); pin the peek overlay z-index above the FAB or inset its content ≥32 px from the right edge; correct the citation drift.
