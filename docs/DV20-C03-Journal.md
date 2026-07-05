# DV20 Cycle 3 Journal

Implementation record for CMA3. Per the Cycle Manager Protocol v2 this
journal is written incrementally; it records what actually happened
(investigation, design, files changed, verification evidence,
deviations). It does not perform confidence. The architect runs the
audit independently; this file does not contain audit verdicts.

## Investigation (2026-07-05)

Read in order: `docs/DV20-Plan.md` (§2 the five-layer pipeline, §4 the
six tag-pair resolvers, §6 the state-machine phases, §11 protocol v2,
§13 values, §14 signed-off decisions), `docs/DV20-Meeting/DV20-C03-spec.md`,
`docs/DV20-Meeting/DV20-Cycle-Manager-Protocol-v2.md`, the Cycle 1
output (`src/lib/utils/route-data.ts`), and the Cycle 2 output
(`src/lib/stores/page-cache.svelte.ts` + `page-cache-logic.ts` +
`page-cache-svelte-types.ts`).

For shadow-mode comparison I read the existing gesture owners:
`src/lib/components/templates/MobileTabPager.svelte`,
`src/lib/components/templates/GesturePageLayout.svelte` (skimmed the
shape of `dragOffset`, `swipeDirection`, `isPendingNavigation`,
`isTransitioningOut`, `swipeNeedsLoadingAtStart`, `coverProgress`,
`backMorph`), and `src/lib/actions/swipe.ts` (entry shape). Supporting
pure modules already cover what the new layer reads:
`src/lib/utils/history-nav.ts` (`previousEntryPathname`,
`backSwipeShouldPopHistory`), `src/lib/utils/gesture-constants.ts`
(`HEADER_MORPH_THRESHOLD`, `PILL_EXPANSION_THRESHOLD`),
`src/lib/utils/route-config.ts` (`getCurrentTabIndex`, `MOBILE_TABS`),
`src/lib/utils/tab-config.ts` (`MOBILE_TAB_DEFS`).

### What Cycle 3 must produce (per §2 + the C03 spec)

Four layers, all NEW files in shadow mode:

1. Layer 1 - Orchestrator (state machine). Macro phases per §6:
   `at-rest` (on tab / deep / search), `intent`, `resolving`,
   `transitioning` (sub-phase `dragging|committing|cancelling|scrubbing`,
   carrying the active resolver + plan), `landing`. Owns interruption
   and SvelteKit interop hooks. Does NOT replace MobileTabPager/GesturePageLayout.
2. Layer 2 - Intent classifier. Maps raw input (pointer, tap, popstate,
   hashchange, goto) to an Intent + continuous parameters (direction,
   live offset, live velocity). Pure, no side effects, no DOM writes.
3. Layer 3 - Resolver dispatch. Pure `resolve(intent, stack, route-data)
-> TransitionPlan`. Six tag-pair resolvers. Each produces per-consumer
   animation plans (page-track, FAB, Header) as functions of
   `(progress, liveOffset)`.
4. Layer 4 - Coordinator. Given the plan's FROM and TO, consults the
   PageCacheStore (Cycle 2). Cache-hit = direct slide; miss =
   chip-exit + preload.

### What Cycle 3 does NOT do (out of scope per the C03 spec)

- Layer 5 executor (Cycle 4).
- PageLifecycle contract + migration (Cycle 5).
- Replacing MobileTabPager / GesturePageLayout (Cycle 5).
- Forward-swipe Messages to /search special case (natural consequence
  in Cycle 5).
- Modifying any existing gesture component file. Shadow mode.

### Key shape constraints (binding)

- The `TransitionPlan` interface matches §4 exactly: `pageTrack`,
  `fab`, `header`, `progressDirection`, `commitPhysics`.
- The slide-axis resolution (§14.2 / §4): `{tab,tab}` resolves the axis
  spatially by position in the tab layout; cross-tag pairs follow user
  intent + the route stack.
- The back-target is always the route stack's previous entry (§6). No
  per-route override. The first consumer of `backParent`
  (`GesturePageLayout.resolvedLeftHref`) dissolves logically in this
  cycle's design (the new resolver reads the stack directly); the
  field itself stays in `RouteData` because the second consumer
  (`isGesturePageLayoutRoute`) does not dissolve until Cycle 5, so
  removing the field now would break Cycle 1's contract. This is a
  documented transitory state, not a deviation.
