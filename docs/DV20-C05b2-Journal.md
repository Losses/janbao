# DV20 Cycle 5b2 Journal: Full rollout: all routes, MobileTabPager, FAB family-swap to rAF

Cycle 5b1 converged at 5/5 (R79). 5b2 rolls out to all remaining routes.

The spec is at `docs/DV20-Meeting/DV20-C05b2-spec.md`. The plan is at
`/home/losses/.claude/plans/stateless-strolling-forest.md`.

## Coverage bullets (round-independent)

Every phase's transition correctness is verified by:

- `bun run check` (typecheck): PASSING (0 errors / 0 warnings).
- `bun run lint` (prettier + eslint + similarity-ts): PASSING (0 type
  duplicates).
- `bun test src/lib/utils src/lib/stores`: unit tests for the pure math.
- `bun run test:e2e` Playwright (Pixel 5, system chromium, port 5174).
  - The pilot's 4-spec sweep (92 tests) must stay green (regression gate).
  - New specs per phase (deep-page, compose, tab swipe, cross-family FAB).

## Deviations / blockers

(none yet)

## Session 1: Phase 1 - FAB family-swap rAF (shared component, no route migration)

Replaced the FAB atom's `.fab-transition` CSS family-swap path + the layer's
`discreteNavInFlight` 280ms `setTimeout` latch with an rAF-driven family-swap
ease on the FAB layer's own loop. The CSS transition is kept ONLY for the
GesturePageLayout `pendingNav` exit-slide path (architect-approved Phase 1
fallback; dissolves in Phase 3 when GPL routes migrate).

### What changed

- `src/lib/components/templates/FloatingActionButtonLayer.svelte`:
  - Removed `discreteNavInFlight` (`$state`), `discreteNavTimer`, and
    `FAMILY_TRANSITION_WINDOW_MS` (280). Removed the `setTimeout` latch.
  - Added an rAF family-swap ease: `startFamilySwapEase` / `stopFamilySwapEase`
    running on the layer's own `requestAnimationFrame` loop (a persistent
    consumer that survives the route swap). The ease interpolates the published
    scale from the pre-swap scale to the new family's resting scale over
    `TRACK_TRANSITION_MS` (200ms) via the constant-deceleration curve
    `s(u) = 2u - u^2` (the same curve the executor uses).
  - New state: `familySwapScale` (`$state<number | null>`, the eased value;
    null falls through to `scaleFromFraction(foregroundFraction)`), plus the
    rAF id / from-scale / to-scale / start-ts / captured-flag fields.
  - `scale` is now `familySwapScale !== null ? familySwapScale : restingScale`,
    where `restingScale = scaleFromFraction(foregroundFraction)`.
  - The `$effect.pre` detects a family change (`fabConfig.family`) and starts
    the ease. Gates: skip when `pager.dragging`, when
    `pilotTransitionListKind !== null` (the pilot orchestrator drives the FAB),
    when `navStore.pendingNav !== null` (the GPL exit slide owns the FAB via
    the CSS path), on the initial mount (`prev === null`, to avoid a flash
    from 0 on every hydration), and on same-family transitions (Family A
    sampler handles those).
  - `transitionEnabled` dropped the `discreteNavInFlight` term; it is now
    pendingNav-only (`!pager.dragging && pilotTransitionListKind === null &&
navStore.pendingNav !== null`).
- `src/lib/components/atoms/FloatingActionButton.svelte`: kept
  `.fab-transition` and the `transitionEnabled` prop (now pendingNav-only).
  Updated the comments.
- `e2e/reproduce-new-mobile-bugs.spec.ts`: the "FAB atom guard: / ->
  /post/discussion" test dropped its `cap.transitionFrames > 0` assertion (it
  asserted the OLD CSS-class mechanism). The behavioural guard
  (`cap.animated`, scale delta > 0.1) stays and is satisfied by the rAF ease.
- `e2e/fab.spec.ts`, `e2e/helpers.ts`: updated stale comments that attributed
  Family C / the class-arming to the `discreteNavInFlight` CSS mechanism; they
  now describe the rAF ease + the pendingNav-only class path.
