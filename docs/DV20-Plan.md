# DV20: Mobile Navigation / Gesture Architecture (Macro)

**Status:** Macro architecture document. Supersedes the forward-swipe-handoff plan (R2: 0/5 PASS, 5/5 FAIL, unanimous). Grounded in five research lines completed 2026-07-04 (records in `docs/DV20-Meeting/DV20-Plan-Journal.md` and the research agent transcripts). Pending owner sign-off on the tag taxonomy and the Cycle plan, then Cycle execution begins under the Cycle Manager protocol (§11).

**Scope:** The navigation, gesture, page-cache, and page-rendering lifecycle layer. The page-cache and page-rendering lifecycle are cross-platform (mobile + desktop); the gesture state machine (orchestrator, intent, resolver, executor) is mobile-only, and desktop navigates via plain SvelteKit nav rendered through the same lifecycle that renders the state-driven track on mobile. The forward-swipe Messages to `/search` is one consequence of this redesign, not its focus.

**Values:** Architectural excellence, long-term maintainability, no shortcuts, no make-do. Every decision is evaluated against these. See §13.

## 0. Why the previous approach failed

DV18 and DV19 each shipped a 5/5-PASS plan that was architecturally wrong. DV20 attempted a third design (pre-navigate + cross-component gesture handoff); the R2 audit returned 0/5 PASS unanimously, with arithmetic-traced geometry defects (the forward `visualDragOffset` formula was wrong by one full panel width against the live `trackTranslateX` base), an underspecified `detectSwipe.claim` that would have classified every release as `reversed` (the forward swipe never commits), pointer events lost during the DOM swap, and a 7-to-9-piece parallel gesture bridge violating the project's own "GPL track-slide is the only transition mechanism; never bridge two mechanisms with a third" rule.

The retrospective that emerged across the research lines is that DV18, DV19, and the DV20-handoff all failed for the same root reason, and it is not a geometry bug or a missing method on `detectSwipe`. It is that this layer has no underlying state machine. State is smeared across roughly twenty flag variables in four-plus stores and components (`dragOffset`, `rawDragOffset`, `swipeDirection`, `snapIndex`, `isPendingNavigation`, `isTransitioningOut`, `pendingCancel`, `swipeNeedsLoadingAtStart`, `transitionEnabled`, `pendingNavRafId`, `activeIndex`, `showDeepPreview`, `backChipReveal`, `pendingNav`, `navInFlight`, `direction`, `fractionalIndex`, `dragging`, `backMorph`, `coverProgress`, `tapMorph`, plus implicit CSS-transition state read back via `transitionend` and computed-style polling). Around 130 to 138 imperative route-classification call sites (`hopForHref` 30, `getCurrentTabIndex` 27, `backSwipeShouldPopHistory` 22, `isOverlayRoute` 19, `isTabRootPath` 15, `isComposeRoute` 8, `isPagerRoute` 6, `isGesturePageLayoutRoute` 3) encode the same shallow-vs-deep question everywhere. The animation layer is split between CSS transitions and JS rAF loops, coordinated by eight overlapping gates and three `setTimeout` calls that align animations by guessing durations. Four cache singletons (`list-cache`, `deep-page-snapshot`, `page-scroll`, `search-cache`) use different keys, value shapes, invalidation rules, and reader contracts for what is conceptually the same thing. The MobileTabPager hardcodes three panels.

In this layer a small requirement (forward swipe from the last tab to `/search`) is not local to one place. It touches the gesture detection, the track geometry, the cache check, the navigation dispatch, the Header morph, the FAB scale, and the CSS-vs-rAF gate, and it must reconcile all of them. That is why each attempt produced five parallel mechanisms and still failed. The fix is not another mechanism; it is to give the layer a single authoritative state machine and a unidirectional pipeline so that a small change becomes local to one resolver.

## 1. Goal

A navigation and gesture layer in which:

1. There is one authoritative state for "what the navigation is doing right now", read by every consumer.
2. Each transition is resolved by a pure function of (user intent, route stack, route data); the resolver is selected by a (from-tag, to-tag) pair, and each pair has one symmetric resolver.
3. Exactly one animation mechanism (a single rAF loop driven by the state machine) owns every visual property's motion; there are no CSS transitions and no `setTimeout` alignment in the gesture layer.
4. The commit animation's speed matches the finger's release velocity (no hardcoded 200ms); the feel is consistent.
5. Page data and scroll are cached in one store keyed by route; tabs and deep pages are handled uniformly.
6. The forward-swipe Messages to `/search`, the back-swipe `/search` to Messages, tab-to-tab swipes, deep-page enters and exits, and the root-to-search tap morph are all instances of the same pipeline, differing only in which resolver the pair selects.

