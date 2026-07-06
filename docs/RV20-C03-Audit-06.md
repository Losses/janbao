# RV20-C03 - Audit Round 06 (2-auditor model)

Third real-time round under the v2 concern/nitpick classification. Two
auditors (A, B) examined the post-R5 state. Result: **0/2 PASS** (both
PASS-WITH-CONCERNS). Both found one code-comment concern each; the two
are in different files and are independent. R6 does not close the cycle
(Auditor A's concern resets the consecutive-pass counter from 2 to 0).

## Prompt sent (clean, non-leading)

Identical in shape to R4/R5: independent audit, read-only, context
(Cycle 3 Layers 1-4 in shadow mode, five files + four suites + spec +
plan sections), open instruction to find any defect empirically,
re-run gates, cross-check pasted numbers, verify TransitionPlan (§4),
dispatch, coordinator, reducer totality, phase transitions (§6),
shadow mode, resolver purity, code-comment accuracy. v2 classification
included. No prior-round framing.

## Auditor verdicts

- **Auditor A: PASS-WITH-CONCERNS.** One concern (`reversed` docstring)
  - four observations (the interrupt-reducer comment's breadth, missing
    resolved-from-cancelling coverage, onLand SSR branch, cancel-reducer
    wording). Re-ran every gate, verified dispatch/coordinator/reducer
    totality, R4 `interrupt`/`reset` fixes, shadow mode, FAB/Header math.
- **Auditor B: PASS-WITH-CONCERNS.** One concern (test header phase
  sequence) + nitpicks (journal similar-pairs prose; the 'scrubbing'
  and `progressDirectionFor` forward-looking observations already
  carried). Same gate re-runs and architectural checks.

## Convergent concerns (each raised by one auditor, blocking)

1. **`IntentState.reversed` docstring was misleading** (auditor A;
   `src/lib/utils/nav-intent.ts:111-113`). It claimed "The resolver
   reads this to pick `progressDirection`," but the resolver reads
   `intent.micro` (`progressDirectionFor`, `nav-resolvers.ts:222`), and
   `reversed` is read only by the classifier's own pointerup case to
   set `micro`. The `nav-resolvers.ts:220` docstring contradicted the
   claim. Fixed: the `reversed` docstring now states it is read by the
   classifier's pointerup case to choose the release `micro`, and that
   the resolver reads `micro`, not this flag.

2. **Test-suite header phase sequence included `resolving`** (auditor
   B; `src/lib/stores/nav-state-machine-logic.test.ts:1-12`). It listed
   "at-rest -> intent -> resolving -> transitioning -> landing," but no
   Cycle-3 event produces `'resolving'` (R3 reverted that; `'resolving'`
   is reserved for Cycle 5 per `nav-state-machine-logic.ts:42-44`). The
   file's own describe block (`at-rest -> intent -> resolved`) confirms
   the real sequence. Fixed: the header now lists the produced sequence
   (at-rest -> intent -> transitioning -> landing) with a note that
   `'resolving'` is reserved for Cycle 5 and never traversed by this
   suite.

3. **Interrupt-reducer comment under-described breadth** (auditor A,
   flagged borderline). The comment said "a new intent arrives
   mid-commit" but the guard accepts interrupt from any transitioning
   sub (dragging/committing/cancelling/scrubbing), not only committing.
   Tightened: "mid-transition, during any transitioning sub."

## Nitpicks (do not block PASS)

- **Journal similar-pairs prose was factually wrong** (auditor B). The
  journal claimed the 52 similar-type pairs are "pre-existing (none
  reference the new `nav-*` types at >=90% duplication)." Three of the
  52 DO reference a `nav-*` type: `VelocitySample`↔`PositionSample`
  96%, `VelocitySample`↔`Sample` (swipe.test) 95%, and
  `BuildInput`↔`CoordinatorInput` 92%. The gate exits 0 (type
  duplicates = 0; these are informational similar-pairs). Fixed: the
  journal's lint section now enumerates the three pairs and explains
  why each is acceptable (the VelocitySample/PositionSample overlap is
  transitory until Cycle 5 replaces `swipe.ts`; unifying now would
  break shadow-mode isolation; BuildInput↔CoordinatorInput is a
  test-fixture builder). The same correction was applied to
  `RV20-C03-Audit-05.md`.
- The `'scrubbing'` sub and the `progressDirectionFor` `'cancelled'`
  branch are forward-looking (already carried; left as-is).

## State after R6 fixes

92/92 unit tests pass across the four pure-half suites; `bun run check`
0 errors / 0 warnings; `bun run lint` exit 0 (52 similar-type pairs, 3
transitory/test-fixture); shadow mode preserved.

Consecutive pass votes: **0** (R6 carried a blocking concern from each
auditor).
