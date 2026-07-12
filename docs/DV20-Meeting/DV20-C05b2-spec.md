# DV20 Cycle 5b2 Spec: Full rollout: all routes, MobileTabPager, FAB family-swap to rAF

**Architect:** the document owner. **Executor:** sub-agents per phase. **Protocol:** `docs/DV20-Meeting/DV20-Cycle-Manager-Protocol-v2.md`. **Status:** ready for development.

Cycle 5b1 cut over ONE pilot route (`/messages/[id]`) to the new all-rAF pipeline, converged at 5/5 (R79). 5b2 rolls out to ALL remaining routes, replaces MobileTabPager, eliminates the last CSS-driven animation (the FAB atom's `.fab-transition` + `discreteNavInFlight` `setTimeout`), and promotes the NavStateMachine to the authority (§13.5).

## Scope

Roll the new pipeline out to every remaining route that mounts `GesturePageLayout` (~25 routes), replace `MobileTabPager` (the tab swipe), and migrate the FAB family-swap animation from CSS to rAF. The four wiring points (SvelteKit hooks, pointer bridge, executor binding, lifecycle) apply to every route.

### Routes to migrate

- **Discussion thread** (`/discussion/[discussionId]/[slug]/[[page]]`): the 5b1 pilot. Verify after shared-component changes.
- **Compose routes** (Family C): `/post/discussion`, `/messages/new`.
- **Deep pages** (Family B 'deep', 19 routes): `/search`, `/bookmarks`, `/notifications`, `/profile/*` (12 sub-routes), `/admin/*` (6 sub-routes).
- **Tab roots** (Family A, served by MobileTabPager): `/`, `/activity`, `/messages/inbox`.

### 5b1-skipped items (explicitly included)

1. **NavStateMachine vestigial → authority (§13.5).** The orchestrator feeds the state machine events but reads `#publication` instead. 5b2 promotes the state machine to the single authority; consumers read its phase + plan, not a private publication.
2. **FAB atom CSS transition → rAF.** The `.fab-transition { transition: transform 200ms ease-out }` CSS class + `discreteNavInFlight` 280ms `setTimeout` latch are replaced with an rAF-driven family-swap ease in the FAB layer.
3. **Skeleton branches wired.** Deep pages may have uncached targets on cold load; the `{:else}` skeleton branches become reachable. Verify layouts match.
4. **`isGesturePageLayoutRoute` rename.** The function covers NavPipelineHost routes too; renamed to `isPipelineRoute` (or similar).
5. **`backParent` consumer audit.** As routes migrate off GPL, `backParent`'s GPL consumer dissolves per route. At end of 5b2, both consumers are gone; 5b3 removes the field.

## End state

1. Every route that was on `GesturePageLayout` or `MobileTabPager` now mounts `NavPipelineHost` (or a pipeline tab host for the three tab roots). The new pipeline is the SOLE transition mechanism for every mobile route that was on those two hosts. Routes still rendered only by `DualColumnLayout` (e.g. the paginated discussions list `/discussions/pN`, whose tab-switch gesture DualColumnLayout's `detectSwipe` + CSS transition drives) are out of scope until `DualColumnLayout` is deleted in 5b3; see Known condition #5. Every migrated transition (back-swipe, tab-click, cross-tab, deep-link landing, forward enter, tab swipe) is driven by one progress through the executor's rAF.
2. The FAB atom carries NO CSS transition. The FAB scale is driven either by the orchestrator's `coverProgress` (during a within-route transition) or by a rAF family-swap ease in the FAB layer (during a cross-route family swap). No `setTimeout`, no `discreteNavInFlight`, no `.fab-transition` CSS class.
3. The `NavStateMachine` is the sole authority (§13.5). Consumers read its phase + plan. The orchestrator does not hold a private `#publication`.
4. `MobileTabPager` is no longer mounted. The three tab roots share a persistent pipeline host in the `(tabs)` layout. The `LoadingChip` cross-tab overlay is removed everywhere.
5. `GesturePageLayout` is no longer mounted on any route (but not yet deleted; 5b3 deletes it). `DualColumnLayout`'s `swipeDisabled` gate simplifies (always true on pipeline routes).
6. `isGesturePageLayoutRoute` is renamed; `isNavPipelinePilotRoute` is generalized to cover all pipeline routes.
7. E2E: the pilot's 4-spec sweep stays green; new specs cover deep-page enter/exit, compose enter/exit, tab swipe, and cross-family FAB animations.

## Constraints

- **UNIFY, DO NOT BRIDGE (binding).** Every route's transition is the new pipeline. No CSS transitions or `setTimeout` in the animation layer. The `.fab-transition` CSS class and `discreteNavInFlight` `setTimeout` are the last CSS-driven animation; 5b2 eliminates them.
- **Unified following-visual model (binding).** Every visual (panels, FAB, header) is a pure function of the slide progress and the transition target. During a cross-route family swap, the FAB layer's rAF ease is driven by the family swap (the target family's resting scale), not a CSS transition.
- **The state machine is the only authority (§13.5).** Consumers read the phase + plan from the state machine. The orchestrator does not hold a private `#publication`.
- **No CSS-transition + setTimeout alignment shortcuts (§13.3).** The pilot's slide AND the FAB family-swap animation are rAF-driven. Zero CSS transitions, zero `setTimeout` in the animation layer.
- **One route at a time (batched).** Each phase migrates a group of routes with its own e2e gate. A phase is done only when the gate is green.
- **Comment-accuracy + clean-prompt audit.** Every code comment in the wiring files describes current behavior. The audit uses the CLEAN protocol prompt AND runs `bun run test:e2e`.
- **No git mutation** by sub-agents.

## Phased approach

1. **FAB family-swap → rAF** (shared component; no route migration). Replace `discreteNavInFlight` + CSS with a rAF family-swap ease in the FAB layer. All existing e2e must pass.
2. **NavStateMachine → authority.** Promote the state machine to the sole authority.
3. **Deep pages migration** (~19 routes). Batch by route group (profile, admin, standalone deep pages).
4. **Compose routes migration** (2 routes: `/post/discussion`, `/messages/new`).
5. **MobileTabPager → pipeline tab swipe.** Replace the tab pager with a persistent pipeline host in the `(tabs)` layout.
6. **Discussion thread verify.** The 5b1 pilot after shared-component changes.
7. **`isGesturePageLayoutRoute` rename + `backParent` audit.** Prepare for 5b3.

## Known 5b2 conditions (intentional deviations, not defects)

These are §5/§13.5 deviations retained with a technical justification and a
defined resolution path. They are documented here so auditors assess them as
known + planned, not as undiscovered divergences from the bar.

1. **Family-swap ease `fromScale` (DOM read-back, §13.5).** The FAB family-swap
   ease anchors its start scale by reading the atom's rendered transform
   (`readRenderedFabScale`) once per family swap. This is immune to a reactive
   race where `restingScale` advances to a transient post-swap value in the same
   SvelteKit-navigation flush before the ease's `$effect.pre` reads it (the
   tracked reactive value had already ramped away from the visible scale). It is
   a one-shot anchor at swap-start, not a per-frame parallel mechanism.
   **TODO:** track the last-committed scale in a `$state` updated post-DOM-update
   so the reactive signal holds the visible value, eliminating the DOM read.

