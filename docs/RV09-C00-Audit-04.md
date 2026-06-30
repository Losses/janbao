# RV09-C00 - Implementation Audit Round 04

5 role-less full auditors (architecture + code quality) re-reviewed the DV09 implementation under an OPEN-ENDED audit standard after the Round-3 revision (cross-document sampler, 1800ms window, forward intermediate-value assertions, onDestroy browser-guard, active-gesture-track docstring reword): "independently find ANY defect empirically; do not trust the journal or that e2e passes; sample real trajectories not endpoints; assess whether each e2e assertion actually exercises the required behavior." vs `docs/DV09-Plan.md` (5/5 FINAL) + the post-Round-3 working-tree diff. Result: **1 acceptable / 3 changes_requested / 1 inconclusive (rate-limit) → revised**. `organicIntegration` = **clean for all 5 reviewers' verdicts**.

Workflow: a single consolidated review of the converged verdicts, distilled from the five independent reviewers' notes. The convergent finding is ONE PRODUCT-correctness defect (A1, a compose-back transition snap uncovered by the existing suite) plus two TEST-RELIABILITY bugs in the e2e helpers (A2/A3) and one coverage gap (A4). The single acceptable reviewer signed off on the layer; the three changes_requested reviewers independently surfaced A1 (Reviewer #3 primary) and the test-helper bugs (Reviewers #2, #4); the inconclusive reviewer hit a tooling rate-limit and could not finish, deferring to the majority.

## Tally

| Auditor | Verdict           | Blocking | Concerns | Organic | Confidence       |
| ------- | ----------------- | -------- | -------- | ------- | ---------------- |
| 1       | acceptable        | 0        | 2        | clean   | high             |
| 2       | changes_requested | 2        | 3        | clean   | high             |
| 3       | changes_requested | 1        | 3        | clean   | high             |
| 4       | changes_requested | 2        | 2        | clean   | high             |
| 5       | inconclusive      | 0        | 0        | clean   | n/a (rate-limit) |

## A1 - compose-back transition snaps instead of ramping (HIGH, PRODUCT defect, 3/5 blocking; Reviewer #3 primary)

**The defect.** On `/messages/new` -> `/messages/inbox` (and generally any compose->list back-nav), the FAB scale jumps 0 -> 1 in one frame instead of easing over the 200ms CSS transition. The discussions variant (`/post/discussion` -> `/`) ramps only by flush-ordering luck; the messages variant snaps deterministically. The existing Family C back spec covered only the discussions variant, so the suite passed despite the snap.

**Root cause.** `transitionEnabled` gated the CSS-transition class to `fabConfig?.family === 'compose'` (FloatingActionButtonLayer.svelte). On a compose->list back-nav the destination route's family is `list`, so the class stripped at the same flush as the foregroundFraction 0->1 swap. Nothing eased the scale change. The discussions variant ramped because its destination route (`/`, tabIndex 0) happens to flush in an order where the class lingered one frame; the messages variant (destination `/messages/inbox`, tabIndex 2) flushes through a different `fabConfig` branch and the class stripped cleanly.

**Evidence.** A rAF probe sampling `getComputedStyle(fab).transform` across each back-nav (captured in this round, deleted after) confirmed the snap on the messages route and the ramp on the discussions route. Post-fix, both routes ramp:

```
(a) /post/discussion -> / :        n=74, traj=[0,0,0.13,0.26,0.38,0.49,0.59,0.68,0.77,0.84,0.91,0.96,0.99,1,...]
(b) /messages/new -> /messages/inbox: n=72, traj=[0,0,0,0.13,0.26,0.38,0.49,0.59,0.68,0.77,0.84,0.91,0.96,0.99,1,...]
```

