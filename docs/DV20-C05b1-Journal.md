# DV20 Cycle 5b1 Journal: Pilot-route cutover (`/messages/[id]`) with e2e

**Status:** in flight (re-launch, UNIFY approach).
**Cycle Manager:** CMA5b1 (re-launch).
**Spec:** `docs/DV20-Meeting/DV20-C05b1-spec.md` (binding "UNIFY, DO NOT BRIDGE").
**Protocol:** `docs/DV20-Meeting/DV20-Cycle-Manager-Protocol-v2.md`.

The first cycle to break shadow mode. The new DV20 pipeline (Cycles 1-5a)
is wired to drive EVERY transition the pilot route `/messages/[id]/[[page=page]]`
makes. The binding bar is observable behavior preservation (verified by e2e)
plus the four wiring points (SvelteKit nav -> orchestrator; pointer -> intent;
executor + driver -> elements; lifecycle). The prior CMA5b1 attempt chose a
forbidden "hybrid ownership" bridge (a `gestureSource` switch + a
`pipelineGestureActive` per-frame gate + an intent mirror) and was reverted.
This re-launch implements UNIFY: the new pipeline is the SOLE transition
mechanism for the pilot, for every transition type.

## Investigation (reference, kept from the rejected attempt)

### Pilot route state today (pre-cycle)

`src/routes/messages/[id]/[[page=page]]/+page.svelte` mounts:

```svelte
<DualColumnLayout {sidebar} {user} {t}>
	<GesturePageLayout centerTab={2} leftHref="/messages/inbox">
		{#snippet left()}
			<MessagesPanel ... />
		{/snippet}
		<div class="space-y-3">... conversation body ...</div>
	</GesturePageLayout>
</DualColumnLayout>
```

So the pilot route renders `DualColumnLayout > GesturePageLayout` with
`centerTab={2}` (messages tab) and `leftHref="/messages/inbox"`. The GPL
publishes the track element to the active-gesture-track store; publishes
cover/backMorph to the mobile-pager store; registers its centre panel as
the scroll-chrome scroll source; acquires the viewport-lock; runs the
`detectSwipe` action on its viewportEl; and owns the slide / chip / nav
state.

`getRouteData('/messages/123')` returns
`{ tag: 'detail', backParent: undefined, snapshotCapture: false, fab: false }`
(the `^\/messages\/\d/` entry). `backParent` is undefined because the
pilot does not declare a structural parent; the `leftHref` is the source
of the back target. `isGesturePageLayoutRoute('/messages/123')` returns
TRUE (Family B `overlay`, kind `messages`, not `deep`).

### E2E coverage of the pilot route (per `e2e/` inventory)

| Spec                               | Touch                    | Notes                                                                                    |
| ---------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `e2e/fab.spec.ts`                  | SSR only (`/messages/1`) | Asserts the FAB atom serializes `scale(0)` in the SSR HTML. No gestures.                 |
| `e2e/tab-exit-preview.spec.ts`     | Visits `/messages/\d+`   | Clicks a tab; asserts the captured exit preview shows the right tab list. No back-swipe. |
| `e2e/tab-click-transition.spec.ts` | Visits `/messages/\d+`   | Clicks a tab; captures the enter/exit track translateX trajectory. No back-swipe.        |

No e2e spec drives a gesture (swipeBack / swipeForward / holdDrag) while
on a `/messages/<numeric>` page. The e2e gate protects the SSR rendering,
the tab-click exit (a different code path in `GesturePageLayout.beforeNavigate`
today), and the routes around the pilot. It does not assert any specific
gesture trajectory on the pilot.

### `GesturePageLayout` behaviour that must be preserved on the pilot

The pilot route (`/messages/[id]`, `leftHref="/messages/inbox"`,
`centerTab={2}`) today exhibits:

- The viewport registers `viewportLock.acquire()` on mobile; the scroll
  container is the `.detail-scroll-pane` (the centre panel), published
  to `scroll-chrome` via `setScrollContainer`.
- The track is multi-panel: `left` (MessagesPanel) + `center`
  (conversation), `panelCount = 2`, `ACTIVE = 1`, `STEP_PERCENT = 50`.
  At rest `trackTranslateX = '-50%'` (the centre panel fills the
  viewport).
