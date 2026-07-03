# DV18 - Audit Round 3 (5-auditor, authoritative)

This is the authoritative Round-3 audit. It supersedes an earlier 3-auditor draft in this file that declared "3/3 PASS, loop exit"; that declaration was retracted because 3 auditors do not meet the DV09 standard of 5 per round, and the loop-exit was not legitimate. This re-audit ran 5 independent role-less auditors against the Round-2 revision of `docs/DV18-Plan.md` at local `master` (`84099b5`). Result: **5/5 PASS**, zero blocking issues.

## Tally

| Auditor | Verdict | Blocking | Organic           | Confidence  |
| ------- | ------- | -------- | ----------------- | ----------- |
| 1       | PASS    | 0        | clean             | high        |
| 2       | PASS    | 0        | has-special-cases | medium-high |
| 3       | PASS    | 0        | clean             | high        |
| 4       | PASS    | 0        | has-special-cases | high        |
| 5       | PASS    | 0        | has-special-cases | high        |

Result line: **5/5 PASS, zero blocking; but NOT a loop exit.** The organic split is 2 clean / 3 has-special-cases. DV09 exits at all organic=clean (`DV09-Plan-Journal.md` Round 3, Round 5); three auditors returned `has-special-cases`, so this round does NOT meet the DV09 exit bar. The earlier "loop exit / plan approved" declaration is retracted as overstating. The `has-special-cases` verdicts flag feature-specific code (`forwardDeepNeighbour`, the forward-edge branches, `searchPeekReveal`, the re-entry flag) entering the shared `tab-config.ts` and `MobileTabPager.svelte`; the three auditors judged it a bounded counterpart to the back-chip and passed it, but "passed with has-special-cases" is not the all-clean terminal verdict the loop targets.

## Verified at the source (every load-bearing claim)

- **§3.6 `hasLeft` is TRUE for `/search`.** `GesturePageLayout.svelte:100` `hasLeft = !!left || (navStore.activeTab >= 0 && navStore.activeTab <= 2)`. `/search` is a `GLOBAL_PREFIXES` route, so `getTabFromPath('/search', activeTab)` returns the launcher's `activeTab` (`navigation-logic.ts:47-54`); `handleBeforeNavigateNav` keeps `activeTab` on the same-tab forward push (`:137-163`). The back-swipe takes the `hasLeft` branch (`swipeEnd :699-716`) → `setPendingNav(resolvedLeftHref='/messages/inbox')` → `executePendingNav` → `hopForHref('/messages/inbox')` → `'back'` → `history.back()`. The round-trip already works today; the static `fallbackRoute="/"` is only the no-`backTarget` fallback.
- **§3.8 `shouldAnimateEnter()` returns TRUE for `/search`** (`GesturePageLayout.svelte:237-244`); `snapIndex` inits at 0 (`:261`), `enterRaf` flips to `ACTIVE` (`:932-937`), and the `tapMorph` scrub runs alongside. `/search` slides in on enter. (Caveat, carried to implementation: if the messages list is empty and the cache unpopulated, `leftNeedsLoading` is true and the `snapIndex` slide does not play; but the `tapMorph` scrub still drives the slide, so the user-visible behavior is preserved.)
- **§3.7 the `goto` push.** `navigateForward`'s `hopForHref` returns `'back'`/`'forward'` when `/search` is adjacent (`history-nav.ts:51-67`); `goto('/search')` is a guaranteed push and triggers the root layout hooks (`routes/+layout.svelte:74-117`) that update the virtual stack. The stronger reason `goto` is correct: `navigateForward` is the dispatcher for advancing to a TAB ROOT (`MobileTabPager.svelte:224`, `MobileTabBar.svelte:102`), and `/search` is not a tab root; a category error regardless of hop result.
- **§4.2 the four `tab-config.ts` sites.** `TabDef` (`:34-47`), `TabDefData` (`:49-56`), the messages `RAW_TAB_DEFS` entry (`:75-83`), the explicit `MOBILE_TAB_DEFS` map (`:86-94`, not a spread); `MOBILE_TABS` (`route-config.ts:362-367`) spreads `...tab`.
- **§4.3 the `dragging` predicate and z-index.** `MobileTabPager.svelte:105` plus `|| searchPeekReveal !== null`; back-chip `z-30` (`:425`) below the FAB `z-35` (`FloatingActionButtonLayer.svelte:425`); the ≥40 px right-edge inset clears the `w-8` OS-back reserve strip.
- **§3.5 Effect E at land.** Guards (`Header.svelte:433-439`) all pass: title `''` on both routes (neither sets `page.data.headerTitle`, neither in `deep-header-config.ts` ENTRIES), `dragging` false post-commit, `settling` false, `lastGestureMorph` 0.
- **§4.7 FAB.** Messages list FAB at scale 1 during the drag; eases to 0 at land via the `discreteNavInFlight` latch on the list→overlay family swap.
- **The re-entry guard.** `goto` does not flip `navStore.navInFlight` (only `executePendingNav` does, `navigation.svelte.ts:191-219`), so the local flag is required.