- The existing MobileTabPager and GesturePageLayout are NOT modified.
  No behavior change. No e2e regressions.

### Architecture decisions for this cycle (CMA3, documented for architect review)

1. **Pure half + reactive half split, mirroring Cycle 2.** Cycle 2
   split `page-cache-logic.ts` (pure, unit-tested under `bun:test`) from
   `page-cache.svelte.ts` (reactive `$state` shell). The
   `[[bun-test-no-runes-loader]]` memory documents that `$state` /
   `$derived` cannot run under `bun:test`. Cycle 3 follows the same
   split for the orchestrator: `nav-state-machine-logic.ts` (pure
   reducer, unit-tested) + `nav-state-machine.svelte.ts` (reactive
   wrapper). Layers 2, 3, 4 are pure (runes-free) single files.

2. **RouteStack shape.** The plan refers to "the route stack's previous
   entry" without specifying the shape. Cycle 1 did not produce a
   stack type; `navigation-logic.ts` has per-tab `RouteEntry[]` stacks
   but those carry `(pathname, search)` and are keyed by tab. For
   Cycle 3's pure resolver input I define a flat `RouteStack` of
   `RouteStackEntry { pathname, search?, tag }` entries
   (chronological; the last entry is current). The resolver reads
   `entries[length - 2]` for the back-target. This shape is internal
   to the new pipeline; Cycle 5 wires it to the real navigation
   history.

3. **Bidirectional pair sharing.** §4: "A bidirectional pair shares one
   resolver because the two directions are the same animation reversed."
   The dispatch keyed on the unordered pair: `{tab,detail}` and
   `{detail,tab}` both select `tabDetailResolver`. The resolver reads
   `direction: 'forward' | 'backward'` from the input and the
   `progressDirection` field encodes which way the plan plays.

4. **`{search,search}` reserved.** §4: "Not a top-level transition
   today; reserved." The resolver exists (the dispatch table covers
   the pair for symmetry) and returns a degenerate no-op plan. The
   orchestrator never produces a `{search,search}` transition in
   shadow mode because there is no top-level navigation that produces
   it; the SearchScopePager's internal scope switch is a nested
   sub-pager.

5. **No new eslint-disable, no `as any`, no `as unknown`.** All types
   are named interfaces or named union types per the project lint
   gate.

6. **Tests cover the pure halves.** The reactive wrappers
   (`nav-state-machine.svelte.ts`) are thin `$state` shells over the
   pure reducer, mirroring the Cycle 2 pattern. They are exercised by
   the unit suites for the pure halves, not by their own suites.

### Investigation notes: existing classifiers the new layer replaces

The existing gesture state is smeared across these flags (per Plan §0):

- MobileTabPager: `activeIndex`, `dragOffset`, `showDeepPreview`,
  `backChipReveal`, `isTransitioningOut`.
- GesturePageLayout: `dragOffset`, `rawDragOffset`, `swipeDirection`,
  `swipeNeedsLoadingAtStart`, `isPendingNavigation`,
  `isTransitioningOut`, `pendingCancel`, `transitionEnabled`,
  `pendingNavRafId`, `snapIndex`, `lockedLeftHref`, `resolvedLeftHref`,
  `pendingTargetHref`, `prefetchStarted`.

The new pipeline collapses these into one `macro` phase + one resolved
`(from, to)` + the live `(progress, liveOffset)`. Cycle 3 does not
delete the existing flags (shadow mode); it builds the unified
authority beside them.

## Design (2026-07-05)

### File layout

- `src/lib/utils/nav-intent.ts` - Layer 2, pure.
- `src/lib/utils/nav-intent.test.ts` - Layer 2 unit suite.
- `src/lib/utils/nav-resolvers.ts` - Layer 3 (types + 6 resolvers +
  dispatch), pure.
- `src/lib/utils/nav-resolvers.test.ts` - Layer 3 unit suite.
- `src/lib/utils/nav-coordinator.ts` - Layer 4, pure.
- `src/lib/utils/nav-coordinator.test.ts` - Layer 4 unit suite.
- `src/lib/stores/nav-state-machine-logic.ts` - Layer 1 pure reducer +
  types.
- `src/lib/stores/nav-state-machine-logic.test.ts` - Layer 1 reducer
  unit suite.