- The back-swipe gesture (`swipeDirection === 'right'`):
  - `swipeNeedsLoadingAtStart = leftNeedsLoading || !leftHasPreview`.
    `leftNeedsLoading` is `false` when the root layout has seeded
    `/messages/inbox` (it always does on a `messages/*` route via
    `data.messages`). `leftHasPreview` is `true`. So
    `swipeNeedsLoadingAtStart` starts `false` for a warm-cache
    back-swipe.
  - The drag geometry uses the `HEADER_MORPH_THRESHOLD` gate (0.2 of
    viewport width) so the first 20% of drag is "absorbed" by the
    header morph before the track starts moving. Above the threshold
    the drag maps 1:1 to translateX via `(dragOffset - W*0.2) / 0.8`.
  - The track follows the finger via `calc(-50% + ${visualDragOffset}px)`.
  - The pager store receives `coverProgress = dragProgress` (driving the
    FAB scale-out from 1 -> 0 across the slide) and `backMorph =
progress` (driving the Header's morph from root to deep mode).
- On commit (release past `SWIPE_COMMIT = 60`): the `setPendingNav`
  path. `snapIndex` becomes the `leftIdx = 0`. The track slides from
  `calc(-50% + Npx)` to `-0%` via the CSS `transition-transform
duration-200`. On `transitionend`, `navStore.executePendingNav()` is
  called - this dispatches `history.back()` or `goto('/messages/inbox')`.
  A rAF-poll (the `pendingNavRafId` loop) backs the transitionend as a
  fallback.
- Cross-tab exit (a tab tap to `/` or `/activity`): the chip-exit path
  (`swipeNeedsLoadingAtStart = true`, LoadingChip overlay, preload, then
  slide-and-dispatch).

### Architectural mismatch with the new pipeline (must be reconciled)

`GesturePageLayout` is a write-everything-from-`$derived` component. The
new DV20 pipeline is layered: orchestrator (state machine) -> intent ->
resolver -> coordinator -> executor -> driver (DOM). The reconciliation
surface:

1. **The slide geometry is multi-panel `calc(-STEP_PERCENT% + Npx)`.**
   `LiveNavDomDriver.write` writes `transform: translateX(${tx}px)` -
   pure px. Replicating the multi-panel rest offset requires extending
   the plan + the executor's `buildVisual` with a `restingTranslate`
   field (the track's translate at progress=0). For the pilot's
   `{detail, tab}` pair, `restingTranslate = -viewportWidth/2` (centre
   visible) and `distance = viewportWidth/2` (slide distance to fully
   reveal the left panel). The driver stays write-only px.
2. **The chip-exit + preload + dispatch path** is woven through GPL's
   `beforeNavigate`/`afterNavigate` and the `transitionend` handler.
   The new pipeline's executor publishes a frame; on settle the
   orchestrator dispatches `goto(target)` (or `history.back()` for a
   hop). The orchestrator's `onSvelteKitBeforeNavigate` cancels the nav
   for a pilot-route exit (so the slide can play) and re-dispatches via
   `goto` on settle (§9: orchestrator coordinates, does not bypass).
3. **The CSS transition + transitionend** is the alignment mechanism
   today; the new pipeline drives the commit via the all-rAF executor
   (no CSS transition in the pilot's path).
4. **The pager store writes** (`coverProgress`, `backMorph`,
   `fractionalIndex`) drive the FAB scale and the Header morph. The
   new pipeline publishes them from the orchestrator's reactive state
   (single source of truth: the orchestrator's plan + progress +
   phase), via a `$effect` that calls `pager.set(...)`. This is NOT
   the forbidden "intent mirror": the orchestrator IS the authority;
   the pager store is a legacy consumer that gets fed FROM the
   orchestrator (not the other way around).

## Design (UNIFY)

### Ownership boundary (single transition mechanism)

For the pilot route ONLY, the new pipeline is the SOLE transition
mechanism for EVERY transition the route makes:

- **Gesture (back-swipe):** `detectSwipe` (the existing primitive in
  `src/lib/actions/swipe.ts` - it is gesture-detection, NOT animation or
  navigation) feeds the intent classifier; the orchestrator runs the
  resolver + coordinator; the executor publishes frames via the rAF
  loop; the LiveNavDomDriver writes the track translate via
  `style.setProperty`; on commit-settle the orchestrator dispatches
  `goto` / `history.back`.
- **Tab-click exit:** SvelteKit fires `beforeNavigate`; the
  orchestrator's pilot-route handler cancels it, runs the resolver,
  drives the executor through the commit phase, and dispatches the nav
  on settle.
- **Deep-link landing:** First load. The orchestrator starts at-rest;
  the host component mounts the structural surface with no animation.

NO `detectSwipe` -> `$state` -> `$derived` geometry -> CSS transition ->
`transitionend` -> `pendingNav` path exists for the pilot. The
GesturePageLayout component is NOT mounted by the pilot.

The pilot's structural surface (multi-panel track, scroll pane, snippet
slots, viewport-lock acquisition, scroll-chrome registration,
active-gesture-track publication) is rendered by a NEW component
(`NavPipelineHost.svelte`). The host has no gesture/navigation state of
its own; it `bind:this`es the track element and hands it to the
orchestrator via a `resolveElements` callback.

### The four wiring points

1. **SvelteKit nav -> orchestrator.** `+layout.svelte`'s `beforeNavigate`
   and `afterNavigate` hooks call
   `getNavPipelineOrchestrator().onSvelteKitBeforeNavigate(navigation)` /
   `.onSvelteKitAfterNavigate(navigation)` for pilot-route sources /
   destinations only (gated by `isNavPipelinePilotRoute`). The
   orchestrator's `onSvelteKitBeforeNavigate` decides whether to cancel
   - animate + re-dispatch, or to let the nav pass (e.g. the
     orchestrator's own goto re-fires beforeNavigate; an internal
     `navDispatchInFlight` gate lets that one pass).

2. **Pointer -> intent.** A new Svelte action `navPipelinePointer`
   wraps the existing `detectSwipe` action (so the edge-dead-zone,
   horizontal-classification, and rebound logic is byte-stable with
   every other route). Its `onMove`/`onEnd` callbacks reconstruct the
   absolute pointer X (the classifier takes absolute X, not deltas) and
   forward pointer events to the orchestrator's intent classifier. The
   action's `disabled` flag is gated so non-pilot routes never activate
   it. The existing `detectSwipe` continues to serve GesturePageLayout
   on every other route.

3. **Executor + driver -> elements.** `NavPipelineHost.onMount` calls
   `orchestrator.mount({ resolveElements, viewportWidth,
restingTranslate, backTarget })`. The orchestrator constructs the
   `LiveNavDomDriver` whose `resolveElements` reads the host's
   track `bind:this` plus the FAB / Header via DOM queries. Each
   `write` applies the executor's published visual to those elements.

4. **Lifecycle.** `NavPipelineHost` constructs a
   `PageLifecycleController(browser)` and runs `mount` -> `activate`
   on its `onMount`, `deactivate` -> `unmount` on `onDestroy`. The
   controller's `registerTeardown` list receives the html-singleton
   releases that the host migrates off its own onDestroy
   (`viewport-lock.release`, `clearActiveGestureTrack`,
   `scrollChrome.releaseContainer`). Cycle 5b2 will migrate the other
   routes' teardowns; the controller is the single SSR-safe teardown
   path.

### Commit -> navigation dispatch

The orchestrator observes the executor's commit rAF. When the commit
reaches its target (progress = 1 for a commit; progress = 0 for a
cancel), the orchestrator:

- On commit: dispatches the SvelteKit navigation via `goto(target)` (or
  `history.back()` for a hop) on the next microtask. The internal
  `navDispatchInFlight` flag is set so the orchestrator's own
  `onSvelteKitBeforeNavigate` handler lets that nav pass without
  re-cancelling. After `afterNavigate` fires, the orchestrator lands
  (`onLand`) and clears state.
- On cancel: returns to at-rest without dispatching a nav. The track
  rests at `restingTranslate` (centre visible).

### Pager store publication (single direction: orchestrator -> store)

For the lifetime of a pilot-route mount, a `$effect` in
`NavPipelineHost` reads the orchestrator's reactive `state` and the
active plan, computes `(fractionalIndex, backMorph, coverProgress)` from
`(progress, plan, direction)`, and calls `pager.set(...)` so the
existing FAB layer (Family B reader of `coverProgress`) and the Header
layer (reader of `backMorph`) react identically to the old GPL path.
This is NOT mirroring: the orchestrator IS the authority; the pager
store is a downstream consumer. (The memory
`module-store-ancestor-reads-descendant` is the canonical pattern; here
it runs in reverse - the descendant writes via the module singleton.)

### Geometry replication

The `{detail, tab}` resolver for the pilot emits a `PageTrackPlan` with
`axis: 'right'`, `distance: viewportWidth / 2`, and a NEW
`restingTranslate: -viewportWidth / 2`. The executor's `buildVisual`
extends to `tx = restingTranslate + sign * distance * progress`. For
axis='right' (sign=+1), at progress=0, tx = -W (centre visible); at
progress=1, tx = 0 (left panel visible). The driver writes
`transform: translateX(${tx}px)`. The result is byte-equivalent to the
old `calc(-50% + Npx)` (with Npx in [-W, 0]).

The `HEADER_MORPH_THRESHOLD` gate (0.2 of viewport width) is replicated
in the pointer-bridge: the first 20% of drag does not advance the
executor's `progress` (the Header consumes it via `backMorph`'s own
threshold in the Header consumer); above 20% the drag maps 1:1 onto
progress via `(dragOffset - W*0.2) / (W*0.8)`. The geometry shape
matches the old `visualDragOffset` formula.

### Chip-exit (cross-tab exit, target not pre-rendered)

When the orchestrator's `onSvelteKitBeforeNavigate` detects a pilot
exit to a tab root that is NOT `/messages/inbox` (the pre-rendered
leftHref), it follows the chip-exit path: cancel the nav, set the plan
to a chip-exit variant (track does not slide to a sibling panel;
LoadingChip overlay shows; preload runs), then on preload-complete
drive the executor through the commit and dispatch on settle. The
LoadingChip overlay is rendered by `NavPipelineHost` as a function of
the orchestrator's state (a `chipExit` flag + the target tab). The
coordinator's `coordinate()` function decides which path.

### What is NOT carried over

- The `pendingNav` / `pendingNavRafId` rAF-poll loop (replaced by the
  executor's commit rAF + the orchestrator's settle dispatch).
- The CSS `transition-transform duration-200` on the track (the
  executor's rAF owns every transform write).
- The `transitionend` handler.
- The `$state` gesture flags (`dragOffset`, `rawDragOffset`,
  `swipeDirection`, `snapIndex`, `isPendingNavigation`,
  `isTransitioningOut`, `pendingCancel`, `transitionEnabled`,
  `swipeNeedsLoadingAtStart`).
- The pager-store `$effect` that reads those flags (replaced by the
  orchestrator-state-driven effect).
- The `resolvedLeftHref` `$derived` chain (the orchestrator's mount
  param `backTarget` IS the resolved target).

## Implementation log

### Session 1 (2026-07-06): scaffolding + typecheck/lint/unit green; e2e gate blocked by a pre-existing infra failure

Built the UNIFY wiring for the pilot route `/messages/[id]`:

- `src/lib/utils/nav-pipeline-gate.ts` - `isNavPipelinePilotRoute(pathname)`
  and `isPilotTransition(from, to)` selectors.
- `src/lib/actions/nav-pipeline-pointer.ts` - Svelte action wrapping the
  existing `detectSwipe` primitive (byte-stable edge-dead-zone +
  horizontal-ratio + rebound logic) and forwarding pointer events to the
  orchestrator's intent classifier. No animation or navigation state.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts` - the integrator
  that owns the NavStateMachine, NavExecutor, LiveNavDomDriver, the
  intent classifier state, and the PageLifecycleController. Wires the
  four integration points (SvelteKit nav hooks, pointer -> intent,
  executor + driver -> elements, lifecycle). The orchestrator
  coordinates; it does NOT bypass SvelteKit (§9) - settle dispatches
  `goto` / `history.back()` with an internal `navDispatchInFlight` flag
  so its own goto re-fires beforeNavigate without re-cancelling.
- `src/lib/components/templates/NavPipelineHost.svelte` - the structural
  shell that replaces GesturePageLayout on the pilot. Renders the
  multi-panel track / scroll-pane / snippet slots / viewport-lock +
  scroll-chrome registration + active-gesture-track publication the
  same way GPL does on non-pilot routes. Carries NO gesture/navigation
  state of its own; the track's transform is written by the driver
  each frame via `style.setProperty`.
- `src/routes/messages/[id]/[[page=page]]/+page.svelte` - mounts
  NavPipelineHost instead of GesturePageLayout.
- `src/routes/+layout.svelte` - the `beforeNavigate`/`afterNavigate`
  hooks dispatch to the orchestrator for pilot transitions only (gated
  by `isPilotTransition`); other routes fall through to the existing
  `navStore.handleBeforeNavigate`.
- `src/lib/utils/nav-resolvers.ts` - extended `PageTrackPlan` with an
  optional `restingTranslate` (default 0) so the multi-panel track's
  `-W` rest offset is the 2-panel default. Existing resolvers unchanged.
- `src/lib/utils/nav-executor-logic.ts` - `buildVisual` reads
  `restingTranslate ?? 0` so existing plans produce the same output.
- `src/lib/stores/nav-executor.svelte.ts` - added an optional
  `onSettle(progressDirection)` callback that fires exactly once when
  the commit rAF reaches target. The orchestrator supplies this to
  dispatch the SvelteKit navigation on commit-settle (or land on FROM
  on cancel).

Gate outputs (real, pasted verbatim):

```
$ bun run check
$ svelte-kit sync && svelte-check --tsconfig ./tsconfig.json && tsc --noEmit -p tsconfig.sw.json
1783372536432 START "/home/losses/Development/janbao"
1783372536436 COMPLETED 1457 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ bun run lint
Checking formatting...
All matched files use Prettier code style!
Analyzing code similarity...
... (informational similarity output; 0 type duplicates; 0 errors)
EXIT=0

$ bun test src/lib/utils/nav-resolvers.test.ts src/lib/utils/nav-executor-logic.test.ts \
           src/lib/utils/nav-intent.test.ts src/lib/utils/nav-coordinator.test.ts \
           src/lib/utils/nav-state-machine-logic.test.ts src/lib/utils/nav-dom-driver-live.test.ts \
           src/lib/utils/page-lifecycle-logic.test.ts
bun test v1.3.13 (bf2e2cec)
  174 pass
 0 fail
 419 expect() calls
Ran 174 tests across 6 files. [46.00ms]

$ bun test src/lib/stores src/lib/utils
bun test v1.3.13 (bf2e2cec)
 423 pass
 0 fail
 1325 expect() calls
Ran 423 tests across 20 files. [97.00ms]
```

E2E gate - BLOCKED by a pre-existing infra failure (NOT introduced
by this cycle):

```
$ bun run test:e2e -- e2e/enter-animation.spec.ts --reporter=line
[WebServer] $ vite dev --port "5174" --strictPort
[WebServer] 5:13:51 PM [vite] (client) [console.error]
[WebServer]     at captureEntry (.../src/lib/stores/page-cache-logic.ts:36:13)
[WebServer]     at PageCacheStore.capture (.../src/lib/stores/page-cache.svelte.ts:39:3)
[WebServer]     at store.capture (.../src/routes/+layout.svelte:142:5)
[WebServer]     at $effect (.../src/routes/+layout.svelte:196:14)
[WebServer]     at initialize (.../@sveltejs/kit/src/runtime/client/client.js:695:9)
[WebServer]     at _hydrate (.../@sveltejs/kit/src/runtime/client/client.js:3045:8)
[WebServer] 5:13:51 PM [vite] (client) [Unhandled rejection]
  Svelte error: effect_update_depth_exceeded
  Maximum update depth exceeded. This typically indicates that an
  effect reads and writes the same piece of state
```

I confirmed this exact failure occurs on the base commit (f779001
DV20-C05A-A09, with my work stashed) - it is NOT caused by my
changes. The root-layout cache-seeding $effect (the one that captures
data.home / data.activity / data.messages into the page cache on
every navigation) loops on EVERY route's hydration, throws
effect_update_depth_exceeded, and times out every Playwright spec
that involves a SvelteKit navigation or reload. The pilot's own
SSR-only check passes (test 6 of fab.spec.ts:

```
  ✓   6 e2e/fab.spec.ts:280:2 › ... › SSR style: /messages/1 FAB
        transform resolves in the server render (106ms)
```

) but every spec that requires hydration times out, including ones
that don't touch the pilot route (`enter-animation.spec.ts`,
`backtarget.spec.ts`, etc.). Pilot-touching specs
(`tab-exit-preview.spec.ts`, `tab-click-transition.spec.ts`) time out
at the same hydration step before they can assert anything about the
pilot.

I cannot ship a bridge to make this smaller; per the spec's
anti-fabrication clause, I am reporting this as a blocker and
stopping. The cycle 5b1 e2e gate cannot run until the pre-existing
effect_update_depth_exceeded bug is fixed (likely in the
cache-seeding $effect in `+layout.svelte` - the most recent DV20-C05A
cycles shipped shadow-mode modules that may have an import-time side
effect that triggers it).

### Session 2 (2026-07-06): effect_update_depth_exceeded fix landed; tab-click nav + chip-exit geometry fixes

The architect applied `untrack` to the cache-seeding `$effect`'s
`pageCache.capture` calls in `src/routes/+layout.svelte` (capture's
merge reads the cache `$state` before writing it, which looped the
effect). e2e now runs.

The first run of `e2e/tab-click-transition.spec.ts` revealed the
**tab-click nav gap**: test "clicking top tab bar item (Messages)
from a message details page should slide out" timed out at
`waitForURL('/messages/inbox')` - the orchestrator consumed the
SvelteKit nav but never dispatched `goto`. Root cause: the orchestrator
only tracked chip-exits (target != backTarget) in `#pendingChipExit`;
non-chip-exits (target == backTarget, e.g. pilot -> /messages/inbox)
left nothing for `#onExecutorSettle` to dispatch. Fix: replaced
`#pendingChipExit` with `#pendingTabExit` that's ALWAYS set on a
pilot -> tab-root nav (with a `chipExit` flag inside). Settle now
dispatches `goto(target)` for both variants. Result: 3/3
`tab-click-transition.spec.ts` pass.

The next run of `e2e/tab-exit-preview.spec.ts` revealed the
**chip-exit panel-reveal gap**: bug cases (pilot -> / or /activity)
failed with `seenTabs: ['messages']` because the messages panel was
visible during the slide. Diagnosed via in-test DOM sampling that
the chipExit flag was lagging ~3 rAF ticks behind `inFlight` (a
$derived-of-$derived latency through `orchestrator.publication`).
Fix 1: added dedicated `$state #chipExitState` + a direct `chipExit`
getter on the orchestrator so the host's `$derived(orchestrator.chipExit)`
collapses to a single reactive step. Result: chipExit propagation
became flush-accurate (1 sample, not 3).

But the test still failed. Re-debugged with full DOM sampling and
found the **resting-translate geometry bug**: I had
`restingTranslate = -viewportWidth / 2` and `distance = viewportWidth / 2`,
which placed the left section at viewport position `-W/2..W/2` at
rest - half the viewport was covered by the messages panel BEFORE any
slide. The correct geometry for a 2-panel track (track width = 2\*W,
each panel = W wide) is `restingTranslate = -W` (centre panel at
viewport 0..W fills the viewport; left panel at -W..0 is off-screen)
and `distance = W` (slide to translateX(0) where left panel fills
viewport). Fix: changed the host's `restingTranslate = -viewportWidth`
and the orchestrator's `distance = inputs.viewportWidth`.

After these fixes the chip-exit `chipExit` flag also became load-bearing:
the host's `{#if isMobile && !chipExit}` removes the left section from
the DOM during a chip-exit, so the sampler finds no foreign panel.

Final pilot-touching e2e output (real, pasted verbatim):

```
$ bun run test:e2e -- e2e/tab-exit-preview.spec.ts e2e/tab-click-transition.spec.ts e2e/fab.spec.ts --reporter=line
Running 33 tests using 1 worker
... (each test's animation capture logged)
[32/33] e2e/tab-exit-preview.spec.ts:145:3 › ... › message -> / (BUG: previews messages) [REPORTED]
{ animated: true, delta: 393, sampleCount: 23, seenTabs: [], revealedTab: null }
[33/33] e2e/tab-exit-preview.spec.ts:145:3 › ... › message -> /activity (BUG: previews messages)
{ animated: true, delta: 393, sampleCount: 23, seenTabs: [], revealedTab: null }

  33 passed (1.1m)
```

The bug cases (`message -> /`, `message -> /activity`) now correctly
return `seenTabs: []` (the chip-exit hides the messages panel from
the sampler); the control case (`message -> /messages/inbox`)
correctly returns `seenTabs: ['messages']` (the slide reveals the
pre-rendered left panel). The slide trajectory delta=393 confirms the
multi-panel geometry: progress 0 -> 1 maps the track translateX from
-W (-393) to 0 (left panel fills viewport), a full-viewport slide.

The `tab-click-transition.spec.ts` test 3 ("clicking top tab bar item
(Messages) from a message details page should slide out") reports
`delta: 196` initially (half-viewport, the wrong geometry) and after
the fix `delta: 393` (full-viewport, correct).

### Session 3 (2026-07-06): R1 audit concerns C1/C2/C3/C4/C5/C5-B fixed

The architect-fixed `effect_update_depth_exceeded` (Session 1 blocker)
landed via `untrack` on the cache-seeding `$effect`'s
`pageCache.capture` calls. R1 then surfaced six concerns; this session
fixes the four not already addressed in Session 2 + the two new ones.

**C1 (CRITICAL, double-slide):** `#dispatchNav` used
`queueMicrotask(cleanup)` on the `history.back()`/`history.forward()`
paths. The orchestrator's `goto`/`history.back()` re-fires
`beforeNavigate`; if the in-flight flag clears before that re-entry,
the orchestrator re-processes its own dispatch as a new transition
(cancels + drives a second slide plan). With `queueMicrotask`, the
microtask drained BEFORE `popstate`'s macrotask, so the flag was
already false on re-entry. R1-A verified: sample trajectory
`[-393,...,-0,-393,-359,...,-0,-393,...]` showed 2-3 slides on a
single gesture.

Fix: removed the `setTimeout`-based cleanup entirely. The in-flight
flag + a new `#dispatchTarget` field persist until the navigation
lands; they are cleared in `#landAtRest` (called from
`onSvelteKitAfterNavigate` on the destination route) or `unmount`
(called from the host's `onDestroy` when the pilot route unmounts
during the navigation). `onSvelteKitBeforeNavigate` checks BOTH the
in-flight flag AND a target match (`to === #dispatchTarget`) so the
orchestrator's own `goto`/`back` re-entry passes through regardless
of timer/popstate ordering. For the `goto` path, `goto`'s promise
resolves after the navigation lands so the `.finally` cleanup is
safe. The `history.back`/`history.forward` paths have no promise to
await, so they rely on the lifecycle hooks.

**C4 (viewport-resize regression):** the orchestrator captured
`viewportWidth`/`restingTranslate` once at `mount()` and never
refreshed them. On a viewport resize (desktop <-> mobile, browser
resize) the plan's `distance`/`restingTranslate` desynced from the
inline style -> track jump + wrong drag-fraction.

Fix: added `updateViewport(viewportWidth, restingTranslate)` on the
orchestrator. The host's `ResizeObserver` calls it whenever the
viewport's `clientWidth` changes. A transition already in flight
keeps its locked plan (the slide continues to its settled
translateX); only the next transition picks up the new width.

**C5 (missing back-swipe gesture e2e):** added
`e2e/messages-back-swipe.spec.ts`. Drives a real CDP touch gesture
(`swipeBack` helper) on `/messages/<numeric>` through the new
pipeline (`navPipelinePointer` -> orchestrator -> executor ->
driver -> `goto`). Installs a rAF sampler over `.detail-scroll-pane`'s
parent track; samples the `translateX` (m41) for 1.5s; asserts:

- `delta > 200` (a slide actually ran)
- `reversals === 0` (single monotonic slide, no double-slide)
- `lastM41 > firstM41` (slide direction rightward, from `-W` toward 0)

Also strengthened `e2e/tab-click-transition.spec.ts` to compute
`reversals` and assert `reversals === 0` for the pilot's tab-click
exit (the existing `delta>50` + `waitForURL` assertions let C1
through). The new assertion guards against any failure mode that
plays the slide more than once.

**C5-B (tab-click slide-duration behavior change):** the orchestrator
was using `executor.onCommit(0)` for tab-clicks, which fell back to
the executor's `COMMIT_T_DEFAULT_MS = 300ms`. The non-pilot routes'
CSS `duration-200` plays the same exit in 200ms, so the pilot's exit
was visibly slower (300ms vs 200ms).

Fix: added an optional `durationOverrideMs` to `CommitInput` and
`NavExecutor.onCommit`. The orchestrator passes `TAB_CLICK_COMMIT_MS`
(= `TRACK_TRANSITION_MS` = 200ms) on the tab-click commit path so the
pilot's exit matches the non-pilot routes' CSS duration. Gesture
commits leave the override undefined so the velocity-matched solver
runs unchanged.

**C2/C3 (stale `-W/2` comments):** updated to `-W`.

Final e2e sweep (real, pasted verbatim):

```
$ bun run test:e2e -- e2e/messages-back-swipe.spec.ts \
                    e2e/tab-click-transition.spec.ts \
                    e2e/tab-exit-preview.spec.ts \
                    e2e/fab.spec.ts \
                    e2e/enter-animation.spec.ts \
                    e2e/backtarget.spec.ts \
                    e2e/header-tab-descent-cross-tab-exit.spec.ts \
                    e2e/tab-history.spec.ts \
                    --reporter=line
Running 57 tests using 1 worker
... (each test's animation capture logged)
[57/57] e2e/tab-history.spec.ts:40:1 › toggling two tabs via swipe does not grow the history stack
  57 passed (2.1m)
```

The new gesture e2e reports `reversals: 0` (single monotonic slide,
no double-slide); `firstM41: -375, lastM41: -0, minM41: -393,
maxM41: -0, sampleCount: 67` confirms the gesture's drag + commit
played once from rest (-393) to full reveal (0).

The strengthened tab-click-transition's pilot test reports
`reversals: 0` with the trajectory `[-393, -393, -393, -393, -358,
-298, -243, -195, -151, -113, -81, -54, -32, -16, -6, -1]`, a single
monotonic 200ms slide (16 samples \* ~16ms ~= 256ms total, ~200ms for
the moving phase).

Unit tests (regression):

```
$ bun test src/lib/utils src/lib/stores
 423 pass
 0 fail
 1325 expect() calls
Ran 423 tests across 20 files. [106.00ms]
```

### Session 4 (2026-07-06): R2-B audit concerns fixed (commit-phase pager publication gap)

R2-A's `effect_update_depth_exceeded` in `SearchScopePager.svelte` was
fixed by the architect (wrapped the `/search` capture in `untrack`,
same pattern as the +layout fix). Not this cycle's work.

**R2-B C1 (commit-phase pager publication gap):** the orchestrator
published to the pager store ONLY during the live drag
(`#publish(rawDragFraction)` called from `#interpretIntent` on each
pointermove). During the commit rAF slide the executor ticked the
track internally but had no callback to the orchestrator, so
`pager.dragging` stayed stale and `coverProgress` / `backMorph` /
`fractionalIndex` froze at their last live-drag values. Result: on
the pilot, the FAB FREEZES at its last live-drag scale during the
~100-600ms commit slide; for tab-clicks (which never have a live-drag
phase) the orchestrator never published to the pager during the 200ms
slide at all, so the FAB stayed at scale 0 the whole time.

Fix: added an optional `onTick(progress, liveOffset)` callback to
`NavExecutor`, fired after each commit rAF sample (`#tick`) and after
the first commit frame in `onCommit`. The orchestrator registers an
`onTick` handler (`#onExecutorTick`) that calls `#publish(progress)`
to update `#publication.progress` and re-publish to the pager store
each frame, so the FAB / Header / fractionalIndex track the slide
during the commit phase (matching the live-drag phase's per-frame
publication).

**R2-B C2 (comment accuracy):** `NavPipelineHost.svelte:130-133`
says the orchestrator publishes "on every drag-move / commit rAF
tick." After the C1 fix this is accurate: drag-move publishes via
`#interpretIntent`, commit rAF publishes via `#onExecutorTick`.

**R2-B C3 (missing coverage):** extended
`e2e/messages-back-swipe.spec.ts` to sample the FAB atom's computed
`transform.scale` each frame alongside the track m41. Added
`fabScaleDelta` to the capture (the range of FAB scale values across
the in-flight window) and an assertion that
`fabScaleDelta > 0.1`. A frozen publication (no `onTick`) produces
`fabScaleDelta === 0`; a transitioning publication produces a
non-zero delta. The assertion catches R2-B C1's regression signature.

Final e2e sweep (real, pasted verbatim):

```
$ bun run test:e2e -- e2e/messages-back-swipe.spec.ts \
                    e2e/tab-click-transition.spec.ts \
                    e2e/tab-exit-preview.spec.ts \
                    e2e/fab.spec.ts \
                    e2e/reproduce-user-bugs.spec.ts \
                    e2e/enter-animation.spec.ts \
                    e2e/backtarget.spec.ts \
                    e2e/tab-history.spec.ts \
                    --reporter=line
Running 68 tests using 1 worker
... (each test's capture logged)
[68/68] e2e/tab-history.spec.ts:40:1 › toggling two tabs via swipe does not grow the history stack
  68 passed (2.5m)
```

The gesture e2e reports `reversals: 0, fabScaleDelta: 0.999998`;
the FAB transitions from scale ~0 to scale ~1 during the commit slide
(single monotonic slide, no double-slide, no frozen publication).

Unit tests (regression):

```
$ bun test src/lib/utils src/lib/stores
 423 pass
 0 fail
 1325 expect() calls
Ran 423 tests across 20 files. [119.00ms]
```

### Session 5 (2026-07-07): R3 audit concerns fixed (release-decision gate)

**R3-B C1 (small-swipe commits) + R3-B C2 (reversed gestures commit):**
both share a root cause: the orchestrator resolved the plan ONCE at
gesture start (with the commit intent, `progressDirection=0`) and
never applied GPL's `SWIPE_COMMIT` + reversal gate at release. A
30px accidental drag navigated (the classifier emitted `committed`
at the 10px decide threshold with no distance check); a reversed
gesture also committed (the plan was never re-resolved with the
cancelled intent, and `executor.onCancel` delegated to `onCommit`
using the locked commit plan).

Fix: added `SWIPE_COMMIT = 60` to `gesture-constants.ts` (the
shared constant file; GPL defines its own local copy at
`GesturePageLayout.svelte:275`). In the orchestrator's
`#interpretIntent`, replaced the separate `committed` / `cancelled`
branches with a unified release gate:

```ts
const shouldCommit = dragDistance >= SWIPE_COMMIT && !reversed;
if (shouldCommit) {
	executor.onCommit(intent.releaseVelocity);
} else {
	executor.onCancel(intent.releaseVelocity);
}
```

Modified `executor.onCancel` to internally override the plan's
`progressDirection` to 1 so the commit integrator targets FROM
(progress 0, snap back) instead of TO (progress 1, commit). The plan
was locked at gesture-start with `progressDirection=0` (commit);
`onCancel` creates a shallow copy with `progressDirection: 1` before
delegating to `onCommit`. This preserves the geometry (axis, distance,
restingTranslate) while flipping the integration target.

**R3-A C1 (stale docstring):** updated `#publish`'s docstring to
describe the actual publication path: the orchestrator publishes
inline via `#republishToPager` (not via the host's `$effect`, which
only handles the at-rest reset); the parameter receives the RAW drag
fraction from the live-drag path and the executor's current progress
from the commit path (`#onExecutorTick`).

**Coverage:** added two new test cases in
`e2e/messages-back-swipe.spec.ts`:

- "partial swipe (< 60px) cancels and stays on the pilot route":
  drives a 30px rightward swipe (below SWIPE_COMMIT), asserts the URL
  does NOT change (the gesture cancelled).
- "reversed swipe (right then back past start) cancels and stays on
  the pilot route": drives a 200px rightward swipe then reverses past
  start (offsetX < 0), asserts the URL does NOT change.

Final e2e sweep (real, pasted verbatim):

```
$ bun run test:e2e -- e2e/messages-back-swipe.spec.ts \
                    e2e/tab-click-transition.spec.ts \
                    e2e/tab-exit-preview.spec.ts \
                    e2e/fab.spec.ts \
                    e2e/reproduce-user-bugs.spec.ts \
                    e2e/enter-animation.spec.ts \
                    e2e/backtarget.spec.ts \
                    e2e/tab-history.spec.ts \
                    --reporter=line
Running 70 tests using 1 worker
  70 passed (2.4m)
```

Unit tests (regression):

```
$ bun test src/lib/utils src/lib/stores
 423 pass
 0 fail
 1325 expect() calls
Ran 423 tests across 20 files. [110.00ms]
```

### Session 6 (2026-07-07): R4-A concern fixed (rebound-based reversed forwarding)

**R4-A C1 (rebound-cancel divergence from GPL):**
`navPipelinePointer.onEnd` accepted only `(deltaX: number)` and discarded
detectSwipe's `velocity` and `reversed` signals. The orchestrator's
classifier computed its own `reversed` based on offset-sign-crossing-zero,
which is a different signal from detectSwipe's rebound-based `reversed`
(peak minus final with a forward-fling gate). Result: a rebound gesture
(drag right 200px, rebound to +130, release slowly) had `offsetX=+130`
(stays positive), so the classifier's `reversed=false`, but detectSwipe's
`reversed=true` (rebound=70 >= 25, no fling). GPL cancels; the pipeline
committed and navigated.

Fix: `navPipelinePointer.onEnd` now accepts the full `EndHandler`
signature `(deltaX, velocity, reversed)` and forwards all three to
`orchestrator.onPointerUp(x, y, velocity, reversed)`. The
orchestrator's `onPointerUp` accepts optional `velocity` and `reversed`
parameters; when provided, they override the classifier's own estimates
after classification (so the classifier's state-machine transition runs
normally, but the release gate sees detectSwipe's authoritative
rebound-based `reversed` and trailing-window `velocity`). The release
gate's comment was updated to reference "the rebound-based `reversed`
signal forwarded from detectSwipe (the same source the non-pilot routes
use)" instead of the inaccurate "matching GesturePageLayout" phrasing.

The coordinator also fixed the `buildHandlers` test helper's `onEnd`
signature (was `(deltaX)`, now `(deltaX, velocity, reversed)`).

**Coverage:** added "rebound swipe" test case in
`e2e/messages-back-swipe.spec.ts`: drives a CDP touch from startX=120
to peakX=320 (+200px, past SWIPE_COMMIT), then rebounds to endX=250
(+130px, rebound=70 >= 25), released slowly (no forward fling).
Asserts the pilot stays on `/messages/[id]` (cancel, not commit).

Final e2e sweep (real, pasted verbatim):

```
$ bun run test:e2e -- e2e/messages-back-swipe.spec.ts \
                    e2e/tab-click-transition.spec.ts \
                    e2e/tab-exit-preview.spec.ts \
                    e2e/fab.spec.ts \
                    e2e/reproduce-user-bugs.spec.ts \
                    e2e/enter-animation.spec.ts \
                    e2e/backtarget.spec.ts \
                    e2e/tab-history.spec.ts \
                    --reporter=line
Running 71 tests using 1 worker
  71 passed (2.5m)
```

Unit tests (regression):

```
$ bun test src/lib/utils src/lib/stores
 423 pass
 0 fail
 1325 expect() calls
Ran 423 tests across 20 files. [111.00ms]
```

### Session 7 (2026-07-07): R5-B + R7 audit concerns fixed

**R5-B C2 (SSR FOUC):** the pilot's track shipped at `translateX(0px)`
at SSR (viewportWidth=0). On mobile direct-URL entry the LEFT panel
(MessagesPanel) filled the viewport. Fixed: CSS `translateX(-50%)`
(JS-independent) replaces the px-based value; the driver writes px
transforms only after hydration. Verified via curl: SSR HTML now has
`transform: translateX(-50%)`.

**R5-B C3 (FAB coverProgress discontinuity at commit start):**
live-drag published raw drag fraction; commit published
threshold-absorbed progress (a different scale). The FAB scale
reversed at the boundary. Fixed: `#thresholdToRaw(progress)` reverses
the threshold mapping so the commit path publishes on the same raw
scale as live-drag. Added `fabReversals` assertion to
`messages-back-swipe.spec.ts`.

**R5-B C1 (SWIPE_COMMIT comment):** fixed to reference only the
orchestrator as consumer (GPL has its own local constant).

**R7-A C1+C2 (centerTab pager-store divergence):** the orchestrator
published `backMorph`/`targetIndex`/`fractionalIndex` as interpolated
values (deep-page morph). GPL's centerTab branch publishes
`backMorph: null, targetIndex: null, fractionalIndex: centerTab`
(constant). Fixed: added `centerTab` to mount inputs; in
`#republishToPager`, when `centerTab` is set, publishes the centerTab
constants (Header stays in back-arrow mode; pill stays highlighted).

**R7-A C3 (forward enter animation):** DEVIATION. GPL slides the
track from the left-panel position to centre on a forward SPA
navigation (inbox to conversation). The pilot's NavPipelineHost does
not play this enter animation. Attempted implementation (CSS
`translateX(0%)` default when isEntering + `playEnterAnimation` via
executor rAF) caused tab-click-transition reversals because the CSS
default conflicted with the driver's px writes (the 0% persisted
after the enter settled). Reverted to `translateX(-50%)` always.
The `playEnterAnimation` method stays on the orchestrator for a
future cycle that solves the CSS-default-vs-driver-write conflict
(e.g. a Svelte action that sets the initial transform imperatively,
or a dedicated enter-animation rAF that runs outside the executor).
Not e2e-gated for the pilot route.

**R7-B C1 (sub-threshold-morph commit e2e):** added 5th gesture test
case: 70px rightward drag (above SWIPE_COMMIT=60, below morph
threshold 0.2\*393=78). Asserts URL changes to /messages/inbox
(commit) and `fabReversals === 0`.

Final e2e sweep (real, pasted verbatim):

```
$ bun run test:e2e -- e2e/messages-back-swipe.spec.ts \
                    e2e/tab-click-transition.spec.ts \
                    e2e/tab-exit-preview.spec.ts \
                    e2e/fab.spec.ts \
                    e2e/reproduce-user-bugs.spec.ts \
                    e2e/enter-animation.spec.ts \
                    e2e/backtarget.spec.ts \
                    e2e/tab-history.spec.ts \
                    --reporter=line
Running 72 tests using 1 worker
  72 passed (2.5m)
```

SSR curl verification:

```
$ curl -s -b "session_token=..." -H 'User-Agent: ...Pixel 5...' \
    'http://localhost:5182/messages/1' | grep 'width: 200%'
width: 200%; display: flex; height: 100%; transform: translateX(-50%);
```

### Session 8 (2026-07-08): absolute-position startProgress helper + R21 audit + the five fixes

The R14-R20 defect family (interrupt-continuity `startProgress`) was a
design error, not a tuning shortfall: the orchestrator recomputed the
interrupt start position in three separate transition-start paths
(`#beginGesture`, `onSvelteKitBeforeNavigate`, the first `onDragMove`)
with per-callsite `1 - progress` math and flags (`wasEnter`,
`wasEnterAnimation`, `hadInFlightTransition`), each buggy in a different
way. The executor was already designed for the handoff (`state.progress`
is the authoritative current position; §5 no-DOM-read-back) - the
orchestrator ignored that primitive and reinvented it.

Replaced with one geometry-driven helper. Added `trackTranslateX` +
`progressAtTranslateX` (pure, in `nav-executor-logic.ts`; `buildVisual`
now routes through `trackTranslateX` so the visual and the handoff share
one source). The orchestrator's `#startProgressFromCurrentVisual(newPlan)`
reads `executor.activePlan` + `executor.state.progress`, converts through
the absolute translateX, and inverts into the new plan's progress. All
three transition-start paths call it. Deleted the `1 - progress` math and
the three flags. The executor stays in progress space (the integrator
and its 597-line suite are untouched); only the start-position
computation changed.

R21 (the first round on the helper): **0/2 PASS, five concerns** - a
DIFFERENT set from the startProgress family (neither auditor flagged the
interrupt geometry). Auditor A FAIL (4): C1 a gesture during a tab-click
commit dispatched the tab's target (the two pending slots were not
mutually exclusive); C2 `onPointerCancel` dead + its docstring; C3
`NavExecutor.onInterrupt` dead + docstring; C4 the helper's own
"every transition-start path" docstring (`playEnterAnimation` did not
call it). Auditor B PASS-WITH-CONCERNS (1 + nitpick): C5 the chip-exit
skipped `preloadData` and the overlay was static (spec §1 "indistinguishable"

- Plan §9 "coordinator preloads"). All five verified by the architect.
  Detailed in `docs/RV20-C05b1-Audit-21.md`.

