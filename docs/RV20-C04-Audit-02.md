# RV20-C04 - Audit Round 02 (2-auditor model)

Second audit round for Cycle 4. Two auditors (A, B) examined the
post-R1 state. Result: **0/2 PASS** (both FAIL). Two unique code-comment
concerns; one (`defaultNow`) flagged by both. The implementation logic
was again verified clean by both auditors.

## Prompt sent (clean, non-leading)

Identical to R1. No prior-round framing.

## Auditor verdicts

- **Auditor A: FAIL.** Two concerns (`CommitStartInfo.reducedMotion`,
  `defaultNow`). Re-ran every gate, verified the integrator math
  (initial-slope velocity match, sign convention for commit + cancel,
  all fallback/clamp branches), the structural invariant (one rAF
  callback, one sampleFrame + one publishFrame per tick, no
  setTimeout/setInterval/transitions/getComputedStyle/.m41), reduced-
  motion snap, interruption, SSR gate, no DOM read-back, shadow mode.
- **Auditor B: FAIL.** One concern (`defaultNow`). Same gate re-runs and
  behavioral checks; verified all 18 `Cycle 5` references are properly
  qualified and all R1 fixes are present.

## Concerns (both blocking, both fixed)

1. **`CommitStartInfo.reducedMotion` field docstring**
   (auditor A; `nav-executor-logic.ts:90`). Said "if true the integrator
   does not run" and "Carried for diagnostics" - but the field is
   hardcoded `false` at the only construction site (line 252), and when
   reduced-motion is active `startCommit` takes the snap path and
   returns `commitStart: null`, so a non-null `CommitStartInfo` always
   reflects a momentum commit. The integrator does not read the field
   (it gates on `state.phase`); no diagnostic consumer reads it either.
   Fixed: now states the field is always `false` in Cycle 4, the
   integrator does not read it, and it is a placeholder for a possible
   Cycle-5 diagnostic consumer.
2. **`defaultNow` function docstring** (auditors A + B;
   `nav-executor.svelte.ts:73`). Said it "falls back to `Date.now()` in
   SSR" - but `performance` is defined in every runtime this project
   ships (Bun, Node, Cloudflare Workers, workerd; verified empirically),
   so the `Date.now()` branch is dead code. The function returns
   `performance.now()` in SSR too. This contradicted the R1-corrected
   `NavExecutorClockFn` docstring eleven lines above. Fixed: now states
   the function returns `performance.now()` in every shipped runtime and
   the `Date.now()` branch is dead code retained only as a fallback.

## What was verified clean

Both auditors verified the substantive Cycle-4 invariants hold:
integrator math (`s(u)=2u-u²`, `T = 2·Δprogress/|progressVel|`, sign
convention, near-zero / wrong-direction / clamp fallbacks, commit/cancel
symmetry); the structural invariant (one rAF write per property; no
CSS transitions / setTimeout / setInterval / getComputedStyle / .m41);
reduced-motion snap; interruption handoff (no jump); SSR `browser` gate;
no DOM read-back (write-only driver); shadow mode (empty `git diff HEAD`
against all existing gesture components and Cycle 1-3 outputs); all 18
`Cycle 5` references properly qualified; all R1 fixes present; all
pasted journal numbers (40/135, 439/1929, 1448 files, 55 similar pairs).

## State after R2 fixes

40/40 unit tests pass across the two new suites (135 expect() calls);
`bun run check` 0 errors / 0 warnings; `bun run lint` exit 0; shadow
mode preserved; no em-dashes.

Consecutive pass votes: **0** (R2 carried two code-comment concerns).
