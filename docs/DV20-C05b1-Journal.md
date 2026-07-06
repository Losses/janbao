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
axis='right' (sign=+1), at progress=0, tx = -W/2 (centre visible); at
progress=1, tx = 0 (left panel visible). The driver writes
`transform: translateX(${tx}px)`. The result is byte-equivalent to the
old `calc(-50% + Npx)` (with Npx in [-W/2, 0]).

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
  `-W/2` rest offset is expressible. Existing resolvers unchanged.
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
