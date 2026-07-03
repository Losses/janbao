# DV18 - Audit Round 2

3 independent role-less auditors examined the Round-1 revision of `docs/DV18-Plan.md` against the codebase at local `master` (`84099b5`). Result: **0/3 PASS** (all FAIL, high confidence). The round overturned R1's two CRITICAL blockers as based on a misread of `GesturePageLayout.svelte:100`, and found the Round-1 revision had over-engineered (a swap-mask and a dynamic `fallbackRoute` that are unnecessary or dead code). The Round-2 revision simplifies the plan back to its verified core. The hasLeft finding was independently verified by the owner against source before this revision.

## Tally

| Auditor | Verdict | Organic           | Confidence |
| ------- | ------- | ----------------- | ---------- |
| 1       | FAIL    | has-special-cases | high       |
| 2       | FAIL    | clean             | high       |
| 3       | FAIL    | has-special-cases | high       |

Result line: **0/3 PASS → revised.** (Three auditors rather than five this round; the overturn is unanimous and the owner re-verified the load-bearing line directly.)

## The overturn; R1 CB1 and CB2(b) were based on a misread of `hasLeft`

`GesturePageLayout.svelte:100`:

```ts
const hasLeft = $derived(!!left || (navStore.activeTab >= 0 && navStore.activeTab <= 2));
```

R1 read `hasLeft` as requiring the `left` snippet. The second disjunct makes `hasLeft` TRUE for `/search` reached from any tab: `/search` is a `GLOBAL_PREFIXES` route (`tab-config.ts:101-107`), so `getTabFromPath('/search', activeTab)` returns the launcher's `activeTab` (`navigation-logic.ts:47-54`), `handleBeforeNavigateNav` keeps `activeTab` at 2 (`navigation-logic.ts:137-163`, same-tab forward push), and `(activeTab >= 0 && activeTab <= 2)` is true. Two consequences that overturn R1:

1. **`shouldAnimateEnter()` returns TRUE for `/search` (R1 CB1 was wrong).** `GesturePageLayout.svelte:237-244` passes every guard: `hasLeft` true, `resolvedLeftHref` = `navStore.backTarget` = `/messages/inbox` (`:116-124`), `direction === 'forward'`, `activeStack.length === 2`, `prevPath === resolvedLeftHref`. `/search` slides in on enter via `snapIndex` 0 → `ACTIVE` (`:261`, `:932-946`) plus the `tapMorph`-driven slide. The DV17 plan (`docs/DV17-Meeting/DV17-Plan-Journal.md`) and the existing `e2e/search-enter-exit-asymmetry.spec.ts` both treat the `/search` Page-panel slide as live behavior. There IS incoming motion to cover the `MobileTabPager`-unmount → `/search`-mount swap. The Round-1 swap-mask (`§4.4`) is therefore NOT the "sole continuity"; it adds a 300 ms `setTimeout` and a mask overlay for no benefit.

2. **Back-swipe from `/search` already returns to the source today (R1 CB2(b) was wrong).** `GesturePageLayout.svelte:699-716` `committedLeft = hasLeft ? resolvedLeftHref : fallbackRoute`. With `hasLeft` true, the `if (hasLeft)` branch runs (`setPendingNav(resolvedLeftHref='/messages/inbox', 'link')` → `executePendingNav` → `hopForHref('/messages/inbox')` → `'back'` → `history.back()`). The `else navigateBackward(fallbackRoute)` branch; the one R1 analyzed; is unreachable for `/search`. The static `fallbackRoute="/"` is only the no-`backTarget` fallback. The Round-1 dynamic `fallbackRoute` (`§4.6`) is dead code: the GPL never reads it on the path `/search` actually takes.

The owner re-verified `GesturePageLayout.svelte:100, 116-124, 237-244` and `navigation-logic.ts:47-54, 137-163` directly.

## What still stands from R1 (verified-TRUE in R2)

- **CB2(a) / §3.7; the forward commit is a guaranteed `goto` push.** `hopForHref('/search')` returns `'back'`/`'forward'` when `/search` is an adjacent history entry (`history-nav.ts:51-67`); `navigateForward` would move the cursor instead of pushing. `goto('/search')` is correct. All three R2 auditors confirmed.
- **CB3 / §4.3; the `dragging` predicate term.** `MobileTabPager.svelte:105` is `dragOffset !== null || backChipReveal !== null`; the forward peek adds `|| searchPeekReveal !== null`. Confirmed at the cited line.
- **CB4 / §4.2; the four `tab-config.ts` sites.** `TabDef` (`:34-47`), `TabDefData` (`:49-56`), the messages `RAW_TAB_DEFS` entry (`:75-83`), and the explicit field list in the `MOBILE_TAB_DEFS` map (`:86-94`, not a spread). `MOBILE_TABS` (`route-config.ts:362-367`) spreads `...tab`, so propagation from `MOBILE_TAB_DEFS` is automatic. Confirmed.
- **CB5 / §4.7; the FAB framing.** During the drag the URL is `/messages/inbox` (family `list`, kind `messages`); the Family A sampler reads the track `m41`, which stays at the messages tab index with `dragOffset = null`, so the FAB scale stays at 1. At land the family swaps `list → overlay`, `discreteNavInFlight` latches 280 ms, and the atom CSS-eases scale 1 → 0. Confirmed end to end.
- **§3.5; Effect E fires at land** (guards `:433-439`; title-unchanged premise holds: neither `/messages/inbox` nor `/search` sets `page.data.headerTitle` and neither is in `deep-header-config.ts` ENTRIES).

