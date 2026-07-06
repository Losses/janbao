# RV20-C04 - Audit Round 03 (2-auditor model)

Third audit round for Cycle 4. Two auditors (A, B) examined the
post-R2 state. Result: **0/2 PASS**. Four unique concerns: three
code-comment accuracy + one substantive (the SSR gate had no unit
test, though the spec lists it as a deliverable). All four fixed; the
SSR-gate fix extracted a pure `shouldScheduleRaf` helper (mirroring
`solveCommitDuration`) so the gate now has unit coverage. The
implementation logic was again verified clean by both auditors.

## Auditor verdicts

- **Auditor A: PASS-WITH-CONCERNS.** One concern (the wrong-direction
  fallback comment said "so the cancel still settles smoothly" but the
  branch is plan-agnostic - the test exercises it with a commit plan).
  Two nitpicks: an unrelated untracked doc (`dev-story-mobile-layout.md`)
  not summarized in the journal, and the SSR-gate-as-deliverable
  question (A read it as a spec-internal nitpick).
- **Auditor B: FAIL.** Three concerns: the `state`/`progress` getter
  docstrings use present-tense "Consumers read" with no Cycle-4
  qualifier (zero current consumers); the test header labelled the
  idle-no-op as "SSR"; and the missing SSR-gate unit test (the spec's
  deliverable list includes "SSR gate" but the gate lived only in the
  reactive shell, untestable under `bun:test`).

## Concerns (all blocking, all fixed)

1. **Wrong-direction fallback comment** (auditor A;
   `nav-executor-logic.ts:207`). Said "so the cancel still settles
   smoothly," but the branch fires for any wrong-direction velocity
   (commit-with-reversed OR cancel-with-reversed); the test exercises it
   with a commit plan. Fixed: now plan-agnostic ("so the settle still
   plays smoothly... fires for either direction").
2. **`state` / `progress` getter docstrings** (auditor B;
   `nav-executor.svelte.ts:104,116`). Present-tense "Consumers read..."
   with zero current consumers. Fixed: qualified "in the integrated
   pipeline...; in Cycle 4 shadow mode there is no consumer."
3. **Test header "SSR / idle no-ops" mislabel** (auditor B;
   `nav-executor-logic.test.ts:19`). Labelled the pure-half idle no-op
   as an SSR test; the SSR gate lives in the reactive shell. Fixed: the
   bullet now reads "idle no-ops" and a separate bullet covers the SSR +
   single-flight gate (the new `shouldScheduleRaf` test).
4. **Missing SSR-gate unit test** (auditor B; auditor A read it as a
   nitpick - B's reading is binding, the spec lists "SSR gate" as a
   deliverable). The gate was only in `#ensureRaf`'s `if (!browser)
return`. Fixed: extracted `shouldScheduleRaf(isBrowser, rafInFlight)`
   into the pure half; the shell's `#ensureRaf` now calls it; the unit
   suite covers all four `(isBrowser, rafInFlight)` combinations
   (browser+idle schedules; browser+in-flight does not; SSR never
   schedules).

## Auditor divergence note

A and B disagreed on whether the missing SSR-gate test is a concern (A:
nitpick; B: blocking concern). The spec's deliverable list explicitly
names "SSR gate" under unit tests, so B's reading (missing deliverable =
concern) is binding. Resolved by extracting the helper + adding the
test.

## What was verified clean

Both auditors verified the implementation invariants: integrator math
(`s(u)=2u-u²`, `T = 2·Δprogress/|progressVel|`, sign convention, all
fallback/clamp branches); the structural invariant (one rAF write per
property; no CSS transitions / setTimeout / getComputedStyle / .m41);
reduced-motion snap; interruption handoff (no jump); SSR gate present;
no DOM read-back; shadow mode (empty `git diff HEAD` against all
existing gesture components and Cycle 1-3 outputs); all R1/R2 fixes
present; all pasted journal numbers (40/135 at R3's read, 439/1929,
1448 files, 55 similar pairs).

## State after R3 fixes

41/41 unit tests pass across the two new suites (139 expect() calls;
+1 `shouldScheduleRaf` test); `bun run check` 0 errors / 0 warnings;
`bun run lint` exit 0; `bun test src/lib` 440/0/1933; shadow mode
preserved; no em-dashes.

Consecutive pass votes: **0** (R3 carried four concerns; the
implementation logic has been auditor-verified clean across R1, R2,
R3).
