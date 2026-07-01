# DV10 - Audit Round 1

5 independent role-less auditors examined `docs/DV10-Plan.md` against the codebase at `43317e6`. Result: **not 5/5 PASS**. 3 of 5 auditors returned (auditors 2 and 4 were rate-limited by the API mid-run and did not complete; they are re-run in Round 2). Of the 3 returned: 2 FAIL, 1 PASS. Two convergent blockers drive the Round-1 revision.

## Tally

| Auditor | Verdict                   | Blocking | Major | Minor | Organic           |
| ------- | ------------------------- | -------- | ----- | ----- | ----------------- |
| 1       | FAIL                      | 2        | 2     | 3     | has-special-cases |
| 2       | (rate-limited, re-run R2) | -        | -     | -     | -                 |
| 3       | PASS                      | 0        | 0     | 6     | has-special-cases |
| 4       | (rate-limited, re-run R2) | -        | -     | -     | -                 |
| 5       | FAIL                      | 1        | 1     | 3     | has-special-cases |

Result line: **not 5/5 PASS → revised.**

## Convergent blockers

### B1 - Publishing `backMorph` on the centerTab branch regresses Header's thread-route morph (BLOCKING, auditors 1, 5)

The plan §4.1 proposes the GPL `centerTab` branch publish `backMorph: dragProgress / 1 / 0` (currently `null`). Header consumes `pager.backMorph` for the deep-page morph: `Header.svelte:142-143` dragging branch is `pager.backMorph ?? (currentHasTabs ? 1 : 0)`, and `:498-506` reads `pager.backMorph ?? 0` for `titleView.progress`, `:191` for `iconProgress`, `:526-539` for `rootLayerStyle`/`layerDownStyle`.

Thread routes (`/discussion/*`, `/messages/<id>`) resolve to Header `'root'` mode (`header-mode.ts:8-23`): the tab bar + hamburger + search-icon layout, with `getCurrentTabIndex('/discussion/123') === 0`. Header currently keeps `morph = 1` throughout a thread back-swipe because `backMorph` is `null` and the `??` falls back to `currentHasTabs ? 1 : 0 = 1`. Publishing non-null `backMorph = dragProgress` on thread routes makes `morph` drop from 1 toward 0 mid-swipe, which would raise the tab bar out of view (`rootLayerStyle translateY(-(1-morph)*100%)`), morph the hamburger into a back arrow (`iconProgress = 1-morph`), and crossfade the title - behavior thread routes never had and were not designed for (thread `backTarget` is not necessarily a tab root, so the deep-title settle semantics do not apply).

The plan §4.1/§8/§9 framed this only as a risk to verify, not as a fundamental signal conflict. The root issue: `backMorph` is overloaded - it is Header's deep-page morph signal AND the proposed FAB gesture signal, and on thread routes the two have incompatible semantics.

**Revision decision:** introduce a FAB-only live signal on the pager store (working name `coverProgress`), published by GPL on BOTH the centerTab and deep branches from the deadzone-free `rawDragOffset/viewportWidth` (the same computation the deep branch already uses for `backMorph`). Header does not read `coverProgress`; its `backMorph` consumption is unchanged (still `null` on thread routes). The FAB reads `pager.coverProgress` for the overlay family. This removes the overload and the Header regression entirely.

### B2 - The atom `scale`/`translate` split breaks the SSR assertion block and the inline-transform readers (BLOCKING, auditor 1; major scope-miss by auditor 5)

The plan §4.3 proposes splitting the atom's `transform: scale() translateY()` into individual `style:scale` + `style:translate` properties, transitioning only `scale`. Auditor 1 verified the blast radius the plan underestimated:

- `fab.spec.ts:117-290` SSR block (5+ tests) regex-matches `transform:\s*scale\([0-9.]+\)\s*translateY\(-?[0-9.]+px\)` (`:206`). After the split, `style` carries no `transform:` field; the whole SSR describe block fails.
- `fab.spec.ts:831` `readFabTransform` reads `fab.style.transform` and parses scale/translateY. After the split that string is empty → every call site (`:309,318,342,350,…`) reads NaN.
- `fab-deep-real-interaction.spec.ts:62-65` trajectory sampler reads `getComputedStyle(fab).transform` and matches `matrix(...)`. After the split the computed transform is `none` → scale parses as null.
- `fab-deep-page-boundary.spec.ts` SSR block (same regex).

The plan §7 said only "samplers read `.scale`", treating this as a single-point edit. It is a multi-file test rewrite.

**Revision decision:** do NOT split the atom. Keep `style:transform={`scale(${scale}) translateY(${translateY}px)`}` and the `.fab-transition { transition: transform 200ms ease-out }` class as-is. The cost: a route-swap CSS transition eases `translateY` too, so scroll-hide is briefly eased during a route transition (the scroll-hide `translateY` and the route-transition `scale` share the `transform` property). This is a minor visual imperfection, accepted in DV10, because the FAB is scaling during a route swap anyway and the scroll-hide state is stable across a route swap (`scroll-chrome` persists). No SSR/test breakage. A future cleanup can split the properties once the test suite is migrated to read individual properties.

## Major findings (non-blocking, addressed in revision)

### M1 - `familyNeedsSamplerDuringDrag('overlay')` must flip to false (auditor 1 F5)

