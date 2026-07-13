# RV20-C05b2 - Audit Round 16 (architect-run, 2 independent auditors, MINIMAL prompt) + refactor audit

Result: **A PASS-WITH-CONCERNS (1 HIGH architectural + 2 LOW); B PASS-WITH-CONCERNS
(1 HIGH architectural + 1 MED + 1 LOW).** Counter stays **0/5** (both PWC, both
flagging the same structural root cause). The R1-R15 trend of shrinking surface
(area-by-area code defects, comment inaccuracy, coverage gaps) converged by R15;
R16's auditors independently stepped back from the per-finding frame and traced
the two deviations that kept being re-flagged as lazily deferred (then Known #2
FAB family-swap separate rAF; then Known #12 Header CSS transitions, setTimeout
backstop, settle rAF, and tapScrub rAF) to a single structural root cause: the
per-host orchestrator vs persistent consumers (FAB atom + Header) lifecycle
mismatch.

The piecemeal fixes through R1-R15 had each been correct (the family-swap rAF
ran on its own loop with the right anchor; the Header's CSS transitions +
setTimeout backstop played correctly under the various in-flight gates); what
R16 established was that the architecture had no state in which a route swap
could be owned end-to-end by one rAF-driving owner, because the rAF owner
unmounted mid-swap while the consumers persisted. Each new transition type that
crossed a route swap (FAB family change, Header title crossfade, Header settle,
Header tap-scrub) had to be bridged with a per-consumer mechanism. The bridge
count was growing, not shrinking.

The orchestrator's response was not another patch. The architectural review
concluded that unifying the per-consumer rAFs onto a persistent owner (a global
singleton orchestrator that survives route swaps) dissolves the lifecycle gap
that produced all four bridges at once. That refactor (steps 1 through 3 below)
is the audit trail for the structural change; R17 audits the post-refactor
state.

R16 used the MINIMAL prompt (spec + Plan + "find any defect" + forbidden-reads +
output format; no scope framing).

## B findings

### B #1 (HIGH, architectural) - the FAB family-swap rAF and the Header CSS-transition / setTimeout / settle / tapScrub rAFs are four parallel bridges across one lifecycle gap

The auditor traced the FAB family-swap ease end-to-end. The FAB atom persists
across route swaps (retained in the root / `(tabs)` layout); a family change
happens during a route swap when neither the old nor the new host's orchestrator
is a stable owner. The orchestrator's own rAF unmounts with the old host before
the new host's mounts, so the FAB layer runs its own family-swap rAF (the
`startFamilySwapEase` path that anchored at a DOM-read-back scale). The Header
runs the same play for the same reason: a settle in flight at a host's destroy
(a commit settle awaiting its navigation landing) cannot survive the
orchestrator's teardown, so the Header organism runs its own settle rAF
(`runSettleDriver`), its own tap-scrub rAF (`startTapScrub`), and a setTimeout
backstop for the crossfade termination.

The auditor classified this as HIGH not because any individual trajectory was
broken (each bridge produced the correct visual) but because the architecture
had accumulated four parallel mechanisms for cross-route-swap animation, each
added piecemeal as a new transition type needed support, none of which could be
removed without re-introducing the gap it bridged. This is the same failure mode
the DV18 / DV19 cycles hit (parallel mechanisms for one concern); the audit bar
forbids it.

### B #2 (MED) - FAB `readRenderedFabScale` DOM read-back is the symptom, not the fix