## Non-blocking concerns (carried to implementation)

1. **`searchPeekReveal` clear on mid-drag reversal in `swipeMove`.** The `swipeMove` else branch must clear `searchPeekReveal` (mirroring `backChipReveal = null` at `:216`) so a forward-then-reversed drag tears down the peek immediately, not only at release. Folded into the plan §4.4.
2. **The re-entry flag's lifecycle prose.** The earlier "cleared in `afterNavigate`" wording was wrong: `MobileTabPager` has no `afterNavigate` and unmounts at the route swap, so the flag dies with the component and resets on remount. Renamed `forwardGotoInFlight` to avoid collision with `navStore.navInFlight`. Folded into the plan §4.4.
3. **The right-edge inset rationale.** The 40 px inset is justified by the 32 px OS-back reserve strip; the `edgeDeadZone` is a separate finger-`pointerdown` filter, not a region the overlay paints into. Folded into the plan §4.3.
4. **§6 case 6 deep-link mechanism.** `seedStackForLanding` seeds a two-entry virtual stack; the back-swipe-to-`/` is a `goto('/')` push (no real previous browser-history entry), not `history.back()`. Folded into the plan §6.
5. **Effect E vs `/search`'s GPL initial-render ordering.** Cross-component `$effect.pre` ordering is not guaranteed; both slide drivers share a start position so no visible jump is expected, but an empirical e2e sample is the implementation-phase verification (§9).
6. **`/search`'s own forward edge.** `/search` has no forward target (`hasRight = !!right = false`); a forward swipe on `/search` rubber-bands. Acceptable per §8 (out of scope); noted for completeness.
7. **The `forwardDeepNeighbour` affordance is hardcoded to search content.** If a second neighbour is ever added, the overlay content must be parameterized. Out of scope.

## Completeness vs DV09 (noted, not blocking)

The DV18 plan is thinner than the DV09 reference in process rigor: it has no `git diff --` audit-gate section enumerating the shared primitives that must stay empty/controlled; no dedicated lifecycle/gotchas section (HMR, SSR, resize mid-drag, OS back-button during a forward drag); fewer edge cases (9 vs DV09's 22); and a lighter testing plan. For a feature this small (one new gesture edge, two modified files) the auditors judged the depth proportionate and the §3 inventory rigorous (every load-bearing claim verified). The audit-gate section is the most consequential gap to add at implementation time, so the "organic clean" property has machine-checkable enforcement.

## Loop-exit statement

NOT exited. 5/5 PASS with zero blocking, but the organic verdict is 2 clean / 3 has-special-cases; below the DV09 all-clean exit bar. The earlier declaration that the loop exited is retracted.

Why all-clean is uncertain for this feature. A rename (`searchPeekReveal` → a generic name) plus an organic-integration section would address the feature-token-naming concern (one of the three `has-special-cases` auditors flagged exactly that). But the deeper flag; feature-specific forward-edge branches living in the shared `MobileTabPager.svelte` swipe handler; likely persists unless the forward-edge logic is extracted into a feature-named module so the pager's diff reduces to a general hook point. Unlike DV09's FAB (a standalone component whose logic lived in FAB-named files, leaving only general hooks like the `active-gesture-track` store in shared primitives), DV18 is gesture-edge behavior tightly coupled to the pager's internals (`dragOffset`, `activeIndex`, `trackEl`, the pager store, the `detectSwipe` callbacks). Extraction is feasible but non-trivial, and it is not guaranteed to reach all-clean.

The §9 UNVERIFIED items (the enter-slide-covers-the-swap empirical check, the `goto`-push stack update, the `dragging` flush, the `forwardGotoInFlight` re-entry guard, the z-index/inset) remain implementation-phase verifications, independent of the organic verdict.
