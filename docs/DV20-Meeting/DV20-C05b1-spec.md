# DV20 Cycle 5b1 Spec: Pilot-route cutover (/messages/[id]) with e2e

**Architect:** the document owner. **Executor:** the Cycle 5b1 Manager Agent (CMA5b1). **Protocol:** `docs/DV20-Meeting/DV20-Cycle-Manager-Protocol-v2.md` (v2, binding, no-borderline classification). **Status:** ready for CMA5b1, pending architect sign-off on the pilot-route choice and the e2e-gate inclusion.

This is the first sub-cycle of the 5b cutover (split per architect decision 2026-07-06 into 5b1 pilot, 5b2 rollout, 5b3 delete-old + `backParent`). **5b1 is the first cycle to break shadow mode** - it modifies a production route's gesture and **requires e2e** to prove behavior is preserved.

## Scope

Wire the new navigation pipeline (built in Cycles 1-5a) to drive the gesture for ONE pilot route - `/messages/[id]/[[page=page]]` (conversation detail) - replacing `GesturePageLayout`'s gesture for that route only. All other routes stay on the old mechanism untouched. The existing + new e2e for that route's gesture must pass (behavior preserved).

The four wiring points (from the cutover-surface map):

1. **SvelteKit nav -> orchestrator**: `src/routes/+layout.svelte`'s `beforeNavigate`/`afterNavigate` hooks feed the orchestrator's phase events (the orchestrator owns the navigation lifecycle; it does NOT bypass SvelteKit - §9).
2. **Pointer -> intent**: the `detectSwipe` action's move/end callbacks bridge to `IntentEvent` -> the intent classifier (`nav-intent.ts`) -> the orchestrator. (For 5b1 this bridge is created; the existing `swipe.ts` continues to serve other routes.)
3. **Executor + driver -> elements**: `NavExecutor` consumes the active `TransitionPlan`; `LiveNavDomDriver.resolveElements` binds the pilot route's track / FAB / Header element refs each `write`.
4. **Lifecycle**: `PageLifecycleController` mounts/activates/deactivates/unmounts from the pilot route's layout lifecycle.

## Background

- The shadow-mode modules (Cycles 1-5a): `route-data.ts`, `page-cache.svelte.ts` (already wired in Cycle 2), `nav-state-machine-logic.ts`/`nav-state-machine.svelte.ts`, `nav-intent.ts`, `nav-resolvers.ts`, `nav-coordinator.ts`, `nav-executor-logic.ts`/`nav-executor.svelte.ts`, `page-lifecycle-logic.ts`/`page-lifecycle.svelte.ts`, `nav-dom-driver-live.ts`.
- The OLD gesture component to partially replace for the pilot: `src/lib/components/templates/GesturePageLayout.svelte` (currently mounted at `/messages/[id]/[[page]]/+page.svelte:3,144` with `leftHref="/messages/inbox"`).
- The cutover-surface map: `src/routes/(tabs)/+layout.svelte` (MobileTabPager mount), `src/routes/+layout.svelte:74-115` (nav hooks), `src/lib/actions/swipe.ts` (`detectSwipe`), `DualColumnLayout.svelte:8,126` (swipe attach + disable gates), `src/lib/utils/route-config.ts:330` (`isGesturePageLayoutRoute`), `GesturePageLayout.svelte:116-124` (`resolvedLeftHref`).
- E2E: `e2e/swipe-forward-back-deep-page.spec.ts`, `e2e/backtarget.spec.ts`, and the `/messages/[id]` gesture specs; runner = Playwright Pixel 5, system chromium via `executablePath`, port 5174, CDP `Input.dispatchTouchEvent` (memory `e2e-playwright-nixos-gotchas`).

## End state