**Fix.** A `familyCInFlight` flag latches when the active family swaps across the compose<->list boundary (either direction) and holds for `FAMILY_C_TRANSITION_WINDOW_MS = 280` (slightly longer than the 200ms ease). `transitionEnabled = (fabConfig?.family === 'compose' || familyCInFlight) && !samplerActive && !pager.dragging && !forwardNavHoldoverActive`, so the class stays armed across the boundary for the full swap on BOTH routes and in BOTH directions. A `$effect` observes `fabConfig.family`, compares against `previousFamily`, and arms the latch on a compose<->list swap; a swap to/from Family A/B (overlay, sampler-driven) clears the latch early so the CSS class does not fight the per-frame sampler. The timer is cleared in `onDestroy` (browser-guarded). Families A/B stay continuous via the sampler (the latch never arms for them); the fix does NOT widen the transition to them.

## A2 - trimTrailingNoise broken for trailing post-settle spikes (MEDIUM, TEST-RELIABILITY, 2/5 blocking; Reviewers #2, #4)

**The defect.** The backward-scan consumed a spike SANDWICHED between terminals but not a trailing `[...,0,0,1,0,0]` or `[...,0,0,1,0]` post-settle spike (the FAB briefly reports scale 1 after settling at 0, before the destination route unmounts the atom). Untrimmed, `assertNonIncreasingWithinTolerance` flagged the 0->1 jump and Family A flaked ~25-40% on correct code.

**Fix.** Rewritten as a FORWARD scan: find the first index where a >=2-sample terminal run begins, extend the plateau forward over sustained terminal samples, discard everything from the first non-terminal sample onward. A real monotonic trajectory does not leave the terminal zone once it settles, so the first sustained plateau is the end of the meaningful trajectory. Verified against `[...,0.05,0,0,1,0,0]`, `[...,0.05,0,0,1,0]`, and the symmetric scale-in `[...,0.95,1,1,0,1,1]` (all four documented cases pass a standalone check).

## A3 - Family B back first-sample too strict for CDP (MEDIUM, TEST-RELIABILITY, 2/5 blocking; Reviewer #2)

**The defect.** `swipeBack` dispatches all touchMoves synchronously before the first rAF, so the first sampled frame lands mid-drag (~0.5), not at rest. The `samples[0] < 0.2` assertion failed on correct code under CDP.

**Fix.** The first-sample assertion is relaxed to `min(samples[0..2]) < 0.2` (a near-zero sample within the first 3 frames). The resting state IS scale 0 (verified: the back-swipe trajectory begins at 0 and rises). The real trajectory-shape guards (monotonic non-decreasing, the 0.5 mid-window crossing, an intermediate in (0.3,0.7), last > 0.9) carry the assertion weight.

## A4 - messages-variant Family C back spec missing (MEDIUM, COVERAGE, 2/5; Reviewer #3)

**The gap.** The Family C back spec covered only `/post/discussion` -> `/`. The messages variant (`/messages/new` -> `/messages/inbox`) had no spec; this is the spec that would have caught A1.

**Fix.** A `/messages/new` -> `/messages/inbox` Family C back spec is added, asserting the SAME trajectory shape as the discussions variant (>=6 samples, monotonic non-decreasing, first < 0.2, last > 0.85, 0.5 mid-window crossing, intermediate in (0.3,0.7)).

## A5 - stray probe files (LOW, PROCESS, 2/5; Reviewer #4)

A read-only `git status` and an exhaustive `find e2e` scan found ZERO stray reviewer probe files in the shared tree. The only e2e file DV09 ships is `e2e/fab.spec.ts`. A5 is a no-op (probes were already absent).

## Notable concerns (non-blocking)

