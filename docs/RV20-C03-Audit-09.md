# RV20-C03 - Audit Round 09 (2-auditor model)

Sixth real-time round under the v2 (no-borderline) classification. Two
auditors (A, B) examined the post-R8 state. Result: **0/2 PASS**. Four
concerns: three module-level (top-of-file) docstrings the R8 sweep did
not cover, plus one test name. All fixed.

## Prompt sent (clean, non-leading)

Identical to R8 (explicit no-borderline classification, naming test
names/headers as in-scope). No prior-round framing.

## Auditor verdicts

- **Auditor A: FAIL.** Three concerns, all module-level docstrings that
  describe Cycle 4/5 integration in the present tense without a Cycle-3
  qualifier (`nav-intent.ts:9-13`, `nav-coordinator.ts:11-14`,
  `nav-state-machine-logic.ts:5-10`). Noted correctly that the R8 sweep
  covered method/case/interface/field docstrings but NOT module-level
  docstrings. Re-ran every gate, verified shadow mode, dispatch,
  coordinator, reducer totality, and the R4/R6/R7/R8 fixes.
- **Auditor B: FAIL.** One concern: the test at
  `nav-state-machine-logic.test.ts:315` was named "the plan set on
  resolved is the plan returned by land" but the body never dispatches
  `land` (and `land` nulls the plan anyway). Same name-vs-body class as
  R8's `isInFlight`.

## Concerns (all blocking, all fixed)

1. **`nav-intent.ts` module docstring** (auditor A). "The orchestrator
   subscribes to the classified intent and publishes it downward to the
   resolver" - in Cycle 3 nothing consumes the classifier (it is a pure
   reducer; the wrapper's `onIntent` has no callers). Fixed: now states
   the classifier is a pure reducer, the orchestrator will call
   `classify` once the pipeline is wired, and in Cycle 3 shadow mode no
   caller consumes it (Cycle 5).

2. **`nav-coordinator.ts` module docstring** (auditor A). "The
   orchestrator wires the live `PageCacheStore.get` into the predicate
   at runtime" - in Cycle 3 `coordinate` is called only by its tests.
   Fixed: now states the orchestrator will wire the predicate when the
   pipeline is connected, and in Cycle 3 `coordinate` is test-only.

3. **`nav-state-machine-logic.ts` module docstring** (auditor A). "Owns
   interruption (a new intent arriving mid-transition; a popstate; a
   failed preload)" - the Cycle 3 reducer models only the new-intent
   interruption; popstate-as-interruption and failed-preload are not
   modeled. Fixed: now scopes the interruption to the Cycle 3
   new-intent case and marks popstate/failed-preload/SvelteKit-interop
   as Cycle 5.

4. **Test name vs body** (auditor B). "the plan set on resolved is the
   plan returned by land" - the body dispatches `resolved` then
   `commit`, never `land`. Fixed: renamed to "the plan set on resolved
   is preserved through commit".

## Proactive fix (same pattern, not flagged)

`nav-resolvers.ts` module docstring carried the same present-tense
integration claims ("the orchestrator selects the resolver";
`resolve(intent, stack, route-data)`; "imported by the orchestrator").
Auditor A did not flag it, but the same logic applies. Fixed
preactively (per [[fix-thoroughly-not-band-aid-patches]], fix all
instances of a pattern, not only the flagged ones): the §4 signature
is now given as `resolve(input: ResolverInput)` with the conceptual
tuple noted as bundled; the orchestrator-wiring claim is qualified
"Cycle 3 shadow mode the dispatch is exercised by the unit suite;
the orchestrator wires it in Cycle 5"; and the import note now says
the orchestrator imports only the `TransitionPlan` type.

## State of the comment surface after R9

The module-level docstrings were the last category the sweeps had not
covered. After R9 every docstring category across the five layer files
has been read against the code: module-level (R9), method/case (R8),
interface/field (R7), plus test headers (R6) and test names (R8/R9).
The wrapper module docstring was already well-qualified ("In Cycle 3
no consumer reads this store"; auditor A confirmed).

## State after R9 fixes

93/93 unit tests pass across the four pure-half suites (217 expect()
calls); `bun run check` 0 errors / 0 warnings; `bun run lint` exit 0
(52 similar-type pairs, 3 transitory/test-fixture); shadow mode
preserved; no em-dashes in the code.

Consecutive pass votes: **0** (R9 carried four code-comment /
test-accuracy concerns).