`fab-scale.ts:106-108` returns `true` for `'overlay'`. The sampler arm effect (`FloatingActionButtonLayer.svelte:411`) uses it. If the overlay family switches to `coverProgress` and drops the sampler, `familyNeedsSamplerDuringDrag('overlay')` must become `false` (or the function reduced to `family === 'list'`), or the arm effect still starts the sampler for overlay. The plan §4.5 did not list this edit. **Revision:** §4.5 explicitly sets `familyNeedsSamplerDuringDrag` to list-only; `familyRestsAtSampleOne` is removed (only list remains, where it is always false - no information).

### M2 - `fab-scale.test.ts` not in the test-update list (auditor 5)

`fab-scale.test.ts:13-35` asserts the `2f-1` curve directly (`scaleFromFraction(0.25)===0`, `0.5===0`, `0.625===0.25`). The §4.4 full-range curve breaks every one. The plan §7 listed `fab.spec.ts`, `fab-deep-real-interaction.spec.ts`, `fab-deep-page-boundary.spec.ts` but missed the unit test. **Revision:** §7 adds `fab-scale.test.ts` rewrite to the new curve.

### M3 - `discreteNavInFlight` vs Family A sampler first-frame race, and the forward-enter mount gap (auditors 1 F3/F4)

With the sampler removed for overlay, the `transitionEnabled` gate `!pager.dragging && !samplerActive` is clean for overlay (no sampler to arm on click nav). For Family A the sampler still arms on track bind. The revision must state: `startSampler` sets `samplerActive = true` synchronously at entry (`FloatingActionButtonLayer.svelte:301-302`), so the arm-effect flush already has `samplerActive = true` before the first render - no first-frame race where transition and sampler both drive. Forward-enter mount gap on a deep route: `coverProgress` is 0 at rest, but the route-swap `transitionEnabled` (now armed by `discreteNavInFlight` for overlay↔list) eases the 1→0 scale over 200 ms; no flash.

## Minor findings (addressed in revision or noted)

- **MobileTabBar also reads `pager.backMorph`** (auditor 3). `MobileTabBar.svelte:55-63` reads `backMorph` for `isDeepSwipe` and pill expansion. Verified safe: the centerTab branch publishes `targetIndex: null` (`GesturePageLayout.svelte:355`), and `isDeepSwipe` requires `targetIndex !== null`, so it stays false regardless of `backMorph`. With the revision (FAB reads `coverProgress`, `backMorph` unchanged), this is moot. Noted for completeness.
- **`fab.spec.ts` Family B back test shares the synchronous-swipe compression bug** (auditor 3). `e2e/helpers.ts:swipeHorizontal` dispatches all touchMoves with `timestamp: 0` and no inter-step delay, compressing the drag into one frame. Family B back passes only because of this. §7 must rewrite the Family B back swipe to realistic speed, or it continues to hide the thread-route defect.
- **`/search` audit** (auditor 1 F6). `/search` runs the GPL deep branch (`:359-407`), already publishes `backMorph`/`coverProgress`; the inner `SearchScopePager` is a separate store that does not leak to primary. DV10 does not touch `/search`. §4 notes this explicitly.
- **D assertion too weak** (auditor 1 F7). The revision strengthens the D e2e to compare the trough minimum against the second-leg peak (monotonic rise ≥ 0.7 after the trough), not just an absolute ≥ 0.4 threshold.
- **overlay↔compose family swap** (auditor 5). `discreteNavInFlight` enumeration should cover any non-null distinct `(prev, current)` family pair, not just overlay↔list and compose↔list. Both endpoints rest at scale 0 so it is cosmetic, but the latch is generalized for clarity.

## Organic verdict

All three returning auditors returned `has-special-cases`. The plan is a substantial move toward a pure-function drive (overlay reads a live signal, holdover removed, full-range curve), but it retains: the Family A sampler as a second scale path, the `discreteNavInFlight` timer-based latch (mirroring `familyCInFlight`), and - in the v1 draft - overloaded `backMorph` (a special-case that caused B1). The Round-1 revision removes the overload (FAB-only `coverProgress`) and keeps the two pragmatic special-cases (Family A sampler for snap continuity, the discrete-nav latch for mount-gap transition) with honest justification. A future cleanup (MobileTabPager publishes a continuous snap-progress so Family A also drops the sampler) remains out of scope.

## Verified-TRUE facts carried forward

- `GesturePageLayout.svelte:336-358` centerTab branch publishes `backMorph: null` (`:354`); the deep branch (`:359-407`) publishes `backMorph: progress` (`:388`), both computing progress from `rawDragOffset/viewportWidth` deadzone-free.
- `Header.svelte:142-143` reads `pager.backMorph ?? (currentHasTabs ? 1 : 0)`; thread routes are `'root'` mode (`header-mode.ts:8-23`) and rely on `backMorph === null`.
- `MobileTabBar.svelte:55-63` reads `backMorph` but is gated on `targetIndex !== null` (always null on centerTab), so it is safe.
- `fab-scale.ts:37-39` `scaleFromFraction = clamp(2f-1, 0, 1)` - the 0.5 threshold is the direct cause of B/D and the fast-drop in A.
- `e2e/helpers.ts:swipeHorizontal` dispatches synchronous touchMoves with `timestamp: 0`, compressing drags; Family B back test passes because of this, hiding the thread-route defect.
- `FloatingActionButton.svelte:70` combined `transform` binding is mirrored across the SSR tests, `readFabTransform`, and the trajectory samplers; splitting it is a multi-file test rewrite, not a single edit.