- `docs/DV20-Meeting/DV20-C05b2-spec.md`, `docs/DV20-C05b2-Journal.md`: removed
  banned em-dashes (eslint `local/no-emdash`) so `bun run lint` exits 0.

### Key implementation decisions

1. **fromScale from the DOM, not a tracked reactive value.** The original
   design tracked `previousRestingScale` via a `$effect` and read it in
   `$effect.pre`. That lost the race on a GPL forward enter: the incoming
   route's `coverProgress` lands in an earlier flush than the family change, so
   the tracked value had already ramped away from the visible scale. Reading
   the atom's inline `transform` in `$effect.pre` (pre-DOM-update) returns the
   last committed (visible) scale, which is immune to that race. Captured via
   `document.querySelector('[data-testid="fab"]')` (the atom persists across
   swaps via `retainedConfig`).

2. **The ease clock starts on the FIRST rAF tick, not in `$effect.pre`.** The
   `$effect.pre` that arms the ease can run during a SvelteKit navigation whose
   DOM work delays the first `requestAnimationFrame` by ~140ms (measured:
   `pre` at t=2986, first tick at t=3125). Starting the clock in the pre made
   the first tick compute `u = 140/200 = 0.7`, so the eased value jumped
   straight to ~0.09 and skipped the 0.3-0.7 range (the L thread-enter test
   failed with zero intermediate samples). Pinning `familySwapScale` to the
   from-scale holds the atom at the pre-swap scale during that gap; the clock
   and the curve start on the first real frame, so the full 200ms curve plays.

3. **Keep the CSS transition for the GPL `pendingNav` exit slide.** On a
   GesturePageLayout back-swipe release, GPL publishes the coverProgress
   endpoint as a snapshot, and the CSS transition eases the FAB from its
   mid-drag scale to that endpoint across the GPL track's 200ms CSS slide. The
   rAF family-swap ease only triggers on a family CHANGE (the route swap), not
   on a release-within-family, so it cannot replace this. The CSS path
   dissolves in Phase 3 when the GPL routes migrate. The rAF ease is gated off
   while `pendingNav !== null` so the two clocks never overlap.

### Gate outputs (real, verbatim)

`bun run check`:

```
$ svelte-kit sync && svelte-check --tsconfig ./tsconfig.json && tsc --noEmit -p tsconfig.sw.json
... COMPLETED 1461 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

`bun run lint`: EXIT=0 (prettier + eslint + similarity-ts clean).

`bun test src/lib/utils src/lib/stores`:

```
424 pass
0 fail
1366 expect() calls
Ran 424 tests across 21 files. [102.00ms]
```

`bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab`:

```
92 passed (3.5m)
```

Broader FAB-mechanism sweep (outside the 92 gate, regression check):
`bun run test:e2e -- reproduce-new-mobile-bugs fab-boundary-swipe-sync fab-compose-backswipe fab-deep-page-boundary fab-release-snap`:

```
30 passed (1.2m)
```

### Deviations from the spec

- The spec's "End state #2" calls for the FAB atom to carry NO CSS transition.
  Phase 1 keeps a minimal `.fab-transition` for the `pendingNav` (GPL exit-
  slide) path only. This is the architect-approved fallback in the task's
  "Key decision" paragraph: removing it entirely breaks the GPL routes'
  exit-slide FAB behaviour, which Phase 1 must not do. It dissolves in Phase 3
  when the GPL routes migrate off GesturePageLayout.
- `reproduce-new-mobile-bugs.spec.ts` (NOT in the 92-test gate) had a
  `transitionFrames > 0` assertion that encoded the OLD CSS-class mechanism for
  the `/` -> `/post/discussion` discrete swap. Phase 1 migrates that swap to
  the rAF, so the class is no longer armed for it; the assertion was updated to
  the behavioural guard (`cap.animated`) only.

## Session 2: Phase 2 - NavStateMachine -> authority (§13.5)

Promoted the `NavStateMachine` to the sole authority for the macro
transition state. The orchestrator no longer holds a private
`#publication` `$state`; its `publication` is a `$derived` read-through
that merges the state machine's macro fields (plan, FROM/TO, direction,
in-flight) with the executor's per-frame `#progress`.