- `src/lib/stores/nav-state-machine.svelte.ts` - Layer 1 reactive
  `$state` wrapper (single singleton + instantiable class).

### Intent (Layer 2) shape

```ts
type IntentMicro = 'idle' | 'deciding' | 'drag-left' | 'drag-right' | 'committed' | 'cancelled';

interface IntentState {
	micro: IntentMicro;
	direction: 'left' | 'right' | null;
	offset: number; // px, signed (current drag offset from start)
	velocity: number; // px/ms at release; 0 during drag
	startX: number; // gesture start X (px)
	startedAt: number; // ms epoch
	reversed: boolean; // user reversed past the start
	target: string | null; // pathname for tap / goto
	releaseVelocity: number;
}
```

The classifier is a pure reducer over `(state, event)` where `event` is
the raw input (pointerdown / pointermove / pointerup / pointercancel /
tap / popstate / hashchange / goto). The velocity is computed from a
ring buffer of the trailing samples inside the move handler.

### Resolver (Layer 3) shape

```ts
interface FabVisual {
	scale: number;
	translateY: number;
	visible: boolean;
}
interface HeaderVisual {
	morph: number;
	titleCrossfade: number;
	translateY: number;
}
interface PageTrackPlan {
	axis: 'left' | 'right';
	distance: number;
}

type FabPlanFn = (progress: number, liveOffset: number) => FabVisual;
type HeaderPlanFn = (progress: number, liveOffset: number) => HeaderVisual;

interface TransitionPlan {
	pageTrack: PageTrackPlan;
	fab: FabPlanFn;
	header: HeaderPlanFn;
	progressDirection: 0 | 1;
	commitPhysics: 'momentum' | 'snap';
}

interface ResolverInput {
	intent: IntentState;
	stack: RouteStack;
	from: RouteData;
	to: RouteData;
	direction: 'forward' | 'backward';
	fromPathname: string;
	toPathname: string;
	fromTabIndex: number; // -1 if from is not a tab root
	toTabIndex: number; // -1 if to is not a tab root
	viewportWidth: number;
	reducedMotion: boolean;
}

type Resolver = (input: ResolverInput) => TransitionPlan;
```

Six resolvers:

| Pair              | Resolver               | axis resolution                                        |
| ----------------- | ---------------------- | ------------------------------------------------------ |
| `{tab,tab}`       | `tabTabResolver`       | spatial: toTabIndex > fromTabIndex -> 'left'           |
| `{detail,detail}` | `detailDetailResolver` | intent + stack: forward -> 'left', backward -> 'right' |
| `{search,search}` | `searchSearchResolver` | reserved; degenerate no-op plan                        |
| `{tab,detail}`    | `tabDetailResolver`    | intent + stack                                         |
| `{tab,search}`    | `tabSearchResolver`    | intent + stack                                         |
| `{detail,search}` | `detailSearchResolver` | intent + stack                                         |

FAB plan reads `from.fab` and `to.fab` only (per §3 there is NO family
enum in the core record); the FAB scale follows the
`scaleFromFraction(foregroundFraction)` shape from `fab-scale.ts` so the
new plan composes with the existing FAB layer once Cycle 4 wires it.

Header plan reads the from/to tags: tab->tab is root mode (no morph,
no crossfade); anything involving `search` carries the search-scrub
morph; detail->detail carries the title crossfade.

### Coordinator (Layer 4) shape

```ts
interface CoordinatorInput {
	fromPathname: string;
	toPathname: string;
	toSubKey: string | undefined;
	toSnapshotCapture: boolean;
	cacheHas: (pathname: string, subKey?: string) => boolean;
}

interface CoordinatorDecision {
	strategy: 'direct-slide' | 'chip-exit';
	preloadPathname: string | null;
	useDeepPreview: boolean;
}
```

Pure: takes a `cacheHas` predicate (injecting the reactive
`PageCacheStore.get` keeps this runes-free). Returns
`'direct-slide'` when `cacheHas(toPathname, toSubKey)` is true OR a
deep-preview snippet is available; otherwise `'chip-exit'` with the
`preloadPathname` set so the orchestrator can call `ensure()`.

### Orchestrator (Layer 1) shape

Macro phase:

```ts
type MacroPhaseKind = 'at-rest' | 'intent' | 'resolving' | 'transitioning' | 'landing';

type AtRestOn = 'tab' | 'deep' | 'search';

type TransitionSub = 'dragging' | 'committing' | 'cancelling' | 'scrubbing';

interface MacroPhase {
	kind: MacroPhaseKind;
	on: AtRestOn | null; // populated when kind === 'at-rest'
	sub: TransitionSub | null; // populated when kind === 'transitioning'
	plan: TransitionPlan | null; // populated when kind === 'transitioning'
}

interface OrchestratorState {
	macro: MacroPhase;
	activePlan: TransitionPlan | null;
	fromPathname: string | null;
	toPathname: string | null;
	fromTag: RouteTag | null;
	toTag: RouteTag | null;
	direction: 'forward' | 'backward' | null;
	startedAt: number | null;
	lastIntent: IntentState | null;
}
```

Events:

```ts
type OrchestratorEvent =
	| { type: 'intent'; intent: IntentState; from: string; fromTag: RouteTag }
	| {
			type: 'resolved';
			plan: TransitionPlan;
			from: string;
			to: string;
			direction: 'forward' | 'backward';
	  }
	| { type: 'drag-move'; intent: IntentState }
	| { type: 'commit' }
	| { type: 'cancel' }
	| { type: 'interrupt'; intent: IntentState }
	| { type: 'land'; on: AtRestOn }
	| { type: 'reset'; on: AtRestOn };
```

The reducer is total: every (state, event) pair has a defined result.
Interruption (re-grab mid-commit) cancels the active commit and re-enters
`intent` with the new pointer.

### SvelteKit interop hooks

The reactive wrapper (`nav-state-machine.svelte.ts`) exposes methods
that the next cycle will wire into SvelteKit's navigation lifecycle:

- `onIntent(intent, from, fromTag)`: gesture-start intent arrived.
- `onResolved(plan, from, to, fromTag, toTag, direction)`: resolver
  produced a plan; locks FROM/TO and enters `transitioning`.
- `onDragMove(intent)`: live drag moved (updates the streaming intent).
- `onCommit()` / `onCancel()`: drag released past/below threshold.
- `onInterrupt(intent)`: a new intent arrived mid-commit (§5).
- `onLand(toTag)`: navigation landed; transitions through `landing`
  into `at-rest` via a microtask.
- `reset(on)`: clear to at-rest on a tag (first-load / SSR).

In Cycle 3 these methods are NOT connected to SvelteKit's
`beforeNavigate` / `afterNavigate`; they are the boundary the next
cycle plugs in. The wrapper has no `goto` import and does not call
`navigation.cancel()`; the orchestrator coordinates, it does not
bypass (§9).

## Implementation log

### 2026-07-05 - Layer 2 (intent classifier) built

`src/lib/utils/nav-intent.ts`: pure reducer `classify(state, event,
opts, viewportWidth)` over `(IntentState, IntentEvent)`. Edge-dead-zone
yield (40px left/right reserve), drag-decision threshold, trailing
5-sample velocity ring buffer, target-bearing intents (tap / popstate /
hashchange / goto). Initial state, helpers (`isEdgeReserve`,
`resolveDirection`, `estimateVelocity`, `intentTarget`), and the
`IntentClassifierOptions` exported for tests.

### 2026-07-05 - Layer 3 (resolvers + dispatch) built

`src/lib/utils/nav-resolvers.ts`: the six resolvers (`tabTabResolver`,
`detailDetailResolver`, `searchSearchResolver`, `tabDetailResolver`,
`tabSearchResolver`, `detailSearchResolver`) plus the dispatch table
(`selectResolver`, `resolve`) keyed on the unordered pair. The
`TransitionPlan` interface matches §4 exactly. FAB plan uses the
half/half handoff shape (mirroring `fab-scale.ts`'s
`scaleFromFraction`); Header plan's morph follows from/to tags.

### 2026-07-05 - Layer 4 (coordinator) built

`src/lib/utils/nav-coordinator.ts`: pure `coordinate(input)` returns
the strategy (`direct-slide` on cache hit; `direct-slide` with
`useDeepPreview` on a snapshot-capturing TO when a snippet exists;
`chip-exit` with `preloadPathname` otherwise). The cache check is
injected as a `CacheHasFn` predicate so the module is runes-free.

### 2026-07-05 - Layer 1 (state machine reducer + reactive wrapper) built

