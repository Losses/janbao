# DV20 Cycle 5a Journal

> **Cycle status: in progress.** Building the PageLifecycle contract and
> the real NavDomDriver in shadow mode. Per the Cycle Manager Protocol
> v2 this journal is written incrementally; it records what actually
> happened (investigation, design, files changed, real command outputs,
> deviations). It does not perform confidence. The architect runs the
> audit independently; this file does not contain audit verdicts.

Implementation record for CMA5a. Per the Cycle Manager Protocol v2
(`docs/DV20-Meeting/DV20-Cycle-Manager-Protocol-v2.md`) this journal
is written incrementally with real evidence pasted verbatim. Round
audit files will live at `docs/RV20-C05a-Audit-{01..NN}.md` (the
Coverage bullets point there, not at in-flight counts).

## Investigation (2026-07-06)

Read in order, per the CMA prompt:

1. `docs/DV20-Meeting/DV20-C05a-spec.md` (the spec for this cycle).
2. `docs/DV20-Meeting/DV20-Cycle-Manager-Protocol-v2.md` (v2, binding).
3. `docs/DV20-Plan.md` §8 (Page lifecycle contract), §9 (SvelteKit
   interop, nested pagers, edge cases), §13.5 (the state machine is
   the only authority; consumers do not read back from the DOM).
4. Cycle 4 outputs the cycle depends on:
   - `src/lib/utils/nav-dom-driver.ts` for the `NavDomDriver`
     interface and the `NavVisualWrite` / `PageTrackWrite` /
     `FabWrite` / `HeaderWrite` records.
   - `src/lib/stores/nav-executor.svelte.ts` for the executor that
     consumes a driver (constructor takes `NavExecutorOptions.driver`;
     boundary methods are shadow-mode no-ops until 5b wires them).
5. The existing refcount template `src/lib/stores/viewport-lock.svelte.ts`
   (memory: `viewport-lock-refcount-pattern`) and the SSR trap
   context (memory: `svelte-ondestroy-runs-in-ssr`).

### What Cycle 5a must produce (per the C05a spec)

Two NEW modules in shadow mode:

1. A `PageLifecycle` module: the four-phase `mount` / `activate` /
   `deactivate` / `unmount` contract; a controller that owns the
   phase transitions totally (every transition defined, out-of-sequence
   calls are no-ops or defined); the refcount-with-microtask-deferral
   helper (template for any html-singleton class); and an SSR-safe
   `unmount` that is the SINGLE teardown path (no `onDestroy` for
   html-singleton removal).
2. A real `NavDomDriver` implementation: implements the Cycle-4
   `NavDomDriver` interface (`write(NavVisualWrite)` +
   `prefersReducedMotion()`), proxying the live page-track / FAB /
   Header element refs and reading
   `matchMedia('(prefers-reduced-motion: reduce)')`.

Plus unit tests for each, runnable under `bun:test`.

### What Cycle 5a does NOT do (out of scope per the C05a spec)

- Wiring the lifecycle, executor, or real driver into actual routes /
  layouts. That is 5b.
- Cutting over `MobileTabPager` / `GesturePageLayout` / `swipe.ts` /
  `DualColumnLayout` to the unified state-driven track. That is 5b.
- Refactoring the lifecycle-adjacent stores (`viewport-lock`,
  `scroll-chrome`, `active-gesture-track`, `page-scroll`) into
  lifecycle hooks. That is 5b.
- Removing `backParent` from `RouteData`. That is 5b.
- The e2e suite that samples `getComputedStyle` trajectories. That is 5c.
- Git mutation.

### Key shape constraints (binding)

- **Shadow mode.** No wiring into any route/layout/executor; no
  modification of the existing gesture components or the
  lifecycle-adjacent stores. The two new modules stand alone,
  exercised only by their unit suites.
- **Testability.** The lifecycle phase machine is pure (or pure-half
  split, mirroring Cycles 2 to 4). The real driver is tested with
  stub elements (plain objects with a style bag) and an injectable
  element-resolver / matchMedia, so no real DOM is required.
- **Refcount microtask deferral invariant.** An html-singleton class
  is added on the first ref and removed on a microtask after the last
  ref, so a same-tick remove + add does not flicker. The microtask
  re-checks the count and cancels the removal if a same-tick acquire
  landed.