## Blocking issues in the Round-1 revision (what R2 fails the revision on)

### RB1; §4.4 swap-mask is unnecessary and adds latency (3/3)

Because `/search` slides in on enter (the overturn, §1 above), there is incoming motion to cover the swap. The 300 ms `isForwardTransitioningOut` mask + `setTimeout(goto, 300)` adds 300 ms of latency to every forward commit for no continuity benefit. The forward commit should call `goto('/search')` directly from `swipeEnd`; the peek overlay clears at commit and `/search`'s GPL enter-slide covers the swap (the same mechanism as thread-enter).

### RB2; §4.6 dynamic `fallbackRoute` is dead code (3/3)

The `/search` back-swipe takes the `hasLeft` same-panel-slide path and never reads `fallbackRoute` (the overturn, §2 above). Deriving `fallbackRoute` from `previousEntryPathname()` has zero observable effect; it misleads reviewers into believing a fix occurred. `/search/+page.svelte` stays unchanged.

### RB3; §3.6 and §3.8 state the wrong mechanism (3/3)

`§3.6` claims "`history.back()` is never called" and the back-swipe "lands on `/`"; the reality is the `hasLeft` path calls `history.back()` to `/messages/inbox`. `§3.8` claims `shouldAnimateEnter()` is `false`; it is `true`. Both sections must be corrected to the `hasLeft`-based mechanism, and the `§9` items that leaned on the wrong premise (the swap-mask timing, the dynamic-`fallbackRoute` capture) are dropped.

### RB4; §4.3 vs §4.4 internal contradiction, and z-index vs §4.7 (2/3)

`§4.3` says the overlay "clears at commit, so `dragging` is false at land"; `§4.4` says the overlay expands to full screen over 300 ms (which requires `searchPeekReveal` to stay non-null through the mask; keeping `dragging` true and tripping Effect E's `dragging` guard). And `§4.3` places the overlay "above the FAB (`z-35`)", which contradicts `§4.7`'s "the FAB stays visible at scale 1 during the drag". Dropping the mask (RB1) dissolves the lifecycle contradiction; the z-index must mirror the back-chip's `z-30` (below the FAB `z-35`) so the FAB stays visible, consistent with §4.7.

## Non-blocking concerns

- **§4.3 affordance inset.** `detectSwipe` `edgeDeadZone = 40` (`swipe.ts:366`); the OS-back reserve strip is `w-8` (32 px, `(tabs)/+layout.svelte:104`). Inset the search affordance at least 40 px from the right edge so it neither sits under the reserve strip nor inside the dead-zone.
- **§4.4 `activeIndex === last` is redundant** with the per-tab field (only Messages carries `forwardDeepNeighbour`); keep it as a defensive guard or drop it. Harmless either way.
- **Rapid re-swipe.** With the mask dropped there is no `setTimeout` to cancel, so the rapid-re-swipe concern (R1 §6.4) largely evaporates; a `navInFlight`-gated early return in `swipeEnd` is still prudent.
- **Citation drift.** `§3.5` branch 1b at `Header.svelte:165-168` (plan said `:160-162`); the back-chip CSS block is `:439-446` (plan said `:442-446`).

## Revision decisions (Round 2)

1. **[RB1] Drop the swap-mask.** The forward commit calls `goto(forwardDeepNeighbour)` directly from `swipeEnd`. No `isForwardTransitioningOut`, no `setTimeout`, no `.transitioning` CSS. `/search`'s GPL enter-slide (§3.8 corrected) covers the swap.
2. **[RB2] Drop the dynamic `fallbackRoute`.** `/search/+page.svelte` is unchanged. The back-swipe round-trip already works via the `hasLeft` same-panel-slide path.
3. **[RB3] Correct §3.6 and §3.8.** `§3.6`: back-swipe from `/search` returns to the source via the `hasLeft` branch (`resolvedLeftHref` = `backTarget` = the launching tab), not via `fallbackRoute`. `§3.8`: `shouldAnimateEnter()` returns `true` for `/search` (the `activeTab` fallback term in `hasLeft`); `/search` slides in on enter.
4. **[RB4] Peek overlay simplified and z-index fixed.** The peek grows during the drag and clears at commit (no expand-to-full-screen). z-index mirrors the back-chip `z-30` (below the FAB `z-35`, so the messages FAB stays visible; consistent with §4.7). Affordance inset ≥40 px from the right edge.
5. **Carry forward unchanged:** §3.7 (the `goto` push), §4.2 (the four `tab-config.ts` sites), §4.7 (the FAB framing), §3.5 (Effect E at land), the `dragging` predicate term.

Round 3 will re-verify the simplified plan: that the peek-overlay + direct-`goto` commit lands `/search` with the GPL enter-slide covering the swap, that back-swipe returns to the source unchanged, that the `dragging` predicate and the `tab-config.ts` propagation are correct, and that nothing else regresses.
