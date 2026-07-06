# RV20-C04 - Audit Round 01 (2-auditor model)

First audit round for Cycle 4 (Layer 5 executor), under the v2
(no-borderline) classification. Two auditors (A, B) examined the CMA4
output. Result: **0/2 PASS** (both FAIL). Five unique code-comment
concerns; one (`setReducedMotion`) flagged by both. The CMA4 pre-report
docstring sweep caught two of its own (`defaultNow` referencing
`swipe.ts`; `activePlan` getter omitting `stop`); R1 found five more.

## Prompt sent (clean, non-leading)

Context: Cycle 4 built Layer 5 in shadow mode (five new files; injected
DOM-driver; no real-DOM wiring; no modification of existing gesture
components). Open instruction to find any defect empirically, re-run
gates, verify the velocity-matched integrator (variable duration, not
hardcoded), the structural invariant (one rAF write per property),
interruption, reduced-motion snap, SSR gate, no DOM read-back, shadow
mode. v2 no-borderline classification included (forward-looking
Cycle-5 claims in the present tense are concerns). No prior-round
framing.

## Auditor verdicts

- **Auditor A: FAIL.** Four concerns (`NavExecutorClockFn`,
  `setReducedMotion`, `clear`, `tickFrame`) + two journal nitpicks.
  Re-ran every gate, verified the integrator math (`s(u)=2u-u²`,
  `T = 2·Δprogress/|progressVel|`, sign-guard, fallbacks, clamp),
  reduced-motion snap, interruption no-jump, SSR gate, shadow mode,
  and all pasted numbers.
- **Auditor B: FAIL.** Two concerns (`FrameSample.done`,
  `setReducedMotion`). Same gate re-runs and behavioral checks.

## Concerns (all blocking, all fixed)

1. **`FrameSample.done` docstring** (auditor B;
   `nav-executor-logic.ts:292`). Said the shell "emits the post-commit
   `onLand` boundary event" when `done`, but the shell's `#tick` only
   stops rescheduling; `onLand` has zero callers (the Cycle-5
   orchestrator observes `done` and emits the land). Fixed: now states
   the shell does NOT emit `onLand` and the Cycle-5 orchestrator does.
2. **`setReducedMotion` docstring** (auditors A + B;
   `nav-dom-driver.ts:107`). Claimed it is "used by the suite that
   exercises both the snap path and the momentum path against the same
   driver instance" - no such suite exists; only the mock-driver
   self-test calls it (getter flip), and the executor-logic suite
   constructs a fresh driver per test. Fixed: now describes the actual
   mock-driver self-test usage.
3. **`NavExecutorClockFn` docstring** (auditor A;
   `nav-executor.svelte.ts:49`). Said "returning epoch milliseconds,"
   but the browser default is `performance.now()` (a
   `DOMHighResTimeStamp` relative to navigation start, NOT epoch); the
   `Date.now()` SSR fallback never runs (rAF is browser-gated). The two
   also have different reference points. Fixed: now describes the
   actual `performance.now()` semantics and notes the Cycle-5
   shared-time-base item.
4. **`clear()` docstring** (auditor A; `nav-dom-driver.ts:120`). Said
   "used between sub-tests that reuse the same driver instance" - no
   test reuses a driver across sub-tests; each constructs a fresh one.
   Fixed: now describes the actual mock-driver self-test usage (assert
   write-count drops, flag survives).
5. **`tickFrame` docstring** (auditor A;
   `nav-executor-logic.ts:375`). Said it is "used by the unit suite to
   drive the per-frame sequence in a single statement" - it is called
   once for a single-step assertion; the sequence tests call
   `sampleFrame` in a loop. Fixed: now describes the single-step use
   and notes the sequence tests use `sampleFrame` directly.

## Nitpicks (journal `.md`, non-blocking, to fix)

- **N1:** the journal's "Pure-half unit suite built" says "33 tests
  across six describe blocks." 33 tests is correct; the count is eight
  describe blocks, not six.
- **N2:** the journal's architecture decision 5 maps orchestrator
  sub-phases `committing/cancelling -> 'committing', others -> 'idle'`,
  which sends `'scrubbing'` (a live drag across a route boundary) to
  `'idle'` rather than `'live'`. The `.ts` docstring on `ExecutorPhase`
  does NOT repeat this mistake (it enumerates only the three executor
  states without the wrong many-to-one mapping), so this is journal
  prose only. Corrected in the journal.

## What was verified clean

Shadow mode (empty `git diff HEAD` against MobileTabPager /
GesturePageLayout / swipe.ts / route-data / page-cache / the Cycle 3
outputs); the velocity-matched integrator math (duration scales with
release velocity; near-zero fallback; high-velocity clamp;
wrong-direction fallback; sign preservation); reduced-motion snap;
interruption handoff (no jump - `visualAtInterrupt` matches
`visualAtNewDrag`); SSR `browser` gate; no CSS transitions / setTimeout
in the new code; no DOM read-back (write-only driver); all pasted
journal numbers (40/135 new-suite, 439/1929 src/lib, 1448 files, 55
similar-type pairs including the three Cycle-4 pairs at 96.00 /
94.67 / 93.14%).

## State after R1 fixes

40/40 unit tests pass across the two new suites (135 expect() calls);
`bun run check` 0 errors / 0 warnings; `bun run lint` exit 0; shadow
mode preserved; no em-dashes.

Consecutive pass votes: **0** (R1 carried five code-comment concerns).