1. For `/messages/[id]` ONLY, the new pipeline is the SOLE transition mechanism for every transition the route makes - the back-swipe gesture, a tab-click to the back-target, a tab-click to another tab root, the deep-link landing, the forward enter. Every transition is driven by ONE progress; every visual that follows the transition (the sliding panels, the floating action button, the header morph) is a pure function of that progress plus the transition target, with no per-transition forced values. **A tab-click whose target is a tab root other than the back-target is an intentional, architect-approved CONTENT divergence from `GesturePageLayout`: GPL reveals the adjacent (wrong-list) panel; the pilot reveals the CORRECT target content instead.** When the target tab's data is cached (the common case - `/`, `/activity`, `/messages/inbox` are eager-loaded on every route), the REAL target panel slides in from that eager-loaded data; when a target is not eager-loaded, a layout-matched **skeleton** (matching the target page's layout, built from the shared `Skeleton` atom) slides in and is replaced by the real page once it loads. `LoadingChip` is not used. The floating action button scales in with the slide when the target shows a FAB at rest, and stays hidden for targets without one (the conversation, `/activity`). Every OTHER transition (back-swipe, same-tab, deep-link landing, forward enter) preserves the old `GesturePageLayout` behavior (verified by e2e).
2. The four wiring points are implemented for the pilot route.
3. `GesturePageLayout`'s OLD gesture mechanism (`detectSwipe` + the `$state` gesture flags + the CSS `transition-transform` + `transitionend` + `pendingNav`/`executePendingNav` path) is NOT present in the pilot route's transition path - for ANY transition type. The structural surface (multi-panel track, scroll pane, snippet slots, viewport-lock acquisition, scroll-chrome registration) may be rendered by `GesturePageLayout` or a new component, but the gesture/animation/navigation mechanism is the new pipeline alone.
4. `GesturePageLayout` continues to serve every OTHER route that mounts it (`/profile/*`, compose, etc.) with its full old mechanism intact - those are 5b2.
5. `MobileTabPager` (the tab swipe) is untouched - that is 5b2.
6. `backParent` stays in `RouteData` (both consumers still exist) - removal is 5b3.
7. E2E green: the specs that touch `/messages/<numeric>` (`tab-exit-preview`, `tab-click-transition`, `fab`) pass; `tab-exit-preview` asserts that a tab-click to another tab root reveals the target's panel (no wrong-list panel). Plus any new spec needed to cover the cached-panel / skeleton path and the FAB-scale-in behavior.

## Constraints

