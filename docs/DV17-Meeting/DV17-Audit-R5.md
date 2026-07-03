# DV17 - Plan Audit Round 05

5 role-less open-ended auditors examined `docs/DV17-Plan.md` (Round 5: publisher in persistent Header) with the identical open prompt (no pre-announcement, no target). Result: **0/5 PASS, 5/5 CHANGES_REQUESTED** (all high confidence). The Round-5 relocation (publisher in persistent Header, NB8 RESOLVED) is endorsed, but the open audit uncovered a deeper, topological defect on the EXIT direction and three enter-side timing defects. Full detail below.

## Tally

| Auditor | Verdict           | Blocking | Organic | Confidence |
| ------- | ----------------- | -------- | ------- | ---------- |
| 1       | changes_requested | 2        | clean   | high       |
| 2       | changes_requested | 3        | clean   | high       |
| 3       | changes_requested | 3        | clean   | high       |
| 4       | changes_requested | 5        | clean   | high       |
| 5       | changes_requested | 3        | clean   | high       |

## Blocking issues (deduplicated)

**NB11 (5/5) - EXIT synchronization is topologically unreachable; "Mirror of case 1" is false.** Traced against `GesturePageLayout.svelte:739-823` + `Header.svelte:408-432,626-633`. On `/search → /` (tap or popstate), the `/search` GPL's `beforeNavigate` intercepts PRE-nav: `cancel()`, `snapIndex = 0` (`:817`), `setPendingNav` + `startPendingNavPoll` (`:821-822`), and the CSS `duration-200` slide plays (`:973`). Nav dispatches only when the slide completes (`onTrackTransitionEnd`/poll → `executePendingNav`). Effect E in Header is `$effect.pre` on `currentHasTabs`/`isSearch`, which derive from `page.url.pathname` - they flip only AFTER nav lands. So the EXIT timeline is: GPL CSS slide (0-200ms) → nav-land → `/search` GPL unmounts → `/` MobileTabPager mounts (does not read `tapMorph`) → Effect E fires → rAF runs (200-400ms). The rAF publishes `tapMorph` into a store whose only Page-side consumer (the `/search` GPL) is already gone. Compounding: `searchProgress = isSearch ? ... : 0` (`Header.svelte:626-633`) hard-cuts to 0 the instant `isSearch` flips false at nav-land, so the Header track translateX jumps `-50% → 0%` with no animation (and the `tapMorph !== null` gate suppresses any CSS transition that might have hidden it). The ENTER direction does NOT have this problem: `/` has no intercepting `beforeNavigate`, nav lands immediately, the `/search` GPL mounts, and both slides run in parallel reading `tapMorph`. The §1 goal ("synchronized motion on a tap enter/exit") and §6 case 2 ("Mirror of case 1") are therefore unachievable on the EXIT side under any publisher-in-Header design.

**NB12 (4/5) - the nav-land clear watch fires on the same flush as Effect E, killing the ENTER scrub.** `navStore.navInFlight` is set ONLY inside `executePendingNav` (`navigation.svelte.ts:191-219`), reached only via the swipe/pendingNav poll path (`GesturePageLayout.svelte:605,613,721`). A plain `<a href="/search">` tap never sets `navInFlight`. So on ENTER, `navInFlight` is already false when Effect E fires, and `currentHasTabs` has just flipped - both conjuncts of the §4.4 item 2 clear condition are satisfied in the same flush Effect E writes the start value, so a reactive watch clears `tapMorph` to null before the rAF paints a single interpolated frame. The ENTER scrub is a no-op.

**NB13 (auditor 1, 4) - drag-cancel does not clear `tapMorph`; the morph arm order then returns a stale value post-settle.** §4.4 item 4 orders the arms `drag → tapMorph → settle → rest`; §6 item 8 says a drag "cancels the rAF" but does not clear `tapMorph`. With the §4.4 item 1 `set` preservation rule, the drag's `pager.set` calls preserve the stale mid-scrub `tapMorph`. On drag release, after `endSettle` clears `settling`, `morph` falls through to the `tapMorph` arm and returns the frozen mid-scrub value, overriding the correct rest. The plan must explicitly `setTapMorph(null)` on the `dragging` flip (Effect A) or in the rAF tick.