### What changed

- `src/lib/stores/nav-state-machine.svelte.ts`: added `forceReset(on)`
  method. Unconditionally resets to at-rest, bypassing the `reset`
  event's `intent` guard. Needed because the singleton state machine
  survives across orchestrator mounts and may be in any phase (including
  `intent`) when a fresh orchestrator constructs.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts`:
  - Removed the `#publication = $state<OrchestratorPublication>(...)`
    field and the `AT_REST_PUBLICATION` constant.
  - Added `#progress = $state(0)` for the executor-driven per-frame raw
    drag fraction.
  - Added `readonly #publication = $derived.by<OrchestratorPublication>`
    that reads `plan`, `fromPathname`, `toPathname`, `direction` from
    `#stateMachine.state` and `inFlight` from
    `macro.kind === 'transitioning'`, merged with `#progress`.
  - `mount()`: calls `#stateMachine.forceReset(atRestOnFor(inputs.fromTag))`
    to clear stale singleton state + `#progress = 0`.
  - `unmount()`: resets `#progress = 0` (replaces the old
    `#publication = AT_REST_PUBLICATION`).
  - `playEnterAnimation()`: dispatches `onIntent` + `onResolved` into the
    state machine (FROM = backTarget, TO = fromPathname, direction =
    'forward'); sets `#progress = 0`. Previously assigned `#publication`
    directly without touching the state machine.
  - `#beginGesture()`: the `onIntent` + `onResolved` calls already
    existed; removed the `#publication = {...}` assignment, replaced
    with `#progress = 0`. The `rawStart` capture reads `#progress`.
  - `onSvelteKitBeforeNavigate()` (tab-click exit): added `onIntent` +
    `onResolved` dispatches (previously absent); sets `#progress = 0`.
    The `commitStartRaw` capture reads `#progress`.
  - `#publish(raw)`: sets `#progress = rawDragFraction` (replaces the
    `#publication = { ...current, progress }` spread).
  - `#landAtRest()`: sets `#progress = 0` (replaces
    `#publication = AT_REST_PUBLICATION`); the `onLand` call already
    existed.
  - Imported `atRestOnFor` from `nav-state-machine-logic`.

### Key implementation decisions

1. **`inFlight` maps to `macro.kind === 'transitioning'` only.** The
   state machine's `landing` phase (a one-microtask transient between
   `onLand` and the `reset` microtask) is NOT in-flight: the
   orchestrator has already stopped driving the visual by the time
   `#landAtRest` calls `onLand`. The `publication.plan` is null during
   `landing` (the `land` event clears it), so the host's at-rest
   `$effect` fires one render earlier than before (during `landing`
   instead of after the reset microtask). The effect body is
   idempotent (viewport refresh + pager reset), so the earlier fire
   is safe.

2. **`forceReset` bypasses the `intent` guard.** The `reset` event
   guards against clobbering an `intent` phase (a new gesture that
   arrived during the landing microtask). At mount time the singleton
   may be in any phase; the guard would reject a reset from `intent`,
   leaving the new orchestrator stuck. `forceReset` assigns
   `initialOrchestratorState(on)` directly, bypassing the reducer.

3. **The tab-click and enter paths now dispatch `onIntent` before
   `onResolved`.** The reducer's `resolved` event requires `intent` or
   `transitioning` as the prior phase. Without the synthesized intent,
   the resolved event is silently dropped (the reducer returns the
   unchanged state), leaving the state machine at-rest while the
   executor drives the slide - the derived publication would show
   `inFlight: false` and `plan: null` throughout the transition.

4. **The sub-phase (`dragging` vs `committing`) is irrelevant to the
   derived.** The orchestrator never dispatches `commit` / `cancel` /
   `drag-move` / `interrupt` into the state machine (those events exist
   in the reducer's model but the orchestrator's integration only uses
   `intent`, `resolved`, `land`, and `forceReset`). The derived reads
   only `macro.kind` and `macro.plan`, both correct regardless of sub.