- **SSR safety.** `unmount` is the single teardown path. `onDestroy`
  is not used for html-singleton removal. The lifecycle's teardown
  path is browser-gated.
- **Comment-accuracy bar (R-cycles lesson).** Every code comment in
  the new files describes CURRENT Cycle-5a behavior. Forward-looking
  (5b wiring) claims are explicitly qualified. Read every docstring
  against the code before reporting done; cross-check the
  Deliverables list against the implementation; a documented
  load-bearing branch edge has a pinning test.

### Architecture decisions for this cycle (documented for architect review)

1. **Pure-half + reactive-half split, mirroring Cycles 2 to 4.** The
   phase reducer, the refcount-deferral logic, and the SSR unmount
   planner live in `src/lib/utils/page-lifecycle-logic.ts` (runes-free,
   unit-tested under `bun:test`). The reactive shell
   `src/lib/stores/page-lifecycle.svelte.ts` holds the controller's
   `$state<PageLifecycleState>` and the registered teardowns, and
   delegates every transition to the pure reducer. The shell itself
   is not unit-tested under `bun:test` (it uses `$state`; per the
   `bun-test-no-runes-loader` memory the runes loader is unavailable
   there); its logic is covered by the pure half.
2. **The `HtmlSingletonClassController` lives in the pure half.** It
   does not need `$state`; the deferral logic is testable in
   isolation. The controller takes an injectable `HtmlClassApplier`
   and `MicrotaskScheduler` so the unit suite drives the microtask
   deterministically with a capturing stub, AND verifies the
   real-`queueMicrotask` path with an `await Promise.resolve()`
   flush. The default applier / scheduler are SSR-safe and exercised
   by the suite.
3. **SSR guard on `unmount`, exposed as a pure `planUnmount` helper.**
   `planUnmount(state, isBrowser)` returns
   `{runTeardowns, nextState}`. The reactive shell's `unmount` calls
   this with the `browser` flag from `$app/environment` and applies
   the result. The phase transition always runs; the registered
   teardowns run only when `isBrowser` is true. This makes `unmount`
   safe to wire to Svelte's `onDestroy` in 5b without re-introducing
   the SSR trap (memory: `svelte-ondestroy-runs-in-ssr`), because the
   teardown work itself is gated.
4. **Real driver writes everything via `style.setProperty`.** Page
   track transform, FAB transform / visibility, and Header
   transform + CSS custom properties (`--header-morph`,
   `--header-title-crossfade`) all flow through `setProperty` so the
   stub style is a single-method capture (no need to intercept
   direct named-property writes). The Header structural type
   (`DriverElement` with a `style: DriverElementStyle`) matches both
   `HTMLElement` (production) and the test stub, mirroring the
   LexicalEditor structural-type pattern from the architecture note.
5. **Element-resolver called per `write`.** The driver is constructed
   with a `resolveElements` callback invoked each frame so a fresh
   `bind:this` reference (re-mount, tab swap) is picked up
   automatically. No `setElements` API surface. This matches how
   Svelte's `bind:this` element identity can change across navigations.
6. **No HMR `import.meta.hot.dispose` in either new module.** The
   controller and the html-singleton controller are instance-scoped
   (constructed per layout that owns them); a module-level HMR
   disposal would be redundant with the per-instance teardown in 5b.
   The existing `viewport-lock.svelte.ts` uses HMR disposal because
   it is a module singleton; the new helpers are not.

### Files planned

- `src/lib/utils/page-lifecycle-logic.ts` (NEW, pure).
- `src/lib/utils/page-lifecycle-logic.test.ts` (NEW, bun:test).
- `src/lib/stores/page-lifecycle.svelte.ts` (NEW, reactive shell).
- `src/lib/utils/nav-dom-driver-live.ts` (NEW, real driver).
- `src/lib/utils/nav-dom-driver-live.test.ts` (NEW, bun:test).

No modification of:

- `src/lib/components/templates/MobileTabPager.svelte`.
- `src/lib/components/templates/GesturePageLayout.svelte`.
- `src/lib/components/templates/swipe.ts` (path approximate).
- `DualColumnLayout` and its callers.
- `src/lib/stores/viewport-lock.svelte.ts`.
- `src/lib/stores/scroll-chrome.svelte.ts`.
- `src/lib/stores/active-gesture-track.svelte.ts`.
- `src/lib/stores/page-scroll.svelte.ts` (if present).
- `src/lib/utils/nav-dom-driver.ts` (the interface is unchanged).
- `src/lib/stores/nav-executor.svelte.ts` (consumer is unchanged).
- Any route or layout.

