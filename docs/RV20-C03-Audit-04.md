# RV20-C03 - Audit Round 04 (2-auditor model)

First real-time round under the v2 concern/nitpick classification. Two
auditors (A, B) examined the post-R3 state. Result: **0/2 PASS** (both
PASS-WITH-CONCERNS). The two concerns converged across both auditors.

## Prompt sent (clean, non-leading)

Independent audit, read-only. Context: Cycle 3 built Layers 1-4 of the
five-layer pipeline as new files in shadow mode (existing gesture
components unmodified; new logic not wired to the DOM), listing the
five files + four suites + spec + plan sections. Open instruction:
"find ANY defect empirically. Read the code AND the journal AND the
spec. Re-run the gates. Cross-check every pasted number. Verify the
TransitionPlan shape (§4), the dispatch table, the coordinator
branches, reducer totality, phase transitions (§6), shadow mode. Probe
the resolvers as pure functions." The v2 concern/nitpick classification
was included. No prior-round framing, no fix summaries, no verdict
hints.

## Auditor verdicts

- **Auditor A: PASS-WITH-CONCERNS.** One blocking concern (C1) + three
  nitpicks (N1-N3). Re-ran every gate (all matched the journal's pasted
  numbers verbatim), verified dispatch totality over all 9 tag pairs,
  coordinator precedence, reducer totality over the 8×5 (event, state)
  grid, resolver purity across route pairs, shadow mode, and the R1-R4
  preventive tests.
- **Auditor B: PASS-WITH-CONCERNS.** One blocking concern + two
  non-blocking observations. Same gate re-runs, same number matches,
  same architectural checks.

## Convergent concerns (both auditors, blocking)

1. **`MacroPhase` overview docstring was literally false.** (Auditor B
   raised it as the concern; auditor A's read agrees.) The summary
   claimed "Only one of `on` / `sub` / `plan` is populated for a given
   `kind`," but for `kind === 'transitioning'` the reducer populates
   BOTH `sub` and `plan` (the `resolved`, `commit`, `cancel` cases).
   A Cycle 4/5 reader implementing the documented invariant would skip
   the plan branch whenever `sub` was non-null and never read the
   authoritative plan. Fixed: the summary now states the real invariant
   (`on` for at-rest/landing; `sub` and `plan` co-populated for
   transitioning; all null for intent/resolving), and the per-field
   docstrings say "Null otherwise" explicitly
   (`src/lib/stores/nav-state-machine-logic.ts:46-64`).

2. **`interrupt` left stale `toPathname` / `toTag` / `direction`.**
   (Auditor A raised it as C1; auditor B raised the same defect as
   Observation A.) The `intent`-from-at-rest and `intent`-from-landing
   branches null these fields, but `interrupt` (which also re-enters
   `intent`) spread `...state` and left the abandoned transition's
   to-fields in place. The wrapper exposes `toPathname` as a reactive
   getter (`nav-state-machine.svelte.ts:93-95`), so a Cycle 5 consumer's
   `$derived` would read a stale destination on a re-grab mid-commit.
   Fixed: the `interrupt` return now explicitly nulls `toPathname`,
   `toTag`, `direction` (FROM survives, the user is still on the FROM
   page). Preventive test `interrupt clears the abandoned to-fields`
   added.

## Non-blocking observations / nitpicks

- **N1 (auditor A; auditor B concurred on the code-comment form).**
  Journal prose and the `nav-resolvers.ts` section comment claimed the
  resolver "reads the back-target from the stack's previous entry."
  In reality no Cycle-3 resolver reads `input.stack`; every resolver
  reads the caller-precomputed `direction`. The journal prose is a
  nitpick (non-blocking); the CODE comment is a concern under the v2
  rule, so it was fixed: the section comment, the `RouteStack`/`ResolverInput`
  docstrings, and the `TransitionDirection` docstring now state that
  `stack` is carried for Cycle 5 and Cycle-3 resolvers consume
  `direction`. The architectural intent (back-target is stack-derived,
  not `backParent`-derived) is honored; only the prose was wrong.
- **N2 (auditor A).** `progressDirectionFor`'s `'cancelled' → 1` branch
  is tested but not driven by the live flow (the reducer's `cancel`
  keeps the existing plan; the wrapper does not re-resolve). Tested-but-
  currently-unused, documented as forward-looking. Not a defect; left
  as-is.
- **N3 (auditor A).** `liveOffset` is unused by every plan body in
  Cycle 3 (all close over `progress` only). The signature matches §4's
  `(progress, liveOffset) => Visual`; Cycle 4's executor passes
  `liveOffset`. Forward-looking. Not a defect; left as-is.
- **Observation B (auditor B).** The wrapper's `onLand` does not cancel
  a prior pending `reset` microtask if `onLand` fires twice in the same
  microtask window. Unreachable in practice (`afterNavigate` fires once
  per navigation) and the reducer is correct; the wrapper is not yet
  wired in Cycle 3 and cannot be unit-tested under `bun:test`. Carried
  to Cycle 4/5 (wrapper hardening once it is wired to real SvelteKit
  events and exercisable by e2e).

## State after R4 fixes

92/92 unit tests pass across the four pure-half suites; `bun run check`
0 errors / 0 warnings; `bun run lint` exit 0 (52 similar-type pairs, all
pre-existing). Shadow mode preserved.

Consecutive pass votes: 0.