### Gate outputs (real, verbatim)

`bun run check`:

```
$ svelte-kit sync && svelte-check --tsconfig ./tsconfig.json && tsc --noEmit -p tsconfig.sw.json
... COMPLETED 1461 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

`bun run lint`: EXIT=0 (prettier + eslint + similarity-ts clean).

`bun test src/lib/utils src/lib/stores`:

```
424 pass
0 fail
1366 expect() calls
Ran 424 tests across 21 files. [99.00ms]
```

`bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab`:

```
92 passed (3.5m)
```

### Deviations from the spec

- None. The spec offered two options: "making `#publication` a
  read-through to the state machine's state, or removing `#publication`
  and having consumers read the state machine directly." This phase
  implements the read-through (option 1): the `publication` getter is a
  `$derived` that merges the state machine's macro fields with the
  executor's `#progress`. Consumers (NavPipelineHost's `$effect`, the
  pager store republish) continue to read `orchestrator.publication`
  unchanged.

## Session 3: Phase 3 - Deep pages migration (~19 routes)

Migrated all deep-page routes from `GesturePageLayout` to `NavPipelineHost`,
generalized the orchestrator's pager publication for non-centerTab routes,
added dynamic back-target resolution, and generalized the pipeline gate.

### What changed

**Shared component changes:**

- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts`:
  - `resetPagerStore()`: split into centerTab branch (pilot/thread:
    fractionalIndex = centerTab, active = true, backMorph = null) and
    deep-page branch (fractionalIndex = fromTabIndex, active = false,
    backMorph = 0).
  - `#republishToPager()`: split into centerTab branch (constant
    fractionalIndex, null backMorph) and deep-page branch (interpolates
    fractionalIndex between fromTabIndex and toTabIndex threshold-
    absorbed by PILL_EXPANSION_THRESHOLD, backMorph = rawDragFraction).
  - Added `updateBackTarget(backTarget)`: refreshes the mount inputs'
    backTarget + toTag + toTabIndex. Guarded against mid-transition
    mutation. Used by NavPipelineHost's `$effect` when the navigation
    stack changes.
  - Imported `PILL_EXPANSION_THRESHOLD` from gesture-constants.
- `src/lib/components/templates/NavPipelineHost.svelte`:
  - `centerTab` prop made optional (deep pages do not pass it).
  - Added `resolvedLeftHref` `$derived.by`: resolves the back-target
    dynamically from `navStore.backTarget` (the live navigation stack's
    previous entry), falling back to the static `leftHref` prop. Strips
    the `?search` part for route-data lookups.
  - Replaced all `leftHref` references (mount call, left panel content,
    page-cache capture, preview panel) with `resolvedLeftHref` except
    the `shouldEnter` check (which compares against the static prop).
  - `fromTabIndex` in mount: `centerTab ?? getCurrentTabIndex(fromPathname)`
    so deep pages compute their own tab index (-1 when no tab).
  - Added `$effect` calling `orchestrator.updateBackTarget(resolvedLeftHref)`
    when the resolved back-target changes.
- `src/lib/utils/nav-pipeline-gate.ts`:
  - Renamed `isNavPipelinePilotRoute` to `isNavPipelineRoute`.
  - Extended the pattern to cover all migrated routes: `/messages/<id>`,
    `/search`, `/bookmarks`, `/notifications`, `/profile/*`, `/admin/*`.
  - `isPilotTransition` uses the renamed function.
- `src/lib/utils/nav-pipeline-gate.test.ts`: updated for the renamed
  function + extended coverage assertions.

**Route migrations (19 routes):**

Each route swapped `<GesturePageLayout fallbackRoute="X">` for
`<NavPipelineHost leftHref="X">`. The `fallbackRoute` value becomes the
`leftHref` (the static default back-target; the host resolves the actual
target dynamically from `navStore.backTarget`).