2. **FAB family-swap rAF ease (separate from the executor's single loop).**
   End-state #2 specifies the FAB scale is driven by `coverProgress`
   (within-route) OR the FAB layer's family-swap rAF ease (cross-route family
   swap). The FAB layer therefore runs its own rAF (the family-swap ease), not
   the executor's single loop. Fully merging the FAB/Header into the executor's
   plan-driven loop is a DV20-wide goal (macro §5) beyond 5b2's scope; the 5b2
   spec's end-state #2 explicitly accommodates the separate FAB ease.

3. **Velocity-matched commit e2e (§12).** No e2e varies the release velocity and
   asserts the commit duration tracks it (longer for slow releases, shorter for
   fast). The `nav-executor-logic` unit suite covers the solver branches
   (`solveCommitDuration`); reduced-motion has an e2e (`messages-back-swipe`).
   **TODO:** add the integration-level velocity e2e.

4. **`isPipelineSwipeDisabledRoute` latent mis-classification.** The function
   returns `false` for `/search`, `/bookmarks`, `/notifications`, `/profile`
   despite those routes mounting `NavPipelineHost` (they fail both the
   overlay-family branch and the `backParent !== undefined` branch). It does not
   manifest because `DualColumnLayout`'s parallel `detectSwipe` is disabled by
   its own `swipeBaseline < 0` check (those routes resolve `getCurrentTabIndex`
   to -1), so the pipeline wins pointer capture consistently. The function and
   `DualColumnLayout.swipeDisabled` dissolve together in 5b3 when
   `DualColumnLayout`'s `detectSwipe` is removed.