`src/lib/stores/nav-state-machine-logic.ts`: the pure reducer
`reduce(state, event, now)` and all state/event types
(`OrchestratorState`, `MacroPhase`, `OrchestratorEvent` variants).
Total: every (state, event) pair has a defined result.
`nav-state-machine.svelte.ts`: the reactive `$state` wrapper class
`NavStateMachine` plus the module singleton `getNavStateMachine()`.

A syntax typo in the reducer's `resolved` case
(`state.macro.kind === 'transitioning && state.macro.sub === ...` with
the quote in the wrong place) was caught during the typecheck pass and
fixed before the unit tests ran. Recorded here for honesty, not as a
defect carried forward.

### 2026-07-05 - Unit tests written and run

92 tests across the four pure-half suites, all passing. Real outputs
pasted under Verification. (Initial run was 87; +2 R1 preventive tests
for `land`-from-at-rest and `resolved`-from-committing, +1 R2
preventive test for `pointercancel`-from-deciding, +1 R4 preventive
test for the `reset`-from-intent race, +1 R4 preventive test for
`interrupt` clearing the abandoned to-fields.)

### 2026-07-05 - Audit-driven fixes (R1-R3)

The architect ran three 2-auditor rounds against this cycle. Each round
found code-level concerns; each was fixed before the next round. Full
per-round detail in `docs/RV20-C03-Audit-{01..03}.md` (reconstructed
post-hoc; the prior orchestrator ran the rounds but wrote no audit
files at the time). Summary in `Failures` below. The fixes, all
verified present in the current code:

- `tabDetailResolver` (and every resolver) `titleCrossfade` follows
  `clamp(progress, 0, 1)` (R1-C1, render bug).
- `ResolvedTarget.via` narrowed to `'goto'` for Cycle 3, with a comment
  that Cycle 5 discriminates real SvelteKit sources (R1-C2). Dead
  `committed` branch deleted (R1-C4).
- Dead `lerp` removed from `nav-resolvers.ts` (R1-C8).
- `coordinator.hasAnySnippet` renamed `hasToSnippet` and narrowed to the
  TO route specifically (R2-C3).
- SSR docstring on `NavStateMachineOptions` corrected (R2-C4).
- `'intent'` macro phase restored as the produced phase; `'resolving'`
  reserved in the union for Cycle 5 async with a comment (R3).
- Preventive tests added: `land`-from-at-rest (R1-C5),
  `resolved`-from-committing (R1-C6), `pointercancel`-from-deciding
  (R2-C2).

### 2026-07-05 - `reset` guard narrowed (R3 regression, caught at R4)

The R3 fix that restored `'intent'` also carried an over-broad guard on
the `reset` case (`kind !== 'landing' && kind !== 'at-rest'`), which
made `reset` a no-op from `transitioning` and broke the committed test
`reset returns to at-rest and clears from/to`. The guard's intent was
to protect the landing-microtask race (a new `intent` arriving between
`land` and the wrapper's microtask must not be clobbered by the stale
`reset`). Narrowed to `kind === 'intent'` - the only phase `reset` must
protect - so `reset` from `transitioning` works again and the race is
still defended. Preventive test `reset from intent is a no-op (protects
the landing-microtask race)` added.

### 2026-07-05 - R4 audit fixes (docstring + interrupt + stack comments)

Three corrections from the R4 round (both auditors converged on the
first two; auditor A raised the third as a code-comment concern under
the v2 rule):

- `MacroPhase` overview docstring rewritten to the real invariant: `on`
  for `at-rest`/`landing`; `sub` and `plan` co-populated for
  `transitioning`; all null for `intent`/`resolving`. The per-field
  docstrings now say "Null otherwise" explicitly.
- `interrupt` case now nulls `toPathname`/`toTag`/`direction` (FROM
  preserved), mirroring the `intent`-from-at-rest and
  `intent`-from-landing branches, so an `intent` phase never carries a
  stale destination. Preventive test added.
- `nav-resolvers.ts` stack docstrings corrected: `stack` is carried on
  `ResolverInput` for Cycle 5 (when resolvers may read the back-target
  directly); in Cycle 3 the caller precomputes `direction` from the
  stack and the resolvers consume `direction`, not `stack`.

## Verification

### Unit tests (the four pure-half suites)

Command: `bun test src/lib/utils/nav-intent.test.ts
src/lib/utils/nav-resolvers.test.ts
src/lib/utils/nav-coordinator.test.ts
src/lib/stores/nav-state-machine-logic.test.ts`