## Implementation log

(Updated incrementally as files land.)

### Pre-flight environment probe (2026-07-06)

Verified the bun runtime globals so the SSR-safety tests are honest:

```
$ bun -e "console.log('typeof window:', typeof window); ..."
typeof window: undefined
typeof document: undefined
typeof matchMedia: undefined
typeof queueMicrotask: function
typeof performance: object
```

`window`, `document`, and `matchMedia` are all undefined under bun, so
the default `matchMedia` and the default `HtmlClassApplier` exercise
their SSR fallback paths directly in the unit suite.

### Baseline gates (before any new code)

```
$ bun run check
1783317575289 START "/home/losses/Development/janbao"
1783317575295 COMPLETED 1448 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ bun run lint; echo EXIT: $?
EXIT: 0
(similarity-ts informational pairs: 55, baseline)

$ bun test src/lib/utils/nav-dom-driver.test.ts src/lib/utils/nav-executor-logic.test.ts
 43 pass
 0 fail
 141 expect() calls
Ran 43 tests across 2 files. [38.00ms]
```

All baseline gates green before the new code lands.

### Files landed (2026-07-06)

In this order:

1. `src/lib/utils/page-lifecycle-logic.ts` (NEW, pure). Exports:
   `PagePhase`, `PageLifecycleEvent`, `PageLifecycleState`,
   `initialLifecycleState`, `reduce` (the total reducer);
   `RefcountState`, `initialRefcountState`, `RefcountEffect`,
   `RefcountTransition`, `acquireRef`, `releaseRef`,
   `RefcountSettleResult`, `settleRefcountRemoval` (the pure
   refcount helpers); `HtmlClassApplier`, `MicrotaskScheduler`,
   `defaultMicrotaskScheduler`, `defaultHtmlClassApplier`,
   `HtmlSingletonClassController` (the live controller with injectable
   applier + scheduler); `UnmountPlan`, `planUnmount` (the SSR-safe
   unmount planner).
2. `src/lib/stores/page-lifecycle.svelte.ts` (NEW, reactive shell).
   Exports `PageLifecycleController`. Holds `$state<PageLifecycleState>`,
   delegates every transition to `reduce`, holds the registered
   teardowns, calls `planUnmount` in `unmount` to gate them on
   `isBrowser`.
3. `src/lib/utils/nav-dom-driver-live.ts` (NEW, real driver). Exports
   `DriverElementStyle`, `DriverElement`, `LiveDriverElements`,
   `LiveDriverElementResolver`, `LiveDriverMatchMediaResult`,
   `LiveDriverMatchMedia`, `LiveNavDomDriverOptions`,
   `REDUCED_MOTION_QUERY`, `LiveNavDomDriver`. Implements the Cycle-4
   `NavDomDriver` interface; writes through `style.setProperty` so a
   single-method stub captures every write.
4. `src/lib/utils/page-lifecycle-logic.test.ts` (NEW, bun:test). 48
   tests across the reducer, the pure refcount helpers, the live
   controller with stub scheduler, the live controller with real
   `queueMicrotask`, the default applier / scheduler sanity, and the
   SSR unmount planner.
5. `src/lib/utils/nav-dom-driver-live.test.ts` (NEW, bun:test). 22
   tests across page-track translateX (sign + magnitude, axis chain),
   FAB (scale + translateY + visibility, visible true/false, scale=0),
   Header (transform + morph + titleCrossfade), null-element skip,
   per-write resolver behavior, re-bind scenario, partial bind,
   reduced-motion read (matches true/false, exact query string, SSR
   fallback), REDUCED_MOTION_QUERY pinning.

No tracked file modified. Verified by `git status`:

```
$ git status --short
?? docs/DV20-C05a-Journal.md
?? docs/DV20-Meeting/DV20-C05a-spec.md
?? src/lib/stores/page-lifecycle.svelte.ts
?? src/lib/utils/nav-dom-driver-live.test.ts
?? src/lib/utils/nav-dom-driver-live.ts
?? src/lib/utils/page-lifecycle-logic.test.ts
?? src/lib/utils/page-lifecycle-logic.ts
```