5. **DualColumnLayout mobile routes (`/discussions/pN`).** The paginated
   discussions list `/discussions/pN` (and any other route rendered only by
   `DualColumnLayout`) is a mobile-reachable route whose tab-switch gesture runs
   on `DualColumnLayout`'s `detectSwipe` + `transition-transform duration-200`
   CSS transition, not the pipeline. It was never on `GesturePageLayout` or
   `MobileTabPager`, so it is outside end-state #1's migration set. It migrates
   when `DualColumnLayout` is deleted in 5b3.

6. **Macro-plan divergences retained.** Three intentional deviations from the
   macro plan, each with a concrete reason:
   - `backSwipeShouldPopHistory` (§6 says it is deleted): the orchestrator's
     `#backwardTabTarget` retains it to decide a backward-to-deep-page
     back-swipe (pop to the deep page in history) vs. a spatial switch to the
     previous tab root. The generic `hopForHref` does not encode that
     distinction. §6's deletion is a future-cycle goal.
   - Forward deep-to-deep navigation (e.g. `/profile` -> `/profile/settings`)
     is plain SvelteKit nav, not a pipeline slide:
     `onSvelteKitBeforeNavigate` intercepts only tab-root targets, and
     `playEnterAnimation`'s `shouldEnter` requires the prior stack entry to
     equal the route's `leftHref`. The `{detail,detail}` resolver is exercised
     by gesture back-swipes only. Wiring forward deep-to-deep is beyond 5b2's
     transition-type scope.
   - `TAB_CLICK_COMMIT_MS` (§13.3 "no hardcoded commit duration"): a tab-click
     exit and a forward enter are discrete navs with no finger-release velocity
     to match, so their commit uses a fixed 200ms (`TRACK_TRANSITION_MS`) to
     align with the Header title crossfade. Gesture commits use the
     velocity-matched solver per §5.

7. **Coverage gaps.** No dedicated e2e covers the backward tab swipe, the
   first/last-tab boundary void-swipe, a mid-commit re-grab (either direction)
   on the tab host, or the backward-to-deep-page path. The geometry is
   unit-tested (`nav-executor-logic`); the forward tab swipe + the reduced-motion
   snap have e2e. **TODO:** add the missing trajectory e2e specs.

## Out of scope (5b3)

- Deleting `GesturePageLayout` / `MobileTabPager` / `swipe.ts` / `DualColumnLayout`.
- Removing `backParent` from `RouteData`.
- Offline unification (Cycle 6).

## Deliverables

- The wiring: every route mounts `NavPipelineHost` (or the pipeline tab host). All four wiring points per route.
- The FAB family-swap rAF animation (replacing CSS + setTimeout).
- The NavStateMachine promoted to authority.
- MobileTabPager replaced by the pipeline tab host.
- `docs/DV20-C05b2-Journal.md` (incremental, honest, real evidence).
- E2e: pilot sweep stays green; new specs for deep-page, compose, tab swipe, and cross-family FAB.