```
bun test v1.3.13 (bf2e2cec)

 92 pass
 0 fail
 210 expect() calls
Ran 92 tests across 4 files. [29ms]
```

Per-file counts (each ran individually during development):

- `nav-intent.test.ts`: 26 pass / 0 fail / 49 expect() calls
- `nav-resolvers.test.ts`: 32 pass / 0 fail / 82 expect() calls
- `nav-coordinator.test.ts`: 10 pass / 0 fail / 18 expect() calls
- `nav-state-machine-logic.test.ts`: 24 pass / 0 fail / 61 expect() calls

### All src/lib unit tests

Command: `bun test src/lib`

```
 398 pass
 0 fail
 1787 expect() calls
Ran 398 tests across 25 files. [2.09s]
```

No regressions in the existing 306 tests across the rest of `src/lib`.

### Typecheck

Command: `bun run check`

```
$ svelte-kit sync && svelte-check --tsconfig ./tsconfig.json && tsc --noEmit -p tsconfig.sw.json
1783275004435 START "/home/losses/Development/janbao"
1783275004439 COMPLETED 1443 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

### Lint

Command: `bun run lint`

```
$ prettier --check . && eslint . && bun scripts/ensure-similarity.ts && bin/similarity-ts ./src --types
Checking formatting...
All matched files use Prettier code style!
...
Total similar type pairs found: 52
---EXIT 0
```

The 52 similar-type pairs are pre-existing (none reference the new
`nav-*` types at >=90% duplication). The new resolver functions
`tabDetailResolver` / `tabSearchResolver` show 94.87% function-level
similarity, which is informational only (per CLAUDE.md: "Function-level
similarities are informational - auth guard patterns in API handlers
are intentionally duplicated"). They share the cross-tag axis +
buildFabPlan shape because they ARE the same animation family; the
`header` plan body (the discriminating part) differs.

### Shadow mode (no existing gesture component modified)

Command: `git diff HEAD -- src/lib/components/templates/MobileTabPager.svelte
src/lib/components/templates/GesturePageLayout.svelte
src/lib/actions/swipe.ts src/lib/utils/route-data.ts
src/lib/stores/page-cache.svelte.ts`

```
(empty)
```

No diff against any of the existing gesture components or the Cycle 1
/ Cycle 2 outputs. Shadow mode preserved.

## Deviations

(None yet. The transitory `backParent` field note in the
Architecture-decisions section is expected intermediate state per the
Cycle 1 contract, not a deviation.)

## Carried-to-future items

- Cycle 4: implement the all-rAF executor (Layer 5) that consumes the
  `TransitionPlan.fab` and `TransitionPlan.header` functions per frame.
- Cycle 5: wire the orchestrator's SvelteKit interop hooks
  (`onBeforeNavigate`, `onAfterNavigate`, `onPopState`) into SvelteKit's
  `beforeNavigate` / `afterNavigate`. Cut over from MobileTabPager /
  GesturePageLayout to the new pipeline.
- Cycle 5: with both consumers of `backParent` dissolved, remove the
  field from `RouteData` and the registry.
- Cycle 6: bring `/offline/*` into the unified gesture layer.
- Cycle 4/5 (wrapper hardening, R4 Observation B): `NavStateMachine.onLand`
  schedules a `reset` microtask without canceling any prior pending one.
  Unreachable today (`afterNavigate` fires once per navigation) and the
  reducer is correct; revisit with a cancellation token once the wrapper
  is wired to real SvelteKit events and exercisable by e2e.

## Failures

Per-round audit state lives in `docs/RV20-C03-Audit-{01..NN}.md` (one
file per round the architect runs; R1-R3 reconstructed post-hoc because
the prior orchestrator wrote none at the time, R4 onward real-time).
This section summarizes; the files are the source of truth.

- **Round 1 (architect, 2-auditor): 0/2 PASS.** Eight code-level
  concerns: titleCrossfade reversal render bug (C1), `via` hardcoded
  losing input-source distinction (C2), `resolving` phase declared but
  unreachable (C3), dead `committed` branch / empty if-block (C4), two
  missing preventive tests for `land`-from-at-rest and
  `resolved`-from-committing (C5, C6), `onLand` microtask untestable
  under `bun:test` (C7, nitpick), dead `lerp` (C8). All fixed except C7
  (structural limitation of the runes-free test split). Detailed in
  `docs/RV20-C03-Audit-01.md`.
- **Round 2 (architect, 2-auditor): 0/2 PASS.** Four concerns: `'intent'`
  left in the type but unreachable after R1's C3 fix (C1), missing
  `pointercancel`-from-deciding test (C2), `hasAnySnippet` too coarse
  (C3), misleading SSR docstring (C4). All fixed. Detailed in
  `docs/RV20-C03-Audit-02.md`.
- **Round 3 (architect, 2-auditor): PASS-WITH-CONCERNS / not converged.**
  One blocking concern: `'intent'` had been removed from `MacroPhaseKind`
  to fix R2-C1, violating the spec which mandates it. Restored `'intent'`
  as the produced phase; `'resolving'` reserved for Cycle 5 async. The
  R3 fix also introduced the `reset`-guard regression (caught and fixed
  at R4). Detailed in `docs/RV20-C03-Audit-03.md`.
- **Round 4 (architect, 2-auditor, v2 classification): 0/2 PASS.** Both
  auditors PASS-WITH-CONCERNS, converging on the same two blocking
  concerns: (a) the `MacroPhase` overview docstring was literally false
  (claimed only one of `on`/`sub`/`plan` is populated, but
  `transitioning` co-populates `sub` and `plan`); (b) `interrupt` left
  the abandoned transition's `toPathname`/`toTag`/`direction` in place,
  violating the contract the `intent` branches establish (the wrapper
  exposes `toPathname` as a reactive getter, so a Cycle 5 `$derived`
  would read a stale destination on a re-grab). Both fixed: docstring
  rewritten to the real invariant; `interrupt` now nulls the to-fields
  (FROM preserved). Auditor A also flagged the `stack`-usage code
  comment as a concern (under v2, code comments stay concerns even
  though journal prose is a nitpick): no Cycle-3 resolver reads
  `input.stack`, they read the caller-precomputed `direction`; the
  `nav-resolvers.ts` stack docstrings corrected. Preventive test
  `interrupt clears the abandoned to-fields` added. Nitpicks N2/N3
  (tested-but-unused `cancelled` branch; unused `liveOffset`) and
  Observation B (wrapper `onLand` microtask cancellation) are
  forward-looking, left as-is or carried to Cycle 4/5. Detailed in
  `docs/RV20-C03-Audit-04.md`.
- **Round 5 (architect, 2-auditor, v2 classification): 2/2 PASS.** Both
  auditors PASS with zero concerns. This is the first clean round.
  Auditor A verified shadow mode three ways (git diff, no `nav-*`
  imports in existing gesture components, new layers imported only by
  themselves + tests), the R4 `interrupt`/`reset` fixes with preventive
  tests, resolver purity across all `(fromFab, toFab)` combinations,
  the runes-free test split, and code-comment accuracy. Auditor B
  verified the coordinator snapshot branch requires both
  `toSnapshotCapture` AND `hasToSnippet` (R2-C3 narrowing), dispatch
  bidirectional sharing, and reducer totality. Two nitpicks (both
  fixed): the `bun test src/lib` count drift (397->398 after the R4
  preventive test was added) and the R1 audit file's "87/87 after R1
  fixes" reconstruction drift (corrected to 89/89). Detailed in
  `docs/RV20-C03-Audit-05.md`.

Consecutive pass votes: **2** (R5 was the first round with zero
concerns from both auditors; R1-R4 each had at least one blocking
concern).

## Coverage

The audit covers, at minimum:

- The four new layer files (`nav-intent.ts`, `nav-resolvers.ts`,
  `nav-coordinator.ts`, `nav-state-machine-logic.ts`) plus the reactive
  wrapper (`nav-state-machine.svelte.ts`).
- The four unit suites (`nav-intent.test.ts`,
  `nav-resolvers.test.ts`, `nav-coordinator.test.ts`,
  `nav-state-machine-logic.test.ts`).
- This journal's evidence section: every pasted number must match real
  command output.
- The constraint that no existing gesture component
  (MobileTabPager.svelte, GesturePageLayout.svelte, swipe.ts) is
  modified.
- The TransitionPlan interface's shape (§4).
- The dispatch table mapping every `(from-tag, to-tag)` pair to the
  correct resolver.
- The coordinator's cache-hit vs chip-exit decision.
- The state machine's phase transitions: totality, interruption,
  landing.
