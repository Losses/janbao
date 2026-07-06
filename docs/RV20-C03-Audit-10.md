# RV20-C03 - Audit Round 10 (2-auditor model)

Seventh real-time round under the v2 (no-borderline) classification.
Result: **split, not clean** - auditor A FAIL with five code-comment
concerns; auditor B PASS. A was the more thorough reader (B claimed
"read every docstring" and passed, but missed the five A found - the
auditor-sampling divergence seen in earlier rounds). Counter resets to 0.

## Prompt sent (clean, non-leading)

Identical to R9 (explicit no-borderline classification; module-level
docstrings named as in-scope). No prior-round framing.

## Auditor verdicts

- **Auditor A: FAIL.** Five code-comment concerns. Four are
  function/interface docstrings that describe Cycle-4/5 integration in
  the present tense (the same pattern R9 fixed at module level); one
  (C1) is a factual error about imports that the R9 proactive fix
  introduced. A also noted (correctly) that the journal's R9 claim
  "every docstring category read against the code" overstated the
  sweep - the reads happened but the function/interface levels were
  sampled, not exhaustively covered.
- **Auditor B: PASS.** Zero defects, zero concerns. One nitpick
  (journal `.md` prose: the Design/Investigation sections still say
  "the resolver reads `entries[length-2]`" / "reads the stack directly"
  while the implementation has the caller precompute `direction`).

## Concerns (all blocking, all fixed)

1. **`nav-resolvers.ts:34-36` factual import error** (auditor A;
   introduced by the R9 proactive fix). Said "the orchestrator imports
   only the `TransitionPlan` type," but the wrapper imports both
   `TransitionDirection` and `TransitionPlan` (line 39) and the reducer
   imports `TransitionPlan` (line 29). Fixed: now states the orchestrator
   imports both types and which half imports which.
2. **`ResolvedTarget` interface docstring** (`nav-intent.ts:157`).
   "The orchestrator matches this against the current route" - present
   tense, no Cycle-3 caller. Fixed: qualified "in the integrated
   pipeline...; in Cycle 3 shadow mode exercised only by the unit suite."
3. **`intentTarget` function docstring** (`nav-intent.ts:328`). "The
   orchestrator uses this to look up the destination's RouteData" -
   `intentTarget` is referenced only in its definition and tests.
   Fixed: qualified likewise.
4. **`coordinate` function docstring** (`nav-coordinator.ts:86`). "The
   orchestrator calls it once at gesture start" - `coordinate` is called
   only by tests. Fixed: qualified "in the integrated pipeline...; in
   Cycle 3 shadow mode exercised only by the unit suite."
5. **`isCommitting` function docstring** (`nav-state-machine-logic.ts:354`).
   "Used by the wrapper to schedule the post-commit land" - the wrapper's
   `onLand` schedules the reset microtask unconditionally without
   consulting `isCommitting`; `isCommitting` is referenced only in tests.
   The strongest of the five (wrong regardless of cycle). Fixed: now
   states it is a Cycle-3-unused predicate and the wrapper does not
   consult it.

## Proactive fixes (same pattern, found in the post-R10 sweep)

After the five, I re-grepped the layer files for present-tense
integration verbs and fixed four more current-use claims auditors had
not yet flagged:

- `nav-intent.ts:18` "the orchestrator reads them each frame" - the
  Cycle 4 executor will; in Cycle 3 nothing consumes them.
- `nav-intent.ts:212` (classify docstring) "The orchestrator applies
  external side effects" - reworded to the structural fact that side
  effects live in other layers.
- `nav-intent.ts:236` (tap/goto/popstate/hashchange) "The orchestrator
  resolves this into a (from, to) pair" - qualified "when the pipeline
  is wired (Cycle 5)".
- `nav-resolvers.ts:224` (`progressDirectionFor`) "reads `intent.micro`
  at gesture start; the orchestrator may pass..." - qualified Cycle 3
  unit-suite-only.

## Auditor B's nitpick (journal prose, fixed)

The journal's Design section point 2 ("The resolver reads
`entries[length - 2]`") and Investigation section ("the new resolver
reads the stack directly") describe the §4 spec language, not the
Cycle-3 implementation (caller precomputes `direction`; resolvers
consume `direction`). This was already acknowledged in the R4
audit-fix paragraph but never corrected in the original CMA design
prose. Fixed: both passages now state the caller precomputes
`direction` and the resolvers consume it.

## Process honesty

The journal's R9 entry claimed "every docstring category across the
five files has been read against the code." Auditor A showed this was
overstated: the reads happened but sampled function/interface
docstrings rather than exhausting them, and the R9 proactive fix
introduced C1. This round's sweep was grep-plus-read on every
function/interface docstring, not only the flagged ones. Corrected the
R9 wording in the journal.

## State after R10 fixes

93/93 unit tests pass across the four pure-half suites (217 expect()
calls); `bun run check` 0 errors / 0 warnings; `bun run lint` exit 0
(52 similar-type pairs, 3 transitory/test-fixture); shadow mode
preserved; no em-dashes.

Consecutive pass votes: **0** (R10 split; A's five concerns reset the
counter).
