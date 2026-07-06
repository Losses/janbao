# RV20-C03 - Audit Round 08 (2-auditor model)

Fifth real-time round under the v2 (no-borderline) classification. Two
auditors (A, B) examined the post-R7 state. Result: **0/2 PASS**. Three
code-comment / test-accuracy concerns, all in different spots; all
fixed. R8 is not clean.

## Prompt sent (clean, non-leading)

Identical to R7 with the explicit no-borderline classification: any
code comment in `.ts` / `.svelte.ts` / `.test.ts` that overclaims,
under-describes, omits a guard, or references behavior the code does
not have is a CONCERN, including forward-plumbed fields; only `.md`
text is a nitpick. No prior-round framing.

## Auditor verdicts

- **Auditor A: PASS-WITH-CONCERNS.** One concern (`reset()` docstring
  overclaims current callers). Re-ran every gate, verified shadow mode
  three ways, dispatch/coordinator/reducer totality, R4/R6/R7 fixes,
  and the 7 existing audit files. Noted (correctly) that the R7 sweep
  grepped a fixed verb set (`reads`/`writes`/`produces`/...) and missed
  `used by`, so the `reset()` method docstring escaped it.
- **Auditor B: FAIL.** Two concerns (the `resolved` case comment
  under-describes the committing-preserving branch; the `isInFlight`
  test name overclaims coverage). Same gate re-runs and architectural
  checks.

## Concerns (all blocking, all fixed)

1. **`resolved` case comment under-described** (auditor B;
   `nav-state-machine-logic.ts:230-231`). It said "Move to transitioning
   with sub `dragging`," but the ternary preserves `'committing'` when
   re-resolved mid-commit (the suite's `resolved from
transitioning/committing preserves committing sub` test relies on
   this). Fixed: the comment now states `dragging` is the default and
   `committing` is preserved on mid-commit re-resolve.

2. **`isInFlight` test name overclaimed** (auditor B;
   `nav-state-machine-logic.test.ts:295`). The name said "every
   transitioning sub-phase," but the body's `cancel` step ran from
   `committing` (a no-op, since `cancel` requires `sub === 'dragging'`),
   so `cancelling` was never reached or asserted. Fixed: the test now
   branches to `cancelling` via `cancel`-from-`dragging`, asserts each
   reachable sub (`dragging`/`committing`/`cancelling`) with both its
   `macro.sub` value and `isInFlight === true`, and is renamed to
   "every reachable transitioning sub" with a note that `scrubbing` is
   unreachable in Cycle 3.

3. **`reset()` method docstring overclaimed callers** (auditor A;
   `nav-state-machine.svelte.ts:176-177`). It said "used by the
   first-load landing and by the SSR initial render," but `grep` for
   `.reset(` returns zero production callers; first-load/SSR use the
   constructor's `initialOn`, and `onLand` dispatches the reset event
   directly. Fixed: the docstring now states it is a public boundary
   with no Cycle-3 caller, where first-load/SSR actually go (the
   constructor), and that Cycle 5 may call it from the first-load/SSR
   wiring.

## Comprehensive method/case docstring sweep (post-R8)

Auditor A's meta-point was correct: the R7 sweep grepped a fixed verb
set and missed `used by`. I read every method, case, interface, and
field docstring across the five layer files (not a verb-targeted grep)
and verified each against the code. The wrapper's `on*` methods
(`onIntent`/`onResolved`/`onDragMove`/`onCommit`/`onCancel`/`onInterrupt`/`onLand`)
describe the event each handles without claiming specific callers, and
the block comment at `nav-state-machine.svelte.ts:114-120` documents
their Cycle-3-unused status at the block level; `reset()` was the only
outlier (now fixed). No further drift found.

## State after R8 fixes

93/93 unit tests pass across the four pure-half suites (217 expect()
calls; the rewritten `isInFlight` test adds sub-assertions); `bun run
check` 0 errors / 0 warnings; `bun run lint` exit 0 (52 similar-type
pairs, 3 transitory/test-fixture); shadow mode preserved.

Consecutive pass votes: **0** (R8 carried three code-comment /
test-accuracy concerns).