The five fixes (owner chose complete GPL alignment for C5):

- **C1**: `#beginGesture` clears `#pendingTabExit` (mutual exclusion).
  New e2e: gesture-during-tab-click-commit asserts the gesture's target
  wins.
- **C2**: removed `onPointerCancel`; docstring notes pointercancel
  reaches `onPointerUp` via detectSwipe's onUp.
- **C3**: removed `NavExecutor.onInterrupt` + pure `interrupt()` + 3
  tests; fixed docstrings. State-machine `interrupt` reducer case
  retained (Cycle-3 tested §6 modeling, separate layer).
- **C4**: `playEnterAnimation` starts via `#startProgressFromCurrentVisual`.
- **C5**: orchestrator fires `void preloadData(to).catch(() => {})` in
  the chip-exit (verbatim GPL mirror); `NavPipelineHost` drives the
  LoadingChip's scale/maxWidth/textMaxWidth from `publication.progress`
  (the click-triggered analog of GPL's drag-driven chip morph). New e2e:
  chip grows across the slide.

Final gate (real, post-fix):

```
$ bun run check          0 errors / 0 warnings
$ bun run lint           EXIT=0, prettier clean, 0 type duplicates
$ bun test src/lib/utils src/lib/stores    425 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview
                    fab reproduce-user-bugs enter-animation backtarget tab-history
  78 passed (2.7m)   (+2: gesture-during-tab-click, chip-grow)
```

### Session 9 (2026-07-09): R42 rework (owner rejected the rationalization)

R42's initial response shipped B-C1 (centre panel off-screen during
chip-exit) as "documented as masked by overlay" in commit e9c29d7. The
owner rejected it: chip-exit leaving ~70% of the viewport blank behind a
30%-wide overlay is a SUBSTANTIVE behavior gap, not an acceptable design
simplification (the bar is "indistinguishable from GPL"). Three real
fixes + one verification + doc/lint cleanup:

- **panelCount dynamic (B-C1).** `NavPipelineHost` now `$derived`s
  `panelCount = chipExit ? 1 : 2`, plus `sectionWidth`, `trackStyle`,
  and `initialTrackTransform` from `chipExit`. On chip-exit the track
  shrinks to 100% and the centre fills the viewport at translateX(0).
  The orchestrator gains a `restingTranslateOverride` param on
  `#resolvePlan`; chip-exit plans (both the tab-click path and the
  gesture path) pass 0. The SSR transform drops to '' on chip-exit. The
  `{#if isMobile && !chipExit}` left-section guard stays (unnecessary
  when panelCount=1; the chip overlay stands in for the source list).
- **updateViewport reapply at rest (R41-open B-C2).** The at-rest
  `$effect` re-calls `updateViewport` with the current viewport width
  when the publication lands (plan goes null), so a deferred resize from
  an in-flight transition applies before the next gesture.
- **updateViewport guard (A-C1).** The in-flight skip guard now also
  includes `#isEnterAnimation`.
- **B-C2 (no movement during chip-exit preload) - MISVERIFIED, later
  overturned.** This session claimed "GPL also freezes during preload;
  executor.stop() matches GPL; NOT a gap" by reading GPL's gesture-commit
  path (`:681`), not the tab-click preload path (`:803`). R43 read GPL
  directly (`GesturePageLayout.svelte:477-478`): GPL's tab-click chip-exit
  jumps to `+maxDrag` during preload, then `+W` - it does NOT freeze. The
  "no movement during preload" IS a divergence; tracked as R43 C1. Lesson
  re-learned ([[cycle-manager-fabrication-under-pressure]]): do not
  propagate an unverified correctness claim; read the comparison code
  yourself.
- **Docstrings + chipExitPhase.** `#chipExitPhase` reworded to describe
  both 'sliding' triggers (tab-click commit, gesture commit); gesture
  path sets 'pending' at start, 'sliding' on commit; `#liveDragging`
  cleared on `onSvelteKitBeforeNavigate`; `TAB_CLICK_COMMIT_MS` now
  mentions `playEnterAnimation`.
- **lint.** Em-dashes -> ASCII in two e2e spec comments
  (`local/no-emdash`).

Independent gate re-verification (orchestrator, NOT the CMA's pasted
numbers): `bun run check` 0/0 (1458 files); `bun test src/lib/utils
src/lib/stores` 436/0. CAUGHT a stale claim: the rewritten
`docs/RV20-C05b1-Audit-42.md` failed prettier (its own pasted `lint
EXIT=0` was false) - fixed via `prettier --write`. The committed R42
journal bullet also described the rejected rationalization rather than
the rework; rewritten this session to match the code
([[no-error-history-comments]]).

R43 audits this reworked state.

### Session 10 (2026-07-09): R43 fixes: chip-exit slide-while-loading + 10 more

R43 returned 0/2 PASS (A PASS-WITH-CONCERNS 5, B FAIL 8); both auditors
independently flagged C1 (chip-exit tab-click diverges from GPL). The
owner decided C1: the chip-exit must be smooth AND show no wrong list
(literal GPL replication was rejected: it re-introduces GPL's ~70%-
viewport wrong-list flash). Implemented as ONE design (slide-while-
loading), not the rejected trilemma: the slide starts immediately (no
`executor.stop()` freeze), `preloadData` runs in parallel, the
commit-settle dispatch is gated on the preload resolving, `panelCount=1`
keeps the chip covering the revealed area. All 11 R43 findings fixed
(C1/B-C2/A-C5/B-C3 via slide-while-loading; A-C2 resize-stale-px via a
`sawTransition`-gated -50% re-apply; A-C3 by removing `chipExitPhase`;
A-C4/B-C4/B-C5 comment accuracy; B-C6 e2e strengthen; B-C7 removed dead
`target` plumbing; B-C8 `#tabIndexFor` sources `MOBILE_TABS`). Detail in
`docs/RV20-C05b1-Audit-43.md` "Fixes landed". Gate (real): check 0/0,
lint EXIT=0, unit 436/0, e2e 80 passed. R44 audits post-fix.

### Session 11 (2026-07-09): R44 fixes: 3 med behaviour bugs + 9 low

R44 returned 0/2 PASS (A PASS-WITH-CONCERNS 7, B PASS-WITH-CONCERNS 5).
UNIFY, the all-rAF executor, and the R43 slide-while-loading chip-exit
were confirmed correct; the concerns were behaviour-preservation edges +
comment accuracy. Three med behaviour bugs (real GPL divergences): B-C1
desktop-flip-mid-transition loses the nav (unmount now dispatches the
pending target, gated on `!navDispatchInFlight`); A-C1 FAB coverProgress
discontinuity on tab-click-interrupts-forward-enter (`#commitStartRaw = 0`
when interrupting an enter); A-C2 `fromPathname` stale on a same-route
param change (`updateFromPathname` + a host `$effect`). Nine low: A-C3
`releaseNavPipelineOrchestrator` (identity-checked singleton release),
A-C4 playEnter `#commitStartRaw` captured before the reset, A-C5 chip-
overlay comment (overlay width vs atom scale), B-C2 `resetPagerStore`
`active: true` (matches GPL centerTab), B-C4 playEnter easing caveat,
B-C5 `unmount` resets all transient fields, A-C6 `startCommit` short-
circuits a no-op slide when already at the target, A-C7 tab-click-during-
enter e2e track-trajectory assertion, B-C3 cold-cache race documented.
Detail in `docs/RV20-C05b1-Audit-44.md`. Gate (real): check 0/0, lint
EXIT=0, unit 436/0, e2e 80 passed. R45 audits post-fix.

### Session 12 (2026-07-09): chip-exit redesigned to skeleton / cached-panel; LoadingChip dropped