- **UNIFY, DO NOT BRIDGE (binding - this is the purpose of the whole DV20 refactor).** The new pipeline is the ONE transition mechanism for the pilot route. Do NOT add a switch (`gestureSource`, `pipelineGestureActive`, or any per-frame/per-transition selector) that keeps `GesturePageLayout`'s old gesture mechanism alive alongside the new pipeline. Do NOT mirror the pipeline's intent into `GesturePageLayout`'s internal `$state` so the old `$derived` geometry still runs. Two mechanisms for the same concern must be resolved by deleting one and routing through the survivor, never by bridging with a third (Plan §13.4; memories `architecture-consistency-single-transition-mechanism`, `two-mechanism-unification-not-bridge`). The prior CMA5b1 attempt chose exactly this forbidden bridge ("hybrid ownership" with a `gestureSource` prop + `pipelineGestureActive` gate + intent mirror) and was rejected. If you find yourself adding a selector that picks old-vs-new per frame or per transition, STOP - that is the bridge; re-design so the new pipeline is the sole writer.
- **Unified following-visual model (binding).** Every visual that follows the transition is a pure function of the slide progress and the transition target. No flag forces a value (the FAB-scale driver, the FAB kind, a panel's `scrollTop`, the `dragging` field) to a fixed value for one transition type. The FAB scales in with the slide for a target that shows a FAB at rest, and stays hidden for a target that does not. A "transition to target X" is not a named category with its own state; the only named quantities are the slide progress and the transition target.
- **Behavior preservation is the bar, except a tab-click to a non-back-target tab root.** The pilot route's other transitions must preserve the old `GesturePageLayout` behavior; the existing e2e that touches the pilot route is the regression gate for those transitions (if any regresses, 5b1 is not done). A tab-click to a non-back-target tab root is the architect-approved CONTENT divergence in End state #1 (the correct target panel and FAB, not GPL's wrong-list reveal) - it is NOT held to "indistinguishable from GPL" for content. Its MECHANISM is unified with every other transition (one progress + target; no special-case forcing).
- **Shared skeleton atom.** The repo's ad-hoc skeletons (daisyUI `skeleton` on hand-sized divs: CategoryListWidget, ActiveUsersWall, the 5 admin pages, LexicalEditorLazy) are migrated to one shared `Skeleton` atom so the placeholder color + animation are consistent and maintained in one place. The per-tab layout skeletons used when a non-eager-loaded target slides in (e.g. ActivitySkeleton, DiscussionsSkeleton) compose this atom and match their page's layout.
- **One route only.** Do NOT modify any other route's transition mechanism. `GesturePageLayout` (full old mechanism) / `MobileTabPager` / `swipe.ts` / `DualColumnLayout` continue to serve the rest. (Minimal edits to shared files are allowed only to route the pilot to the new pipeline and leave others untouched.)
- **No CSS-transition + setTimeout alignment shortcuts** (§13.3): the new pipeline drives the pilot via the all-rAF executor; no CSS transitions or `setTimeout` in the pilot's path.
- **The orchestrator coordinates, it does not bypass** (§9): SvelteKit navigation still flows through `goto`/`beforeNavigate`/`afterNavigate`; the orchestrator does not call a parallel navigation API.
- **No git mutation** by the CMA.
- **Comment-accuracy + clean-prompt audit**: every code comment in NEW wiring files describes current 5b1 behavior. The audit uses the CLEAN protocol prompt AND runs `bun run test:e2e` (e2e is now in scope - the first cycle where it is).

## Out of scope (5b2 / 5b3)

- Rolling the new pipeline out to other GPL routes (`/profile/*`, compose) and to `MobileTabPager` (the tab swipe) - 5b2.
- Deleting `GesturePageLayout` / `MobileTabPager` / `swipe.ts` / `DualColumnLayout` once all routes are migrated - 5b3.
- Removing `backParent` from `RouteData` (only after both consumers dissolve) - 5b3.

## Deliverables

- The wiring: intent bridge (pointer -> classifier -> orchestrator), orchestrator -> executor driving, executor + `LiveNavDomDriver` element binding, `PageLifecycleController` lifecycle, SvelteKit-nav -> orchestrator events - all for the pilot route.
- The pilot-route gesture driven by the new pipeline, behavior-identical to the old.
- A gate that selects the new pipeline for `/messages/[id]` and leaves other routes on the old mechanism.
- E2E: existing `/messages/[id]` gesture specs green; new spec(s) if needed to cover the new pipeline's path.
- `docs/DV20-C05b1-Journal.md` (incremental, honest, real evidence - including e2e output pasted verbatim).
- Coverage bullets round-independent from the start.

## What the architect will check at review

- **Is the new pipeline the SOLE transition mechanism for the pilot route (no bridge)?** No `gestureSource`/`pipelineGestureActive` selector, no intent mirror into `GesturePageLayout`'s `$state`, no `detectSwipe`/CSS-`transition`/`transitionend`/`pendingNav` in the pilot's transition path - for ANY transition type (gesture, tab-click, landing).
- Does the pilot route's behavior match before (e2e green, no regressions)?
- Are all other routes untouched (still on the full old mechanism)?
- Are the four wiring points implemented for the pilot only?
- Is the all-rAF executor driving the transitions (no CSS-transition / setTimeout reintroduced)?
- Does the orchestrator coordinate without bypassing SvelteKit?
- Is `bun run test:e2e` green (the new e2e gate)?
- Are the NEW wiring files' comments accurate (clean-prompt + e2e audit)?