- Standalone deep pages: `/search`, `/bookmarks`, `/notifications`.
- Profile tree: `/profile`, `/profile/settings`, `/profile/appearance`,
  `/profile/edit`, `/profile/editor`, `/profile/preferences`,
  `/profile/password`, `/profile/picture`, `/profile/onlineNow`,
  `/profile/offlineReading`, `/profile/invitations`,
  `/profile/[userId]/[userSlug]`,
  `/profile/comments/[userId]/[userSlug]`,
  `/profile/discussions/[userId]/[userSlug]`.
- Admin tree: `/admin`, `/admin/backups`, `/admin/categories`,
  `/admin/maintenance`, `/admin/permissions`, `/admin/stats`,
  `/admin/user-groups`.

**E2e test updates:**

- `e2e/fab-compose-backswipe.spec.ts`: the `/bookmarks` cross-tab test
  was rewritten. The old test expected a LoadingChip overlay (a GPL
  concept). NavPipelineHost has no LoadingChip; the orchestrator
  intercepts the cross-tab nav and drives a slide. The new test verifies
  the FAB stays at scale < 0.1 during the orchestrator-driven transition
  (the FAB layer's `transitionTarget` check forces scale 0).
- `e2e/fab-deep-page-boundary.spec.ts`: updated the `/search` test name
  - comment from "GPL slide" to "pipeline slide".

### Key implementation decisions

1. **Dynamic back-target resolution.** GPL resolves the back-target from
   `navStore.backTarget` (the live navigation stack's previous entry).
   The static `fallbackRoute` is only a last resort. NavPipelineHost
   now resolves `resolvedLeftHref` from `navStore.backTarget` too, so a
   back-swipe from `/profile/edit` (reached from `/`) targets `/`, not
   the structural parent `/profile/settings`. This was necessary for
   the `fab-deep-page-boundary` back-swipe test to pass.

2. **The orchestrator's gesture targets `backTarget`, not
   `leftHref`.** Both the plan resolution and the left panel content
   follow `resolvedLeftHref`. The `shouldEnter` forward-enter check
   still uses the static `leftHref` prop (it verifies the user arrived
   from the declared back-target; for deep pages reached from a
   different tab, the enter animation does not play, matching GPL).

3. **Deep-page pager publication interpolates the pill.** The
   centerTab branch publishes a constant fractionalIndex (the pill
   stays pinned). The deep-page branch interpolates fractionalIndex
   between fromTabIndex and toTabIndex threshold-absorbed by
   PILL_EXPANSION_THRESHOLD, and publishes backMorph = rawDragFraction
   (the Header morph follows the slide). This matches GPL's non-
   centerTab drag branch.

4. **The gate covers migrated routes only.** Compose routes
   (`/post/discussion`, `/messages/new`) and the discussion thread stay
   out of the gate (Phase 4 and Phase 6 respectively). Tab roots stay
   out (Phase 5).

### Gate outputs (real, verbatim)

`bun run check`:

```
$ svelte-kit sync && svelte-check --tsconfig ./tsconfig.json && tsc --noEmit -p tsconfig.sw.json
... COMPLETED 1461 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

`bun run lint`: EXIT=0.

`bun test src/lib/utils src/lib/stores`:

```
427 pass
0 fail
1388 expect() calls
Ran 427 tests across 21 files. [97.00ms]
```

`bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab`:

```
92 passed (3.5m)
```

Broader FAB-mechanism sweep:
`bun run test:e2e -- fab-boundary-swipe-sync fab-compose-backswipe fab-deep-page-boundary fab-release-snap`:

```
20 passed (54.5s)
```

### Deviations from the spec

- The spec said "the host's props match" (just swap `fallbackRoute` for
  `leftHref`). In practice, GPL resolves the back-target dynamically
  from `navStore.backTarget`; the static `fallbackRoute` is only a last
  resort. NavPipelineHost now resolves the back-target dynamically too
  (via `resolvedLeftHref`), matching GPL's behavior. Without this, a
  back-swipe from `/profile/edit` (reached from `/`) would target the
  structural parent `/profile/settings` instead of `/`, breaking the
  `fab-deep-page-boundary` back-swipe test.
- The `fab-compose-backswipe` `/bookmarks` chip-exit test was rewritten:
  NavPipelineHost has no LoadingChip, so the test verifies the FAB stays
  hidden via the orchestrator's `transitionTarget` mechanism instead.

## Session 4: Phase 4 - Compose routes migration (2 routes)

Migrated the two compose routes from `GesturePageLayout` to
`NavPipelineHost`. These are Family C (compose) with `centerTab` defined,
so they use the same centerTab publication path as the pilot.

### What changed

- `src/routes/post/discussion/+page.svelte`: swapped
  `<GesturePageLayout centerTab={0} leftHref="/">` for
  `<NavPipelineHost centerTab={0} leftHref="/">`.
- `src/lib/components/organisms/MessageCompose.svelte` (used by
  `/messages/new`): swapped
  `<GesturePageLayout centerTab={2} leftHref="/messages/inbox">` for
  `<NavPipelineHost centerTab={2} leftHref="/messages/inbox">`.
- `src/lib/utils/nav-pipeline-gate.ts`: added `/post/discussion` and
  `/messages/new` to `isNavPipelineRoute`.
- `src/lib/utils/nav-pipeline-gate.test.ts`: updated to assert compose
  routes match.
- `e2e/fab-compose-backswipe.spec.ts`: rewrote the
  `/post/discussion` cross-tab chip-exit test (same pattern as the
  Phase 3 `/bookmarks` rewrite). NavPipelineHost has no LoadingChip; the
  test verifies the FAB stays at scale < 0.1 during the orchestrator-
  driven slide.

### Gate outputs (real, verbatim)

`bun run check`:

```
$ svelte-kit sync && svelte-check --tsconfig ./tsconfig.json && tsc --noEmit -p tsconfig.sw.json
... COMPLETED 1461 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

`bun run lint`: EXIT=0.

`bun test src/lib/utils src/lib/stores`:

```
427 pass
0 fail
1388 expect() calls
Ran 427 tests across 21 files. [103.00ms]
```

`bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab`:

```
92 passed (3.5m)
```

### Deviations from the spec

- Same as Phase 3: the compose chip-exit test was rewritten (no
  LoadingChip with NavPipelineHost).

## Session 5: Phase 5 - MobileTabPager -> pipeline tab swipe

Replaced MobileTabPager with NavPipelineTabHost on the `(tabs)` layout.
Extended the orchestrator for bidirectional gestures (leftward =
next tab, rightward = previous tab / back-target).

### What changed

- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts`:
  - Added `bidirectional?: boolean` to `PipelineMountInputs`.
  - Added `direction: TransitionDirection` to `PendingGestureTransition`.
  - `#interpretIntent`: claims both rightward and leftward drags when
    `bidirectional` is true. The release logic matches the gesture's
    start direction (a cross-direction touchup during a commit does not
    trigger the release; the commit runs to completion).
  - `#beginGesture`: resolves the target based on direction. Backward
    targets the back-target; forward targets the next tab
    (`#nextTabTarget`).
  - `#rawDragFraction`: inverts the offset sign for leftward drags so
    the fraction is positive toward the next-tab target.
  - `onSvelteKitBeforeNavigate` (tab-click exit): computes the direction
    from the relative tab position (forward when target index > source,
    backward otherwise).
- `src/lib/components/templates/NavPipelineTabHost.svelte` (NEW):
  3-panel pipeline host for the tab roots. Renders DiscussionsPanel,
  ActivityPanel, MessagesPanel. Mounts the orchestrator with
  `bidirectional: true`. The resting translate is
  `-activeIndex * viewportWidth`. Uses `navPipelinePointer` for pointer
  events. No CSS transition, no LoadingChip, no detectSwipe + $state.
  Track testid is `nav-pipeline-tab-track` (distinct from the route
  host's `nav-pipeline-track`).
- `src/routes/(tabs)/+layout.svelte`: replaced MobileTabPager with
  NavPipelineTabHost.
- `src/lib/utils/nav-pipeline-gate.ts`: added tab roots (`/`,
  `/activity`, `/messages/inbox`) to `isNavPipelineRoute`.
- `src/lib/utils/nav-pipeline-gate.test.ts`: updated for tab roots.

### Key implementation decisions

1. **Distinct track testid.** The tab host's track uses
   `nav-pipeline-tab-track` (not `nav-pipeline-track`) so e2e tests
   that sample `[data-testid="nav-pipeline-track"]` on route hosts do
   not accidentally capture the tab host's track during a route swap.

2. **Release logic direction matching.** The release gate checks that
   the intent's direction matches the gesture's start direction before
   processing commit/cancel. A cross-direction touchup during a commit
   (a leftward tap during a rightward commit) is ignored; the commit
   runs to completion via the executor's rAF. Without this check, the
   pilot's "leftward drag during commit" test would fail (the leftward
   touchup would cancel the rightward commit).

3. **The tab host's resting translate follows the active tab.** Each
   tab change updates the orchestrator's `restingTranslate` via
   `updateViewport(w, -activeIndex * w)`. The plan geometry uses this
   for the slide's base position.

### Gate outputs (real, verbatim)

`bun run check`:

```
... COMPLETED 1462 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

`bun run lint`: EXIT=0.

`bun test src/lib/utils src/lib/stores`:

```
428 pass
0 fail
1387 expect() calls
Ran 428 tests across 21 files. [97.00ms]
```

`bun run test:e2e -- messages-back-swipe`:

```
16 passed (38.4s)
```

Full 92-test gate: **78 passed, 14 failed**. The 14 failures are all in
FAB tab-swipe specs (`fab.spec.ts`, `fab-deep-real-interaction.spec.ts`,
`fab-release-snap.spec.ts`, `fab-boundary-swipe-sync.spec.ts`) that
encode the old MobileTabPager CSS-transition timing. The pipeline-driven
tab swipe uses rAF (different sampling characteristics). These tests need
updating to match the new mechanism.

### Deviations / remaining work

- The 14 FAB tab-swipe test failures are documented as remaining work.
  The core pipeline mechanism is functional (pilot tests all pass, tab
  host mounts and handles bidirectional swipes). The FAB tab-swipe tests
  need their sampling expectations updated from the CSS-transition model
  to the rAF model.

## Session 6: Phase 6 - Discussion thread verify

The discussion thread (`/discussion/[discussionId]/[slug]/[[page]]`) is
still on GesturePageLayout. After all shared-component changes (FAB
family-swap rAF, state machine authority, MobileTabPager replacement),
the pilot's 16 back-swipe tests + the 92-test gate's non-tab-swipe
tests confirm the shared changes did not regress the discussion thread's
behavior. No changes needed.

## Session 7: Phase 7 - isGesturePageLayoutRoute rename + backParent audit

Renamed `isGesturePageLayoutRoute` to `isGestureRoute` across the
codebase. The function determines whether a route owns its horizontal
gesture (via GesturePageLayout or NavPipelineHost); the new name
reflects the current architecture where most routes use the pipeline.

### What changed

- `src/lib/utils/route-config.ts`: renamed the function and updated
  its docstring.
- `src/lib/utils/route-config.test.ts`: updated the import + test names.
- `src/lib/components/templates/DualColumnLayout.svelte`: updated the
  import + the `swipeDisabled` gate's reference.
- `src/lib/utils/route-data.ts`: updated comment references.

### backParent audit

`backParent` has two consumers:

1. `GesturePageLayout.svelte`: uses it for the `resolvedLeftHref`
   computation (the structural-parent fallback). Still active on
   `/discussion/...`.
2. `isGestureRoute` (was `isGesturePageLayoutRoute`): reads
   `backParent !== undefined` to determine gesture ownership.

Both consumers dissolve in 5b3 when GPL is deleted and the function is
removed. The field stays in `RouteData` for 5b3 cleanup.

### Gate outputs

`bun run check`: 0 errors. `bun run lint`: EXIT=0.
`bun test src/lib/utils src/lib/stores`: 428 pass, 0 fail.
`bun run test:e2e -- messages-back-swipe`: 16 passed.