## 2. Architecture: a five-layer unidirectional pipeline

Data flows one direction, top to bottom. Only the bottom layer touches the DOM. Each layer has one responsibility.

### Layer 1: Lifecycle orchestrator (the state machine)

Owns the macro state of a navigation transition and the page lifecycle. Macro phases: `at-rest`, `intent`, `resolving`, `transitioning` (with the active resolver and phase), `landing`. Owns interruption (a new intent arriving mid-transition; a popstate; a failed preload) and SvelteKit interop (§9). Carries the `PageLifecycle` contract (§8). The orchestrator holds the (from-tag, to-tag) dispatch table and selects the resolver for the current transition.

### Layer 2: Intent classifier

Maps raw input (pointer events, taps, popstate, hash change) to an intent plus continuous parameters (direction, live offset, live velocity). Replaces the gesture-detection logic currently split across `detectSwipe`, `onSwipeMove`, and `beforeNavigate`. Pure classification; no side effects; no DOM writes. Publishes the intent downward.

### Layer 3: Resolver (tag-pair dispatch)

A pure function `resolve(intent, stack, route-data) -> TransitionPlan`. The orchestrator selects the resolver by the (from-tag, to-tag) pair of the current transition (§4). The plan is resolved once per gesture (the FROM and TO are locked at gesture start; the live offset streams separately to the executor). The resolver does not touch the DOM.

### Layer 4: Coordinator (cache)

Given the plan's FROM and TO, consults the unified `PageCacheStore` (§7). If the TO is cached, the plan is a direct slide. If not, the plan becomes a chip-exit with preload. Replaces `swipeNeedsLoadingAtStart`, `leftNeedsLoading`, `leftHasPreview`, `isLeftCachePopulated`, and the scattered `preloadData` calls.

### Layer 5: Executor (animation)

A single rAF loop, driven by the orchestrator's phase, executes the plan. It writes the per-frame visual state for every consumer (page track, FAB, Header). It is the only layer that touches the DOM. The commit phase animates with a velocity-matched momentum integral (§5). No CSS transitions; no `setTimeout`.

The orchestrator (Layer 1) and the intent classifier (Layer 2) are the macro and micro of one transition, not two independent machines: the intent layer kicks the orchestrator from `at-rest` into `intent`; the orchestrator owns everything from `resolving` through `landing`.

## 3. Route DATA model

One record per route replaces the ~138 classifier call sites. The record is data, sourced from the route's actual mount and behavior.

**Clarity principle (binding).** The `tag` is the single primary categorization; it selects the resolver pair. No stored field may duplicate the tag; anything that maps one-to-one to it is derived. The core record holds ONLY what the resolver (Layer 3) or coordinator (Layer 4) genuinely read. Consumer-rendering details (the FAB's icon, the tab-bar's pill target) live in their own consumer configs, not here. §3 describes the TARGET architecture; Cycle 1 is a behavior-preserving data-relocation step, so where a target-form derivation would change behavior (the pure-tag `headerMode` formula, full `backParent` coverage, dissolving the FAB family enum), Cycle 1 keeps the behavior-preserving intermediate and documents it as a deviation deferred to the noted cycle. Those deviations are intentional intermediate state, not defects.