The FAB layer anchored the family-swap ease's start scale by reading its own
rendered transform once per family swap. This was a defensive measure against a
reactive race (the tracked `restingScale` could advance to a transient
post-swap value before the ease's `$effect.pre` reads it). The auditor noted
that the DOM read-back was the FAB layer compensating for the orchestrator's
absence during the route swap: if a stable owner existed across the swap, the
owner would hold the last-rendered scale itself and the FAB layer would not
need to read anything back. The DOM read-back would dissolve with the
structural fix.

### B #3 (LOW) - singleton state-machine one-frame stale window during a route swap

The orchestrator is constructed at component-init but `mount()` (which
`forceReset`s the shared singleton state machine) runs in `onMount`. For one
render frame the new host's `$derived` publication reads the singleton the
prior orchestrator left in `transitioning`. No visible artifact (the prior
`unmount()` clears the pager store first; the SSR initial transform holds the
visual at rest); `mount()` clears it the next frame. The auditor classified
this as another instance of the same lifecycle gap (the per-host mount / unmount
sequence is not atomic against the persistent singleton's publication), so the
fix path is the same as B #1.

## A findings

### A #1 (HIGH, architectural) - same root cause as B #1, traced from the Header side

The auditor independently traced the Header settle path end-to-end and reached
the same root cause as B #1 from a different entry point. The Header organism
is persistent; a settle in flight at the host's destroy must continue to its
navigation landing, but the orchestrator that owns the settle signal unmounts
before the landing. The Header runs its own settle rAF as a result, plus a
`setTimeout` backstop that ends the crossfade if the navigation never lands
(a defensive timeout against a navigation that the orchestrator cancelled
mid-settle). The `startTapScrub` rAF (the root<->search morph on a tap) is the
same pattern again: the orchestrator's `pager.tapMorph` publication unmounts
mid-scrub, so the Header runs its own rAF.

The consensus with B #1 is structural: the orchestrator's per-host lifecycle
cannot own animations that cross route swaps, so each cross-swap animation
becomes a per-consumer mechanism.

### A #2 (LOW) - the `tapMorph` rAF and `backMorph` publication overlap during a forward enter

During a tap-induced `/` -> `/search` forward enter the orchestrator plays an
enter slide (publishing `pager.backMorph`) while the Header's Effect E also
fires `startTapScrub` (publishing `pager.tapMorph`). The Header's `trackMorph`
arbitrates by preferring `backMorph` while `transitionTarget !== null`, so only
one signal drives the morph at any instant. The redundancy (a published signal
that is read as null) dissolves when the tap-scrub rAF moves onto the
orchestrator's rAF, since the orchestrator can publish a single arbitration
result instead of two signals one of which is masked.

### A #3 (LOW) - pager store cleared by the displaced orchestrator during a route swap

On a route swap the new host's `setNavPipelineOrchestrator(B)` displaces A by
calling `A.unmount()`, which clears the pager store AFTER `B.mount()` already
published B's at-rest state; B's `$effect` re-publishes the at-rest state in
the same flush. The net is a one-frame window where the store is in the cleared
state. No visible artifact (the FAB layer's URL-derived tab fallback and the
Header's `backMorph === null` at-rest value hold the visual correct through the
cleared frame). Same root cause as A #1 / B #1: the per-host mount / unmount
sequence is not atomic against the persistent singleton's publication.

## Architectural-review conclusion

The orchestrator's audit of the four R16 findings (B #1, B #2, B #3, A #1, A
#2, A #3) concluded:

1. **Common root cause.** All four "bridges" (FAB family-swap rAF, Header
   settle rAF, Header tap-scrub rAF, Header CSS transitions + setTimeout
   backstop) plus the FAB DOM read-back and the singleton state-machine gap
   frame are symptoms of one structural mismatch: the per-host orchestrator's
   lifecycle is bound to one route's host, while the FAB and Header consumers
   persist across route swaps and need animation continuity through the gap.
2. **No patch is acceptable.** A patch (e.g. delaying the orchestrator's
   `unmount` until the persistent consumers' in-flight animations rest) would
   add a fifth bridge (a "is the persistent layer idle?" gate) on top of the
   four existing ones, against the binding "UNIFY, DO NOT BRIDGE" constraint
   (§13.4).
3. **The structural fix is a global singleton.** Promote the orchestrator to a
   module-level singleton that survives route swaps; hosts feed it inputs
   (`configure(inputs)`) on mount and release them (`releaseInputs()`) on
   destroy without tearing down the executor / driver / rAF. The persistent
   owner now spans the route swap, so each cross-swap animation can move onto
   its rAF and the per-consumer bridges can be deleted.
4. **Scope of the refactor.** Steps 1 through 3 below cover the global
   singleton + the FAB family-swap migration + the Header settle / tap-scrub
   migration. The deeper step (the driver writes the FAB and Header elements
   directly each frame, deleting the reactive pager-store bridge entirely) is
   deferred: the reactive bridge carries correct signals today and the
   driver-writes-elements step is a performance / coupling cleanup, not a
   correctness fix. Step 5 (centralized interruption policy) is also deferred:
   the current interruption handling is correct per trajectory; centralizing it
   is a maintainability improvement, not a defect fix.

## Refactor audit (steps 1 through 3)

The refactor was applied in three checkpoints, each verified by the full gate
(`bun run check`, `bun run lint`, `bun test src/lib/utils src/lib/stores`,
`bun run test:e2e`). Each step leaves the codebase consistent.

### Step 1 - global singleton + `configure` / `releaseInputs` lifecycle

A module-level singleton instance is constructed eagerly at module load (so its
`$state` / `$derived` fields bind to the module scope rather than the first
host's component context; Svelte 5 rune ownership ties reactive fields
instantiated inside a component script to that component, which surfaces as
`derived_inert` warnings and stale reads on the next host). The host
(`NavPipelineHost` / `NavPipelineTabHost`) reaches the singleton via
`getGlobalNavPipelineOrchestrator()` and calls `configure(inputs)` in `onMount`

- `releaseInputs()` in `onDestroy`.

`configure(inputs)` captures the host's input bundle (element refs, route data,
viewport, scroll containers, `fromTag`), runs `forceReset` on the singleton
state machine to clear any stale phase from the prior host, publishes the
at-rest pager state, detects a family change (arming the family-swap ease in
step 2), and sets the `#mounted` flag. `releaseInputs()` captures the visible
FAB scale into `#lastRenderedScale` (the next configure's family-swap anchor),
clears the in-flight pager state, drops the inputs, and clears the `#mounted`
flag WITHOUT tearing down the executor / driver / rAF / lifecycle `mount`.

The `#mounted` guard on the derived publication returns at-rest while inputs
are absent (the gap frame between an old host's `releaseInputs` and the new
host's `configure`), so the gap frame publishes at-rest instead of the prior
route's in-flight state. The mobile -> desktop flip and the app exit call the
full `unmount` teardown.

### Step 1a - attempted skip-`mount` shortcut (reverted)

A first attempt rerouted `releaseInputs` through the full `unmount` teardown on
the assumption that the singleton's executor / driver / rAF could be rebuilt
cheaply on the next `configure`. The Header froze on the first route swap that
crossed a settle in flight: with step 1 in place the Header had been made
render-only for the settle signal (the settle rAF was about to move onto the
orchestrator), but tearing the singleton's executor down between hosts killed
the in-flight settle rAF mid-transition. The hang was the
lifecycle-interdependence proof: the orchestrator's rAF channels cannot be torn
down across a route swap while the persistent Header is mid-settle, because the
persistent layer is precisely the consumer that needs the rAF to continue.

The shortcut was reverted to the `releaseInputs` definition that preserves the
executor / driver / rAF across route swaps, and the lesson was recorded as a
constraint on the singleton design: the executor / driver / rAF lifetime is the
app's mobile lifetime, not any one host's lifetime. Only the mobile -> desktop
flip and the app exit tear them down (via the full `unmount`).

### Step 2 - orchestrator owns the FAB family-swap ease

The family-swap rAF moved into the orchestrator (`#startFamilySwapEase` /
`#stopFamilySwapEase` / `#publishFamilySwapScale`), armed on a family change
detected at `configure` time. The orchestrator publishes
`pager.familySwapScale` each tick; the FAB layer reads it reactively
(`scale = pager.familySwapScale ?? restingScale`).

The orchestrator's `#lastRenderedScale` (captured in `releaseInputs` before the
inputs clear, maintained at the eased value each tick while the ease runs) is
the family-swap anchor; the FAB layer no longer reads the DOM (the
`readRenderedFabScale` helper was deleted along with the FAB layer's own rAF).

A reduced-motion gate snaps the family-swap (drops `familySwapScale` so the FAB
falls through to the destination family's resting scale immediately, no rAF
integration). A live-drag / list-kind gate hands the scale back to the live or
track signal mid-ease (a higher-priority driver took over).

### Step 3 - orchestrator owns the Header settle + tap-scrub eases

The settle rAF (`#settleActive` / `#settleProgress` / `#settleLatched` /
`#settleDirection` / `#settleAwaitTitle`) and the tap-scrub rAF
(`#tapScrubRafId` / `#searchScrubbing`) moved into the orchestrator. The
orchestrator publishes the settle / tap-scrub state via getters that the
Header reads reactively; the Header's `runSettleDriver` rAF,
`startTapScrub` rAF, and `setTimeout` settle backstop are deleted. The Header
derives every visual (morph, title crossfade, search-track / search-button /
tab-bar transforms, settle / tap-scrub state) from the manager-published
signals.

A settle in flight at a host's `releaseInputs` now continues across the route
swap (the orchestrator's rAF persists), so the Header reads a continuous
settle signal across the swap instead of having to run its own. The
`releaseInputs` body notes the invariants: the settle / tap-scrub eases are
NOT cancelled in `releaseInputs` (they must continue until their navigation
lands), while the family-swap ease IS cancelled (the route swap that
`releaseInputs` tears down for either re-arms a fresh ease from the new host's
`configure` or needs no further FAB motion).

The root<->search morph arbitration (`trackMorph` prefers `backMorph` while
`transitionTarget !== null`) is unchanged. The residual inline-style CSS
transitions on the Header's search-track / search-button / tab-bar transforms
fire only outside an orchestrator transition (their condition list collapses
to `'none'` during `searchScrubbing`, `tapMorph`, `navInFlight`, or an active
`transitionTarget`); they cover programmatic URL changes that arrive without a
gesture or a tap (direct URL entry, an external link). The macro plan folds
them into the executor when those paths become orchestrator-driven.

## §5 invariant status (post-refactor)

Macro §5's structural invariant reads: "For any visual property of the
gesture / navigation layer at any instant, exactly one rAF write owns its
motion, decided solely by the orchestrator's phase. CSS transitions and
`setTimeout` alignment do not exist in this layer." Status after the refactor
(documented in the spec's "Global animation manager" section):

- **Track slide during a gesture / commit / scrub:** owned by the executor's
  rAF (unchanged). CSS-transition-free.
- **FAB scale during a within-route transition:** owned by the executor's rAF
  via `coverProgress` / `fractionalIndex` (unchanged). CSS-transition-free.
- **FAB scale during a cross-route family swap:** owned by the orchestrator's
  family-swap rAF via `pager.familySwapScale`. CSS-transition-free; no DOM
  read-back.
- **Header morph / title crossfade during a drag / commit:** owned by the
  executor's rAF via `pager.backMorph` / `pager.tapMorph` (unchanged).
  CSS-transition-free.
- **Header title crossfade during a settle:** owned by the orchestrator's
  settle rAF via the `settleProgress` getter. CSS-transition-free; the
  `setTimeout` settle backstop is deleted.
- **Header root<->search morph on a tap:** owned by the orchestrator's
  tap-scrub rAF via the `searchScrubbing` flag and `pager.tapMorph`.
  CSS-transition-free; the Header's `startTapScrub` rAF is deleted.

The R16 HIGH architectural findings (B #1, A #1) and their LOW satellites (B
#2, B #3, A #2, A #3) are resolved by the refactor. Their spec entries (the
prior Known #1 DOM read-back, #2 FAB family-swap separate rAF, #8 singleton
state-machine gap frame, #12 Header CSS transitions + setTimeout + settle /
tapScrub rAFs) are removed from the Known list (the deviations no longer
exist; the spec text is now architecture-matching rather than
deviation-documenting).

## Gate outputs (post-refactor)

```
$ bun run check                       0 errors / 0 warnings (1462 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    418 pass / 0 fail
$ bun run test:e2e                    197 passed, EXIT=0 (8.4m, clean run)
```

## Convergence counter

Consecutive pass votes: **0/5** (both R16 auditors PWC with the same HIGH
architectural concern; the structural refactor that resolved it is between R16
and R17, not an in-round fix). R17 audits the post-refactor state against the
updated spec (the "Global animation manager" section + the renumbered Known
conditions with the resolved entries removed).