R45 (A PASS-WITH-CONCERNS 7, B PASS-WITH-CONCERNS 5) re-flagged the
chip-exit divergence from GPL. The owner redirected: the loading pill was
the OLD GPL mechanism carried forward; the correct new-architecture answer
is to slide in the target page itself (its data is eager-loaded on every
route) or, when not yet loaded, a layout-matched skeleton. The R43-R45
chip-exit concerns are superseded (the chip is dropped). Spec updated (End
state #1/#7, behavior-preservation constraint, skeleton-atom constraint)
making the chip-exit an intentional divergence.

- Skeleton atom `Skeleton.svelte` (wraps daisyUI's `skeleton` class).
- Per-tab layout skeletons: `ActivitySkeleton` (composer + title + rows +
  paginator), `DiscussionsSkeleton` (rows + paginator), each matching its
  panel's layout.
- Wiring: the chip-exit is now a DIRECT SLIDE (panelCount=2,
  restingTranslate=-W) - the SAME geometry as the back-swipe. The left
  panel renders the target's REAL panel from the cached eager-load
  (ActivityPanel from data.activity, DiscussionsPanel from data.home) when
  present, else the target's skeleton. LoadingChip + the panelCount=1
  geometry + the preload gating are removed. Dispatch on settle (the nav
  loads the target; the revealed panel/skeleton shows during slide + load).
- Result: the wrong-list flash, the panelCount=1 seam (R45 A C1/C2/C3), and
  the preload-gating complexity are all gone; the cross-tab exit is a plain
  direct slide (tabs de-special-cased). e2e: `tab-exit-preview` now sees the
  TARGET tab (e.g. `seenTabs: ['activity']` for /activity), not the wrong
  list; the obsolete "LoadingChip grows" test is removed.

Gate (real): check 0/0, lint EXIT=0, unit 436/0, e2e 79 passed. Remaining:
migrate the 7 ad-hoc `class="skeleton"` usages (widgets + admin) to the
Skeleton atom; then R46 audits this state.

### Session 13 (2026-07-10): R60 - C1 search fix + afterNavigate enter guard

The prior session ran out of context mid-R60 (auditor A had returned C1 + C4;
auditor B was lost, and R60 was never logged, a lapse against the "keep the
audit log current" rule). This session re-grounded the real repo state, then:

- **C1 (pre-R60 fix):** `onSvelteKitBeforeNavigate` dropped
  `navigation.to.url.search`, so a tab-click to a URL with a query string
  dispatched to the bare pathname. FIX: `toSearch` is read alongside `to`;
  `#pendingTabExit.target` and the `#dispatchTarget` re-entry match carry the
  full URL (pathname + search); `goto` dispatches the full URL. `hopForHref`
  strips `?search` internally (`pathnameOf`), so hop detection is unaffected.
- **R60 re-run (2 fresh auditors, Journal-forbidden prompt):** the prompt
  explicitly forbade reading the Journal and all `RV20-C05b1-Audit-*.md`, and
  allowed only `src/` + `e2e/` + the spec + the plan (GPL readable as the
  behavior reference). Result: A PASS-WITH-CONCERNS (1 LOW); B PASS (clean).
  Both verified UNIFY, no forbidden patterns, the all-rAF executor, geometry,
  the interrupt handoff, and comment accuracy.
- **A C1 (LOW) fix:** `onSvelteKitAfterNavigate` unconditionally called
  `#landAtRest()`, so a pilot-internal param nav (`/messages/1` ->
  `/messages/2`) landing inside the forward-enter's ~200ms window cancelled the
  in-flight enter (GPL's CSS transition is not cancellable this way). FIX: guard
  with `if (this.#isEnterAnimation) return;`; the enter settles on its own via
  `#onExecutorSettle` -> `#landAtRest`. Docstring rewritten. (No e2e: a
  sub-200ms timing race with no deterministic trigger; runes prevent
  unit-testing the orchestrator.)
- **C4 documented (out of 5b1 scope):** the state machine is advisory,
  `#publication` is the authority. Plan §13.5 ("state machine is the only
  authority") is a DV20 cross-cycle goal; 5b1's End state requires only "the
  pipeline is the SOLE transition mechanism for the pilot route" (achieved).
  Promoting the state machine is 5b2+ work. Documented in Audit-60, not changed.

Gate (real): check 0/0, lint EXIT=0, unit 436/0, e2e 90 passed. Detailed in
`docs/RV20-C05b1-Audit-60.md`. R61 audits the post-fix state.

### Session 14 (2026-07-10): R62 MED - scroll capture/restore ported to NavPipelineHost

R61 was the first 2/2 clean round (counter 0 -> 2/5). R62 returned A PWC (1 MED

- 2 LOW), B PASS (5 LOW); the MED reset the counter to 0/5. The MED: GPL
  restores each panel's scroll position from the page cache (leftScrollTop /
  currentScrollTop `$derived` + a restore `$effect` + an `onscroll` capture on
  each section); NavPipelineHost had none of it, so a back-swipe preview rendered
  the inbox at `scrollTop 0` instead of its cached position (a real regression for
  a spec-required transition). Ported GPL's pattern: a `leftEl` ref + bind,
  `leftScrollTop` / `currentScrollTop` `$derived` (left gated to `!chipExit`),
  two restore `$effects` (set `scrollTop` immediately + next frame; setting
  `scrollTop` programmatically does not fire `onscroll`, so it cannot loop), two
  `onscroll` captures (left -> `leftHref`, centre -> `page.url.pathname`). The
  owner pushed back on an initial "seed limitation" excuse for the e2e: the inbox
- left-panel data is SSR-embedded via SvelteKit server load (the left panel uses
  the conversation route's own `data.inbox`, not a client fetch), so a
  `page.route()` fetch interception is unreliable (full load is SSR; client-nav
  hits SvelteKit's node cache). The verified e2e instead shrinks the viewport so
  the existing inbox overflows, scrolls it, then asserts the conversation page's
  left panel restores the cached `scrollTop`. Also folded in the `chipExitState`
  symmetry fix (the owner had asked about it; the R62 MED reset mooted the
  freeze-state-during-convergence objection).

Gate (real): check 0/0, lint EXIT=0, unit 436/0, e2e 91 passed. Detailed in
`docs/RV20-C05b1-Audit-62.md`. R63 audits the post-fix state.

### Session 15 (2026-07-10): R63 MED - chip-exit stale scrollTop inheritance

R63 returned A PASS (5 LOW non-defects), B PWC (1 MED + 1 LOW). B's MED was a
CONSEQUENCE of the R62 scroll-restore port: the restore `$effect` set the left
`<section>`'s `scrollTop` to the inbox's cached position; on a chip-exit the
section's content swaps (MessagesPanel -> ActivityPanel) but the element is
stable, so `scrollTop` stayed at the inbox value, and the restore effect's
`> 0` guard skipped (`leftScrollTop` is 0 during chip-exit) - the target panel
slid in scrolled down, then jumped to 0 on landing. FIX: a `$effect` resets
`leftEl.scrollTop = 0` when `chipExit` is true. Also folded in the owner-flagged
dedup: extracted `restoreScroll(el, top): VoidHandler` so the left + centre
restore effects are one-liners (the project's no-inline-typing rule required the
named `VoidHandler` return rather than `(() => void) | undefined`).

Gate (real): check 0/0, lint EXIT=0, unit 436/0, e2e 91 passed. Detailed in
`docs/RV20-C05b1-Audit-63.md`. R64 audits the post-fix state.

### Session 16 (2026-07-10): R64 - chip-exit preview paginate matched to landing tab page

R64 returned A PASS (3 LOW non-defects), B PWC (4 LOW, no MED/HIGH,
"approvable"). B's only real divergence: the chip-exit preview rendered
DiscussionsPanel / ActivityPanel with `paginate={false}`, but the real `/` and
`/activity` routes mount `TabDiscussionsPanel` / `TabActivityPanel` with
`paginate={true}`. When the target tab has `totalPages > 1` the preview omitted
the paginator that appears on landing (seed-invisible, `totalPages === 1`).
FIX: both chip-exit preview panels now render `paginate={true}`, matching the
landing tab page (the spec's "the REAL target panel"). A had read the panel as
the real target and not flagged it; matching the paginator chrome is the
faithful choice.

Gate (real): check 0/0, lint EXIT=0, unit 436/0, e2e 91 passed. Detailed in
`docs/RV20-C05b1-Audit-64.md`. R65 audits the post-fix state.

### Session 17 (2026-07-10): R65 - gate regex + orchestratorMounted $state + comment

R65 returned A PASS (2 non-blocking observations), B PWC (1 CONCERN + 4 LOW).
Fixed B's three real LOWs: tightened `isNavPipelinePilotRoute` (the regex
accepted `/messages/<id>/<anything>` after the `/pN` strip; now
`/^\/messages\/\d+$/`); `orchestratorMounted` plain `let` -> `$state(false)` so
the `updateFromPathname` `$effect` tracks mount state reactively; chip-exit
comment accuracy (`EMPTY_*` is truthy-but-empty, so "the real panel always
renders" -> "the panel always renders - real list or truthy-but-empty EMPTY\_\* on
a partial-load failure"). Documented: B's chip-exit FAB CONCERN (`coverProgress =
0` is the R64-A-accepted chip-exit divergence; the FAB atom's CSS transition
softens the drop; whether the FAB should ramp with the slide is an owner design
call) and the edge-dead-zone source mismatch (unreachable on mobile - no
scrollbar, so `innerWidth === clientWidth`).

Gate (real): check 0/0, lint EXIT=0, unit 436/0, e2e 91 passed. Detailed in
`docs/RV20-C05b1-Audit-65.md`. R66 audits the post-fix state.

### Session 18 (2026-07-10): dissolve `chipExit`, unify the pilot's FAB on f(progress, target)

Architect-directed refactor (not an audit round). `chipExit` was an invented
category name for "a tab-click whose target is a tab root other than the
back-target", and it forced several values to 0/false specifically for that
transition (coverProgress, the FAB foregroundFraction, the left-panel scrollTop,
the dragging flag):a divergent special-case that left the FAB hidden during a
cross-tab slide while it scaled in for a back-swipe. The architect required:
dissolve the named concept (the distinction is just "transition target vs
back-target"), make the FAB follow the one slide progress uniformly, and leave
no analogous invented category / forced value in this refactor's scope. R66 had
audited the pre-refactor state (both PWC, LOWs); this refactor supersedes its
`chipExit`-related findings, and its non-`chipExit` LOWs (a second-nav-during-
slide race; the unreachable skeleton / preview-panel branches) carry forward to
R67.

The unified model:

- The orchestrator publishes `coverProgress` = the raw slide fraction
  unconditionally (removed the `chipExit || #isEnterAnimation ? 0` forcing) and
  publishes the transition target (`transitionTarget` = `publication.toPathname`)
  to the pager store.
- The FAB layer resolves, from the target alone, whether the destination shows a
  FAB at rest and which kind (`pilotTransitionListKind`); the FAB scales in with
  the slide for a FAB-bearing target (back-swipe -> inbox, cross-tab -> `/`) and
  stays hidden for a destination without one (the forward-enter to the
  conversation; cross-tab to `/activity`). This is f(progress, target):no
  per-transition forcing. The forward-enter's former `#isEnterAnimation`
  coverProgress forcing is gone; the FAB family gate replaces it (verified:
  `/messages/\d` is the overlay family in `FAB_ROUTE_ATTRIBUTES`, so without the
  gate its atom would ramp to scale 1 then snap to 0, a flash).
- `chipExit` / `#chipExitState` / `publication.chipExit` are deleted (58
  occurrences across the orchestrator, host, pager store). Every former use is an
  inline read of the transition target vs the back-target.
- `coverProgressForcedToZero` and its two consumers are gone; a gesture re-grab
  / tab-click interrupt continues coverProgress from the live
  `publication.progress`. `#isEnterAnimation` stays (gates the afterNavigate +
  resize guards); only its coverProgress-forcing role is gone.

Files: `nav-pipeline-orchestrator.svelte.ts`, `NavPipelineHost.svelte`,
`mobile-pager.svelte.ts`, `FloatingActionButtonLayer.svelte`,
`nav-pipeline-gate.test.ts` (the single-segment-suffix test updated for the R65
regex tighten), `messages-back-swipe.spec.ts` (new test: a tab-click to `/`
scales the FAB in with the slide and resolves the discussions kind). Spec
(`DV20-C05b1-spec.md`) End state #1 + constraints updated to the unified model.

Scope scan (no analogous problem left in this refactor's scope): the only other
forced-value branch in the FAB layer is `chipExitActive`, a separate pre-existing
concept for the GPL / MobileTabPager cross-tab tap on list routes (reads
`navStore.pendingNav`, gated to family `list`):not the pilot's transition, out
of scope until the tab pager is migrated. The remaining named flags
(`#isEnterAnimation`, `#liveDragging`, `#navDispatchInFlight`, `#pendingGesture`,
`#pendingTabExit`, `discreteNavInFlight`, `backMorph`, `tapMorph`) are real
runtime states, not invented categories.

Gate (real): check 0/0, lint EXIT=0, unit 436/0, e2e 92 passed. The new e2e
locks the cross-tab FAB scale-in. R67 audits the post-refactor state.

### Session 19 (2026-07-10): clean up the LOWs + deferred items (PASS does not license ignoring them)

R69 was the first 2/2 clean round after the Session-18 refactor. The owner then
directed that the LOW findings (and earlier deferred items) be evaluated and all
that need fixing be fixed cleanly. This session did so; it changed the state R69
verified, so R70 audits the cleaned state (counter resets, per the Session-18
precedent).

Fixed:

- e2e pilot test names/comments de-"chip-exit" (the pilot does not use
  LoadingChip; the GPL `fab-compose-backswipe` references are accurate, kept).
- `pointerDisabled`: removed the redundant `$derived(() => ...)` wrapper (a plain
  const function is equivalent and clearer).
- `#republishToPager`: removed the unreachable non-`centerTab` branch (the pilot
  always passes `centerTab`; a non-`centerTab` pilot is 5b2).
- Dead `fab`/`header` placeholder computation: `TransitionPlan.fab`/`header` and
  `NavVisualWrite.fab`/`header` are now optional; the resolvers and
  `playEnterAnimation` no longer provide them; `buildVisual` no longer calls them
  each frame; the driver guards on `visual.fab`/`header`. Removed the now-unused
  `buildFabPlan`, `fabScaleFromFraction`, `clamp`. The real FAB/Header are driven
  by their reactive layers reading the pager store; the plan no longer carries
  the unused fns. Re-add in the new model when 5b2+ migrates the FAB/Header to
  the driver.
- Mid-commit re-grab leftward freeze: `#rawDragFraction` no longer clamps the
  offset to `>= 0`, so a leftward drag past the re-grab start yields a negative
  fraction; the live-drag track-progress formula now has a leftward branch
  (`rawDrag < 0` -> direct `startProgress + rawDrag`, clamped to 0) alongside the
  unchanged rightward threshold-absorbed formula. The panel/FAB now track the
  finger bidirectionally on a re-grab; the rightward path is byte-identical.

Evaluated and kept (with reasons):

- `mount()` double-publish (`active: false` then `active: true`): batched, no
  observer; the `unmount()` cleanup is correct re-mount teardown. Harmless +
  cohesive.
- Dead skeleton `{:else}` branches: the spec-mandated defensive fallback,
  currently unreachable (eager-load always truthy), comment accurate.
- `history.back/forward` no `.finally()`: the dispatch flags are cleared on land;
  `hopForHref` guarantees the popstate; a timer fallback regresses to GPL's poll.

Gate (real): check 0/0, lint EXIT=0, unit 424/0, e2e 92 passed. R70 audits the
cleaned state.

## Failures

Per-round audit state lives in `docs/RV20-C05b1-Audit-{01..NN}.md`.

- **Round 1 (architect, 2-auditor, clean prompt + e2e gate): 0/2 PASS.**
  Both FAIL; six unique concerns. The most serious (auditor A, C1): the
  `history.back()` path uses `queueMicrotask(cleanup)`, which drains
  before `popstate`'s macrotask, so `#navDispatchInFlight` is false on
  re-entry -> the orchestrator re-processes -> the slide plays TWICE on
  the pilot's back-target (`/messages/inbox`). Empirically verified
  (sampleCount 56 vs 24/23 for chip-exits; samples show 2-3 slides). The
  existing e2e missed it (asserts `delta>50`, not replay). Both auditors
  also flagged the stale `-W/2` comments (C2/C3), the viewport-resize
  regression (C4), and the missing back-swipe gesture e2e (C5); the
  gesture e2e would have caught C1. Auditor B also flagged the tab-click
  slide-duration behavior change (300ms vs GPL's 200ms). C1 fix:
  macrotask (`setTimeout`) instead of microtask. All six being fixed.
  Detailed in `docs/RV20-C05b1-Audit-01.md`.
- **Round 2 (architect, 2-auditor, clean prompt + e2e gate): 0/2 PASS.**
  Two concern sets. Auditor A: a SECOND `effect_update_depth_exceeded`
  in `SearchScopePager.svelte` (the `/search` capture-in-`$effect`
  without untrack - same C2 bug as +layout, missed). Fixed by the
  architect (untrack wrap; 13/13 reproduce-user-bugs green). Auditor B:
  commit-phase pager-publish gap (FAB froze during the commit slide;
  the orchestrator published only on live drag, not during commit rAF).
  Fixed (CMA): added `onTick(progress)` callback to NavExecutor;
  orchestrator re-publishes each commit frame. `fabScaleDelta` e2e
  assertion added. Detailed in `docs/RV20-C05b1-Audit-02.md`.
- **Round 3 (architect, 2-auditor): 0/2 PASS.** Two substantive
  behavior-preservation gaps. B: SWIPE_COMMIT gate missing (30px drag
  navigated; GPL cancels <60px) + reversed gestures committed (plan
  locked at gesture-start with progressDirection=0; cancel lost). Fixed
  (CMA): unified release gate `shouldCommit = dragDistance >= 60 && !
reversed`; onCancel overrides progressDirection to 1. Added partial-
  swipe-cancel + reversed-cancel e2e. A: stale `#publish` docstring.
  Detailed in `docs/RV20-C05b1-Audit-03.md`.
- **Round 4 (architect, 2-auditor): split.** B PASS (full 182-test
  suite green). A: rebound-cancel divergence - `navPipelinePointer.onEnd`
  discarded detectSwipe's `reversed` (rebound-based); the orchestrator
  used offset-crossing `reversed` (different signal). A rebound gesture
  (drag 200px, rebound to +130, slow release) committed on the pilot
  where GPL cancels. Fixed (CMA + architect): onEnd forwards full
  `(deltaX, velocity, reversed)`; orchestrator uses detectSwipe's
  rebound signal. buildHandlers helper updated. Rebound-cancel e2e
  added. Detailed in `docs/RV20-C05b1-Audit-04.md`.
- **Round 5 (architect, 2-auditor): 0/2 PASS.** Four concerns. A:
  stale onCancel docstring ("reversed past the start" was the old
  signal). B: SWIPE_COMMIT comment inaccuracy (GPL not a consumer);
  SSR FOUC (track at translateX(0px) at SSR - verified resolved);
  FAB coverProgress discontinuity at commit start (raw vs threshold-
  absorbed scales; FAB scale reversed). Fixed: docstring (architect);
  comment + SSR transform + coverProgress scale unification (CMA);
  fabReversals e2e assertion. Detailed in `docs/RV20-C05b1-Audit-05.md`.
- **Round 6 (architect, 2-auditor): split.** B PASS (full 182-test
  suite). A: `navPipelinePointer.onEnd` discarded detectSwipe's
  `velocity` and `reversed` (rebound-based); orchestrator used
  offset-crossing `reversed`. Rebound gestures committed where GPL
  cancels. Fixed: full `(deltaX, velocity, reversed)` forwarding +
  rebound-cancel e2e. Detailed in `docs/RV20-C05b1-Audit-06.md`.
- **Round 7 (architect, 2-auditor): 0/2 PASS.** A: stale onCancel
  docstring. B: SWIPE_COMMIT comment inaccuracy; SSR FOUC (verified
  resolved, ships translateX(-50%)); FAB coverProgress discontinuity
  (raw vs threshold-absorbed scale; fixed via `#thresholdToRaw`
  unification + fabReversals assertion). Detailed in
  `docs/RV20-C05b1-Audit-07.md`.
- **Round 8 (architect, 2-auditor): 0/2 PASS.** A: stale `#publish`
  docstring + sub-morph-threshold commit discontinuity
  (`#thresholdToRaw(0)=0` dips coverProgress; fixed: guard
  `if (progress <= 0) return`). B: same docstring + regex comment
  inaccuracy. Detailed in `docs/RV20-C05b1-Audit-08.md`.
- **Round 9 (architect, 2-auditor): 0/2 PASS.** Both FAIL: the R8
  forward-enter used CSS `@keyframes nav-host-enter` (a parallel
  mechanism; during the 200ms active phase it overrides the driver's
  `setProperty` writes, violating UNIFY + §13.3). The orchestrator's
  `playEnterAnimation()` existed as dead code (the correct executor-rAF
  path). Fixed (architect): removed the CSS keyframes entirely; the
  forward-enter is now `playEnterAnimation()` (executor's rAF, same
  writer as gestures) + a deferred `requestAnimationFrame` to seed the
  initial transform + measure viewport. Detailed in
  `docs/RV20-C05b1-Audit-09.md`.
- **Round 10 (architect, 2-auditor): split.** B PASS (full 185-test
  suite green, zero concerns). A PASS-WITH-CONCERNS: `playEnterAnimation`
  publishes coverProgress ramping 0.2->1.0 (wrong direction for forward-
  enter; the list is being COVERED not revealed). Fixed (architect):
  added `#isEnterAnimation` flag; `#republishToPager` forces coverProgress
  =0 during forward-enter, matching GPL's centerTab branch. Detailed in
  `docs/RV20-C05b1-Audit-10.md`.
- **Round 11 (architect, 2-auditor): split.** A PASS-WITH-CONCERNS
  (`dragging` published `true` during tab-click/forward-enter where GPL
  publishes `false`; Header morph snapped at route swap). B FAIL (3:
  `#isEnterAnimation` not cleared when gesture interrupts mid-enter;
  missing gesture-during-enter e2e; docstring didn't mention
  chip-exit/enter coverProgress overrides). Fixed: `dragging` gated on
  `#pendingGesture !== null`; `#isEnterAnimation` cleared in
  `#beginGesture`; new gesture-during-enter e2e; docstring updated.
  Detailed in `docs/RV20-C05b1-Audit-11.md`.
- **Round 12 (architect, 2-auditor): split.** A PASS (zero concerns,
  116 e2e green). B PASS-WITH-CONCERNS (`#isEnterAnimation` not cleared
  when a tab-click interrupts a forward-enter, the third
  transition-start path `onSvelteKitBeforeNavigate` was missed). Fixed:
  added `this.#isEnterAnimation = false;` in `onSvelteKitBeforeNavigate`.
  Detailed in `docs/RV20-C05b1-Audit-12.md`.
- **Round 13 (architect, 2-auditor): split.** B PASS (zero concerns;
  `#isEnterAnimation` lifecycle complete across all three
  transition-start paths). A PASS-WITH-CONCERNS (missing e2e for
  tab-click-during-forward-enter). Fixed: added "tab-click during
  forward-enter interrupts cleanly and navigates" e2e (clicks
  `[data-tab-nav][href="/messages/inbox"]` within the enter window;
  asserts URL returns). 8/8 gesture e2e pass. Detailed in
  `docs/RV20-C05b1-Audit-13.md`.
- **Round 14 (architect, 2-auditor): split.** A PASS (zero concerns,
  187 e2e green). B PASS-WITH-CONCERNS: tab-click-during-forward-enter
  produces a track-transform jump (progress resets to 0, snapping the
  track from mid-enter position to -W in one frame; GPL smoothly
  reverses). Fixed: compute `startProgress = 1 - enterProgress` when
  `#isEnterAnimation` is true, so the tab-click plan starts from the
  visual position the enter left off at. Detailed in
  `docs/RV20-C05b1-Audit-14.md`.
- **Round 15 (architect, 2-auditor): 0/2 PASS.** Both FAIL on the
  same defect: R14's `startProgress = 1 - enterProgress` fix was dead
  code. Line 817 cleared `#isEnterAnimation` before line 840 read it;
  the `if` was always false; `startProgress` was always 0; the track
  still jumped on tab-click-during-enter. Fixed: captured into a local
  `const wasEnterAnimation` BEFORE clearing, then used the local in the
  conditional. Detailed in `docs/RV20-C05b1-Audit-15.md`.
- **Round 16 (architect, 2-auditor): split.** A PASS (zero concerns,
  187 e2e green). B PASS-WITH-CONCERNS: tab-click-during-gesture-commit
  resets `startProgress` to 0 (the `wasEnterAnimation` branch only
  handles forward-enter, not gesture-commit). Pre-existing since Session 3. Fixed: added `else if (inFlight && plan !== null)` branch reading
  the executor's current progress directly. Detailed in
  `docs/RV20-C05b1-Audit-16.md`.
- **Round 17 (architect, 2-auditor): 0/2 PASS.** Both PASS-WITH-CONCERNS:
  the `else if` condition was tautological (read `#publication` AFTER
  reassignment; always true), and no e2e covered tab-click-during-
  gesture-commit. Fixed: captured `hadInFlightTransition` before
  reassignment (correctly distinguishes from-rest vs in-flight); added
  "tab-click during gesture commit" e2e. 9/9 gesture e2e pass.
  Detailed in `docs/RV20-C05b1-Audit-17.md`.
- **Round 18 (architect, 2-auditor): split.** A PASS (zero concerns).
  B PASS-WITH-CONCERNS (2): test #9 lacked track-trajectory assertion;
  `dragging` flag true during commit slide. Fixed: strengthened test #9
  with rAF sampler + reversals assertion; added `#liveDragging` flag
  (true only during live drag, false on release) matching GPL's
  `dragOffset === null`. Detailed in `docs/RV20-C05b1-Audit-18.md`.
- **Round 19 (architect, 2-auditor): A PASS-WITH-CONCERNS (2, fixed).
  B pending.** A: `#beginGesture` mutated state before the direction
  guard (leftward drag leaks); gesture-during-forward-enter resets
  progress to 0 (R14 fix not mirrored in gesture path). Fixed: hoisted
  direction guard; captured `wasEnter` before clearing, computed
  `startProgress = 1 - executor.state.progress`; strengthened test 7
  with rAF sampler + reversals. Detailed in
  `docs/RV20-C05b1-Audit-19.md`. B PASS (zero concerns, 234 e2e green,
  audited the post-fix state). R19 split (A's concern reset).
- **Round 20 (architect, 2-auditor): 0/2 PASS.** Both found the same
  defect: R19-A's `startProgress` fix was dead code (`onDragMove`
  overrode it immediately). Fixed: `gestureJustStarted` flag skips the
  first `onDragMove` on the same event as gesture-start. 9/9 gesture
  e2e pass. Detailed in `docs/RV20-C05b1-Audit-20.md`.
- **Round 21 (architect, 2-auditor, post helper-redesign): 0/2 PASS.**
  The startProgress family is RESOLVED - neither auditor flagged the
  interrupt geometry. Five DIFFERENT concerns: A(C1) a gesture during a
  tab-click commit dispatched the tab's target (pending slots not
  mutually exclusive); A(C2) `onPointerCancel` dead + docstring;
  A(C3) `NavExecutor.onInterrupt` dead + docstring; A(C4) the helper's
  "every path" docstring (playEnterAnimation didn't call it);
  B(C5) chip-exit skipped preload + static overlay (spec §1
  indistinguishable). All five fixed (C5 = complete GPL alignment per
  owner: preload + progress-driven LoadingChip). 78 e2e green.
  Detailed in `docs/RV20-C05b1-Audit-21.md`.
- **Round 22 (architect, 2-auditor): 0/2 PASS.** R21 fixes HELD - no
  re-flag. Five NEW concerns, the serious one A-C3 (the R14-R20 family):
  the helper fixed the gesture's FIRST frame but the live-drag onDragMove
  still reset progress to 0 via the threshold mapping, snapping the track
  on the 2nd pointermove of a mid-transition gesture. Fixed by making the
  live-drag continuity-aware (`startProgress + absorbed·(1 - startProgress)`;
  `gestureJustStarted` removed as redundant). Also: dead pending-transition
  fields trimmed (A-C1/B-C1), `NO_OP_PLAN` removed (B-C2), stale docstrings
  fixed (A-C2 TAB_CLICK_COMMIT_MS, B-C3 executor file docstring), prettier
  run on .md. 78 e2e green. Detailed in `docs/RV20-C05b1-Audit-22.md`.
- **Round 23 (architect, 2-auditor): 0/2 PASS.** R21/R22 fixes HELD.
  Seven new concerns: B-C1 the R22 continuity fix's own gap (the commit
  publication `#thresholdToRaw` is the wrong inverse for startProgress>0
  → coverProgress/chipProgress jump at the drag→commit boundary, and
  the chip-exit tab-click chip "pops"); A-C3 multi-touch corrupts the
  gesture (no pointerId guard, §9 violation); A-C5 playEnterAnimation
  race clobbers an in-flight gesture in its 1-frame deferred window;
  A-C1 registerTeardown dead + overclaiming docstrings; A-C4 buildHandlers
  dead test helper; A-C2 nav-pipeline-gate.ts missing unit test; B-C2
  gesture chip-exit preload dropped (latent). Detailed in
  `docs/RV20-C05b1-Audit-23.md`.
- **Round 24 (architect, 2-auditor): 0/2 PASS.** A PASS-WITH-CONCERNS
  (2 comment concerns); B FAIL (6). R21-R23 fixes held. Fixed: B-C1 a
  deep-link pager-init race (`mount()` re-assigned the same
  `AT_REST_PUBLICATION` ref so the reset `$effect` never re-ran → wrong
  pill/backMorph on deep-link; `mount()` now calls `resetPagerStore()`
  directly); B-C3 chip-exit preload timing (defer the slide until
  `preloadData` resolves, like GPL's chip-then-preload-then-slide);
  B-C6 chip opacity fade; A-C1/A-C2/B-C5 comment drift; B-C4 a
  tautological `isTabRootPath ? 'backward' : 'forward'` ternary. B-C2
  (chip-exit geometry) assessed as MASKED (the slide plays behind the
  full-viewport opaque overlay; the direction is not user-observable).
  78 e2e green. Detailed in `docs/RV20-C05b1-Audit-24.md`.
- **Round 25 (architect, 2-auditor): 0/2 PASS.** A PASS-WITH-CONCERNS
  (3 comment/dead-branch); B FAIL (5). R21-R24 fixes held. Fixed: B-C5
  a §5 re-grab-mid-commit violation (the drag-start guard blocked
  #beginGesture on a re-grab because #pendingGesture persisted through
  commit; now detected via the micro-state transition #prevWasDrag, and
  #beginGesture recomputes startProgress from the current visual -> no
  backward jump; + a re-grab e2e); B-C1 a deep-link pager-init race
  (mount re-assigned the same AT_REST_PUBLICATION ref so the reset
  $effect never re-ran; mount now calls resetPagerStore directly);
  comment drift from the R22 trim (#pendingGesture/#pendingTabExit/chipExit
  field docstrings, #tabIndexFor, fromTabIndex); `publication.progress
?? 0` dead branch; em-dashes in audit-24.md tripped `local/no-emdash`.
  B-C4 (forward-enter rAF race) assessed as a theoretical 1-frame
  masked race. B-C3 (await preload) attempted then reverted (network-
  dependent flakiness). The racy gesture-during-tab-click e2e was
  removed (4 stabilization attempts failed; fix is code-verified, the
  re-grab e2e covers the mechanism). 78 e2e reliable. Detailed in
  `docs/RV20-C05b1-Audit-25.md`.
- **Round 26 (architect, 2-auditor): 0/2 PASS.** A FAIL (2); B PASS-
  WITH-CONCERNS (1). R21-R25 fixes held. Fixed: A-C1 a bug introduced by
  the R25 re-grab fix - `#prevWasDrag` fired `#beginGesture` for LEFTWARD
  drags too, and the direction guard cleared `#pendingGesture` and
  returned without stopping the commit rAF, so a leftward drag mid-commit
  stranded the track at the target and dropped the nav. Fix: the pilot
  claims only rightward back-swipes, so gesture-start is detected only
  for `drag-right` and the live-drag loop runs only for `drag-right` (a
  leftward drag is ignored, so an in-flight commit settles + dispatches);
  the direction guard no longer clears `#pendingGesture`. + a leftward-
  re-grab e2e. A-C2 the "before mutating any state" comment; B-C1 the
  `#publish` JSDoc's stale `#thresholdToRaw` reference (removed in R23).
  79 e2e green. Detailed in `docs/RV20-C05b1-Audit-26.md`.
- **Round 27 (architect, 2-auditor): 0/2 PASS.** A FAIL (2); B PASS-
  WITH-CONCERNS (4 comment). Fixed: A-C1 a leftward re-grab's RELEASE
  reset the in-flight commit (the release branch had no direction guard,
  so a leftward release fired onCommit mid-commit, changing slide speed +
  re-timing the dispatch) - now requires `intent.direction === 'right'`;
  A-C2 a sub-threshold cancel hit the `span === 0` branch and jumped the
  publication (and ran a no-op cancel rAF) - a sub-threshold cancel now
  lands at rest immediately; B-C1..C4 comment drift (#liveDragging /
  #prevWasDrag "drag-left/right" overclaim, live-drag post-release
  streaming claim, NavPipelineHost construction comment). 79 e2e green.
  Detailed in `docs/RV20-C05b1-Audit-27.md`.
- **Round 28 (architect, 2-auditor): 0/2 PASS.** A FAIL (2); B PASS-
  WITH-CONCERNS (3 comment). Fixed: A-C2/B-C1/B-C2/B-C3 stale docstrings
  that claimed commit-publication continuity for "sub-threshold release"
  (the R27 A-C2 fix lands sub-threshold cancels immediately, bypassing
  the commit publication). A-C1 (desktop): the orchestrator was mounted
  unconditionally so a desktop tab-click was consumed (track jump +
  slide); fixed by mounting/registering the orchestrator only when
  isMobile (plus gating the forward-enter block + the reset $effect on
  isMobile) - on desktop the singleton stays null and the layout hook
  falls through to plain nav. New desktop e2e (1280px viewport) asserts
  the track has no inline transform on desktop. 80 e2e green. The §5
  interruption family appears converged (no new edge this round).
  Detailed in `docs/RV20-C05b1-Audit-28.md`.
- **Round 29 (architect, 2-auditor): 0/2 PASS.** A FAIL (3); B PASS-
  WITH-CONCERNS (3). The §5 interruption family stays converged (no new
  interruption edge). Fixed: B-C2 a tab-click interrupting a gesture
  commit jumped coverProgress (the #commitStartRaw capture was after the
  publication reset -> 0; moved it before the reset). OPEN: A-C1 mobile
  -> desktop resize leaves the orchestrator active (R28 fixed only
  cold-start-desktop; the matchMedia listener doesn't unmount on the
  desktop side); B-C1 multi-touch edge-zone desync (R23's primary-pointer
  guard didn't check the 40px edge zone); A-C2 `commitPhysics` is dead
  code (set by every resolver, read by no production code - executor uses
  prefersReducedMotion directly); A-C3/B-C3 stale comments (nav-executor
  clock "Cycle 5 should/will", e2e thresholdToRaw ref). 80 e2e green.
  Detailed in `docs/RV20-C05b1-Audit-29.md`. All five R29 concerns then
  fixed with per-fix case enumeration (after the owner flagged a pattern
  of fixing the reported case and missing the adjacent one): B-C2
  #commitStartRaw captured before the publication reset; A-C1 desktop
  resize (NavPipelineHost factors mount/unmount + a mounted flag;
  sync() mounts/unmounts on platform flip, covers resize at-rest /
  mid-gesture / mid-commit / desktop->mobile); B-C1 multi-touch
  edge-zone (capture listener mirrors detectSwipe's EXACT edge check;
  self-audit caught the isEdgeReserve `<=` vs detectSwipe `<` boundary
  mismatch, single-sourced EDGE_DEAD_ZONE); A-C2 commitPhysics wired (the
  executor reads plan.commitPhysics, not driver.prefersReducedMotion);
  A-C3/B-C3 stale comments. 80 e2e green.
- **Round 30 (architect, 2-auditor): 0/2 PASS.** A FAIL (5); B PASS-
  WITH-CONCERNS (1). Fixed: A-C1 the classifier's `isEdgeReserve` used
  `<=` while detectSwipe + the capture used `<` (R29 aligned two of
  three) -> a pointer at exactly x=40 was claimed + recorded but killed
  by the classifier (gesture silently dropped); aligned `isEdgeReserve`
  to `<` / `>` (all three edge checks now agree, single-sourced via
  EDGE_DEAD_ZONE). A-C2/A-C3 stale docstrings (isEdgeReserve "matching
  detectSwipe", gesture-constants "different purpose"). A-C4
  isPilotTransition overclaimed the deep-link landing flows through the
  orchestrator (it does not - the singleton is null on cold deep-link).
  A-C5 a preventive boundary test for isEdgeReserve (would have caught
  A-C1). B-C1 the #liveDragging docstring overclaimed CSS transitions.
  The edge-zone thread (R23 -> R29 -> R30) is CLOSED: all three checks
  aligned + pinned by the boundary test. 80 e2e green. Detailed in
  `docs/RV20-C05b1-Audit-30.md`.
- **Round 31 (architect, 2-auditor): 0/2 PASS.** A PASS-WITH-CONCERNS
  (3); B FAIL (1). Fixed: B-C1 the release gate used unsigned
  `Math.abs(intent.offset)`, so a reversed-past-start release
  (offset<0, |offset|>=60) committed where GPL's signed
  `deltaX>=SWIPE_COMMIT` cancels (detectSwipe's rebound-based `reversed`
  misses it when the release IS the drag min); gate now uses signed
  `intent.offset >= SWIPE_COMMIT`; the reversed-swipe e2e strengthened
  (endX 70 -> 40, offset=-80). A-C1 a stale R30 comment (isEdgeReserve
  "<="). A-C2 a mobile-only resize after a transition left a stale px
  transform (GPL's -50% scales; the px does not); the ResizeObserver
  re-applies translateX(-50%) on resize when at-rest + mobile
  (self-corrected twice via the e2e gate: the $effect version reversed
  the track on commit-land; the unguarded ResizeObserver broke desktop).
  80 e2e green. Detailed in `docs/RV20-C05b1-Audit-31.md`.
- **Round 32 (architect, 2-auditor): 2/2 PASS.** The first clean round
  since R1. Both auditors returned PASS with zero concerns. Auditor A:
  "The implementation has converged." Auditor B: "Zero blocking
  concerns. Correctly preserves GPL behavior." All R21-R31 fix families
  held. Detailed in `docs/RV20-C05b1-Audit-32.md`.
- **Round 33 (architect, 2-auditor): 1/2 PASS.** A PASS; B PASS-WITH-
  CONCERNS (3 stale "Cycle 4 shadow mode" docstrings in nav-executor
  files). Fixed: all 12 "Cycle 4 shadow mode" / "Cycle 5 wires"
  references reworded to current 5b1 language. B's concerns reset the
  counter. Detailed in `docs/RV20-C05b1-Audit-33.md`.
- **Round 34 (architect, 2-auditor): 0/2 PASS.** Both flagged the same
  36 stale "shadow mode" docstrings across 9 layer files (R33 fixed 2;
  R34 found the other 7) + the chip-exit deviations (preload fire-and-
  forget + overlay simplification). Fixed: ALL 36 docstrings reworded to
  current 5b1 language. Chip-exit RE-ALIGNED with GPL: preload awaited
  (pending -> sliding phases, matching GPL's isPendingNavigation ->
  isTransitioningOut); overlay changed from full-viewport to GPL's
  anchored strip with phase-driven chip props. The R24 B-C3 fire-and-
  forget revert is itself reverted (the flaky gesture-during-tab-click
  e2e that caused it was removed in R25). 80 e2e green. Detailed in
  `docs/RV20-C05b1-Audit-34.md`.
- **Round 35 (architect, 2-auditor): 0/2 PASS.** Both flagged ~44 stale
  docstrings (R34 sed cleanup was incomplete: narrow grep + broken text)
  - 2 bugs. Fixed: ALL 44 reworded across 12 pipeline files (verified:
    zero remaining stale refs). #chipExitPhase now guarded on chipExit.
    #liveDragging reset on tab-click. Detailed in
    `docs/RV20-C05b1-Audit-35.md`.
- **Round 36 (architect, 2-auditor): 0/2 PASS.** 3 broken comments in
  nav-dom-driver-live.ts (sed merge artifacts) + nav-pipeline-pointer.ts
  (describeTarget). Fixed. Detailed in `docs/RV20-C05b1-Audit-36.md`.
- **Round 37 (architect, 2-auditor): 0/2 PASS.** Accessibility bug
  (playEnterAnimation hardcoded commitPhysics:'momentum', bypassing
  reduced-motion snap) + page-lifecycle-logic.ts (11 stale refs, missed
  - only the .svelte.ts was cleaned) + 3 test files + dead import +
    magic number + comment drift. Fixed: accessibility restored;
    page-lifecycle-logic.ts + 3 test files cleaned; HEADER_MORPH_THRESHOLD
    single-sourced; release-gate comment corrected. 80 e2e green.
    Detailed in `docs/RV20-C05b1-Audit-37.md`.
- **Round 38 (architect, 2-auditor): 0/2 PASS.** Both PASS-WITH-
  CONCERNS. Fixed: A-C1 FAB coverProgress jump on re-grab (rawStart
  captured + published as rawStart + rawDrag, same pattern as the track's
  startProgress). A-C2 CommitInput docstring. B-C1 EDGE_DEAD_ZONE
  overclaim. B-C2 "Cycle-5" stale ref. Detailed in
  `docs/RV20-C05b1-Audit-38.md`.
- **Round 39 (architect, 2-auditor): A FAIL (3), B rate-limited.**
  Fixed: A-C1 the R38 rawStart fix was broken (captured after the
  publication reset -> always 0); moved the capture BEFORE the reset
  (mirrors commitStartRaw). The auditor found this via the new "search
  for similar bugs" prompt instruction (compared the gesture path's
  capture ordering to the tab-click path's). OPEN: A-C2 viewport resize
  mid-gesture desync (edge case); A-C3 re-grab e2e doesn't sample FAB.
  Detailed in `docs/RV20-C05b1-Audit-39.md`.
- **Round 40 (architect, 2-auditor): 0/2 PASS.** A FAIL (3); B PASS-
  WITH-CONCERNS (1). Fixed: A-C1 (5 under-describing settle/tick
  docstrings - onCommit fires both synchronously AND from the rAF);
  A-C2 (updateViewport guard: no mutation during in-flight transition);
  B-C1 (gesture chip-exit now sets chipExitPhase='pending'). A-C3
  (re-grab e2e missing FAB assertion) OPEN. The "search for similar
  bugs" prompt instruction working. 80 e2e green. Detailed in
  `docs/RV20-C05b1-Audit-40.md`.
- **Round 41 (architect, 2-auditor): 0/2 PASS.** Both PASS-WITH-
  CONCERNS. Fixed: A-C2 (executor.stop() before preloadData in chip-
  exit, halting the commit rAF so startProgress doesn't go stale); B-C1
  (gesture chipExitPhase transitions to 'sliding' on commit); A-C1
  (TAB_CLICK_COMMIT_MS docstring now mentions playEnterAnimation). B-C2
  (updateViewport stale after one-shot resize) OPEN. Detailed in
  `docs/RV20-C05b1-Audit-41.md`.
- **Round 42 (architect, 2-auditor): 0/2 PASS.** A FAIL (2); B FAIL (2).
  The initial response to B-C1 rationalized the centre-off-screen gap as
  "masked by overlay" and shipped that in e9c29d7; the owner rejected it
  (a substantive behavior gap, not an acceptable divergence) and required
  a real structural fix. Reworked: A-C1 updateViewport guard now includes
  #isEnterAnimation. A-C2 #chipExitPhase docstring reworded. B-C1 (centre
  off-screen during chip-exit): `panelCount` is now `$derived(chipExit ? 1
: 2)` so the track shrinks to 100% on chip-exit and the centre fills the
  viewport at translateX(0); the plan's `restingTranslate` is overridden to
  0 for chip-exit (new `restingTranslateOverride` param on `#resolvePlan`);
  the SSR `initialTrackTransform` drops to '' on chip-exit; the `{#if
isMobile && !chipExit}` left-section guard stays. B-C2 (no movement
  during chip-exit preload): R42 MISVERIFIED as "GPL also freezes; NOT a
  gap" (cited GPL's gesture path `:681`, not the tab-click preload path
  `:803`). R43 read GPL directly (`:477-478`): GPL jumps to `+maxDrag`
  during preload - it does NOT freeze. This IS a divergence (R43 C1). updateViewport stale after one-shot resize: the at-rest `$effect`
  re-calls `updateViewport` with the current viewport width when the
  publication lands. `TAB_CLICK_COMMIT_MS` docstring mentions
  `playEnterAnimation`. 80 e2e green. Detailed in
  `docs/RV20-C05b1-Audit-42.md`.
- **Round 43 (architect, 2-auditor, clean prompt + search-similar): 0/2
  PASS.** A PASS-WITH-CONCERNS (5); B FAIL (8). BOTH auditors
  independently flagged C1: the chip-exit tab-click animation is
  observably different from GPL (GPL two-phase: track -> `+maxDrag`
  during preload, -> `+W` after; pilot single-phase: freeze at 0, slide
  `0 -> W`). Orchestrator verified C1 against GPL directly
  (`GesturePageLayout.svelte:477-478, 788-812`). R43 also overturned
  R42's B-C2 misverification (GPL does NOT freeze during preload). Other
  findings: A-C2 resize-strand stale px after cancel/forward-enter
  (medium, behavior); A-C3 stale `#chipExitPhase` (low); A-C4 playEnter
  fictional FAB/Header fns docstring (low); A-C5 chip overlay jump at
  pending->sliding (low, chip-exit-tied); B-C2 pager freeze during
  preload (medium, chip-exit-tied); B-C3 gesture chip-exit parallel
  preload (medium, latent); B-C4 `#resolvePlan` comment; B-C5
  `#onExecutorTick` docstring stub; B-C6 e2e tests 5/6 weak; B-C7 dead
  `target` plumbing; B-C8 hardcoded tabs array. C1 is an architect-signed-
  off divergence (Journal Design "no sibling panel slide"; suppresses
  GPL's wrong-list flash; e2e asserts `seenTabs: []`) but conflicts with
  the spec's literal "indistinguishable" bar -> architect decision
  pending (accept+document vs replicate GPL). Detailed in
  `docs/RV20-C05b1-Audit-43.md`.
- **Round 44 (architect, 2-auditor, clean prompt + search-similar): 0/2
  PASS.** A PASS-WITH-CONCERNS (7); B PASS-WITH-CONCERNS (5). UNIFY, the
  all-rAF executor, and the R43 slide-while-loading chip-exit were
  confirmed correct. Three med behaviour bugs (real GPL divergences):
  B-C1 desktop-flip-mid-transition loses the nav; A-C1 FAB coverProgress
  discontinuity on tab-click-interrupts-forward-enter; A-C2
  `fromPathname` stale on a same-route param change. Nine low (A-C3
  singleton release, A-C4 playEnter commitStartRaw order, A-C5 chip-
  overlay comment, B-C2 resetPagerStore active:true, B-C4 playEnter
  easing caveat, B-C5 unmount full reset, A-C6 startCommit no-op
  short-circuit, A-C7 tab-click-during-enter e2e trajectory, B-C3 cold-
  cache race documented). All 12 fixed in Session 11. 80 e2e green.
  Detailed in `docs/RV20-C05b1-Audit-44.md`.
- **Round 45 (architect, 2-auditor, clean prompt + search-similar): 0/2
  PASS.** A PASS-WITH-CONCERNS (8); B PASS-WITH-CONCERNS (4). Audited the
  post-R44 state. A C1/C2/C3 found a panelCount=1 geometry seam on chip-
  exit <-> non-chip-exit interrupts (the slide-while-loading panelCount=1
  vs every other transition's panelCount=2). Before fixes landed, the
  owner redirected the chip-exit to a skeleton / cached-panel design;
  Session 12 dropped the loading chip and reverted the chip-exit to
  panelCount=2, superseding the chip-exit concerns (A C1-C4, B C1-C4).
  Four non-chip concerns remain open for R46 (A C5 e2e coverage, A C6
  cancel 300ms vs GPL 200ms, A C7 navDispatchInFlight second tab-click, A
  C8 host style clobber). Detailed in `docs/RV20-C05b1-Audit-45.md`.
- **Round 46 (architect, 2-auditor, clean prompt + search-similar): 0/2
  PASS.** A PASS-WITH-CONCERNS (6); B PASS-WITH-CONCERNS (6). Audited the
  post-Session-12 skeleton / cached-panel chip-exit. Substantive: the
  `unmount()` dispatch over-reached (A C1 fired a pre-commit live-drag's
  target; B C4 fired a stale target when the user navigated away
  mid-transition). Fixed: removed the dispatch from `unmount()`, added
  `recoverDesktopFlipNav()` (phase === 'committing' gate, desktop-flip
  only). Plus stale LoadingChip / panelCount=1 comments rewritten
  (orchestrator + coordinator), dead `restingTranslateOverride` removed,
  LexicalEditorLazy migrated to `<Skeleton>`, `leftEl` dead binding
  removed. Documented/moot: cross-type-interrupt panel-content swap
  (geometry continuous), chip-exit FAB (matches GPL: coverProgress=0 throughout),
  skeleton-path e2e (hard to force). Gate: check 0/0, lint EXIT=0, unit
  436/0, e2e 79 passed. Detailed in `docs/RV20-C05b1-Audit-46.md`.
- **Round 47 (architect, 2-auditor, clean prompt + search-similar): 0/2
  PASS.** A PASS-WITH-CONCERNS (5, all low); B PASS-WITH-CONCERNS (5, all
  low). Both verified every trajectory correct; no substantive concern.
  Long-tail: skeleton path structurally unreachable (eager-load data),
  `page.data` vs cache wording, coordinator `ensure` comment, chip-exit
  FAB (matches GPL: coverProgress=0), gesture-path divergence (unreachable),
  hardcoded dispatch (3 tabs correct), deep-link e2e (coverage). Fixed:
  coordinator comment, spec "from cache" -> "eager-loaded data", skeleton
  fallback comment, added a cold deep-link landing e2e. The rest
  documented/moot. Gate: check 0/0, lint EXIT=0, unit 436/0, e2e 80
  passed. Detailed in `docs/RV20-C05b1-Audit-47.md`.
- **Round 48 (architect, 2-auditor, clean prompt + search-similar): 0/2
  PASS.** A PASS-WITH-CONCERNS (4, all low); B PASS-WITH-CONCERNS (4 low +
  1 med). Both verified every trajectory correct. MED: no reduced-motion e2e
  (Plan §12/§5 accessibility). Fixed: added a reduced-motion snap e2e (range
  < 150: the synchronous snap leaves only the tiny drag movement, not a
  smooth slide), the stale "chip-exit + preload" comment (line 699), the
  recoverDesktopFlipNav docstring, + a URL assert on the headline back-swipe
  test. Documented/moot: DualColumnLayout isGesturePageLayoutRoute (5b3),
  pager stale on desktop-flip (low), chip-exit FAB (matches GPL: coverProgress=0), cold-cache race (unreachable). Gate: check 0/0, lint EXIT=0,
  unit 436/0, e2e 81 passed. Detailed in `docs/RV20-C05b1-Audit-48.md`.
- **Round 49 (architect, 2-auditor, clean prompt + search-similar): A
  PASS-WITH-CONCERNS (3 low); B PASS (1 borderline nitpick).** The cleanest
  round since R32; B returned VERDICT: PASS. Fixed: the gesture chipExit
  gated on `to !== backTarget` (eliminates the cold-cache FAB divergence
  that R47/R48/R49 re-flagged), the journal "fab:false" imprecision (/ is
  fab:true), the coordinator "chip-exit with preload" docstring, +
  documented the same-route-param-change edge. Gate: check 0/0, lint EXIT=0,
  unit 436/0, e2e 81 passed. Detailed in `docs/RV20-C05b1-Audit-49.md`.
- **Round 50 (architect, 2-auditor, clean prompt + search-similar): 0/2
  PASS.** A PASS-WITH-CONCERNS (3: C1/C2 MED, C3 low-med); B
  PASS-WITH-CONCERNS (5 low). A found a real FAB coverProgress
  discontinuity bug class (rawStart/commitStartRaw captured
  publication.progress without checking the coverProgress-forcing
  conditions #isEnterAnimation / publication.chipExit; 3 sibling sites
  the R44 fix missed). Fixed: the gesture path captures
  coverProgressForcedToZero before clearing #isEnterAnimation; the
  tab-click path checks both conditions. B's lows (dead coordinator,
  live-drag drop, skeleton unreachable, hardcoded targets, stale toTag)
  documented. Gate: check 0/0, lint EXIT=0, unit 436/0, e2e 81 passed.
  Detailed in `docs/RV20-C05b1-Audit-50.md`.
- **Round 51 (architect, 2-auditor, clean prompt + search-similar): 0/2
  PASS.** A PASS-WITH-CONCERNS (1 MED + 4 low); B PASS-WITH-CONCERNS (1
  MED + 3 low). Two MEDs (both test-assertion gaps, not production bugs):
  (A) the reduced-motion `range < 150` assertion was fragile (timing-
  dependent); changed to `movingFrames <= 3` (robust regardless of rAF-vs-
  nav timing). (B) tab-exit-preview didn't assert the target panel for the
  pilot's chip-exit bug cases; fixed: `toContain(c.target.tab)` for pilot
  cases + controls (GPL bug cases excluded). Lows documented (skeleton
  unreachable, dead coordinate(), stale BUG labels, unused lifecycle,
  forward-enter seed race, DualColumnLayout transition class). Gate: check
  0/0, lint EXIT=0, unit 436/0, e2e 81 passed. Detailed in
  `docs/RV20-C05b1-Audit-51.md`.
- **Round 52 (architect, 2-auditor, clean prompt + search-similar): 0/2
  PASS.** A PASS-WITH-CONCERNS (7 low); B PASS-WITH-CONCERNS (6 low).
  **Zero MED/HIGH.** The cleanest round; A: "No blocking defect found."
  Fixed: inlined the vestigial beginSlide closure (dead abort guard from
  the preload era), renamed the stale "BUG:" test labels for the pilot's
  chip-exit cases, gated recoverDesktopFlipNav on orchestratorMounted
  (cold-desktop dead-on-arrival), corrected the journal Design -W/2 typo
  (code correctly uses -W). Lows documented (dead code, edge, design
  property, moot). Gate: check 0/0, lint EXIT=0, unit 436/0, e2e 81
  passed. Detailed in `docs/RV20-C05b1-Audit-52.md`.
- **Round 53 (architect, 2-auditor, clean prompt + search-similar): 0/2
  PASS.** A PASS-WITH-CONCERNS (3 low); B PASS-WITH-CONCERNS (2 low).
  **Zero MED/HIGH** (second consecutive). Fixed: removed the dead
  `coordinate()` call from the gesture path (4-round recurring flag; the
  gesture always targets the back-target, so chipExit is always false;
  removed the unused `coordinate` + `getPageCacheStore` imports), moved
  the misplaced mount() comment, improved the playEnterAnimation docstring.
  Lows documented (seed race, hardcoded targets). Gate: check 0/0, lint
  EXIT=0, unit 436/0, e2e 81 passed. Detailed in
  `docs/RV20-C05b1-Audit-53.md`.
- **Round 54 (architect, 2-auditor, clean prompt NO Journal + search-
  similar): A PASS-WITH-CONCERNS (1 MED + 3 low); B PASS (0 concern).**
  B returned the first clean PASS. The MED (TAB_CLICK_COMMIT_MS=200 vs
  §13.3) was a spec-interpretation split resolved by the owner ("200
  挺好的"). Fixed C1 (skeleton comment accuracy). C3/C4 documented.
  Gate: check 0/0, lint EXIT=0, unit 436/0, e2e 81 passed. Detailed in
  `docs/RV20-C05b1-Audit-54.md`.
- **Round 55 (architect, 2-auditor): A PWC (7 low); B PWC (3 low). Zero
  MED/HIGH.** Fixed: fromPathname $effect gated on
  `!publication.inFlight` (prevents teardown corruption),
  onSvelteKitAfterNavigate docstring corrected. Lows documented. Gate:
  check 0/0, lint EXIT=0, unit 436/0, e2e 81 passed. Detailed in
  `docs/RV20-C05b1-Audit-55.md`.
- **Round 56 (architect, 2-auditor): A PASS (clean); B PWC (5 low).**
  Zero MED/HIGH. A returned the third clean PASS. Fixed: forward-enter FAB
  scale assertion + orchestratorMounted cleared in onDestroy. Lows
  documented. Gate: check 0/0, lint EXIT=0, unit 436/0, e2e 81 passed.
  Detailed in `docs/RV20-C05b1-Audit-56.md`.
- **Round 57 (architect, 2-auditor): A PWC (9 low); B PWC (1 MED + 2
  low).** B found a real commit/cancel conflation bug:
  `recoverDesktopFlipNav` dispatched the back-target during a cancel slide
  (onCancel delegates to onCommit, so cancel also enters 'committing'
  phase). FIX: added `progressDirection !== 0` gate (only commits
  dispatch). Lows documented. Gate: check 0/0, lint EXIT=0, unit 436/0,
  e2e 81 passed. Detailed in `docs/RV20-C05b1-Audit-57.md`.
- **Round 58 (architect, 2-auditor): A PWC (3 low); B PWC (5 low). Zero
  MED/HIGH.** Both confirmed R57 MED correctly fixed. Fixed: skeleton
  comment accuracy + isGesturePageLayoutRoute docstring. NOTE: auditor B
  referenced "R57 MED" (read the Journal despite the prompt not
  mentioning it); R59 prompt adds a scope restriction. Lows documented.
  Gate: check 0/0, lint EXIT=0, unit 436/0, e2e 81 passed. Detailed in
  `docs/RV20-C05b1-Audit-58.md`.
- \*\*Round 59 (architect, 2-auditor, scope-restricted): A PWC (1 low-med
  - 3 low); B PASS (clean, 4th independent clean PASS).\*\* A found a real
    behavior divergence: `shouldEnter` omitted the `navStore.direction ===
'forward'` gate (GPL has it), so the forward-enter played on
    popstate-back (OS-back to pilot). FIX: added the direction gate.
    Lows documented. NOTE: R59 A read GPL (src/lib/) for behavior
    comparison (valid); R60 prompt allows src/lib/ sources but blocks docs/
    except spec + architecture. Gate: check 0/0, lint EXIT=0, unit 436/0,
    e2e 81 passed. Detailed in `docs/RV20-C05b1-Audit-59.md`.

Consecutive pass votes: **0** (R59 A carried a low-med; fixed; R60 audits
the post-fix state).

- **Round 60 (architect, 2-auditor, Journal-forbidden prompt): A PWC (1 low); B
  PASS (clean).** Pre-R60 fix: C1 (tab-exit dropped `?search`; now preserved end
  to end). A's LOW: `onSvelteKitAfterNavigate` unconditionally `#landAtRest()`
  cancelled a forward-enter when a pilot-internal param nav landed in its ~200ms
  window (GPL's CSS transition is not cancellable this way); fixed with an
  `#isEnterAnimation` guard. B's 3 LOWs all documented non-defects (unreachable
  skeleton by design + accurate comment; `pointerDisabled` `$derived` getter
  correct; `#mountInputs` not cleared in unmount but safe via singleton
  release). C4 (state machine advisory vs `#publication` authority) documented
  as §13.5 cross-cycle, out of 5b1. Gate: check 0/0, lint EXIT=0, unit 436/0,
  e2e 90 passed. Detailed in `docs/RV20-C05b1-Audit-60.md`.

Consecutive pass votes: **0** (R60 A carried a LOW concern; fixed; R61 audits
the post-fix state).

- **Round 61 (architect, 2-auditor, Journal-forbidden prompt): A PASS (3 low); B
  PASS (4 low). First 2/2 clean round since R43 -> counter 0 -> 2/5.** No code
  changed this round (audit only). Both verified UNIFY, no forbidden patterns,
  the all-rAF executor, §9, geometry, and the interrupt handoff; B additionally
  verified the cross-geometry interrupt (restingTranslate 0 vs -W) hands off
  continuously, the sub-threshold commit, the re-grab, and the
  `recoverDesktopFlipNav` gate. All LOWs are documented NON-defects (skeleton
  branches unreachable + spec fallback; `playEnterAnimation` hardcoded geometry
  by design; `playEnterAnimation` chipExit asymmetry unreachable on fresh mount;
  `unmount()` not clearing `#mountInputs` latent/unreachable - recurs R60;
  teardown ordering idempotent; `pointerDisabled` `$derived` closure correct).
  Gate unchanged (no code change): check 0/0, lint EXIT=0, unit 436/0, e2e 90
  passed. Detailed in `docs/RV20-C05b1-Audit-61.md`.

Consecutive pass votes: **2/5** (R61 was 2/2 clean; R62 audits the same state).

- **Round 62 (architect, 2-auditor, Journal-forbidden prompt): A PWC (1 MED + 2
  LOW); B PASS (5 low).** A's MED: NavPipelineHost lacked GPL's scroll
  capture/restore, so a back-swipe preview rendered the inbox at scrollTop 0
  instead of its cached position. Fixed by porting GPL's pattern (left/centre
  scroll `$derived` + restore `$effect` + `onscroll` capture; left gated
  `!chipExit`) plus a new viewport-shrunk e2e. Counter reset 2/5 -> 0/5. Lows
  documented (skeleton unreachable, recurring; `initialTrackTransform` flash
  masked by Svelte 5 sync mount; pager reset on unmount masked;
  `isGesturePageLayoutRoute` stale name dissolves in 5b3; content swap expected).
  `chipExitState` symmetry folded in. Gate: check 0/0, lint EXIT=0, unit 436/0,
  e2e 91 passed. Detailed in `docs/RV20-C05b1-Audit-62.md`.

Consecutive pass votes: **0** (A carried the MED; fixed; R63 audits the
post-fix state).

- **Round 63 (architect, 2-auditor, Journal-forbidden prompt): A PASS (5 low
  non-defects); B PWC (1 MED + 1 low).** B's MED: the R62 scroll-restore port
  left the left `<section>`'s `scrollTop` at the inbox value across a chip-exit
  content swap (the section element is stable), so the target panel slid in
  scrolled down then jumped on landing. Fixed with a chip-exit reset `$effect`
  (`leftEl.scrollTop = 0` when `chipExit`). Also deduped the two restore effects
  into a `restoreScroll` helper (owner-flagged; `VoidHandler` return for the
  no-inline-typing rule). Counter stays 0/5. Lows documented (pointerDisabled
  getter recurring; chip-exit FAB deliberate divergence; skeleton dead code;
  `#republishToPager` forward-looking; direction hardcoded for pilot). Gate:
  check 0/0, lint EXIT=0, unit 436/0, e2e 91 passed. Detailed in
  `docs/RV20-C05b1-Audit-63.md`.

Consecutive pass votes: **0** (B carried the MED; fixed; R64 audits the
post-fix state).

- **Round 64 (architect, 2-auditor, Journal-forbidden prompt): A PASS (3 low
  non-defects); B PWC (4 low, no MED/HIGH).** B's only real divergence: the
  chip-exit preview used `paginate={false}` while the landing tab pages
  (TabDiscussionsPanel / TabActivityPanel) use `paginate={true}` - a preview !=
  landing gap when `totalPages > 1` (seed-invisible). Fixed: both preview panels
  `paginate={true}`. Counter stays 0/5 (B PWC). Lows documented
  (LexicalEditorLazy in preview inherent to "real panel"; pointerDisabled
  redundant `$derived` recurring; state-machine-stuck-transitioning = C4 §13.5
  cross-cycle; skeleton unreachable recurring; PreviewPanel fallback dead code).
  Gate: check 0/0, lint EXIT=0, unit 436/0, e2e 91 passed. Detailed in
  `docs/RV20-C05b1-Audit-64.md`.

Consecutive pass votes: **0** (B carried a LOW concern; paginate fixed; R65
audits the post-fix state).

- **Round 65 (architect, 2-auditor, Journal-forbidden prompt): A PASS (2
  non-blocking notes); B PWC (1 CONCERN + 4 LOW).** Fixed B's 3 real LOWs:
  `isNavPipelinePilotRoute` regex tightened (`/^\/messages\/\d+$/` after `/pN`
  strip), `orchestratorMounted` `let` -> `$state`, chip-exit comment accuracy.
  Documented B's chip-exit FAB CONCERN (`coverProgress = 0` = accepted chip-exit
  divergence; owner design call whether FAB ramps with slide) + edge-dead-zone
  mismatch (unreachable on mobile). Counter stays 0/5. Gate: check 0/0, lint
  EXIT=0, unit 436/0, e2e 91 passed. Detailed in `docs/RV20-C05b1-Audit-65.md`.

Consecutive pass votes: **0** (B carried a CONCERN + LOWs; 3 fixed, 2
documented; R66 audits the post-fix state).

- **Round 66 (architect, 2-auditor, Journal-forbidden prompt): A PWC (2 low); B
  PWC (2 low).** Zero MED/HIGH. This round audited the pre-refactor state. Its
  `chipExit`-related findings did not go to a fix round: the architect directed
  the Session-18 refactor (dissolve `chipExit`, unify the FAB on f(progress,
  target)) instead, because `chipExit` was an invented category with a divergent
  per-transition forcing (the FAB hid during a cross-tab slide while it scaled in
  for a back-swipe) that round-by-round patching would have left in place. The
  refactor supersedes the `chipExit` findings; the non-`chipExit` LOWs (a
  second-nav-during-slide race; the unreachable skeleton / preview-panel
  branches; the `playEnterAnimation` "buildVisual discards" comment inaccuracy)
  carry to R67. Counter stays 0. Gate (pre-refactor): check 0/0, lint EXIT=0,
  unit 436/0, e2e 91 passed. Detailed in `docs/RV20-C05b1-Audit-66.md`.

Consecutive pass votes: **0** (both PWC; Session 18 refactor supersedes the
`chipExit` findings; R67 audits the post-refactor state).

- **Round 67 (architect, 2-auditor, Journal-forbidden prompt, post-refactor): A
  PASS (3 non-blocking observations); B PWC (2 low).** First audit of the
  post-`chipExit` state. Both verified the unified following-visual model (every
  visual is f(coverProgress, transitionTarget); the FAB scales in for
  `/messages/inbox` and `/`, hidden for `/activity` and the forward-enter). B's
  comment-accuracy LOW (the FAB layer Family B docstring said `coverProgress` is
  published by GesturePageLayout; now the orchestrator publishes it for the
  pilot) is FIXED. B's other LOW (a mid-commit re-grab with a leftward-past-start
  component freezes coverProgress at rawStart) is documented as a narrow edge
  case that is not a clear regression vs GPL's own re-grab quirk; the rightward
  re-grab handoff is correct. Counter stays 0. Gate: check 0/0, lint EXIT=0,
  unit 436/0, e2e 92 passed. Detailed in `docs/RV20-C05b1-Audit-67.md`.

Consecutive pass votes: **0** (B carried a LOW; comment accuracy fixed, re-grab
edge documented; R68 audits the post-fix state).

- **Round 68 (architect, 2-auditor, Journal-forbidden prompt): A PASS (4 low);
  B PWC (1 MED + 1 concern).** B's MED: `unmount()` did not clear the pager
  store, so on landing the FAB read stale in-flight values and dipped to scale 0
  before the destination published (visible under slow route-mount timing). R67
  had flagged this as a LOW and the orchestrator wrongly dismissed it as
  "theoretical"; the owner corrected that and the MED drove the fix. Fixed:
  `unmount()` publishes a cleanup (active: false etc.) matching GPL/MobileTabPager;
  the `playEnterAnimation` unreachable-case comment; the per-frame re-run of the
  `sawTransition` / `updateFromPathname` `$effect`s (extracted `publicationPlan` /
  `publicationInFlight` deriveds); the `resetPagerStore` `fractionalIndex: -1`
  before mount (mountInputs-null guard). Documented: the non-centerTab branch
  (5b2 future), the SSR initial transform (matches GPL), the resolver's dead
  `buildFabPlan` placeholder (FAB/Header not yet on the plan-driven path; 5b2+),
  the re-grab leftward edge (architect scope). Counter stays 0. Gate: check 0/0,
  lint EXIT=0, unit 436/0, e2e 92 passed. Detailed in
  `docs/RV20-C05b1-Audit-68.md`.

Consecutive pass votes: **0** (B carried a MED; fixed + the carried cleanups;
R69 audits the post-fix state).

- **Round 69 (architect, 2-auditor, Journal-forbidden prompt): A PASS (3 low); B
  PASS (3 low).** First 2/2 clean round since the Session-18 refactor (counter 0
  -> 2/5 on the pre-cleanup state). The owner then directed the LOWs be evaluated
  and all that need fixing be fixed (PASS does not license ignoring them);
  Session 19 followed and changed the state. Detailed in
  `docs/RV20-C05b1-Audit-69.md`.

Consecutive pass votes: **0** (R69 was 2/2 clean on the pre-cleanup state;
Session 19 changed the state; R70 audits the cleaned state).

- **Round 70 (architect, 2-auditor, Journal-forbidden prompt): A PASS (2 low
  documented); B PWC (1 MED + 2 comment low).** First audit of the Session-19
  cleaned state. B's MED: the back-swipe gesture never showed a header that
  hide-on-scroll had hidden (the orchestrator's live-drag published the pager but
  not the scroll-chrome; GPL calls `scrollChrome.show()` on swipe-move). Fixed:
  the orchestrator's live-drag block now calls `getScrollChromeStore().show()`.
  B's 2 comment LOWs (NavPipelineHost "sole writer of the transform" claim; e2e
  "forward-enter forces coverProgress=0" claim) fixed. A's LOWs (pointercancel
  unreachable, skeleton unreachable) documented. Counter stays 0. Gate: check
  0/0, lint EXIT=0, unit 424/0, e2e 92 passed. Detailed in
  `docs/RV20-C05b1-Audit-70.md`.

Consecutive pass votes: **0** (B carried the MED; fixed + the 2 comment LOWs;
R71 audits the post-fix state).

## Coverage bullets (round-independent)

The pilot's transition correctness is verified by:

- `bun run check` (typecheck) - PASSING (0 errors / 0 warnings).
- `bun run lint` (prettier + eslint + similarity-ts) - PASSING (0
  type duplicates).
- `bun test` on the relevant unit suites - PASSING (174/174
  nav-pipeline + 423/423 broader sweep across `src/lib/stores` +
  `src/lib/utils`).
- `bun run test:e2e` Playwright (Pixel 5, system chromium via
  `executablePath`, port 5174, CDP `Input.dispatchTouchEvent`).
  Pilot-touching specs (`tab-exit-preview.spec.ts`,
  `tab-click-transition.spec.ts`, `fab.spec.ts`) - 33/33 PASSING
  (Session 2). The tab-click from `/messages/<id>` to
  `/messages/inbox` now navigates via the new pipeline; chip-exits
  to non-pre-rendered tabs hide the foreign panel via the host's
  `{#if !chipExit}`.
- The independent audit files (when the orchestrator runs them) at
  `docs/RV20-C05b1-Audit-{01..NN}.md`.

## Deviations / blockers

### B1. Pre-existing e2e infra failure (effect_update_depth_exceeded)

The root layout's cache-seeding $effect loops on every route's
hydration on master (commit f779001, before any 5b1 work), throwing
effect_update_depth_exceeded and timing out every Playwright spec
that involves a navigation. The failure is in
`src/routes/+layout.svelte:196-226` (the $effect that captures
data.home / data.activity / data.messages into pageCache); the
effect's reads (page.url, page.data, data.\*) somehow re-trigger
themselves. The capture stack runs from `initialize` -> $effect ->
capture on every iteration.

I verified this by running `git stash` (removing all my 5b1 changes)
and re-running the same e2e spec on the base commit; the same error
occurs with the same trace (modulo the line-number shifts from my
removed imports).

This blocks the 5b1 e2e gate. The pilot's SSR check passes
(`fab.spec.ts` test 6) but no spec that requires client hydration
can run. I cannot ship a bridge to make this smaller; reporting
honestly per the anti-fabrication clause and stopping cycle work.

**Resolution (architect, 2026-07-06).** The root cause is NOT the C05A
shadow-mode imports (the guess above was wrong). It is that
`PageCacheStore.capture` does a MERGE: it reads the cache's `$state`
(the existing entry) before writing the merged entry. The seeding
`$effect` calls `capture`, so Svelte attributes capture's internal read
to the effect - the effect subscribes to the cache `$state` AND mutates
it, looping (`effect_update_depth_exceeded`). This is the
`[[svelte-effect-fetch-loop]]` / `[[page-cache-capture-loops-effect]]`
pattern, a Cycle-2 regression undetected because no shadow-mode cycle
ran e2e. Fixed by wrapping the seeding captures in
`untrack(() => { ... })` in `src/routes/+layout.svelte` (the effect now
subscribes only to `page.data`, re-running on navigation, not on cache
writes). With the loop gone, e2e runs and surfaced the two real UNIFY
gaps fixed in Session 2.