```ts
interface RouteData {
	// The primary categorization. Selects the resolver pair (§4). A page's tag is
	// the transition family it participates in, not a hierarchy level.
	tag: 'tab' | 'detail' | 'search';
	// TRANSITIONAL (migration-era): remove when its consumers dissolve; do NOT
	// leave it as a permanent field. The route's structural parent. It exists ONLY
	// to feed two transitional consumers: `isGesturePageLayoutRoute` (reads
	// `backParent !== undefined` to mark the deep-route set; dissolves in Cycle 5)
	// and `GesturePageLayout.resolvedLeftHref` (the "/" edge-case substitution;
	// dissolves in Cycle 3 when back-target becomes always stack-based). It has no
	// clean target use (no breadcrumb; the preview panel is PREVIEW_PANEL_CONFIG).
	// When both consumers are gone (end of Cycle 5), remove this field from the
	// record and the registry. NOT the back-target (that is the route-stack entry
	// behind the current one, §6).
	backParent?: string;
	// Whether the page captures its data into the cache on leave.
	// Read by the coordinator (Layer 4).
	snapshotCapture: boolean;
	// Whether the FAB is visible on this page. The resolver (Layer 3) reads the
	// from/to fab booleans to drive the FAB scale plan: visible-to-hidden shrinks,
	// hidden-to-visible appears. There is NO FAB family enum; the
	// list/overlay/compose distinction was an artifact of the DV09 track-sampler
	// and dissolves in the unified resolver-driven architecture.
	fab: boolean;
}

// Derived (NOT stored; one source of truth):
//   isSpatial(r)       = r.tag === 'tab'
//   headerMode(r)      = r.tag === 'tab' ? 'root' : r.tag === 'search' ? 'search' : 'deep'
//   spatialNeighbours  = positional: a tab's neighbours are its adjacent entries in
//                        the tab order (the tag's metadata), not a per-route field.
// (centerTab / pill target is a tab-bar consumer-config read, NOT a RouteData
//  derivation; and `backParent` itself is transitional; see its field comment.)
```

**Consumer configs (separate, keyed by route; NOT in the core record):**

- **FAB config**: the FAB's icon and tap-action for each route with `fab: true`. Today only `/` (new discussion) and `/messages/inbox` (new message). The FAB layer reads this for rendering; the resolver reads only the core `fab` boolean for the scale plan.
- **Tab-bar config**: the pill target per route (`'discussions' | 'activity' | 'messages' | 'active' | 'none'`), where `'active'` (renamed from `inherit`) means the route follows the currently-active tab (the global routes `/admin`, `/profile`, `/search`, `/bookmarks`, `/notifications`). The tab-bar reads this to position its pill during a transition.

**What was removed and why:**

- `isSpatial`, `headerMode`, `gestureOwner`: derived or deferred. `isSpatial` is `tag === 'tab'`; `headerMode` derives from tag; `gestureOwner` is a component-architecture property that dissolves in Cycle 5 (the latent `isGesturePageLayoutRoute('/search') === false` bug is a DualColumnLayout-vs-GPL competition issue fixed then, not by a data field).
- `spatialNeighbours`: a tab's neighbours are positional in the tab order (tag metadata), not a per-route field.
- `fabFamily` (the list/overlay/compose/none enum): a DV09 track-sampler artifact. In the unified resolver-driven architecture the FAB is visible-or-not; the resolver drives shrink/appear from the two routes' `fab` booleans. The enum is gone.
- `fabKind`: the FAB's icon/action is a rendering detail, moved to the FAB config.
- `tabModule`: moved to the tab-bar config as the pill target; `inherit` renamed to `active`.
- `subPager`: removed. A nested pager (SearchScopePager) self-registers with the top-level gesture layer (the existing `shouldClaim` pattern); it is not a route-data field.
- `forcedBackTarget`: removed. The back-target is always the route stack's previous entry (with `backParent` as a deep-link fallback). The "threads always back to their list" override (today's `leftHref` on threads) is dropped in favour of consistent stack-based back: a thread reached from its list backs to the list (the common case), and a thread reached from elsewhere backs to where the user came from.

The discussions-detail and messages-detail pairs reach their source list via the tab-bar and FAB consumer configs (`pillTarget` + `fabKind`), not via `backParent`. `backParent` declares structural parents for the settings/admin/compose sub-trees (e.g. `/profile/settings → /profile`). Activity has no detail page because no deep route declares it as a structural parent. `/search` carries `tag: 'search'`; its Header mode is derived (`search`) and its navigation behavior is deep; its nested SearchScopePager self-registers.

## 4. Tag-pair resolvers

The orchestrator selects the resolver by the (from-tag, to-tag) pair. A bidirectional pair shares one resolver because the two directions are the same animation reversed (parameterized by progress direction, 0 to 1 for enter, 1 to 0 for exit). Six pairs for three tags:

| Pair               | Resolver               | Transition it owns                                                                                                                                                         |
| ------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{tab, tab}`       | `tabTabResolver`       | Spatial swipe between tabs; tab-internal pagination (e.g. `/discussions/p2`); cross-tab chip-exit when the target is not pre-rendered.                                     |
| `{detail, detail}` | `detailDetailResolver` | Deep-to-deep (thread to profile, settings to sub-settings). Header title push/squish crossfade is part of this resolver's Header plan.                                     |
| `{search, search}` | `searchSearchResolver` | Not a top-level transition today (search has no search-to-search nav); reserved. The SearchScopePager's internal scope switch is a nested sub-pager, not a top-level pair. |
| `{tab, detail}`    | `tabDetailResolver`    | List-to-detail enter slide; detail-to-list back slide. FAB scale 1 to 0 across the slide; Header back-arrow + title crossfade.                                             |
| `{tab, search}`    | `tabSearchResolver`    | Root-to-search and search-to-root. Owns the DV17 Header scrub morph; the track slide; the FAB scale.                                                                       |
| `{detail, search}` | `detailSearchResolver` | Thread/profile to search and back.                                                                                                                                         |

Each resolver is a pure function:

```ts
type Resolver = (input: {
	intent: Intent;
	stack: RouteStack;
	from: RouteData;
	to: RouteData;
	direction: 'forward' | 'backward';
}) => TransitionPlan;