Shadow-mode check: a repo-wide grep for any of the new symbols
(`page-lifecycle`, `nav-dom-driver-live`, `LiveNavDomDriver`,
`PageLifecycleController`, `HtmlSingletonClassController`) outside the
new files returns no matches. No route, layout, executor, or
gesture-component file imports the new modules. The existing
`MobileTabPager.svelte`, `GesturePageLayout.svelte`, `swipe.ts`,
`DualColumnLayout`, and the lifecycle-adjacent stores
(`viewport-lock`, `scroll-chrome`, `active-gesture-track`,
`page-scroll`) are unchanged.

### Deviations from the spec

None. The spec's "e.g." file paths are followed verbatim. The
pure-half / reactive-half split mirrors Cycles 2 to 4. The refcount
helper is a single class (`HtmlSingletonClassController`) parameterized
by an
injectable applier and scheduler (defensive depth: both the controller
and the default applier gate on `typeof document` / `typeof window`).

One comment-accuracy iteration worth recording (matches the R-cycles
lesson): the initial draft of `defaultMicrotaskScheduler`'s docstring
said "this scheduler only fires in the browser", which is wrong for
Cycle 5a because the unit suite fires it under the bun runtime. The
final wording describes both current uses (the bun:test suite + the
future 5b effect-callback invocation). The `registerTeardown`
docstring was likewise reworded from "Replaces the per-call ... pattern
used by the existing ... stores" (which read as a past-tense
replacement) to a description of the current API's gating behavior plus
an explicitly qualified 5b migration note.

### Verification (final gates)

```
$ bun run check
$ svelte-kit sync && svelte-check --tsconfig ./tsconfig.json && tsc --noEmit -p tsconfig.sw.json
1783318510581 START "/home/losses/Development/janbao"
1783318510584 COMPLETED 1453 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ bun run lint; echo EXIT: $?
(similarity-ts informational pairs: 55, baseline)
EXIT: 0

$ bun test src/lib/utils/page-lifecycle-logic.test.ts src/lib/utils/nav-dom-driver-live.test.ts
bun test v1.3.13 (bf2e2cec)

 70 pass
 0 fail
 144 expect() calls
Ran 70 tests across 2 files. [34.00ms]
```

Transitively-touched DV20 suites (no regressions):

```
$ bun test src/lib/utils/nav-coordinator.test.ts src/lib/utils/nav-intent.test.ts \
           src/lib/stores/nav-state-machine-logic.test.ts \
           src/lib/utils/nav-dom-driver.test.ts src/lib/utils/nav-executor-logic.test.ts \
           src/lib/utils/page-lifecycle-logic.test.ts src/lib/utils/nav-dom-driver-live.test.ts
bun test v1.3.13 (bf2e2cec)

 174 pass
 0 fail
 420 expect() calls
Ran 174 tests across 7 files. [42.00ms]
```

(70 new + 104 pre-existing across the DV20 touched files.)

### Docstring sweep (R-cycles bar)

Re-read every docstring in every new file against the code, post-format
and post-edit. Each comment describes current Cycle-5a behavior or is
explicitly qualified with "In Cycle 5b". Specific items verified:

- `PagePhase` field descriptions match `docs/DV20-Plan.md` §8 verbatim.
- `reduce` arm descriptions match each `case` in the switch.
- `acquireRef` / `releaseRef` / `settleRefcountRemoval` docstrings
  match each branch.
- `HtmlSingletonClassController.acquire` / `release` docstrings match
  the method bodies.
- `planUnmount` docstring matches the implementation; the SSR-safe
  single-teardown-path claim is supported by the `runTeardowns: false`
  branch test.
- `LiveNavDomDriver.write`'s page-track comment ("the driver applies
  the value as given; it does not recompute the sign") is supported by
  the `axis -> sign chain end-to-end` tests, which compute the sign
  outside the driver and assert the driver writes the value as given.
