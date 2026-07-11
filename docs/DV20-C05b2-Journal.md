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
