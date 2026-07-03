# DV17 - Plan Audit Round 03

5 role-less open-ended auditors re-examined the Round-2 revision of `docs/DV17-Plan.md`. Result: **0/5 PASS, 5/5 CHANGES_REQUESTED** (all high confidence). Round-2 blockers NB1-NB4 are all RESOLVED; NB5 is PARTIAL (one sign error). Two new blocking issues survive, both narrow and concrete. Round-4 input is the revision in "Revision decisions".

## Tally

| Auditor | Verdict           | New blocking | NB1-NB5 status           | Confidence |
| ------- | ----------------- | ------------ | ------------------------ | ---------- |
| 1       | changes_requested | 1            | NB1✓ NB2✓ NB3✓ NB4✓ NB5∆ | high       |
| 2       | changes_requested | 2            | NB1✓ NB2✓ NB3∆ NB4✓ NB5∆ | high       |
| 3       | changes_requested | 1            | NB1✓ NB2✓ NB3✓ NB4✓ NB5∆ | high       |
| 4       | changes_requested | 1            | NB1✓ NB2✓ NB3✓ NB4✓ NB5∆ | high       |
| 5       | changes_requested | 1            | NB1✓ NB2✓ NB3∆ NB4✓ NB5∆ | high       |

(✓ = RESOLVED, ∆ = PARTIAL.)

## Round-2 blocker resolution (consensus)

