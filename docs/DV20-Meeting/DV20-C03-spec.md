# DV20 Cycle 3 Spec: State machine core + tag-pair resolvers (Layers 1-4)

**Architect:** the document owner. **Executor:** the Cycle 3 Manager Agent (CMA3). **Protocol:** `docs/DV20-Meeting/DV20-Cycle-Manager-Protocol-v2.md` (v2, binding). **Status:** ready for CMA3.

## Scope

Build the state machine core (Layers 1-4 of the five-layer pipeline) as NEW files, in shadow/parallel mode. The resolvers produce TransitionPlans but do NOT drive the DOM (the executor lands in Cycle 4). The existing MobileTabPager and GesturePageLayout continue to own the gesture; Cycle 3's output is verified by unit tests (the resolvers are pure functions) and by shadow-mode comparison (does the plan match what the old system actually does?).

## Background

- `docs/DV20-Plan.md` §2 (the five-layer pipeline), §4 (tag-pair resolvers, six pairs), §6 (state machine phases), §11 (protocol v2), §13 (values).
- Cycle 1 output: `RouteData` (tag/backParent/snapshotCapture/fab) in `src/lib/utils/route-data.ts`.
- Cycle 2 output: `PageCacheStore` in `src/lib/stores/page-cache.svelte.ts` (capture/get/invalidate/ensure, pluggable source).

## End state

1. **Layer 1 (orchestrator)**: a state machine module that tracks the macro state of a navigation transition. Macro phases: `at-rest`, `intent`, `resolving`, `transitioning` (with the active resolver + phase), `landing`. Owns interruption handling + SvelteKit interop hooks. Does NOT replace MobileTabPager/GesturePageLayout (shadow mode).

2. **Layer 2 (intent classifier)**: classifies raw input (pointer events, taps, popstate, hash change) into an intent + continuous parameters (direction, live offset, live velocity). Pure; no side effects; no DOM writes.

3. **Layer 3 (resolver dispatch)**: a pure function `resolve(intent, stack, route-data) -> TransitionPlan`. Six tag-pair resolvers: `{tab,tab}`, `{detail,detail}`, `{search,search}`, `{tab,detail}`, `{tab,search}`, `{detail,search}`. Each produces per-consumer animation plans (page-track direction, FAB plan, Header plan) as functions of `(progress, liveOffset)`. The orchestrator selects the resolver by the (from-tag, to-tag) pair.

4. **Layer 4 (coordinator)**: given the plan's FROM and TO, consults the `PageCacheStore` (Cycle 2). If the TO is cached, the plan is a direct slide; if not, chip-exit + preload.

5. All four layers are in NEW files under `src/lib/stores/` or `src/lib/utils/`. The existing gesture components are NOT modified. The output is unit-tested (the resolvers are pure functions; the state machine transitions are finite and testable).

## Constraints

- **Shadow mode.** Do NOT connect the new pipeline to the DOM. The existing MobileTabPager and GesturePageLayout continue to own gestures. Cycle 3's output is pure logic + unit tests.
- **No behavior change.** The existing system is untouched. No e2e regressions.
- **The TransitionPlan interface** must match §4's shape: `pageTrack: { axis: 'left'|'right'; distance: number }`, `fab: (progress, liveOffset) => FabVisual`, `header: (progress, liveOffset) => HeaderVisual`, `progressDirection: 0|1`, `commitPhysics: 'momentum'|'snap'`.
- **The slide-axis resolution** (§14.2): for `{tab,tab}` the resolver resolves the axis spatially (by position in the tab layout); for cross-tag pairs it follows user intent + the route stack.
- **The back-target** is always the route stack's previous entry (§6). No per-route override (backParent is transitional; its consumer `resolvedLeftHref` dissolves in THIS cycle's design - the new resolver reads the stack directly).
- **No git mutation.**

## Out of scope

- The executor (Layer 5, all-rAF, velocity-matched commit) - Cycle 4.
- The PageLifecycle contract + migration - Cycle 5.
- Replacing the old MobileTabPager/GesturePageLayout - Cycle 5.
- The forward-swipe Messages to /search behavior - it becomes a natural consequence when Cycle 5 wires the pipeline, not a special case here.

## Deliverables

- The state machine module (`src/lib/stores/nav-state-machine.svelte.ts` or similar).
- The intent classifier (`src/lib/utils/nav-intent.ts` or similar).
- The resolver dispatch + six resolvers (`src/lib/utils/nav-resolvers.ts` or similar).
- The coordinator (`src/lib/utils/nav-coordinator.ts` or similar).
- Unit tests for each (the resolvers are pure; the state machine transitions are finite).
- `docs/DV20-C03-Journal.md` (incremental, honest, real evidence pasted).
- Coverage bullets round-independent from the start.

## What the architect will check at review

- Are the four layers built as new files, NOT modifying the existing gesture components?
- Is the TransitionPlan interface correct per §4?
- Does the dispatch select the right resolver by (from-tag, to-tag)?
- Does the coordinator consult PageCacheStore correctly?
- Is the back-target always the stack's previous entry?
- Are the resolvers unit-tested as pure functions?
- Is behavior unchanged (the existing system is untouched)?
