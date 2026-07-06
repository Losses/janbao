# DV20 Cycle 4 Journal

> **Cycle status: COMPLETE (closed 2026-07-06 at R6, 2/2 PASS).** The
> five new Layer-5 files are built in shadow mode, all gates green
> (43/43 unit tests, check 0, lint 0), and the implementation was
> auditor-verified clean across R1-R6. The cycle ran past the
> architect's R5 floor because R3 (missing SSR-gate test) and R5
> (missing `<= 0` branch tests) were substantive missing-test concerns;
> those were closed and R6 confirmed both auditors clean. Per-round
> detail in `docs/RV20-C04-Audit-{01..06}.md`.

Implementation record for CMA4. Per the Cycle Manager Protocol v2 this
journal is written incrementally; it records what actually happened
(investigation, design, files changed, verification evidence,
deviations). It does not perform confidence. The architect runs the
audit independently; this file does not contain audit verdicts.

## Investigation (2026-07-05)

Read in order: `docs/DV20-Meeting/DV20-C04-spec.md`,
`docs/DV20-Meeting/DV20-Cycle-Manager-Protocol-v2.md`,
`docs/DV20-Plan.md` (§2 the pipeline, §5 the executor, §6 phases, §11
protocol v2, §13 values), the Cycle 3 outputs the executor consumes
(`src/lib/utils/nav-resolvers.ts` `TransitionPlan` shape,
`src/lib/stores/nav-state-machine-logic.ts` phase record + interrupt
event, `src/lib/utils/nav-intent.ts` `releaseVelocity`), and
`docs/DV20-C03-Journal.md` for the pure-half / reactive-half pattern
and the `bun:test` runes-free constraint (also in memory:
`bun-test-no-runes-loader`).

### What Cycle 4 must produce (per §5 + the C04 spec)

Layer 5 of the five-layer pipeline, NEW files in shadow mode:

1. The executor module: a single rAF loop driven by the
   orchestrator's phase. Each frame, for each consumer (page track,
   FAB, Header), it calls the active plan's function with the current
   `(progress, liveOffset)` and writes the returned visual through an
   injected DOM driver.
2. The velocity-matched commit integrator: the `committing` sub-phase
   does NOT use a hardcoded ease. It takes the finger's release
   velocity and integrates the remaining distance with a momentum
   integral at that velocity. Variable duration: fast flick = few
   frames; slow release = longer ease. Near-zero release velocity
   falls back to a default ease; very high velocity is clamped.
3. Interruption: a new intent arriving mid-commit cancels the commit
   rAF, and the executor hands off from the current visual state with
   no jump. The executor publishes authoritative state; there is no
   DOM read-back.
4. Reduced motion: when `prefers-reduced-motion: reduce` is set, the
   commit phase snaps (instant translate to target, no rAF
   integration). Non-negotiable.
5. SSR safety + browser-only: the rAF loop is gated by `browser`; the
   SSR render is the resting state. No rAF runs during SSR.

### What Cycle 4 does NOT do (out of scope per the C04 spec)

- The cutover: deleting the CSS transitions / `setTimeout` alignment /
  dual DOM read-backs from MobileTabPager / GesturePageLayout /
  swipe.ts, and wiring the executor to the real DOM. That is Cycle 5.
- The `PageLifecycle` contract. Cycle 5.
- Replacing MobileTabPager / GesturePageLayout. Cycle 5.
- The e2e suite that samples `getComputedStyle` trajectories across
  real gestures. That e2e is meaningful only after the cutover; Cycle
  4 validates with mock-Driver unit tests.

### Key shape constraints (binding)

- The executor talks to an injected `NavDomDriver` interface, so it is
  unit-testable under `bun:test` with a mock driver, no real DOM, no
  runes loader.
- Pure-half / reactive-half split (mirroring Cycles 2-3): the
  integrator + per-frame math live in a runes-free pure module covered
  by `bun:test`; the rAF loop lives in a thin `$state` shell.
- The structural invariant (§5): for any visual property at any
  instant, exactly one rAF write owns its motion, decided solely by
  the orchestrator's phase. No CSS transitions, no `setTimeout`
  alignment in the new code.
- Velocity-matched, not duration-hardcoded (§13.3): the commit
  integrator's duration is a function of release velocity and
  remaining distance, never a fixed `200ms`.