- `LiveNavDomDriver.write`'s Header comment was reworded to NOT claim a
  current consumer ("A Header consumer that reads these ... is a Cycle
  5b wiring detail; in Cycle 5a shadow mode the values are written but
  no consumer reads them").
- `PageLifecycleController.registerTeardown`'s comment was reworded to
  describe the current API's gating behavior plus a qualified 5b note.

## Failures

Per-round audit state lives in `docs/RV20-C05a-Audit-{01..NN}.md`. This
section summarizes; the files are the source of truth.

- **Round 1 (architect, 2-auditor, v2 no-borderline): split, not
  clean.** Auditor A PASS; auditor B FAIL with one code-comment concern.
  B: the `planUnmount` docstring said "even when the surrounding
  lifecycle hook runs in SSR," but in Cycle 5a there is no surrounding
  lifecycle hook (only the controller's `unmount` method and the unit
  suite; the Svelte lifecycle hook is Cycle-5b wiring) - a forward-
  looking present-tense claim without a Cycle-5a qualifier. Fixed: the
  docstring now states the current Cycle-5a callers, the `isBrowser`
  gate mechanism, and the Cycle-5b wiring as an explicitly qualified
  forward-looking claim. Both auditors also flagged the journal's
  per-file test counts (47/23; actual 48/22 - the total 70 matched
  because the errors cancelled) and A flagged the pasted `git status`
  omitting the spec file; both corrected. The implementation invariants
  were verified clean by both (lifecycle totality, refcount
  microtask-deferral same-tick cancel, SSR single-teardown-path, real
  driver write mapping, shadow mode). Detailed in
  `docs/RV20-C05a-Audit-01.md`.
- **Round 2 (architect, 2-auditor, v2 no-borderline): split, not
  clean.** Auditor A PASS; auditor B PASS-WITH-CONCERNS with one
  code-comment concern. B: the `#isBrowser` field docstring said "this
  field is exercised only by the integrated pipeline," but in Cycle 5a
  the controller is never constructed (no Svelte importer; the unit
  suite cannot load `$state` under `bun:test`), so the field is
  exercised by nothing - same forward-looking-present-tense pattern as
  R1's `planUnmount`. Fixed: now states no caller constructs the
  controller in 5a; the integrated pipeline (5b) will exercise it. The
  post-R2 proactive sweep of all five new files found one more instance
  (the class docstring "for consumers to read" lacked the qualifier the
  `phase` getter had); fixed. Other present-tense hits verified
  accurate (the `settleRefcountRemoval` "the caller applies the effect"
  is the pure helper's contract with its existing caller; the
  `defaultMatchMedia` "exercised by the unit suite" is a true bun-runtime
  statement). The implementation invariants were verified clean by both.
  Detailed in `docs/RV20-C05a-Audit-02.md`.
- **Round 3 (architect, 2-auditor, v2 no-borderline): split, not
  clean.** Auditor B PASS; auditor A FAIL with one concern. A: the
  `nav-dom-driver-live.ts` file docstring claimed the executor shell is
  "still constructed with `MockNavDomDriver` by its own unit suite" - it
  is not (`new NavExecutor` is nowhere; the pure-logic tests pass the
  mock to free functions and never construct the `$state` shell, which
  cannot load under `bun:test`). A different failure class than R1/R2
  (a factual error about the test surface, not a forward-looking claim),
  which is why the R2 proactive forward-looking sweep did not catch it.
  Fixed: now describes the pure-logic half tested with the mock passed
  to free functions, and the shell not constructed under `bun:test`.
  B's markdown nitpick (a stray list-item continuation in the
  Deviations section) also fixed. The implementation invariants were
  again verified clean by both. Detailed in `docs/RV20-C05a-Audit-03.md`.
- **Round 4 (architect, 2-auditor, v2 no-borderline): split, with a
  timing wrinkle.** Auditor A FAIL on the post-R3 state (found the
  `HtmlSingletonClassController.count` getter docstring: "The integrated
  pipeline does not read this" - present-tense "integrated pipeline"
  without a Cycle-5a qualifier; same forward-looking pattern, missed by
  the R2 grep sweep because of the phrasing). The fix was applied
  mid-round; auditor B then PASSed the post-fix state (B's file-mtime
  observation confirms it read the file after the fix). Net: the `count`
  concern is fixed and B confirmed the post-fix state clean, but this is
  not a clean 2/2 round (A and B audited different states). After the
  fix I did an exhaustive end-to-end docstring read (not grep) of all
  three source files; every docstring is now accurate and Cycle-5a-
  qualified. Detailed in `docs/RV20-C05a-Audit-04.md`.

