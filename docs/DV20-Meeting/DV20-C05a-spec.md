# DV20 Cycle 5a Spec: PageLifecycle contract + real DOM driver

**Architect:** the document owner. **Executor:** the Cycle 5a Manager Agent (CMA5a). **Protocol:** `docs/DV20-Meeting/DV20-Cycle-Manager-Protocol-v2.md` (v2, binding, no-borderline classification). **Status:** ready for CMA5a.

This is the first sub-cycle of the Cycle 5 cutover, split (per architect decision 2026-07-06) into 5a (this - contract + real driver, shadow), 5b (route-by-route migration that modifies the existing gesture components), and 5c (e2e trajectory sampling).

## Scope

Build the two NEW modules the cutover (5b) will plug in, in shadow mode:

1. The `PageLifecycle` contract: the four-phase `mount` / `activate` / `deactivate` / `unmount` interface plus a layout-level controller that owns the phase transitions, the refcount-with-microtask-deferral pattern (the template for any `html`-level singleton, mirroring the existing `viewport-lock` refcount), and the SSR-teardown guard (so `unmount` is the single place html-singleton classes are removed, eliminating the `svelte-ondestroy-runs-in-ssr` trap at the source).
2. The real `NavDomDriver` implementation: implements the Cycle-4 `NavDomDriver` interface (`write(NavVisualWrite)` + `prefersReducedMotion()`), proxying the live page-track / FAB / Header elements and reading `matchMedia('(prefers-reduced-motion: reduce)')`.

Both are NEW files. The existing gesture components and the lifecycle-adjacent stores (`viewport-lock`, `scroll-chrome`, `active-gesture-track`) are NOT modified (their refactor into lifecycle hooks is 5b). The executor is NOT wired to the real driver (5b). Shadow mode.

## Background

- `docs/DV20-Plan.md` §8 (Page lifecycle: the four-phase contract; the adjacent stores become hooks; refcount-with-microtask-deferral; SSR teardown), §9 (SvelteKit interop / nested pagers edge cases), §13.5 (state machine is the only authority).
- Cycle 4 output: the `NavDomDriver` interface + `NavVisualWrite` / `PageTrackWrite` / `FabWrite` / `HeaderWrite` in `src/lib/utils/nav-dom-driver.ts`; the executor in `src/lib/stores/nav-executor.svelte.ts` that consumes a driver.
- Existing refcount pattern: `viewport-lock` (memory `viewport-lock-refcount-pattern`); the SSR trap: `svelte-ondestroy-runs-in-ssr`.

## End state

1. A `PageLifecycle` module (e.g. `src/lib/stores/page-lifecycle.svelte.ts` + a pure-half `page-lifecycle-logic.ts` if the phase machine warrants it) exporting the four-phase contract, a controller that transitions through the phases totally (every transition defined; out-of-sequence calls are no-ops or defined), the refcount-with-microtask-deferral helper, and the SSR-safe `unmount`.
2. A real `NavDomDriver` implementation (e.g. `src/lib/utils/nav-dom-driver-live.ts`) that binds to element refs and writes the visual each frame, plus reads the reduced-motion media query.
3. Unit tests: lifecycle phase totality (mount -> activate -> deactivate -> unmount; idempotency; out-of-sequence no-ops), the refcount microtask deferral (add/remove ref → html-singleton class added on first ref, removed on a microtask after last ref), the SSR `unmount` guard; the live driver's write mapping (progress/axis -> translateX sign and magnitude, FAB/Header field pass-through) tested against stub elements (plain objects with a `style` bag) so it runs under `bun:test` with no real DOM; the reduced-motion read.
4. All NEW files. No modification of the existing gesture components or the lifecycle-adjacent stores.

## Constraints

- **Shadow mode.** Do NOT wire the lifecycle or the real driver into any route, layout, or the executor. Do NOT modify `MobileTabPager.svelte`, `GesturePageLayout.svelte`, `swipe.ts`, `DualColumnLayout`, or the lifecycle-adjacent stores (`viewport-lock`, `scroll-chrome`, `active-gesture-track`). Those are 5b.
- **No behavior change.** The existing system is untouched. No e2e regressions.
- **Testable under `bun:test`.** The lifecycle's phase machine is pure (or pure-half split); the live driver is tested with stub elements (object with a `style` bag) and an injectable element-resolver/matchMedia so no real DOM is required.
- **The refcount-with-microtask-deferral invariant** (memory `viewport-lock-refcount-pattern`): an html-singleton class is added on the first ref and removed on a microtask after the last ref, so a same-tick remove+add does not flicker.
- **SSR safety.** `unmount` is the single teardown path; `onDestroy` is not used for html-singleton removal (avoids `svelte-ondestroy-runs-in-ssr`). The lifecycle module is browser-gated where it must be.
- **No git mutation.**
- **Comment-accuracy bar (R-cycles lesson):** every code comment in the new files describes current Cycle-5a behavior. Forward-looking (5b wiring) claims are explicitly qualified. Read every docstring against the code before reporting done; cross-check the deliverables list (do not deliver a spec item without its test).

## Out of scope (5b / 5c)

- Wiring the lifecycle, executor, and real driver into actual routes/layouts (5b).
- Cutting over `MobileTabPager` / `GesturePageLayout` / `swipe.ts` / `DualColumnLayout` to the unified state-driven track (5b).
- Refactoring the lifecycle-adjacent stores into lifecycle hooks (5b).
- Removing `backParent` from `RouteData` (5b, once both consumers dissolve).
- The e2e suite that samples `getComputedStyle` trajectories (5c).

## Deliverables

- The `PageLifecycle` module (contract + controller + refcount deferral + SSR-safe unmount).
- The real `NavDomDriver` implementation.
- Unit tests for each (lifecycle totality + refcount deferral + SSR; live driver write mapping + reduced-motion).
- `docs/DV20-C05a-Journal.md` (incremental, honest, real evidence pasted).
- Coverage bullets round-independent from the start (point to `docs/RV20-C05a-Audit-{01..NN}.md`).

## What the architect will check at review

- Are the lifecycle and the real driver NEW files, NOT modifying the existing gesture components or stores (shadow mode preserved)?
- Is the lifecycle total (every phase transition defined; out-of-sequence calls handled)?
- Does the refcount-with-microtask-deferral hold (first-ref add; last-ref microtask-deferred remove; no same-tick flicker)?
- Is `unmount` the single SSR-safe teardown path (no `onDestroy` for html-singleton removal)?
- Does the real driver correctly map `NavVisualWrite` to element writes (sign/magnitude) and read the reduced-motion media query?
- Is everything unit-testable under `bun:test` (lifecycle pure; driver via stub elements)?
- Is every code comment accurate to Cycle-5a behavior (the R-cycles bar)?