**NB14 (auditor 1) - EXIT terminal `tapMorph = 1` leaks stale into a later deep-page navigation.** After an exit, `tapMorph` rests at 1 (the exit terminal). A later `/ → /bookmarks` mounts a fresh `/bookmarks` GPL that reads `pager.tapMorph === 1`, computes `tapVisualOffset = W`, and renders panel 0 (list preview) instead of panel 1 (bookmarks). The clear-on-nav-land watch (NB12) does not fire on a non-search navigation, so the stale value persists. The plan needs an unconditional clear at scrub completion (or on any navigation that is not a root↔search tap).

## ENTER direction: structurally correct (auditor 3, 5)

Both auditors 3 and 5 confirm the ENTER fix in isolation is sound: a continuous `tapMorph` over `[0.2, 1]`, consumed by both the Page slide (`tapVisualOffset`) and the Header track (`searchProgress`), does synchronize them as the defect description demands. The ENTER-side geometry, the `tapVisualOffset` sign, the 160ms linear segment, and the persistent-publisher detection are all verified correct. The ENTER-side defects (NB12 clear-timing, NB13 drag-clear, NB14 stale leak) are implementable fixes, not architectural.

## Notable concerns (non-blocking)

- **§6 case 6 wording wrong.** A `/search → /activity` cross-tab chip-exit DOES flip `currentHasTabs` and `isSearch` and DOES have matching empty titles, so Effect E fires; it is harmless only because `searchProgress` is gated by `isSearch` (false on `/activity`). The plan's stated exclusion mechanism is incorrect.
- **§4.4 item 2 "exit dispatch is poll-only during a tap scrub" is stale for Round 5.** In Round 5 the publisher moved to Header; the tap scrub arms at nav-land (after `executePendingNav`), so the poll and the scrub never overlap. Remove or rewrite.
- **§4.4 item 1 `!== undefined` rationale.** `setTapMorph` is a field-level setter that does not route through `set`; the `!== undefined` vs `??` distinction only matters if a caller passes `tapMorph: null` through `set`, which the design forbids. The preservation rule is correct; the rationale is muddled.
- **§6 case 7 `W` reactivity.** `GesturePageLayout.svelte:180` `W` is `$derived` over non-reactive reads (functionally constant); the reactive width is `viewportWidth` (`:89`). Pre-existing; the plan's "tracks the new width" wording is wrong.
- **§7 first-frame sampler may be unfalsifiable.** Svelte batches Effect E's `tapMorph` write into the same flush as the `currentPath` change, so the first paint already reflects the start value; a rAF sampler cannot catch a single-flush flash.
- **Probe snapshot.** The DEV `HeaderStateSnapshot` does not capture `tapMorph`; extend it for debug visibility.

## Organic-clean

Clean (5/5). GPL reads only the general `pager.tapMorph`; no `resolveHeaderMode` import, no `/search` token. Header retains its existing `/search` detection net-unchanged.

## Architectural conclusion and scope decision (for the owner)

The Round-5 audit establishes that the DV17 §1 goal as written - synchronized Page/Header motion on BOTH tap enter and tap exit - is **only half-achievable in the current architecture**: ENTER is achievable (and the Round-5 design is correct for it modulo NB12-14); EXIT is topologically blocked (NB11), because the `/search` GPL intercepts the navigation pre-nav and animates before `page.url` updates, while the Header morph signal can only fire post-nav. Closing the EXIT side would require either (a) a pre-nav publisher (a Header `beforeNavigate` that arms the rAF before nav-land, plus a `searchProgress` rewrite that does not hard-cut on the `isSearch` flip), or (b) accepting EXIT as out-of-scope and keeping the pre-existing behavior (GPL CSS slide + post-nav Header scrub, unsynchronized but unchanged from master).

This is a scope decision the owner must make; the audit cannot resolve it. See `docs/DV17-Meeting/DV17-Plan-Journal.md` Round 5.
