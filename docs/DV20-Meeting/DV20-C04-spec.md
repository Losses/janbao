# DV20 Cycle 4 Spec: All-rAF executor + velocity-matched commit (Layer 5)

**Architect:** the document owner. **Executor:** the Cycle 4 Manager Agent (CMA4). **Protocol:** `docs/DV20-Meeting/DV20-Cycle-Manager-Protocol-v2.md` (v2, binding, no-borderline classification). **Status:** COMPLETE. Closed 2026-07-06 at R6 (2/2 PASS) after running past the architect's R5 floor: R3 (missing SSR-gate test) and R5 (missing `<= 0` branch tests) were substantive missing-test concerns, closed with extracted/injected helpers + tests; R6 confirmed both auditors clean on the post-fix state. The scope recommendation below (shadow mode) was followed. Per-round detail in `docs/RV20-C04-Audit-{01..06}.md`.

## Scope question (architect decides before CMA4 starts)

`docs/DV20-Plan.md` §11/Cycle-4 line lists the executor AND "delete the CSS transitions, the `setTimeout` alignment (three sites), and the dual DOM read-back." But §11/Cycle-5 is the `PageLifecycle` contract + route-by-route migration + cutover, where the executor actually replaces the existing gesture components. This spec recommends **Cycle 4 stays in shadow mode** (build the executor as a new module with an injectable DOM-driver interface, unit-tested with a mock driver; do NOT modify MobileTabPager / GesturePageLayout / swipe.ts and do NOT delete the CSS transitions / `setTimeout` / DOM read-backs yet). The deletion + real-DOM wiring lands at the Cycle 5 cutover, when the executor demonstrably replaces the old mechanism and e2e can sample `getComputedStyle`. This mirrors Cycles 1-3 (each built its layer in shadow mode; the cutover is Cycle 5).

If the architect prefers the plan's literal Cycle-4 scope (build the executor AND cut over a slice this cycle), CMA4's risk and e2e burden rise substantially; say so explicitly and this spec's Constraints/Out-of-scope sections flip.

## Scope (assuming shadow mode, recommended)

Build Layer 5 of the five-layer pipeline as NEW files: the single rAF executor that consumes a `TransitionPlan` (Cycle 3) and writes per-frame visuals, the velocity-matched momentum integrator for the commit phase, interruption (re-grab mid-commit), and `prefers-reduced-motion` handling. The executor talks to an injected DOM-driver interface, so it is unit-testable under `bun:test` with no real DOM and no Svelte runes loader. The existing MobileTabPager / GesturePageLayout / swipe.ts continue to own the gesture; Cycle 4's output is verified by unit tests (the executor + integrator are pure-ish functions of `(plan, phase, time)` over the injected driver).

## Background

- `docs/DV20-Plan.md` §5 (executor: all-rAF, velocity-matched, interruption, reduced-motion, SSR safety, performance), §13.3 (no CSS-transition + `setTimeout` alignment; no hardcoded commit duration), §13.5 (the state machine is the only authority; consumers do not read back from the DOM), §6 (the phase record carries `(from, to, startTime, liveOffset, releaseVelocity, direction)`), §11 (protocol v2 + cycle slicing).
- Cycle 3 output: `TransitionPlan` (`pageTrack`, `fab(progress, liveOffset)`, `header(progress, liveOffset)`, `progressDirection`, `commitPhysics: 'momentum' | 'snap'`) in `src/lib/utils/nav-resolvers.ts`; the orchestrator phase (`at-rest` / `intent` / `transitioning` with sub `dragging`/`committing`/`cancelling`/`scrubbing` / `landing`) in `src/lib/stores/nav-state-machine-logic.ts`; the intent classifier's release velocity in `src/lib/utils/nav-intent.ts`.

## End state