- **NB1 RESOLVED (5/5).** `slideT` (`Header.svelte:205-207`) gates on `dragging || pager.tapMorph !== null` only (no `navInFlight`, preserving the deep→root "Tab descent" descent per the comment at `:195-204`); `trackStyle`/`searchButtonStyle`/`tabBarStyle` keep `navInFlight`. Consumers `rootLayerStyle`/`layerDownStyle` consume `slideT` only via `transition: ${slideT}`; the split does not break them.
- **NB2 RESOLVED (5/5).** `setTapMorph(value)` field-level setter; `set` preserves via `update.tapMorph !== undefined ? update.tapMorph : currentTapMorph`. All existing `pager.set` callers omit `tapMorph` and preserve it; `setTapMorph(null)` clears. No race.
- **NB3 RESOLVED (5/5; 2 mark residual empirical uncertainty).** `$effect.pre` arming lands `tapMorph` at its start value before the first post-nav render (precedent: `FloatingActionButtonLayer.svelte:98,239`). Two auditors note the `svelte-effect-pre-same-flush-rerun` memory and ask for an empirical first-frame sample to confirm; the mechanism is sound.
- **NB4 RESOLVED (5/5).** Exit `isSearchFlip` reads `resolveHeaderMode(page.url.pathname)` (source `/search`, still current inside GPL's `beforeNavigate`) vs `resolveHeaderMode(navigation.to.url.pathname)` (target). Verified `page.url` is not mutated by the root layout's earlier `beforeNavigate`; the stack-pop race is avoided.

## New blocking issues (Round 2 → Round 3)

**NB6 (5/5) - `tapVisualOffset` enter sign is inverted.** `docs/DV17-Plan.md` §4.4 item 3. The plan states `sign` is negative on enter, positive on exit, with base `calc(-${ACTIVE * STEP_PERCENT}% + ${tapVisualOffset}px)`. Geometry (`/search` GPL: `panelCount=2`, `ACTIVE=1`, `STEP_PERCENT=50`, track width `200%`): at enter start (`tapMorph=1`) the Page must rest on `/` (panel 0, `translateX=0`), so `tapVisualOffset` must be `+W` to cancel the `-W` base. With `sign=-1` the plan computes `tapVisualOffset=-W`, giving `translateX=-2W` - both panels off-screen left, a blank viewport for the entire `tapMorph ∈ (0.2,1]` segment (~160ms). The Header track (driven by `searchProgress`, independent of `sign`) slides correctly `0 → -W`, so the desync DV17 exists to fix is replaced by a worse blank-screen flash. The drag reference confirms it: `visualDragOffset` (`GesturePageLayout.svelte:452`) is POSITIVE on the back-swipe (the tap-exit analog). The morph sweep direction (enter `1→0`, exit `0→1`) already encodes the time direction; the spatial sign must be `+1` on BOTH. Fix: drop the `sign` parameter; `tapVisualOffset = W · max(0, (tapMorph − HEADER_MORPH_THRESHOLD) / (1 − HEADER_MORPH_THRESHOLD))` for both directions.

**NB7 (auditor 2) - the enter `$effect.pre` misfires on same-route `/search → /search?scope=` navigations.** §4.4 item 2. `SearchScopePager.switchTo` (`SearchScopePager.svelte:165-173`) calls `goto('/search?scope=…', { replaceState: true, noScroll: true })`. This is a SvelteKit navigation; `beforeNavigate` fires with `type='link'`, `to=from='/search'`. The `if (stack[last].pathname !== to)` guard (`navigation-logic.ts:158`) skips the push, so `activeStack` stays `[/, /search]`, but `direction` flips to `'forward'` (`:156`). At that moment `shouldAnimateEnter()` is true (`direction==='forward'`, stack length 2, `prevPath='/'===resolvedLeftHref`), and `isSearchFlip` (current `/search` mode 'search' vs `activeStack[len-2]='/'` mode 'root') is true - so the rAF arms and `setTapMorph(1)` fires, making `morph` jump `0 → 1` and the search panel flash off then re-slide-in on every scope tap. The deleted Effect E suppressed this via `if (curTabs === prevTabs) return;` (`Header.svelte:424`) plus its `prevIsSearch` tracking. Fix: the enter arming must require a strict root→search transition using a tracked previous pathname (`prevPathname !== currentPathname && resolveHeaderMode(prevPathname)==='root' && resolveHeaderMode(currentPathname)==='search'`), maintained by the `$effect.pre`, so a same-route scope switch (prev='/search', cur='/search') does not arm. This also closes the `/search ↔ /bookmarks` and `/search ↔ /discussion/*` boundary cases (no root↔search flip).

## Notable concerns (non-blocking)

- **`iconProgress` `&& currentHasTabs` scope.** §4.4 item 5 freezes on `tapMorph !== null`; the current code (`Header.svelte:194`) is `isSearch || (searchScrubbing && currentHasTabs)`. Direct substitution preserves the `currentHasTabs` scope; the plan should pin the substitution (observably identical on `/search`, but spec it).
- **`onTrackTransitionEnd` is poll-only during a tap scrub.** With CSS `duration-200` suppressed while `tapMorph !== null`, no `transitionend` fires; the exit dispatch relies entirely on `startPendingNavPoll` (`:572-619`, rAF-based computed-transform poll, 800ms wall-clock cap). Functional (the poll is the robust fallback), but the plan should state the dependency and the rAF-registration order (tap rAF armed before `startPendingNavPoll`).
- **`tapVisualOffset` terminal-value observability.** If the rAF sets the terminal value and clears `tapMorph` in the same tick (batched), the terminal is never rendered; this is fine because `snapIndex` has already advanced to `targetSnapIndex`/`ACTIVE`, so the `snapIndex` fallback yields the same transform. The plan's "no jump" claim should call out that it relies on `snapIndex` having advanced, not on the rAF's terminal value being observed.
- **Rapid-tap restart semantics.** §4.4 item 2 ("sets `tapMorph` to its start value synchronously") vs §6 case 4 ("restarts from the current `tapMorph`") differ for a mid-sweep reversal. Pick the start-value reset (matches the deleted `startSearchScrub`).
- **`$effect.pre` re-arm guard.** The enter `$effect.pre` should short-circuit when `tapMorph !== null` (rAF already in flight) so a dep change mid-sweep does not re-arm from the start value.
- **`W` reactivity.** `GesturePageLayout.svelte:180` `W` is not actually reactive (reads `window.innerWidth` once); the reactive width is `viewportWidth` (`:948`). Pre-existing; the plan repeats the "read per-frame" claim. Flag, do not fix in DV17.
- **Tap-EXIT e2e trigger.** Drive via `page.goBack()` (popstate → same-panel `beforeNavigate`), not a MobileTabBar tab-tap (the tab bar is off-screen on `/search`).
- **SearchScopePager `tapMorph` field.** Adding `tapMorph` to `createPagerStore()` adds it to the search scope pager too; it stays `null` there (SearchScopePager never calls `setTapMorph`, its `set` calls omit the field). Worth a one-line note.

## Organic-clean

Clean (5/5). No `/search`/`scope` token enters any shared primitive; `resolveHeaderMode` is a general mode utility (no circular dep; `header-mode.ts` imports only `getCurrentTabIndex` from `route-config.ts`, which GPL already imports). Header loses ~50 lines of `/search` machinery; GPL gains one import + the `isSearchFlip` check. Net-neutral-to-cleaner.

## Revision decisions (applied to `docs/DV17-Plan.md` as Round 3)

1. **Drop the `tapVisualOffset` sign parameter (NB6).** §4.4 item 3 uses `tapVisualOffset = W · max(0, (tapMorph − HEADER_MORPH_THRESHOLD) / (1 − HEADER_MORPH_THRESHOLD))` for BOTH enter and exit; the morph sweep direction (enter `1→0`, exit `0→1`) encodes the time direction. §6 case 1 and §9 updated.
2. **Strict root↔search arming with a tracked previous pathname (NB7).** The enter `$effect.pre` maintains `prevPathname`; it arms only when `prevPathname !== currentPathname && resolveHeaderMode(prevPathname) === 'root' && resolveHeaderMode(currentPathname) === 'search'`. The exit check is the symmetric `resolveHeaderMode(page.url.pathname) === 'search' && resolveHeaderMode(navigation.to.url.pathname) === 'root'`. This excludes same-route scope switches and `/search ↔ deep` transitions. The `$effect.pre` short-circuits when `tapMorph !== null` (no re-arm mid-sweep).
3. **Pin the non-blocking items.** §4.4 item 5 keeps the `iconProgress` `&& currentHasTabs` scope. §4.4 item 2 states the rapid-tap restart resets to the start value, and notes the exit dispatch is poll-only during a tap scrub (tap rAF armed before `startPendingNavPoll`). §7 drives the tap-EXIT e2e via `page.goBack()`. §5 notes the search scope pager's `tapMorph` stays null.

Open for Round 4: confirm the `tapVisualOffset` sign correction produces a frame-for-frame Page/track sync (the §7 assertion guards this); confirm the `prevPathname`-tracked arming excludes scope switches and arms exactly once per legitimate root↔search tap; and the empirical first-frame sample for NB3.