Consecutive pass votes: **0** (R4 split by timing; A's concern reset the
counter. The implementation invariants have been auditor-verified clean
across R1-R4; the docstring surface is now exhaustively swept).

## Coverage bullets (round-independent)

Each bullet says what the suite covers; the per-round audit files at
`docs/RV20-C05a-Audit-{01..NN}.md` will record the auditor verdicts.

- Lifecycle reducer totality: every transition defined
  (`mount`/`activate`/`deactivate`/`unmount`); idempotency
  (mount on mounted/active/inactive, activate on active, deactivate on
  inactive, unmount on unmounted); out-of-sequence no-ops (activate on
  unmounted, deactivate on unmounted, deactivate on mounted); full
  cycle; re-activation cycle.
- Refcount microtask deferral (pure helpers): 0->1 returns immediate
  `add`; 1->2 returns `none`; acquire-with-pending-removal cancels and
  does NOT re-add; 1->0 schedules microtask and does NOT remove
  immediately; 2->1 is a no-op; release-at-0 is idempotent;
  settle-at-0-pending removes; settle-at->0-pending cancels;
  settle-without-pending is a no-op.
- Refcount microtask deferral (live controller, stub scheduler):
  first-acquire adds; second-acquire does NOT re-add; release-below-1
  schedules and does not remove; microtask removes at 0;
  same-tick acquire+release+acquire does NOT flicker; release with
  count > 1 does not schedule; release at 0 is a no-op;
  acquire-after-pending-release cancels (no re-add).
- Refcount microtask deferral (live controller, real `queueMicrotask`):
  default scheduler removes after an `await Promise.resolve()` flush;
  same-tick re-acquire does not flicker.
- Default applier / scheduler sanity: callable without `document` /
  under the bun runtime; default scheduler's `queueMicrotask` fires.
- SSR unmount guard: `planUnmount(state, true)` returns
  `runTeardowns: true`; `planUnmount(state, false)` returns
  `runTeardowns: false` AND `nextState.phase === 'unmounted'`; the SSR
  branch holds across `mounted`, `active`, `inactive` source phases;
  idempotent on `unmounted` in both branches.
- Live driver write mapping, page-track: negative / positive / zero /
  fractional translateX preserve sign and magnitude; axis->sign chain
  verified end-to-end for both `axis='left'` (negative) and
  `axis='right'` (positive), composing the executor's sign convention
  with the driver's application.
- Live driver write mapping, FAB: scale + translateY + visibility
  written when visible; `visibility: hidden` when not visible; the
  `scale=0, visible=false` case (the inactive-FAB plan in
  `nav-resolvers.ts`) writes both fields correctly.
- Live driver write mapping, Header: transform + `--header-morph` +
  `--header-title-crossfade` written; zero-state Header write verified.
- Live driver null + resolver behavior: null elements skipped without
  throwing; default `makeElements()` shape is all-null (pinning test);
  the resolver is called each write; a fresh element per write is
  honored (re-bind scenario); a partial bind (pageTrack only) writes
  the pageTrack and skips the others.
- Live driver reduced-motion read: returns `true` / `false` per the
  injected matchMedia; the exact query string
  `(prefers-reduced-motion: reduce)` is forwarded (asserted via the
  `REDUCED_MOTION_QUERY` constant); the default `matchMedia` is
  callable without `window` and returns `matches: false` (SSR
  fallback); the default matchMedia is idempotent across calls.

## Out-of-scope items carried to Cycle 5b (and 5c)

- Wiring `PageLifecycleController` into the gesture components
  (`MobileTabPager.svelte`, `GesturePageLayout.svelte`) and the root
  layout. 5b.
- Migrating the lifecycle-adjacent stores (`viewport-lock`,
  `scroll-chrome`, `active-gesture-track`, `page-scroll`) to register
  their html-singleton releases via `registerTeardown` and to construct
  an `HtmlSingletonClassController` each. 5b.
- Wiring `LiveNavDomDriver` into the executor shell
  (`nav-executor.svelte.ts`), replacing the `MockNavDomDriver` used by
  the executor's own unit suite. 5b.
- Cutting over `MobileTabPager` / `GesturePageLayout` / `swipe.ts` /
  `DualColumnLayout` to the unified state-driven track. 5b.
- Removing `backParent` from `RouteData`. 5b.
- The e2e suite that samples `getComputedStyle` trajectories. 5c.