- **Family B forward steepness (#1).** The Family B forward trajectory drops 1 -> 0.83 -> 0 over ~3 frames, steeper than the back-swipe's 0 -> 1 over ~10 frames. Acceptable: the forward-enter track snaps faster than the back-swipe drags, and the sampler follows the track 1:1. The intermediate-value assertion (a sample in (0.3,0.7)) holds.
- **Sampler destination-doc arm gap (#2).** Across a route swap the source track unbinds (sampler disarms) before the destination track binds (sampler re-arms); the sampler gap holdover bridges the gap. Acceptable: empirically no flash on either route (Round-2/3 trajectories).
- **Forward holdover timing skew under contention (#3).** The forward-nav holdover's release timing rests on empirical not structural proof. Acceptable; re-verify on any GPL rAF change.
- **Messages-thread Family B e2e gap (#5).** The messages-thread back-swipe path has no dedicated e2e (the seed baseline has no populated conversation). Math is symmetric with the discussions path and unit-covered. Acceptable.

## Round-4 revision decisions (implemented)

1. **A1 - compose-back transition armed across the boundary.** `familyCInFlight` latch added; `transitionEnabled` widened to `(family === 'compose' || familyCInFlight) && ...`. Latch arms on a compose<->list family swap observed by a `$effect` reading `fabConfig.family`; clears via 280ms timer or on a non-C swap; timer cleared in `onDestroy`. Families A/B unaffected.
2. **A2 - trimTrailingNoise forward-scan.** Rewritten to find the first sustained terminal plateau and discard everything after.
3. **A3 - Family B back first-sample relaxed.** `min(samples[0..2]) < 0.2`.
4. **A4 - messages-variant Family C back spec.** Added; same trajectory shape as discussions variant.
5. **A5 - probe cleanup.** No-op (probes absent).
6. **Journal.** A "C00 Round-4 revision" section appended to `docs/DV09-C00-Journal.md` documenting A1/A2/A3/A4/A5, the dual-route C-back trajectories, the multi-run stability evidence, and the re-verify results.

## Dual-route Family C back trajectories (empirical evidence)

Captured via a temporary rAF probe (deleted after) reading `getComputedStyle(fab).transform` across each back-nav. Both routes ramp smoothly through 0.5 mid-window (not a step):

```
(a) /post/discussion -> / (discussions):
    n=74, first=0.00, last=1.00, min=0.00, max=1.00
    traj=[0,0,0.13,0.26,0.38,0.49,0.59,0.68,0.77,0.84,0.91,0.96,0.99,1,1,...]

(b) /messages/new -> /messages/inbox (messages):
    n=72, first=0.00, last=1.00, min=0.00, max=1.00
    traj=[0,0,0,0.13,0.26,0.38,0.49,0.59,0.68,0.77,0.84,0.91,0.96,0.99,1,1,...]
```

## Multi-run stability evidence

`bun run test:e2e e2e/fab.spec.ts` run 5 times in an ISOLATED worktree (own `node_modules` via `bun install`, own `.svelte-kit`, dev DB symlinked, dedicated `E2E_PORT=5184`, `reuseExistingServer: false`):

```
RUN 1: 14 passed (35.2s)
RUN 2: 14 passed (35.4s)
RUN 3: 14 passed (34.9s)
RUN 4: 14 passed (34.6s)
RUN 5: 14 passed (35.2s)
```

70/70 across 5 runs, zero flakes. The 14th spec is the new messages-variant Family C back spec (A4).

## Re-verify (post-Round-4)

- `bun run check`: **0 errors / 0 warnings** (1431 files).
- `bun test src/`: **206 pass / 0 fail**.
- `bunx tsc --noEmit -p e2e/tsconfig.json`: **EXIT 0**.
- `bunx eslint` on the changed files: **0 errors**.
- `bin/similarity-ts ./src --types`: **EXIT 0** (46 similar pairs below the hard-duplicate threshold; same set as clean master).
- `bun run lint`: exits 1 only on the pre-existing `src/app.css` prettier nit (reproduces on clean master at `a8693dd`; DV09 does not touch `app.css`).
- `bun run test:e2e e2e/fab.spec.ts`: **14 pass / 0 fail** (5/5 isolated runs, see above).
- Full e2e suite (isolated worktree): **89 pass / 1 fail**. The single failure is the pre-existing `header-tabs-replay` gesture-timing flake (documented in Audit-01/02/03; reproduces on a clean-master worktree baseline; the DV09 diff does not touch the header-tabs-replay subsystem).
- Organic-clean: shared primitives contain zero DV09-introduced `fab`/`post`/`messages`/`discussions` tokens.

## Loop-exit status

Round 5 pending. The compose-back snap (A1) is fixed and empirically verified on BOTH routes; the test-helper bugs (A2/A3) are fixed; the coverage gap (A4) is closed. Round 5 should re-confirm the open-ended audit standard holds with the latch in place and scrutinize the latch timing/interactions flagged in the journal's Round-4 concerns.