- Reduced-motion snap is non-negotiable (§5): the executor must check
  the media query and snap; it may not rely on CSS transitions.
- No DOM read-back (§13.5): the executor publishes authoritative
  state; no consumer reads from the DOM.
- Comment-accuracy bar (R6-R10 lesson): every code comment in the new
  files describes CURRENT Cycle-4 behavior. Forward-looking (Cycle 5
  wiring) claims are explicitly qualified.

### Architecture decisions for this cycle (CMA4, documented for architect review)

1. **Pure-half + reactive-half split, mirroring Cycle 2/3.** The
   integrator (`sampleFrame`), the commit-duration solver
   (`startCommit`), the visual builder (`buildVisual`), and the
   interruption (`interrupt`) live in `nav-executor-logic.ts` (pure,
   runes-free, unit-tested). The rAF loop, the SSR gate, and the
   driver binding live in `nav-executor.svelte.ts` (thin `$state`
   shell, exercised by Cycle 5 integration).
2. **Momentum integral, not literal spring.** The C04 spec allows
   "critically-damped spring (or equivalent momentum integral)." The
   integrator uses a constant-deceleration momentum integral: the
   duration is set so the initial slope of the ease matches the
   release velocity (`T = 2 * |Δprogress| / |progressVelocity|`,
   clamped). The deceleration curve `s(u) = 2u - u²` over `u ∈ [0,1]`
   has the right shape (s(0)=0, s(1)=1, s'(0)=2, s'(1)=0). This is
   equivalent in feel to a critically-damped spring for the
   commit-and-settle case but easier to reason about and to test the
   velocity-to-duration mapping of.
3. **Driver interface lives in `nav-dom-driver.ts`.** The interface
   `NavDomDriver` declares `write(NavVisualWrite)` and
   `prefersReducedMotion()`. A `MockNavDomDriver` is exported from the
   same file for the unit suite. A real driver (proxying the live
   track / FAB / Header elements) is Cycle 5; in Cycle 4 the only
   implementation is the mock.
4. **No driver read-back method.** §13.5 forbids DOM read-back. The
   executor holds the authoritative `(progress, liveOffset)` in its
   own state record; interruption handoff reads from that record. The
   driver declares only `write` and `prefersReducedMotion`.
5. **Phase kinds local to the executor.** The executor's pure state
   carries its own phase (`'idle' | 'live' | 'committing'`) which is a
   projection of the orchestrator's state, not a subset (`dragging`/
   `scrubbing` -> `'live'`, `committing`/`cancelling` -> `'committing'`;
   outside transitioning the executor rests at `'idle'`). The
   orchestrator's record stays the authority for the broader navigation;
   the executor's local phase tracks only what its rAF loop needs to
   know (whether to sample a commit frame or to idle).
6. **No new eslint-disable, no `as any`, no `as unknown`.** All types
   are named interfaces or named union types per the project lint
   gate. No inline object type literals.

## Design (2026-07-05)

### File layout (all NEW)

- `src/lib/utils/nav-dom-driver.ts` - the DOM-driver interface
  (`NavDomDriver`) + the visual write record (`NavVisualWrite`,
  `PageTrackWrite`, `FabWrite`, `HeaderWrite`) + `MockNavDomDriver`.
- `src/lib/utils/nav-dom-driver.test.ts` - unit suite for the mock.
- `src/lib/utils/nav-executor-logic.ts` - the pure half: executor
  state, drag/commit/interrupt/sampleFrame/buildVisual.
- `src/lib/utils/nav-executor-logic.test.ts` - the unit suite for the
  pure half (uses `MockNavDomDriver`).
- `src/lib/stores/nav-executor.svelte.ts` - the reactive wrapper: rAF
  loop, `browser` gate, driver binding.

### DOM driver shape

```ts
interface NavVisualWrite {
	pageTrack: PageTrackWrite;
	fab: FabWrite;
	header: HeaderWrite;
}
interface PageTrackWrite {
	translateX: number;
}
interface FabWrite {
	scale: number;
	translateY: number;
	visible: boolean;
}
interface HeaderWrite {
	morph: number;
	titleCrossfade: number;
	translateY: number;
}

interface NavDomDriver {
	write(visual: NavVisualWrite): void;
	prefersReducedMotion(): boolean;
}
```

