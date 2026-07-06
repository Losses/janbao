# RV20-C05a - Audit Round 04 (2-auditor model)

Fourth audit round for Cycle 5a. Two auditors (A, B) were launched
against the post-R3 state. Result: **split, with a timing wrinkle** -
auditor A FAIL on the pre-fix state (found a `count` getter concern);
the fix was applied mid-round; auditor B PASS on the post-fix state.
The net is the `count` concern is fixed and B confirmed the post-fix
state clean, but this is not a clean 2/2 round for convergence purposes
(A and B audited different states).

## Auditor verdicts

- **Auditor A: FAIL** (on the post-R3 state). One concern: the
  `HtmlSingletonClassController.count` getter docstring said "The
  integrated pipeline does not read this" - a present-tense mention of
  "the integrated pipeline" without a Cycle-5a qualifier. Same forward-
  looking pattern as R1/R2; the R2 proactive grep sweep missed it
  because the phrasing ("does not read" / "integrated pipeline") was
  not in the grep pattern set.
- **Auditor B: PASS** (on the post-R4-A-fix state - the file mtime
  observation in B's report confirms B read the file after the `count`
  fix was applied). Zero concerns; verified all invariants and the
  comment-accuracy bar holds on the post-fix state.

## Concern (blocking, fixed)

- **`HtmlSingletonClassController.count` getter docstring** (auditor A;
  `page-lifecycle-logic.ts:304`). Fixed: now states "In Cycle 5a the
  controller is constructed only by the unit suite, which asserts
  `count` to verify acquire/release pairs; the integrated pipeline
  (Cycle 5b) will not read this field."

## Exhaustive end-to-end docstring read (post-R4)

The grep-based sweeps (R2 forward-looking; R3 factual-test-surface)
kept missing phrasing variants. After the R4-A fix I read all three
source files end-to-end (not grep) and verified every docstring:

- `page-lifecycle-logic.ts`: module docstring, `PagePhase`,
  `PageLifecycleEvent`, `PageLifecycleState`, `initialLifecycleState`,
  `reduce`, the refcount pure helpers (`RefcountState`,
  `RefcountTransition`, `acquireRef`, `releaseRef`, `settleRefcountRemoval`),
  `HtmlSingletonClassController` + its `acquire`/`release`/`count`/
  `pendingRemoval`, `UnmountPlan`, `planUnmount` - all accurate, forward-
  looking claims qualified.
- `page-lifecycle.svelte.ts`: module docstring, `PageLifecycleController`
  class, `#teardowns`, `#isBrowser`, `phase` getter, `mount`/`activate`/
  `deactivate`/`unmount` (covered by the class-level Cycle-5a qualifier,
  the "qualified-by-accompanying-disclaimer" standard), `registerTeardown`
  - all accurate.
- `nav-dom-driver-live.ts`: file docstring (R3 factual-fix), the
  structural types, `defaultMatchMedia`, `LiveNavDomDriver` + `write`
  (page-track sign comment, header custom-property comment with its
  Cycle-5b qualifier), `prefersReducedMotion` - all accurate.

No further drift found. The two test files' headers were verified in
earlier rounds.

## What was verified clean

Both auditors verified: lifecycle totality (all 16 event x phase pairs;
idempotency; out-of-sequence no-ops); refcount-with-microtask-deferral
(closure reads state at fire time; same-tick cancel; stub + real
`queueMicrotask`); SSR single teardown path (`planUnmount` gates on
`isBrowser`; no `onDestroy`; no `import.meta.hot.dispose`); real driver
write mapping (sign matches `buildVisual`; FAB/Header compose; null-
element skip; per-write resolver; `REDUCED_MOTION_QUERY` exact; SSR
`matchMedia` fallback); shadow mode (zero external importers; `new
NavExecutor` nowhere; empty `git diff`); all pasted journal numbers.

## State after R4 fixes

70/70 unit tests pass across the two new suites (144 expect() calls);
`bun run check` 0 errors / 0 warnings; `bun run lint` exit 0; shadow
mode preserved; no em-dashes.

Consecutive pass votes: **0** (R4 split by timing; A's concern reset the
counter. The implementation invariants have been auditor-verified clean
across R1-R4; the docstring surface is now exhaustively swept).