1. **The executor module**: a single rAF loop driven by the orchestrator's phase. Each frame, for each consumer (page track, FAB, Header), it calls the active plan's function with the current `(progress, liveOffset)` and writes the returned visual through the injected DOM driver. It is the only layer that touches the DOM (through the driver).
2. **The velocity-matched commit integrator**: the `committing` sub-phase does NOT use a hardcoded ease. It takes the finger's release velocity and integrates the remaining distance with a critically-damped spring (or equivalent momentum integral) at that velocity. Variable duration: fast flick = few frames; slow release = longer ease. Near-zero release velocity falls back to a default ease; very high velocity clamps to a ceiling.
3. **Interruption**: a new intent arriving mid-commit cancels the commit rAF, reads the current visual position + the new pointer, and re-enters `dragging` from the current visual state. No jump (the executor's authoritative state hands off seamlessly).
4. **Reduced motion**: when `matchMedia('(prefers-reduced-motion: reduce)')` is set, the commit phase snaps (instant translate to target, no rAF integration). Non-negotiable accessibility.
5. **SSR safety + browser-only**: the rAF loop is gated by `browser`; the SSR render is the resting state. No rAF runs during SSR.
6. **No DOM read-back**: the executor holds authoritative visual state and publishes it to consumers; no `getComputedStyle(trackEl).transform.m41` read-back (the dual sampler + pending-nav poll the plan calls out).
7. All executor files are NEW under `src/lib/stores/` or `src/lib/utils/`. The existing gesture components are NOT modified (shadow mode). Output verified by unit tests with a mock DOM driver.

## Constraints

- **Shadow mode.** Do NOT connect the executor to the real DOM or the existing gesture components. Do NOT delete the CSS transitions, the three `setTimeout` alignment sites, or the dual DOM read-backs (those land at the Cycle 5 cutover). Inject a DOM-driver interface so the executor is unit-testable with a mock.
- **No behavior change.** The existing system is untouched. No e2e regressions.
- **The structural invariant (§5):** for any visual property of the gesture/navigation layer at any instant, exactly one rAF write owns its motion, decided solely by the orchestrator's phase. No CSS transitions, no `setTimeout` alignment in the new code.
- **Velocity-matched, not duration-hardcoded (§13.3):** the commit integrator's duration is a function of release velocity and remaining distance, never a fixed `200ms`.
- **Reduced-motion snap is non-negotiable (§5):** the executor must check the media query and snap; it may not rely on CSS transitions to handle it.
- **No DOM read-back (§13.5):** the executor publishes authoritative state; no consumer reads from the DOM.
- **Pure-half / reactive-half split where needed**, mirroring Cycles 2-3, so the integrator + per-frame math run under `bun:test` with no runes loader.
- **No git mutation.**
- **Comment-accuracy bar (v2, no-borderline):** every code comment in the new files must describe current Cycle-4 behavior. Forward-looking (Cycle 5 wiring) claims must be explicitly qualified ("Cycle 5 wires..."). Apply the R6-R10 lesson: exhaustively read every docstring (module, function, interface, field, case, test name) against the code before reporting done; do not sample.

## Out of scope

- The cutover: deleting the CSS transitions / `setTimeout` alignment / dual DOM read-backs from MobileTabPager / GesturePageLayout / swipe.ts, and wiring the executor to the real DOM. That is the Cycle 5 migration.
- The `PageLifecycle` contract (`mount`/`activate`/`deactivate`/`unmount`). Cycle 5.
- Replacing MobileTabPager / GesturePageLayout. Cycle 5.
- The e2e suite that samples `getComputedStyle` trajectories across real gestures. That e2e is meaningful only after the cutover; Cycle 4 validates with mock-Driver unit tests (the per-frame output sequence, the integrator's velocity-to-duration mapping, the reduced-motion snap, the interruption handoff).

## Deliverables

- The executor module (`src/lib/stores/nav-executor.svelte.ts` or similar reactive wrapper) + its pure-half integrator (`nav-executor-logic.ts` or similar).
- The DOM-driver interface (`src/lib/utils/nav-dom-driver.ts` or similar) + a mock driver for tests.
- The velocity-matched commit integrator (critically-damped spring / momentum integral; near-zero fallback; high-velocity clamp).
- Unit tests: per-frame output sequence for each `commitPhysics` kind; velocity-to-duration mapping (slow release > fast release); near-zero fallback; high-velocity clamp; reduced-motion snap; interruption handoff (no jump); SSR gate.
- `docs/DV20-C04-Journal.md` (incremental, honest, real evidence pasted).
- Coverage bullets round-independent from the start.

## What the architect will check at review

- Is the executor built as new files, NOT modifying the existing gesture components (shadow mode preserved)?
- Does the commit phase integrate release velocity (variable duration), not a hardcoded ease?
- Is the structural invariant upheld (one rAF write per property, decided by phase; no CSS transitions / `setTimeout` in the new code)?
- Does reduced-motion snap, explicitly?
- Is the SSR gate present (no rAF during SSR)?
- Does the executor avoid DOM read-back (authoritative state published to consumers)?
- Are the integrator + per-frame math unit-tested with a mock driver under `bun:test`?
- Are the interruption handoff and the velocity-to-duration mapping tested?
- Is every code comment accurate to Cycle-4 behavior (the R6-R10 bar)?