`MockNavDomDriver` records every write in order; `prefersReducedMotion`
is configurable per-test.

### Executor (pure half) shape

```ts
type ExecutorPhase = 'idle' | 'live' | 'committing';

interface ExecutorState {
	phase: ExecutorPhase;
	progress: number; // 0..1
	liveOffset: number; // signed px
	commitStart: CommitStartInfo | null;
}

interface CommitStartInfo {
	progressStart: number;
	progressTarget: number;
	progressVelocity: number; // unit progress / ms (releaseVelocity / distance)
	t0: number; // ms epoch
	durationMs: number;
	reducedMotion: boolean;
}
```

Constants:

- `COMMIT_T_MIN_MS = 100`
- `COMMIT_T_MAX_MS = 600`
- `COMMIT_T_DEFAULT_MS = 300`
- `COMMIT_VELOCITY_EPSILON_PX_PER_MS = 0.05`
- `COMMIT_VELOCITY_CLAMP_PX_PER_MS = 5`

Functions:

- `initialExecutorState()`
- `applyDrag(state, { progress, liveOffset }) -> state` (live phase)
- `startCommit(state, { releaseVelocityPxPerMs, plan, reducedMotion, now }) -> state`
- `interrupt(state) -> state` (cancels commit, preserves progress)
- `sampleFrame(state, plan, now) -> { state, done }` (one commit tick)
- `buildVisual(plan, progress, liveOffset) -> NavVisualWrite`
- `publishFrame(state, plan, driver) -> void`

### Velocity-to-duration mapping

The release velocity is in px/ms. The integrator normalizes to
progress velocity: `progressVelocity = releaseVelocity / distance`
(`distance = |plan.pageTrack.distance|`, with a min of 1 to avoid
divide-by-zero). The commit duration is:

- If `reducedMotion` is true: snap (no integration, phase returns to
  `'idle'` with progress = target).
- If `|releaseVelocity| < EPSILON`: `T = COMMIT_T_DEFAULT_MS` (the
  near-zero fallback ease).
- Else if the velocity points toward the target: `T = 2 * |Δprogress| / |progressVelocity|`,
  clamped to `[COMMIT_T_MIN_MS, COMMIT_T_MAX_MS]`.
- Else (velocity points away from target, e.g. user reversed then
  released): `T = COMMIT_T_DEFAULT_MS` (fall back rather than
  integrate a backward motion).

The release velocity is clamped to `[-CLAMP, +CLAMP]` before use.

### Reduced motion

`startCommit` checks the `reducedMotion` flag (the wrapper obtains it
from `driver.prefersReducedMotion()`). When true, the function returns
a state record with `phase: 'idle'`, `progress: target`, and
`commitStart: null`: no integration runs. The wrapper publishes once
and does not schedule the rAF.

### SSR safety

The reactive wrapper imports `browser` from `$app/environment`. The
rAF scheduler (`#ensureRaf`) is a no-op when `!browser`. The wrapper
has no other DOM access; the driver is the only DOM touchpoint, and
the mock driver used in unit tests does not touch the DOM either.

### Reactive wrapper shape

```ts
class NavExecutor {
	#state = $state<ExecutorState>(initialExecutorState());
	#plan: TransitionPlan | null = null;
	readonly #driver: NavDomDriver;
	readonly #now: () => number;
	#rafId: number | null = null;
	// ...
}
```

Boundary methods (Cycle 5 wiring; no Cycle 4 caller):

- `onDragStart(plan, progress, liveOffset)`
- `onDragMove(progress, liveOffset)`
- `onCommit(releaseVelocityPxPerMs)`
- `onCancel(releaseVelocityPxPerMs)` (mirrors onCommit; the plan's
  `progressDirection` carries the cancel-vs-commit distinction)
- `onInterrupt()`
- `onLand()`

The rAF callback `#tick` is a single arrow-function: it samples one
frame, publishes, and either reschedules or stops. The state machine
guarantees only one rAF is in flight at a time.

## Implementation log

### 2026-07-05 - DOM-driver interface + mock built

