# DV20 Cycle 5b2 Spec: Full rollout: all routes, MobileTabPager, FAB family-swap to rAF

**Architect:** the document owner. **Executor:** sub-agents per phase. **Protocol:** `docs/DV20-Meeting/DV20-Cycle-Manager-Protocol-v2.md`. **Status:** ready for development.

Cycle 5b1 cut over ONE pilot route (`/messages/[id]`) to the new all-rAF pipeline, converged at 5/5 (R79). 5b2 rolls out to ALL remaining routes, replaces MobileTabPager, eliminates the last CSS-driven animation (the FAB atom's `.fab-transition` + `discreteNavInFlight` `setTimeout`), and promotes the NavStateMachine to the authority (§13.5).

## Scope

Roll the new pipeline out to every remaining route that mounts `GesturePageLayout` (~25 routes), replace `MobileTabPager` (the tab swipe), and replace the FAB atom's CSS-transition scale animation with an rAF-driven `fabScale(progress, fromHasFab, toHasFab)` on the orchestrator. The four wiring points (SvelteKit hooks, pointer bridge, executor binding, lifecycle) apply to every route.

### Routes to migrate

- **Discussion thread** (`/discussion/[discussionId]/[slug]/[[page]]`): the 5b1 pilot. Verify after shared-component changes.
- **Compose routes** (Family C): `/post/discussion`, `/messages/new`, `/messages/add/[userId]` (the last two share `MessageCompose`).
- **Deep pages** (Family B 'deep', 24 routes): `/search`, `/bookmarks`, `/notifications`, the `/profile` tree (`/profile` + 13 sub-routes), the `/admin` tree (`/admin` + 6 sub-routes).
- **Tab roots** (Family A, served by NavPipelineTabHost): `/`, `/activity`, `/messages/inbox`.

### 5b1-skipped items (explicitly included)

1. **NavStateMachine vestigial → authority (§13.5).** The orchestrator feeds the state machine events but reads `#publication` instead. 5b2 promotes the state machine to the single authority; consumers read its phase + plan, not a private publication.
2. **FAB atom CSS transition → rAF.** The `.fab-transition { transition: transform 200ms ease-out }` CSS class + `discreteNavInFlight` 280ms `setTimeout` latch are replaced with an rAF-driven scale on the orchestrator. The FAB layer computes `fabScale(progress, fromHasFab, toHasFab)` reactively from the published transition progress and the FROM / TO `RouteData.fab` booleans.
3. **Skeleton branches audited.** The eager-load model is permanent (the root layout's `Promise.allSettled` always returns truthy `EMPTY_*` objects on rejection, never null). The dead `ActivitySkeleton` and `DiscussionsSkeleton` `{:else}` branches and their component files are removed; only `MessagesSkeleton` remains, reachable via the `/messages/[id]` route shadowing the layout's `messages` field with its message-row array (the preview cannot render an array, so the skeleton stands in until the back-swipe lands).
4. **`isGesturePageLayoutRoute` rename.** The function covers NavPipelineHost routes too; renamed to `isPipelineRoute` (or similar).
5. **`backParent` consumer audit.** As routes migrate off GPL, `backParent`'s GPL consumer dissolves per route. At end of 5b2, both consumers are gone; 5b3 removes the field.

## End state

1. Every route that was on `GesturePageLayout` or `MobileTabPager` now mounts `NavPipelineHost` (or a pipeline tab host for the three tab roots). The new pipeline is the SOLE transition mechanism for every mobile route that was on those two hosts. Routes still rendered only by `DualColumnLayout` (e.g. the paginated discussions list `/discussions/pN`, whose tab-switch gesture DualColumnLayout's `detectSwipe` + CSS transition drives) are out of scope until `DualColumnLayout` is deleted in 5b3; see Known condition #2. Every migrated transition (back-swipe, tab-click, cross-tab, deep-link landing, forward enter, tab swipe) is driven by one progress through the executor's rAF.
2. The FAB atom carries NO CSS transition. The FAB scale is `fabScale(progress, fromHasFab, toHasFab)` driven by the same single transition progress that drives the page-track slide and the FROM / TO `RouteData.fab` booleans; the FAB exits in the first half of the transition if FROM has a FAB and enters in the second half if TO has a FAB. No `familySwapScale`, no `#lastRenderedScale`, no separate family-swap rAF, no `setTimeout`, no `discreteNavInFlight`, no `.fab-transition` CSS class.
3. The `NavStateMachine` is the sole authority (§13.5). Consumers read its phase + plan. The orchestrator does not hold a private `#publication`.
4. `MobileTabPager` is no longer mounted. The three tab roots share a persistent pipeline host in the `(tabs)` layout. The `LoadingChip` cross-tab overlay is removed everywhere.
5. `GesturePageLayout` and `MobileTabPager` are deleted (5b2; both were dead with zero imports once every route mounted the pipeline host). `DualColumnLayout`'s `swipeDisabled` gate simplifies (always true on pipeline routes).
6. `isGesturePageLayoutRoute` is renamed; `isNavPipelinePilotRoute` is generalized to cover all pipeline routes.
7. E2E: the pilot's 4-spec sweep stays green; new specs cover deep-page enter/exit, compose enter/exit, tab swipe, and cross-family FAB animations.

## Constraints

- **UNIFY, DO NOT BRIDGE (binding).** Every route's transition is the new pipeline. No CSS transitions or `setTimeout` in the animation layer. The `.fab-transition` CSS class and `discreteNavInFlight` `setTimeout` are the last CSS-driven animation; 5b2 eliminates them.
- **Unified following-visual model (binding).** Every visual (panels, FAB, header) is a pure function of the slide progress and the transition target. The FAB layer computes `fabScale(progress, fromHasFab, toHasFab)` reactively from the published transition progress and the FROM / TO `RouteData.fab` booleans, not a CSS transition.
- **The state machine is the only authority (§13.5).** Consumers read the phase + plan from the state machine. The orchestrator does not hold a private `#publication`.
- **No CSS-transition + setTimeout alignment shortcuts (§13.3).** The pilot's slide AND the FAB family-swap animation are rAF-driven. Zero CSS transitions, zero `setTimeout` in the animation layer.
- **One route at a time (batched).** Each phase migrates a group of routes with its own e2e gate. A phase is done only when the gate is green.
- **Comment-accuracy + clean-prompt audit.** Every code comment in the wiring files describes current behavior. The audit uses the CLEAN protocol prompt AND runs `bun run test:e2e`.
- **No git mutation** by sub-agents.

## Phased approach

1. **FAB scale → rAF** (shared component; no route migration). Replace `discreteNavInFlight` + CSS with an rAF-driven FAB scale on the orchestrator; the FAB layer computes `fabScale(progress, fromHasFab, toHasFab)` from the published transition progress and the FROM / TO `RouteData.fab` booleans. All existing e2e must pass.
2. **NavStateMachine → authority.** Promote the state machine to the sole authority.
3. **Deep pages migration** (24 routes). Batch by route group (profile, admin, standalone deep pages).
4. **Compose routes migration** (3 routes: `/post/discussion`, `/messages/new`, `/messages/add/[userId]`).
5. **MobileTabPager → pipeline tab swipe.** Replace the tab pager with a persistent pipeline host in the `(tabs)` layout.
6. **Discussion thread verify.** The 5b1 pilot after shared-component changes.
7. **`isGesturePageLayoutRoute` rename + `backParent` audit.** Prepare for 5b3.

## Global animation manager (the 5b2 structural refactor)

The 5b2 audit loop (R1 through R16) converged the piecemeal fixes but kept
re-flagging two deviations as lazily deferred: the FAB family-swap running on
its own rAF (then Known #2) and the Header morph/title animation running on CSS
transitions plus a `setTimeout` settle backstop plus a `startTapScrub` rAF
(then Known #12). R16's A/B auditors traced both to one structural root cause
and an in-place patch was ruled out (it would have been a third bridge on top
of the two parallel mechanisms, violating §13.4). The refactor that followed
(steps 1 through 3 below) is now the architecture; this section is its
authoritative description.

### Root cause that was fixed

The orchestrator was per-host: each route's `NavPipelineHost` /
`NavPipelineTabHost` constructed an orchestrator in `onMount` and tore it down
in `onDestroy`, so its lifecycle was bound to one route's host. The FAB atom
and the Header organism persist across route swaps (they live in the root /
`(tabs)` layout, and the FAB atom is intentionally retained across swaps so it
can ease the family change). During a route swap the old host's orchestrator
was unmounting while the new host's was constructing; neither was a stable
owner, but the FAB and Header still needed animation data for the route-swap
transition (FAB family change, Header title crossfade, Header settle).

A global singleton pager store bridged this gap, but it only carried gesture
progress (when a host was driving). The route-swap animations happened in the
gap with no host driving, so the FAB ran its own family-swap rAF and the Header
runs CSS transitions + a `setTimeout` settle backstop + a `startTapScrub` rAF.
The global state and the per-consumer rAFs were all symptoms of one root cause:
the per-host orchestrator vs persistent consumers lifecycle mismatch.

### Target architecture (in place after the refactor)

One persistent manager (a module-level singleton constructed eagerly at module
load) owns the animation layer for the app's mobile lifetime:

1. **Global singleton.** `getGlobalNavPipelineOrchestrator()` returns one
   instance shared by every mobile host. It does not unmount on a route swap;
   hosts feed it inputs via `configure(inputs)` and release them via
   `releaseInputs()`. The active-slot pointer (`getNavPipelineOrchestrator`)
   is `null` only in the gap frame between an old host's `releaseInputs` and
   the new host's `configure`, during which the SvelteKit nav hooks skip
   processing.
2. **One rAF per motion channel, all owned by the orchestrator.** The
   executor owns the gesture slide (the track and the Header morph): during a
   live drag the track transform is written synchronously per `pointermove` (the
   executor stops its rAF), and during a commit / cancel slide the executor's
   rAF owns the motion. The FAB scale is a reactive reader: the FAB layer
   computes `fabScale(progress, fromHasFab, toHasFab)` from the published
   transition progress and the FROM / TO `RouteData.fab` booleans. A second
   orchestrator-owned rAF drives the settle ease (publishing `settleActive` /
   `settleProgress` / `settleLatched` / `settleDirection`); a third drives the
   tap-scrub ease (publishing `searchScrubbing` while scrubbing the root<->search
   morph). Each motion channel has exactly one rAF
   owner; no consumer runs its own. This principle governs the **top-level
   gesture layer** (the slide / FAB / Header consumers driven by the
   orchestrator's publication). Macro §9 sanctions nested sub-pagers with
   their own local state machines: `SearchScopePager` runs its own rAF for its
   internal scope switch (a §9-sanctioned nested motion channel that composes
   under the top-level orchestrator via `shouldClaim`, not a violation of the
   single-owner principle, which applies to the top-level gesture layer the
   orchestrator owns).
3. **`configure` / `releaseInputs` lifecycle.** The host calls `configure` in
   `onMount` (capture inputs, `forceReset` the singleton state machine, publish
   at-rest) and `releaseInputs` in `onDestroy` (clear the in-flight pager state,
   drop the inputs) WITHOUT tearing down the executor,
   the driver, the rAF loops, or the lifecycle `mount`. The `#mounted` guard
   returns at-rest from the publication while inputs are absent, so the gap
   frame publishes at-rest instead of the prior route's in-flight state. The
   mobile -> desktop flip and the app exit call the full `unmount` teardown.
4. **FAB layer is a reactive reader.** The FAB layer derives its scale from
   `fabScale(progress, fromHasFab, toHasFab)` where `progress` is the same
   single transition signal that drives the page-track slide and
   `fromHasFab` / `toHasFab` are the FROM / TO `RouteData.fab` booleans. The
   FAB exits in the first half of the transition if FROM has a FAB and
   enters in the second half if TO has a FAB. It runs no rAF of its own
   and performs no DOM read-back; there is no `familySwapScale`, no
   `#lastRenderedScale`, and no separate family-swap rAF.
5. **Header organism is a reactive reader.** The Header derives its morph,
   title crossfade, search-track / search-button / tab-bar transforms, and
   settle/tap-scrub state from manager-published signals
   (`pager.backMorph`, `pager.tapMorph`, `pager.transitionTarget`,
   `orchestrator.settleActive`, `.settleProgress`, `.settleLatched`,
   `.settleDirection`, `.searchScrubbing`). The `runSettleDriver` rAF, the
   `startTapScrub` rAF, and the `setTimeout` settle backstop are deleted from
   the Header. The root<->search morph arbitration (`trackMorph` prefers
   `backMorph` while `transitionTarget !== null`) is unchanged.

### Step rollout

- **Step 1 - global singleton + `configure` / `releaseInputs` lifecycle.**
  Module-level singleton + `getGlobalNavPipelineOrchestrator()`; the prior
  `mount` / `unmount` split into `configure(inputs)` (capture inputs, reset,
  publish at-rest) and `releaseInputs()` (drop inputs, return publication to
  at-rest) without tearing down the executor / driver / rAF. Hosts call
  `configure` in `onMount` and `releaseInputs` in `onDestroy`.
- **Step 1a - attempted skip-`mount` shortcut (reverted).** A first attempt
  rerouted `releaseInputs` through the full `unmount` teardown on the
  assumption that the singleton's executor / driver / rAF could be rebuilt
  cheaply on the next `configure`. The Header froze on the first route swap:
  the Header's settle / tap-scrub eases had been moved onto the orchestrator's
  rAF in step 1, so when the singleton tore its executor down between hosts,
  the in-flight settle rAF (a commit settle awaiting its navigation landing)
  died mid-transition. The hang was the lifecycle-interdependence proof: the
  orchestrator's rAF channels cannot be torn down across a route swap while
  the persistent Header is mid-settle. Reverted to the `releaseInputs`
  definition that preserves the executor / driver / rAF.
- **Step 2 - FAB scale driven by the single transition progress.** The FAB
  scale is `fabScale(progress, fromHasFab, toHasFab)` driven by the same
  single transition progress as the page-track slide and the FROM / TO
  `RouteData.fab` booleans; the FAB exits in the first half if FROM has a
  FAB and enters in the second half if TO has a FAB. No separate
  family-swap rAF, no `familySwapScale`, no `#lastRenderedScale`, no DOM
  read-back.
- **Step 3 - orchestrator owns the Header settle + tap-scrub eases.** The
  settle rAF (`settleActive` / `settleProgress` / `settleLatched` /
  `settleDirection` / `#settleAwaitTitle`) and the tap-scrub rAF
  (`#tapScrubRafId` / `searchScrubbing`) moved into the orchestrator. The
  Header reads the published getters and derives every visual from them; the
  CSS transitions and `setTimeout` backstop in the Header were deleted.
- **Step 4 - sub-component CSS transitions removed (R18).** The four
  reactive readers under the Header / MobileTabBar / SearchTabBar still
  carried CSS `transition:` strings that competed with the orchestrator's
  single-rAF publication during gesture / settle / commit slides. R18
  removed them: `BurgerArrowIcon`'s line-element `transition: transform
200ms ease-out` (driven 1:1 by `iconProgress` from the orchestrator's
  settle / drag publication), `MobileTabBar`'s `labelStyle` `transition`
  - the pill anchor's `transition-colors duration-200` (the bar
    re-derives `closeness` + `labelStyle` per frame from the orchestrator's
    `fractionalIndex`), `SearchTabBar`'s underline `transition: left 200ms
ease-out, width 200ms ease-out` + the cell `transition-colors
duration-200` (the underline follows the SEARCH pager publication each
    frame), and the Header outer `<header>` `transition-transform
duration-200` (the hide-on-scroll `translateY` is a reactive read of
    the scroll-chrome store, whose own rAF-throttled scroll listener
    publishes each frame). The `BurgerArrowIcon` `dragging` prop
    dissolved in the same step (it gated the CSS transition; with the
    transition gone the prop has no consumer).

### §5 invariant status

Macro §5's structural invariant reads: "For any visual property of the
gesture/navigation layer at any instant, exactly one rAF write owns its
motion, decided solely by the orchestrator's phase. CSS transitions and
`setTimeout` alignment do not exist in this layer." Status after the refactor:

- **Track slide during a live drag:** written synchronously per `pointermove`
  (the orchestrator calls `executor.onDragMove`, then `#publish`; the executor
  keeps its commit rAF stopped).
  CSS-transition-free.
- **Track slide during a commit / cancel / scrub:** owned by the executor's
  rAF (unchanged). CSS-transition-free.
- **FAB scale:** a reactive reader. The FAB layer computes
  `fabScale(publication.progress, fromHasFab, toHasFab)` from the raw drag
  progress the orchestrator publishes and the FROM / TO `RouteData.fab` booleans
  (the page-track slide applies the threshold absorption on non-bidirectional
  hosts, so the FAB reacts from the first pixel while the track absorbs the
  deadzone). The FAB exits in the first half of the transition if FROM has a FAB
  and enters in the second half if TO has a FAB; at rest it is 1 on a FAB route
  and 0 elsewhere. On a boundary void-swipe (first/last tab rubber-band, where
  FROM === TO and no route change occurs) the FAB reacts to the raw progress by
  design: it is not a tab-to-tab swap, but the FAB's "reacts from the first
  pixel" rule applies uniformly, so the scale dips along the rubber-band (e2e
  `fab-boundary-swipe-sync` asserts scale delta > 0.1). Note the divergence:
  on a boundary void-swipe the FAB uses the proportional rubber-band reaction
  `1 - progress * BOUNDARY_RUBBER_BAND_FACTOR` (reaching 0.6 at full drag),
  NOT the `fabScale` icon-handoff half-mapping, so it does not dip to 0.
  CSS-transition-free; no
  separate family-swap rAF, no `familySwapScale`, no `#lastRenderedScale`, no
  DOM read-back.
- **Header morph / title crossfade during a gesture drag / commit:** owned
  by the executor's rAF via `pager.backMorph` / `pager.tapMorph`. The morph
  runs DURING the slide (the gesture's coverProgress drives the back-arrow
  reveal frame-by-frame as the panels move). CSS-transition-free.
- **Header morph / title crossfade on a tab-click commit:** owned by the
  orchestrator's settle rAF via the `settleProgress` getter. The morph runs
  POST-LANDING (the slide is a discrete nav with no live coverProgress to
  drive the morph, so the settle ease owns the crossfade after the route
  lands). CSS-transition-free.
- **Header title crossfade during a settle:** owned by the orchestrator's
  settle rAF via the `settleProgress` getter. CSS-transition-free; the
  `setTimeout` settle backstop is deleted.
- **Header root<->search morph on a tap:** owned by the orchestrator's
  tap-scrub rAF via the `searchScrubbing` flag and `pager.tapMorph`.
  CSS-transition-free; the Header's `startTapScrub` rAF is deleted.

The Header's search-track, search-button, and tab-bar transforms are pure
reactive style bindings with no CSS transition (R17 removed the last residual
inline-style transitions; R18 removed the last sub-component transitions -
`BurgerArrowIcon`'s line-element transform transition, `MobileTabBar`'s label

- pill transitions, `SearchTabBar`'s underline + cell transitions, and the
  Header outer `transition-transform duration-200`; every frame is driven by the
  orchestrator's rAF publication). The programmatic URL changes that arrive
  without a gesture or a tap (direct URL entry, an external link) update the
  reactive derivations on the next flush; the macro plan folds them into the
  executor when those paths become orchestrator-driven.

## Known 5b2 conditions (intentional deviations, not defects)

These are §5 / §13.5 deviations retained with a technical justification and a
defined resolution path. They are documented here so auditors assess them as
known + planned, not as undiscovered divergences from the bar. Each entry is
labelled by status so the reader can tell at a glance whether it is a
**5b3-deletion item** (the clean fix is in 5b3 and the item dissolves with
the named 5b3 deletion), a **macro-plan deviation** (the behaviour
intentionally diverges from the macro plan with a stated rationale), or
**spec-code drift** (the spec text in another section overstates what the
code does; the drift is documented rather than the spec text being softened,
because the spec text is forward-looking).

The deviations resolved during C05b2 are no longer listed: the six the global
animation manager resolved (FAB DOM read-back, FAB family-swap separate rAF,
singleton state-machine gap frame, Header CSS transitions + setTimeout +
settle / tapScrub rAFs, `replaceState` side-channel leak, non-profile/admin
no-preview panel); the backward-to-deep-page visual proxy (deep-snapshot
overlay for `activeIndex >= 1`, suppress-slide for `activeIndex === 0`);
the FAB + Header being reactive readers (the manager publishes per-frame
state via `pager.*` and the consumers' reactive `style=` bindings are the
intended architecture, not a deviation); the velocity-matched commit
coverage gap (e2e added in `messages-back-swipe`); the trajectory coverage
gaps (backward tab swipe + tab-host mid-commit re-grab e2e added in
`tab-host-swipe`; first / last-tab boundary void-swipe covered by
`fab-boundary-swipe-sync`; backward-to-deep-page covered by `backtarget`);
and the skeleton `{:else}` drift (dead `ActivitySkeleton` /
`DiscussionsSkeleton` branches and components removed; `MessagesSkeleton`
kept, legitimately reachable via the `/messages/[id]` array shadow). The
three macro-plan divergences (old Known #3) are also resolved:
`backSwipeShouldPopHistory` is deleted (a backward gesture targets the
history-previous entry, with a spatial-previous fallback only when no
history exists); forward deep-to-deep nav is intercepted by
`onSvelteKitBeforeNavigate` and played as a `{detail, detail}` pipeline
slide (left panel renders the destination skeleton); and
`TAB_CLICK_COMMIT_MS` is removed (the tab-click / forward-enter commit
passes release velocity 0 to the solver, which returns
`COMMIT_T_DEFAULT_MS`; the Header settle reads the resulting
`commitStart.durationMs` so no desync).

1. **`isPipelineSwipeDisabledRoute` latent mis-classification (5b3-deletion).**
   The function returns `false` for `/search`, `/bookmarks`, `/notifications`,
   `/profile`, `/messages/add/[userId]` despite those routes mounting
   `NavPipelineHost` (they fail both the overlay-family branch and the
   `backParent !== undefined` branch). **Why retained:** the mis-classification
   does not manifest because `DualColumnLayout`'s parallel `detectSwipe` is
   gated off by its own `swipeBaseline < 0` check (those routes resolve
   `getCurrentTabIndex` to -1), so the pipeline wins pointer capture
   consistently. Fixing the classifier in isolation would leave it reading a
   `backParent` field whose own dissolution is also tracked (see #4) and
   would not change any user-visible behaviour. **Resolution:** the classifier
   and `DualColumnLayout.swipeDisabled` dissolve together in 5b3 when
   `DualColumnLayout`'s `detectSwipe` is removed.

2. **DualColumnLayout mobile routes (5b3-deletion).** The paginated discussions
   list `/discussions/pN` and any other route rendered only by
   `DualColumnLayout` is mobile-reachable but its tab-switch gesture runs on
   `DualColumnLayout`'s `detectSwipe` + `transition-transform duration-200` CSS
   transition, not the pipeline. **Why retained:** these routes were never on
   `GesturePageLayout` or `MobileTabPager`, so they are outside end-state #1's
   migration set; migrating them in 5b2 would require deleting
   `DualColumnLayout` (5b3 scope) because they have no other host.
   **Resolution:** migrate when `DualColumnLayout` is deleted in 5b3.

3. **`pointercancel` treated as a regular release (5b3-deletion).**
   `detectSwipe` routes `pointercancel` through its terminal path to `onEnd`,
   so the pointer bridge forwards it as a `pointerup` and the release gate
   commits vs cancels by offset. A `pointercancel` past the commit threshold
   therefore commits (navigates) instead of snapping back. Pre-existing
   (inherited from `detectSwipe`, which `DualColumnLayout` still uses); rare
   in practice (`touch-action: pan-y` handles most scroll conflicts). The
   intent classifier's `pointercancel -> cancelled` path is dead because the
   bridge cannot distinguish the cancel from a release inside `detectSwipe`'s
   `onEnd`. **Why retained:** `detectSwipe` is shared with `DualColumnLayout`,
   so changing its terminal routing before 5b3 would bifurcate the gesture
   model between the pipeline and `DualColumnLayout`. **Resolution:** the
   clean fix lands with the 5b3 `detectSwipe` rework (when
   `DualColumnLayout`'s `detectSwipe` is removed and the pipeline owns the
   gesture layer end-to-end).

4. **`backParent` consumer dissolution timeline (spec-code drift on
   5b1-skipped item #5).** The spec's 5b1-skipped item #5 ("at end of 5b2,
   both consumers are gone; 5b3 removes the field") overstates the current
   code: `isPipelineSwipeDisabledRoute` still reads `backParent !== undefined`
   (see #1), so one consumer remains at end of 5b2. The field cannot be
   removed until both the classifier and `DualColumnLayout`'s `detectSwipe`
   are addressed in 5b3. **Why documented rather than softened:** the
   5b1-skipped item #5 text is forward-looking (it tracks the field's
   dissolution plan). **Resolution:** the drift dissolves in 5b3 when the
   classifier and `DualColumnLayout`'s `detectSwipe` are removed and the
   field is deleted.

5. **Forward deep-to-deep slide axis override (macro-plan deviation).** A
   forward `{detail, detail}` navigation (e.g. `/profile` ->
   `/profile/settings`, or a sidebar link `/messages/<id>` ->
   `/discussion/<id>`) on the 2-panel `NavPipelineHost` slides visually
   **backward** (axis `right`, destination skeleton revealed from the left
   panel) for what is semantically a forward push. **Why retained:** the
   `{detail, detail}` resolver returns axis `left` for a forward push, but
   `NavPipelineHost`'s track is 2 panels wide (centre + left; no right
   panel), so a leftward slide would reveal empty space. The axis override
   to `right` lets the destination skeleton (rendered by
   `NavPipelineHost`'s `forwardDeepTarget` branch) be revealed. The title
   crossfade direction is derived independently from `navStore.direction`
   in `#resolveNavDirection`, so the title still enters from the right
   (matching the forward semantic). The slide direction and the title
   direction therefore disagree visually for this transition only.
   **Resolution:** the clean fix is a 3-panel track (a right-panel
   destination slot, mirroring `NavPipelineTabHost`'s 3-panel geometry)
   OR a coordinator-driven preload (Layer 4) that places the destination
   in a right panel so the resolver's native `left` axis works. Either
   lands in a future cycle.

6. **Backward gesture on a bidirectional tab host to a higher-indexed tab
   (macro-plan deviation).** A backward gesture on a bidirectional tab host
   (`NavPipelineTabHost`) can target a HIGHER-indexed tab when that
   higher-indexed tab is the temporal-previous entry (the user previously
   navigated forward from it). Per macro §6 the backward gesture must target
   the temporal-previous entry (where the user came from), not the
   spatial-previous tab. The higher-indexed tab sits at `[2W, 3W]` in the
   3-panel track layout and can only be revealed by a leftward track
   translate (axis `left`), so the track translates leftward while the
   finger moves rightward for this one case: the content moves against the
   finger. **Why retained:** this is a geometry consequence of the 3-panel
   track layout (panel index strictly determines translate direction; a
   higher index is always leftward-revealed). The macro-plan mandate
   (target the temporal-previous) takes priority over the
   spatial-direction coincidence. The pill still interpolates toward the
   target tab and the FAB scale follows `fabScale`, so only the
   finger-vs-content direction is inverted. **Resolution:** none planned;
   the deviation is intrinsic to revealing a higher-indexed panel from a
   lower one within a single 3-panel track. A nested-sub-pager
   architecture (macro §9) would dissolve the case by giving each tab its
   own track; out of scope for 5b3.

## Out of scope (5b3)

- Deleting `swipe.ts` / `DualColumnLayout`. (`GesturePageLayout` and `MobileTabPager` were deleted in 5b2 once every route had migrated to the pipeline host; both were dead, zero imports.)
- Removing `backParent` from `RouteData`.
- Offline unification (Cycle 6).

## Deliverables

- The wiring: every route mounts `NavPipelineHost` (or the pipeline tab host). All four wiring points per route.
- The rAF-driven FAB scale (`fabScale(progress, fromHasFab, toHasFab)`, replacing the CSS + setTimeout family-swap animation).
- The NavStateMachine promoted to authority.
- MobileTabPager replaced by the pipeline tab host.
- `docs/DV20-C05b2-Journal.md` (incremental, honest, real evidence).
- E2e: pilot sweep stays green; new specs for deep-page, compose, tab swipe, and cross-family FAB.