interface TransitionPlan {
	pageTrack: { axis: 'left' | 'right'; distance: number }; // which way, how far
	fab: (progress: number, liveOffset: number) => FabVisual; // scale, translateY
	header: (progress: number, liveOffset: number) => HeaderVisual; // morph, translateY, titleCrossfade
	progressDirection: 0 | 1; // 0 to 1 = enter, 1 to 0 = exit
	commitPhysics: 'momentum' | 'snap'; // momentum uses release velocity; snap for reduced-motion
}
```

The resolver computes the page-track axis. For `{tab, tab}` it is spatial: left or right by the two pages' positions in the spatial layout. For cross-tag pairs it follows user intent and the route stack: a forward push slides one way, a back pop slides the other. The non-adjacent-tab case is not a separate product decision; the resolver computes the direction from spatial position for tab-to-tab and from intent plus stack for cross-tag, and the executor plays it.

The resolver hands each consumer (page track, FAB, Header) a function of `(progress, liveOffset)` plus the plan's structural fields. The consumers execute; they do not decide. The `commitPhysics` field selects the executor's commit integrator.

The resolver is unit-testable: given (intent, stack, from, to, direction), assert the plan. This is a large testability gain over the current scattered-flag state.

Default symmetry: a pair's two directions use the same resolver with `progressDirection` flipped. A resolver MAY override one direction when the pair is genuinely asymmetric (e.g. a chip-exit whose reverse is a quick-retract); the structure allows per-direction override without forcing two resolvers.

## 5. Executor: all-rAF, velocity-matched

One rAF loop, driven by the orchestrator's phase. Each frame, for each consumer, the executor calls the plan's function with the current `(progress, liveOffset)` and writes the returned visual to the DOM. The structural invariant:

> For any visual property of the gesture/navigation layer at any instant, exactly one rAF write owns its motion, decided solely by the orchestrator's phase. CSS transitions and `setTimeout` alignment do not exist in this layer.

### Velocity-matched commit

The commit phase does not use a hardcoded 200ms ease. It takes the finger's release velocity (computed by the intent classifier from the trailing pointer samples) and integrates the remaining distance with a critically-damped spring (or equivalent momentum integral) at that velocity. The animation duration is variable: a fast flick commits in a few frames; a slow drag-and-release commits over a longer ease. Near-zero release velocity falls back to a default ease; very high velocity is clamped to a ceiling. This delivers the long-missing consistency: the gesture's release feel matches the drag feel.

### Interruption

A new intent arriving mid-commit (the user re-grabs during the momentum animation) interrupts cleanly: the orchestrator cancels the commit rAF, reads the current visual position and the new pointer position, and enters the `dragging` phase from the current visual state. No jump.

### Reduced motion

The executor checks `matchMedia('(prefers-reduced-motion: reduce)')`. When set, the commit phase snaps (translates instantly to the target, no rAF integration). CSS transitions used to handle this automatically; the all-rAF executor must handle it explicitly. This is a non-negotiable accessibility requirement.

### SSR safety

The executor is browser-only. The initial server render is the resting state (no animation). A `browser` gate (mirroring the existing pattern) prevents the rAF loop from running during SSR.

### Performance

`transform` and `opacity` are compositor-friendly; the rAF callback computes values, the compositor paints. The main-thread cost is one callback per frame per active transition, which is well within budget. The current dual `getComputedStyle(trackEl).transform.m41` reads (the pending-nav poll and the FAB sampler) are eliminated: the executor holds authoritative state and publishes it to consumers directly; no consumer reads back from the DOM.

## 6. State machine

Macro phases (Layer 1): `at-rest-on-tab`, `at-rest-on-deep`, `intent`, `resolving`, `transitioning` (carrying the active resolver, the plan, the phase `dragging` | `committing` | `cancelling` | `scrubbing`), `landing`. Micro states (Layer 2, intent): `idle`, `deciding`, `drag-left`, `drag-right`, `committed`, `cancelled`.

The phase record carries `(from, to, startTime, liveOffset, releaseVelocity, direction)` and is the sole input to every consumer. The four duplicated `committed` predicates, the three "where are we going" strings (`resolvedLeftHref`, `lockedLeftHref`, `pendingTargetHref`), the stealth `navInFlight = false` writer, and the overloaded `pager.dragging` semantics (research line 2) are eliminated: there is one `phase` and one resolved `from`/`to`.

The back-target is always the route stack's previous entry, read at gesture start; there is no per-route override. (`backParent` is a separate transitional field, see §3; it feeds the `resolvedLeftHref` "/" edge-case substitution and `isGesturePageLayoutRoute`; it dissolves in Cycles 3 and 5 and is NOT a back-target fallback.) `backSwipeShouldPopHistory` is deleted: a back-swipe always targets the stack's previous entry; the hop-vs-push decision is the generic `hopForHref` check, which already works for any page including `/search`.

## 7. Unified cache: `PageCacheStore`

Replaces `list-cache`, `deep-page-snapshot`, `page-scroll`, and `search-cache`. One store, keyed by `(pathname, subKey)`:

```ts
interface PageCacheEntry {
	data: UnknownPageData; // the page's server payload; opaque to the store
	scrollTop: number; // colocated with data; eliminates the separate scroll store
	source: { route: string; query?: string; sort?: string; page?: number };
	capturedAt: number;
}
// The entry's type (tab-list / thread / search-scope / deep) is NOT stored; it is
// derived from `source.route` via the RouteData record. The reader narrows `data`
// by looking up the route, not by reading a stored discriminator.
```

One writer (`capture`), one reader (`get`), one invalidation rule (source-tag mismatch + a TTL eviction that closes the unbounded `page-scroll` growth). The coordinator (Layer 4) reads it to decide chip-exit vs direct slide. SvelteKit's `snapshot` exports are retained for cross-reload restoration (orthogonal to this session-scoped store).

This dissolves the documented cache bugs at the class level: back-to-back threads no longer destroy each other's snapshot (keyed by pathname); scroll is colocated with data so a stale scrollTop can never apply to the wrong content; the cross-tab chip-exit can read "what was behind me in history" from one store.

## 8. Page lifecycle

A four-phase contract owned by the layout that mounts the gesture surface, honoured uniformly across tabs and deep pages: `mount` (SSR + hydrate; no listeners, no store writes), `activate` (DOM bound; acquire locks, publish the gesture track, register the scroll source), `deactivate` (navigation away committed; stop publishing; hold locks through the swap), `unmount` (release locks, cancel rAFs, clear cross-page publications).

The lifecycle-adjacent stores (`viewport-lock`, `scroll-chrome`, `active-gesture-track`) become lifecycle hooks. The refcount-with-microtask-deferral pattern (already used by `viewport-lock`) is the template for any html-level singleton. SSR teardown guards move from per-call `if (!browser)` to the lifecycle module's `unmount`, eliminating the `svelte-ondestroy-runs-in-ssr` trap at the source.

## 9. SvelteKit interop, nested pagers, edge cases

**SvelteKit interop.** SvelteKit owns the route lifecycle (`load`, `beforeNavigate`, `afterNavigate`). The orchestrator coordinates, it does not bypass. The chip-exit path: the orchestrator's `beforeNavigate` hook calls `navigation.cancel()`, the coordinator preloads, the orchestrator dispatches the nav via the pending-nav poll on phase completion. The boundary between the orchestrator and SvelteKit's hooks is explicit: SvelteKit decides when a navigation starts and when it lands; the orchestrator decides the animation around it.

**Nested pagers.** `SearchScopePager` is a nested gesture layer inside `/search`'s centre panel. Its gestures yield to the top-level orchestrator at boundaries (the existing `shouldClaim` logic), so a rightward drag at the leftmost scope bubbles to the orchestrator's back-swipe. The sub-pager is NOT a top-level (from, to) pair; it is a nested consumer with its own local state machine that composes under the top-level.

**OS edge-back.** The 40px edge-dead-zone in `detectSwipe` is preserved in the intent classifier; the OS edge-back gesture and the app's back-swipe do not collide.

**Deep-link landing.** On a first load (no gesture), the orchestrator starts at `at-rest`; the page mounts and activates with no enter animation (or the existing `enterRaf` enter-slide if the stack indicates a forward arrival).

**Offline routes.** The `/offline/*` routes are the offline-rendering mirrors of online routes, sourced from IndexedDB by the offline reader (DV06/DV07). `/offline` mirrors `/` (the discussions list) and `/offline/[discussionId]` mirrors `/discussion/[id]` (a discussion detail); both are discussions-tab content served offline. `/offline/activity` and `/offline/bookmarks` mirror their online counterparts likewise. They mount DualColumnLayout only (no GesturePageLayout), so they do not participate in the horizontal gesture layer, and they read IDB directly (not `PageCacheStore`). Their list-to-detail structure (`/offline` to `/offline/[id]`) parallels the online discussions-list-to-detail structure, but without the gesture. DV20 brings the offline routes into the unified layer (Cycle 6): the offline routes mount the state-driven track, IDB feeds the cache interface (Cycle 2 designs it data-source-agnostic), and the offline list-to-detail transitions use the gesture layer like their online counterparts. Leaving offline as a parallel path would preserve exactly the online-vs-offline fragmentation this architecture eliminates, so it is in scope.

**DualColumnLayout dissolves completely.** DualColumnLayout's current roles are (a) a desktop sidebar + content layout and (b) a mobile gesture-disable wrapper that keeps the page's own swipe from competing with the GesturePageLayout. In the new architecture the state machine owns the gesture, so role (b) dissolves entirely (there is no competition to disable); on mobile the page lifecycle (Cycle 5) owns the page structure, so the mobile wrapper is redundant too. Role (a) is NOT left as residue: the desktop sidebar + content is absorbed into the page-rendering lifecycle, which renders the sidebar + content on desktop and the state-driven track on mobile. The migration (Cycle 5) and the offline unification (Cycle 6) remove DualColumnLayout from the routes; `MobileTabPager` and `GesturePageLayout` likewise dissolve into the unified state-driven track. Nothing is left "out of scope"; DualColumnLayout has no residue.

**Multi-touch.** The intent classifier tracks the primary pointer; a secondary pointer is ignored. Single-gesture at a time.

## 10. Refinements to handle in the Cycle specs (not blockers)

1. prefers-reduced-motion handling in the executor (§5).
2. Commit interruption by a re-grab (§5).
3. Velocity-matched commit edge cases (near-zero fallback, high-velocity clamp, integrator choice).
4. Detail-to-detail Header title readiness: the new title may not be loaded when the animation starts; the resolver and coordinator must handle the async (chip-exit-style preload, or a deferred title swap mid-crossfade).
5. `{tab, tab}` covering tab-internal pagination, not just spatial swipes.
6. SSR safety of the executor (§5).
7. The SvelteKit-orchestrator ownership boundary (§9), specified per transition type.
8. SearchScopePager composition (§9).

## 11. Cycle plan and the Cycle Manager protocol

Execution is sliced into Cycles. Each Cycle is a discrete, auditable unit with its own spec, implementation, multi-agent audit, and report. The architect (this document's owner) writes the macro architecture and each Cycle spec; a Cycle Manager Agent (CMA) implements the Cycle and runs its audit; the architect reviews each Cycle's report against the spec and decides rework or advance.

### Cycle slicing (dependencies in parentheses)

- **Cycle 1: Route DATA model + tag taxonomy.** Replace the ~138 classifier call sites with per-route `RouteData` records (§3). Add the tag values. Pure data refactor; the existing call sites become reads of the record. (No dependency. Low risk. Decouples downstream Cycles.)
- **Cycle 2: Unified `PageCacheStore`.** Replace the four cache singletons with the unified store (§7). Migrate writers and readers. The store's read interface is data-source-agnostic (a pluggable source) so Cycle 6 can plug in IndexedDB for the offline routes. (No dependency. Medium risk.)
- **Cycle 3: State machine core + tag-pair resolvers (Layers 1 to 4).** The orchestrator, intent classifier, resolver dispatch table, and coordinator. The resolvers produce plans but do not yet drive the DOM (the executor lands in Cycle 4). Validate the plans against the current behavior in a shadow/parallel mode. With the back-target always stack-based, the `resolvedLeftHref` "/" edge-case substitution dissolves here; the first of `backParent`'s two consumers goes away. (Depends on Cycle 1. High risk. The core.)
- **Cycle 4: All-rAF executor + velocity-matched commit (Layer 5).** The single rAF loop, the velocity-matched momentum integrator, interruption, reduced-motion. Delete the CSS transitions, the `setTimeout` alignment (three sites), and the dual DOM read-back. (Depends on Cycle 3. High risk.)
- **Cycle 5: PageLifecycle contract + migration.** Roll the lifecycle hooks across all page types and both platforms; cut over from the old `MobileTabPager` / `GesturePageLayout` / `DualColumnLayout` to the new pipeline (state-driven track on mobile, sidebar + content on desktop), route-by-route, with full e2e at each step. The state machine now owns the gesture, so `isGesturePageLayoutRoute` (and the latent `/search` bug) dissolve; the second of `backParent`'s consumers goes away. With both consumers gone, REMOVE `backParent` from `RouteData` and the registry in this Cycle (it is transitional; do not leave it standing). (Depends on Cycles 1 to 4. Cross-cutting.)
- **Cycle 6: Offline unification.** Bring the `/offline/*` routes into the unified gesture/navigation/cache layer. Mount the state-driven track on the offline routes; plug IDB into the data-source-agnostic cache interface; give the offline routes `RouteData` records mirroring their online counterparts; remove DualColumnLayout from them. The offline list-to-detail transitions (`/offline` to `/offline/[id]`) use the gesture layer like online. (Depends on Cycles 1 to 5. Final.)

Each Cycle is sequenced by default. Parallel execution is permitted only for Cycle pairs that are provably file-disjoint: the agents are unaware of each other, so parallel edits to the same file conflict silently. Given the gesture-owner files are touched by most Cycles, the default is sequence; the architect re-evaluates parallelism per pair only when a disjoint pair emerges.

### Cycle Manager Agent (CMA) instructions

For each Cycle, the architect spawns a CMA with: this macro document, the Cycle spec (`docs/DV20-Meeting/DV20-Cycle-N-spec.md`), and the protocol below. The CMA owns the Cycle's implementation and audit; the architect owns the spec and the verdict.

**Documentation (DV09/RV09 convention, binding).** For Cycle N (1 to 6): the implementation journal is `docs/DV20-C0N-Journal.md` (at the `docs/` root); each audit round is `docs/RV20-C0N-Audit-{MM}.md` (at the `docs/` root, `RV` prefix, zero-padded round number); the Cycle spec is `docs/DV20-Meeting/DV20-C0N-spec.md`; the Cycle revision history is `docs/DV20-Meeting/DV20-C0N-Plan-Journal.md`. This matches DV09's `DV09-C00-Journal.md` / `RV09-C00-Audit-{NN}.md` (implementation artifacts at the root) and the `DV##-Meeting/` plan-phase folder. The journal records what actually happened, including failures; it does not perform confidence.

**Multi-agent audit (orchestrator-run, 5-vote convergence).** The architect (orchestrator) runs the audit, not the CMA. Each round: 2 independent role-less, hint-less auditors. Accumulate pass votes across rounds (2 per round, or 1 in the final round). When the total reaches 5 consecutive pass votes (e.g., 2 + 2 + 1 across three rounds), the Cycle closes. Any concern resets the counter to 0. The audit prompt gives ONLY what the system IS (the spec, the architecture) and the open instruction "find ANY defect empirically"; it must NOT include prior-round results, state assessments, or any framing that implies the state is clean or dirty. The audit process's convergence state (how many votes accumulated so far) is NOT itself a concern for the auditor: the auditor assesses the code and journal; the orchestrator counts the votes. PASS-with-concerns is not PASS. The orchestrator independently verifies every CMA claim (re-runs `bun run check`, `bun test`, reads the audit files, cross-checks the journal numbers against actual outputs). The CMA does NOT run its own audit (conflict of interest).

**Anti-cheating (non-negotiable).**

- The CMA decides what to verify and how. The architect does not prescribe a checklist of gates or commands; prescribing the checks would let the CMA follow a recipe instead of demonstrating it knows what correctness means for its scope. The CMA determines the appropriate verification, carries it out, and pastes the real evidence in the journal. A claim of correctness without supporting evidence is a failure.
- A defect is not fixed unless a preventive test exists that fails on the cause and passes on the fix. The CMA decides what tests are needed; no fix is claimed without one.
- A Cycle is complete only at 5 consecutive pass votes (per the convergence model above).
- No shortcuts: no CSS-transition or setTimeout animation alignment in the gesture layer; no parallel mechanism where the architecture says unify; no hardcoded commit duration; no make-do that leaves fragmentation in place.
- No fabrication (non-negotiable). The CMA must not invent architect instructions, verdicts, audit outcomes, or evidence. If the audit cannot complete (an infrastructure rate limit, an agent failure, any blockage), the CMA reports the blockage honestly in the journal and stops; it does not fabricate a justification to deliver. Delivering a Cycle without the 5-vote convergence bar, or asserting an instruction that was not given, is a protocol violation that voids the Cycle. (Added after CMA1 fabricated an "architect instruction" to escape a rate limit.)
- No git mutation that bypasses review. The CMA works in the working tree; no stash/checkout/reset/clean/switch/commit/push without the architect's instruction.
- Every deviation from the spec is documented in the journal and flagged for the architect. Deviations are not decided unilaterally by the CMA.

**Reporting.** On completion, the CMA returns a report: files changed, the audit tally per round, the gate outputs (pasted), the deviations, and the carried-to-future items. The architect reads the report, verifies it against the spec (§13 values), and decides: rework (open a new CMA with the specific deficiencies) or advance to the next Cycle.

## 12. Testing strategy

- **Unit.** The resolvers are pure functions; each pair gets a unit suite covering (intent, stack, from, to, direction) to plan. The cache store's `capture`/`get`/`invalidate` get a unit suite. The lifecycle refcount gets a unit suite.
- **E2E.** Each transition family gets an e2e spec that samples `getComputedStyle(el).transform` (or the published plan values) across the gesture and asserts the trajectory shape (first/min/max/last, a 0.5 mid-window crossing, monotonicity where required). The velocity-matched commit gets a spec that varies the release velocity and asserts the commit duration tracks it (longer for slow releases, shorter for fast). Reduced-motion gets a spec that sets the media query and asserts a snap (no rAF integration).
- **SSR.** A raw-fetch (no-JS) spec per route class asserting the resting transform, mirroring the DV09 SSR-style preventive tests.
- **Regression.** The full e2e suite runs at each Cycle's audit. Pre-existing flakes are documented and excluded with a rationale, never silently.

## 13. Values and decision principles

1. **Architectural excellence over expediency.** When a faster path leaves fragmentation in place, take the longer path that removes it.
2. **Long-term maintainability over short-term shipping.** A small change must be local to one resolver. If a change touches five files of scattered state, the architecture is wrong.
3. **No shortcuts.** No CSS-transition+setTimeout alignment in the gesture layer. No parallel mechanism where the architecture says unify. No hardcoded commit duration. No claiming PASS without evidence.
4. **Unify, do not bridge.** Two mechanisms for the same concern are resolved by deleting one and routing through the survivor, never by adding a third bridge.
5. **The state machine is the only authority.** Consumers read the phase and the plan; they do not read back from the DOM; they do not hold private transition state.
6. **Honesty in reporting.** Journals record what happened, including failures. Audits are open-ended and independent. A pass vote earned by a leading prompt is not a pass vote.

## 14. Decisions (signed off 2026-07-04)

1. **Tag set: three independent tags** (`tab`, `detail`, `search`). `search` is independent because the `tab to search` transition owns the DV17 Header scrub. Owner decision: independent tags, the cleanest architecture.
2. **Slide direction is the resolver's job.** For `{tab, tab}` the resolver resolves the axis spatially, by position in the spatial layout. For cross-tag pairs it resolves by user intent and route stack. The non-adjacent-tab case is not a separate product decision; the resolver computes the direction (spatial for tabs, intent plus stack for cross-tag) and the executor plays it. Owner decision.
3. **Cycle sequencing.** Five Cycles, sequenced by default. Parallel execution is permitted only for Cycle pairs that are provably file-disjoint, because the agents are unaware of each other and parallel edits to the same file conflict silently. The architect re-evaluates parallelism per pair when a disjoint pair emerges.

Cycle 1 is spec'd in detail and its CMA is launched.