`src/lib/utils/nav-dom-driver.ts`: `NavDomDriver` interface with
`write(NavVisualWrite)` and `prefersReducedMotion()`. The visual write
record decomposes into `PageTrackWrite { translateX }`, `FabWrite`,
`HeaderWrite` (mirroring the resolver's `FabVisual` / `HeaderVisual`).
The mock `MockNavDomDriver` records every write in order and exposes a
mutable reduced-motion flag.

`src/lib/utils/nav-dom-driver.test.ts`: 7 tests covering the mock's
recording semantics and the configurable / mutable reduced-motion flag.

### 2026-07-05 - Pure-half executor logic built

`src/lib/utils/nav-executor-logic.ts`: `ExecutorState` + the five pure
functions (`applyDrag`, `startCommit`, `interrupt`, `sampleFrame`,
`buildVisual`) plus the duration solver (`solveCommitDuration`) and the
publish convenience (`publishFrame`, `tickFrame`). Five tuning
constants (`COMMIT_T_MIN_MS`, `COMMIT_T_MAX_MS`, `COMMIT_T_DEFAULT_MS`,
`COMMIT_VELOCITY_EPSILON_PX_PER_MS`, `COMMIT_VELOCITY_CLAMP_PX_PER_MS`).

The momentum integral: `s(u) = 2u - u²` (constant-deceleration ease).
Duration solver: `T = 2 * |Δprogress| / |progressVelocity|` (matched
to the release velocity via the ease's initial slope `s'(0) = 2`),
clamped to `[T_MIN, T_MAX]`. Near-zero velocity (`|v| < EPSILON`) and
wrong-direction velocity fall back to `T_DEFAULT`. Reduced motion snaps
(no integration).

### 2026-07-05 - Pure-half unit suite built

`src/lib/utils/nav-executor-logic.test.ts`: 36 tests across nine
describe blocks: `buildVisual` (axis sign convention, FAB/Header
pass-through), `initialExecutorState + applyDrag`, `solveCommitDuration`
(velocity-to-duration mapping: near-zero fallback, fast < slow, clamp
ceiling, clamp floor, wrong-direction fallback, sign preservation,
cancel plan), `startCommit` (snap paths, momentum path, metadata
matches solver), `sampleFrame` (no-op outside committing, t0 and
t0+duration sampling, post-duration clamp, monotonicity forward and
backward, ease-curve midpoint), `publishFrame + tickFrame`,
interruption handoff (no-jump visual continuity), reduced-motion end-
to-end through the executor.

### 2026-07-05 - Reactive shell built

`src/lib/stores/nav-executor.svelte.ts`: `NavExecutor` class. Holds
`$state<ExecutorState>` + `$state<TransitionPlan | null>`. Boundary
methods `onDragStart` / `onDragMove` / `onCommit` / `onCancel` /
`onInterrupt` / `onLand` (and a `stop` for unexpected teardown). The
rAF callback `#tick` is a single arrow function that samples one
commit frame and either reschedules or stops. `#ensureRaf` is gated by
`browser` from `$app/environment` (SSR safety). The wrapper queries
the driver once at commit start for `prefersReducedMotion()` and
short-circuits the rAF for the snap path.

The shell uses `$state` and is NOT exercised by `bun:test` (per the
`bun-test-no-runes-loader` memory). It is exercised by the unit suite
for the pure half via the shell's delegate functions; the shell itself
is Cycle 5's integration-test surface.

### 2026-07-05 - Docstring sweep (post-implementation)

Two accuracy corrections found by reading every docstring against the
code (the R6-R10 lesson applied before report):

- `defaultNow` initially claimed `performance.now()` "matches the
  gesture-detection code in `swipe.ts`". Verified by grep:
  `swipe.ts` uses `event.timeStamp` (the DOM event timestamp), not
  `performance.now()`. Reworded to state the actual reason
  (high-resolution, monotonic) and to qualify the Cycle 5 time-base
  unification.
- `activePlan` getter initially said the plan is "cleared by `onLand`"
  but `stop` also clears it. Reworded to "cleared by `onLand` and by
  `stop`".

## Verification

### Unit tests (the two new suites)

Command: `bun test src/lib/utils/nav-dom-driver.test.ts
src/lib/utils/nav-executor-logic.test.ts`

```
bun test v1.3.13 (bf2e2cec)

 43 pass
 0 fail
 141 expect() calls
Ran 43 tests across 2 files. [40ms]
```

Per-file: `nav-dom-driver.test.ts` 7 pass / 0 fail; `nav-executor-
logic.test.ts` 36 pass / 0 fail.

### All src/lib unit tests (regression check)

Command: `bun test src/lib`

```
442 pass
 0 fail
1935 expect() calls
Ran 442 tests across 27 files. [1.80s]
```

399 pre-existing + 43 new = 442. No regressions in the existing suites.

### Typecheck

Command: `bun run check`

```
$ svelte-kit sync && svelte-check --tsconfig ./tsconfig.json && tsc --noEmit -p tsconfig.sw.json
1783300027973 START "/home/losses/Development/janbao"
1783300027976 COMPLETED 1448 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

### Lint

Command: `bun run lint`

```
$ prettier --check . && eslint . && bun scripts/ensure-similarity.ts && bin/similarity-ts ./src --types
Checking formatting...
All matched files use Prettier code style!
...
Total similar type pairs found: 55
---EXIT 0
```

The similarity-ts gate reports 55 similar-type pairs (up from 52 in
Cycle 3) and exits 0 (type duplicates = 0; the 55 are informational
similar-pairs, not gate failures). Three of the new pairs reference
Cycle 4 types:

- `HeaderVisual` (`nav-resolvers.ts`) vs `HeaderWrite`
  (`nav-dom-driver.ts`) 96%: parallel field shape (morph,
  titleCrossfade, translateY). Intentional: the resolver produces
  HeaderVisual (Layer 3 output), the driver consumes HeaderWrite
  (Layer 5 input), and the executor copies field-by-field. They are
  conceptually different layers and may diverge once Cycle 5 wires
  the real driver. Unifying would couple Layer 3 to Layer 5.
- `FabVisual` (`nav-resolvers.ts`) vs `FabWrite` (`nav-dom-driver.ts`)
  94.67%: same rationale.
- `DragUpdate` (`nav-executor-logic.ts`) vs `PlanCallRecord`
  (`nav-executor-logic.test.ts`) 93.14%: a test-fixture mirroring an
  internal input shape (both have `{ progress, liveOffset }`); not a
  production duplication.

### Shadow mode (no existing gesture component modified)

Command: `git diff HEAD --stat -- src/lib/components/templates/MobileTabPager.svelte
src/lib/components/templates/GesturePageLayout.svelte
src/lib/actions/swipe.ts src/lib/utils/route-data.ts
src/lib/stores/page-cache.svelte.ts src/lib/utils/nav-resolvers.ts
src/lib/stores/nav-state-machine-logic.ts src/lib/utils/nav-intent.ts
src/lib/utils/nav-coordinator.ts`

```
(empty)
```

No diff against any existing gesture component or any Cycle 1/2/3
output. Shadow mode preserved.

The only working-tree changes outside the new Cycle 4 files are two
pre-existing edits by the architect (closing out Cycle 3):
`docs/DV20-C03-Journal.md` (added the "Cycle status: COMPLETE" banner)
and `docs/DV20-Meeting/DV20-C03-spec.md` (status line). Those are not
my edits and are not in scope for Cycle 4.

## Deviations

(None. The implementation follows the C04 spec as written: shadow
mode, pure-half / reactive-half split, velocity-matched momentum
integral with near-zero fallback and high-velocity clamp, reduced-
motion snap, SSR gate, no DOM read-back.)

## Carried-to-future items

- Cycle 5: implement the real `NavDomDriver` (proxies track / FAB /
  Header elements) and wire the orchestrator's phase events to the
  `NavExecutor` boundary methods.
- Cycle 5: delete the CSS transitions, the three `setTimeout`
  alignment sites, and the dual DOM read-backs from
  MobileTabPager / GesturePageLayout / swipe.ts at the cutover.
- Cycle 5: choose a single time base for the rAF tick and the intent
  classifier's clock (the executor's `now()` and the classifier's
  clock currently have independent defaults).
- Cycle 5: the e2e suite that samples `getComputedStyle` trajectories
  across real gestures, exercising the executor end-to-end through
  the real driver.
- Cycle 5: with the cutover landed, reconsider the `commitPhysics:
'snap'` field on `TransitionPlan`. The resolver currently selects
  it from `reducedMotion`; the executor also reads `reducedMotion`
  from the driver. After Cycle 5 the two paths are exercised
  together and may collapse.

## Failures

Per-round audit state lives in `docs/RV20-C04-Audit-{01..NN}.md` (one
file per round the architect runs). This section is populated as the
architect's audit proceeds; the CMA does not run its own audit
(conflict of interest per the v2 protocol).

- **Round 1 (architect, 2-auditor, v2 no-borderline): 0/2 PASS.** Both
  auditors FAIL. Five unique code-comment concerns (one,
  `setReducedMotion`, flagged by both). Auditor B: `FrameSample.done`
  docstring claimed the shell emits `onLand` at settle (it does not;
  the Cycle-5 orchestrator does). Auditor A: `NavExecutorClockFn`
  docstring said "epoch milliseconds" but the browser default is
  `performance.now()` (DOMHighResTimeStamp, not epoch); `clear()`
  docstring claimed cross-sub-test driver reuse that does not exist;
  `tickFrame` docstring claimed it drives the per-frame sequence (it is
  a single-step convenience; the sequence tests use `sampleFrame` in a
  loop); plus the same `setReducedMotion` overclaim. All five fixed.
  Two journal nitpicks also fixed: the unit-suite describe-block count
  (six -> eight) and the executor phase mapping (`scrubbing` -> `'live'`,
  not `'idle'`). The implementation itself was verified clean: shadow
  mode, the velocity-matched integrator math, reduced-motion snap,
  interruption handoff, SSR gate, no DOM read-back, all pasted numbers.
  Detailed in `docs/RV20-C04-Audit-01.md`.
- **Round 2 (architect, 2-auditor, v2 no-borderline): 0/2 PASS.** Both
  auditors FAIL. Two unique code-comment concerns; `defaultNow` flagged
  by both. Auditor A also flagged `CommitStartInfo.reducedMotion`
  (claimed the integrator branches on it / carried for diagnostics;
  actually always `false`, never read). The `defaultNow` docstring said
  it "falls back to `Date.now()` in SSR" but `performance` is defined
  in every shipped runtime (Bun/Node/Workers/workerd), so that branch
  is dead - contradicting the R1-corrected `NavExecutorClockFn`
  docstring above it. Both fixed. The implementation logic was again
  verified clean by both auditors (integrator math, structural
  invariant, reduced-motion snap, interruption, SSR gate, no DOM
  read-back, shadow mode, all 18 Cycle-5 references qualified). Detailed
  in `docs/RV20-C04-Audit-02.md`.
- **Round 3 (architect, 2-auditor, v2 no-borderline): 0/2 PASS.** Four
  unique concerns. Three code-comment accuracy (auditor A: the wrong-
  direction fallback comment said "the cancel" but the branch is plan-
  agnostic; auditor B: the `state`/`progress` getter docstrings use
  present-tense "Consumers read" with no Cycle-4 qualifier, and the test
  header labelled the idle no-op as "SSR"). One substantive (auditor B):
  the spec lists "SSR gate" as a unit-test deliverable but the gate
  lived only in the reactive shell's `#ensureRaf` (untestable under
  `bun:test`). Fixed all four; the SSR-gate fix extracted a pure
  `shouldScheduleRaf(isBrowser, rafInFlight)` helper into the logic file
  (mirroring `solveCommitDuration`'s extract-to-test pattern) and added
  a four-case test. Auditor divergence: A read the SSR-gate gap as a
  spec-internal nitpick; B read it as a blocking missing-deliverable
  concern - B is binding (the spec explicitly lists it). The
  implementation logic was again verified clean by both auditors.
  Detailed in `docs/RV20-C04-Audit-03.md`.
- **Round 4 (architect, 2-auditor, v2 no-borderline): 0/2 PASS.** Six
  unique code-comment / test-name concerns (three per auditor, no
  overlap), all in the docstring-precision class - no substantive logic
  or test-coverage issues. Auditor A: `ExecutorPhase` ("strict subset" -
  false, it is a projection), `ExecutorState` and `NavExecutor` class
  docstrings (present-tense "consumers read" / "drives it from the
  orchestrator"). Auditor B: the `interrupt` docstring (present-tense
  "the orchestrator continues from here"); the `solveCommitDuration`
  wrong-direction comment (under-described the `<= 0` branch - omitted
  the `directionSign === 0` / already-at-target case and the
  load-bearing `<=` vs `<` choice, verified empirically: progress at
  target -> 300ms not 100ms); the "visual continuity" test name
  (overclaimed - only `pageTrack.translateX` asserted). All six fixed.
  Per the architect's directive the cycle runs to at least R5 (R3's
  missing-test was "lethal"; no early closure). The implementation logic
  was again verified clean by both auditors. Detailed in
  `docs/RV20-C04-Audit-04.md`.
- **Round 5 (architect, 2-auditor, v2 no-borderline): split, not
  clean.** Auditor A PASS; auditor B FAIL with two missing-test
  concerns. Both were gaps in coverage of the `solveCommitDuration`
  `<= 0` branch that R4 had documented but not tested: the
  already-at-target case (`directionSign === 0`, `deltaProgress === 0`)
  and the reversed-cancel-velocity case (`progressDirection: 1` with
  positive release velocity). The "load-bearing `<=`" doc claim was
  unenforceable without a test (a `<=` -> `<` edit would silently route
  at-target from `T_DEFAULT` 300ms to the solve's `T_MIN` 100ms). Added
  both tests (`progress already at target ...`; `reversed cancel
velocity ...`). Auditor divergence: A judged existing coverage
  sufficient; B wanted the two explicit cases - B is binding under the
  rigor directive (a documented load-bearing branch edge needs a pinning
  test). The implementation logic was again verified clean. Detailed in
  `docs/RV20-C04-Audit-05.md`.
- **Round 6 (architect, 2-auditor, v2 no-borderline): 2/2 PASS.** Both
  auditors PASS with zero concerns - the first clean round, on the
  post-R5-fix state. Both explicitly verified the three trigger cases of
  the `<= 0` branch are now pinned by tests, the integrator math
  (auditor B probed it numerically), the structural invariant,
  reduced-motion snap, interruption, the SSR + single-flight gate, no
  DOM read-back, shadow mode, and every docstring accurate to Cycle-4
  behavior. Detailed in `docs/RV20-C04-Audit-06.md`.

Consecutive pass votes: **2** (R6 is the first round with zero concerns
from both auditors; R1-R5 each carried at least one concern, with R3
and R5 carrying substantive missing-test concerns).

## Cycle closure (2026-07-06, R6)

Cycle 4 is COMPLETE. The architect required running past R5 (R3's
missing SSR-gate test was "lethal" - a substantive spec-deliverable
gap, not docstring precision). The cycle ran to R6 and converged there:
R5 surfaced two further missing tests (the `<= 0` branch's at-target
and reversed-cancel cases, which R4 had documented but not tested);
those were added, and R6 confirmed both auditors clean. The cycle
closed on a genuine clean round (2/2 PASS) after the substantive gaps
were closed - not on an early-close shortcut. The implementation logic
was auditor-verified clean across R1-R6; the concerns that extended the
loop were docstring precision (R1, R2, R4) plus the two substantive
missing-test rounds (R3 SSR gate, R5 `<= 0` cases).

## Coverage

The audit covers, at minimum:

- The five new Cycle 4 files (`nav-dom-driver.ts`,
  `nav-dom-driver.test.ts`, `nav-executor-logic.ts`,
  `nav-executor-logic.test.ts`, `nav-executor.svelte.ts`).
- This journal's evidence section: every pasted number matches real
  command output.
- The constraint that no existing gesture component
  (MobileTabPager.svelte, GesturePageLayout.svelte, swipe.ts) or any
  Cycle 1/2/3 output is modified.
- The `NavDomDriver` interface's shape and the no-read-back invariant
  (§13.5).
- The `ExecutorState` shape and the local-phase subset invariant
  (idle / live / committing vs the orchestrator's sub-phases).
- The velocity-to-duration mapping: near-zero fallback, high-velocity
  clamp, wrong-direction fallback, fast < slow ordering.
- The reduced-motion snap path (no integration; progress jumps to
  target).
- The per-frame sample sequence: monotonicity, ease-curve shape,
  settle to target.
- The interruption handoff (no jump): visual continuity across
  interrupt -> new live drag.
- The SSR gate (`#ensureRaf` is a no-op when `!browser`).
- The comment-accuracy bar (R6-R10 lesson): every docstring describes
  current Cycle-4 behavior; Cycle 5 references are explicitly
  qualified.
