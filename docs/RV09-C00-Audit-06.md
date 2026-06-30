# RV09-C00 - Implementation Audit Round 06

5 role-less full auditors (architecture + code quality) re-reviewed the DV09 implementation under an OPEN-ENDED audit standard after the Round-5 revision (atom `style:transform` value-binding fix, preventive SSR-style spec, messages-variant Family C forward spec, probe cleanup): "independently find ANY defect empirically; sample real trajectories not endpoints; assess whether each e2e assertion actually exercises the required behavior; re-confirm the SSR serialization holds and re-verify the preventive SSR-style spec's fails-old property by a targeted revert." vs `docs/DV09-Plan.md` (5/5 FINAL) + the post-Round-5 working-tree diff. Result: **3 acceptable / 1 changes_requested / 1 inconclusive → revised**. `organicIntegration` = **clean for all 5 reviewers' verdicts**.

Workflow: a single consolidated review of the converged verdicts, distilled from the five independent reviewers' notes. The convergent finding is a PRODUCT-CORRECTNESS consensus (no product defect this round) plus one TEST-COVERAGE gap (T1, the overlay route omitted from the preventive SSR spec on a false-403 rationale) and a cluster of TEST-RELIABILITY concerns on the acceptable reviewers' notes (T2 leading-spike monotonicity flake, T3 endpoint brittleness) and one comment inaccuracy (T4). The three acceptable reviewers and the inconclusive reviewer all confirmed every family ramps through 0.5 and the SSR serialization fix is correct and preventively tested; the single changes_requested reviewer flagged the overlay-SSR coverage gap as the blocker.

## Tally

| Auditor | Verdict           | Blocking | Concerns | Organic | Confidence |
| ------- | ----------------- | -------- | -------- | ------- | ---------- |
| 1       | changes_requested | 1        | 2        | clean   | high       |
| 2       | acceptable        | 0        | 1        | clean   | high       |
| 3       | acceptable        | 0        | 2        | clean   | high       |
| 4       | acceptable        | 0        | 2        | clean   | high       |
| 5       | inconclusive      | 0        | 1        | clean   | medium     |

## Product-correctness consensus (5/5)

Every reviewer who sampled a trajectory confirmed all three families ramp correctly:

- **Family A (tab swipe):** scale ramps 1 -> 0 across the drag, monotonic, crosses 0.5 inside the window, an intermediate in (0.3, 0.7) present.
- **Family B forward (list -> thread):** scale ramps 1 -> 0 across the GPL slide, monotonic, crosses 0.5, intermediate present, rests near 0.
- **Family B back (thread -> list):** scale ramps 0 -> 1 across the back-swipe, monotonic, crosses 0.5, intermediate present, rests near 1.
- **Family C forward (list -> compose, both source lists):** scale ramps 1 -> 0 across the 200ms CSS ease, monotonic, crosses 0.5, intermediate present.
- **Family C back (compose -> list, both source lists):** scale ramps 0 -> 1 across the 200ms CSS ease, monotonic, crosses 0.5, intermediate present.

The Round-5 SSR serialization fix (atom `style:transform` value-binding form) is confirmed correct on every reachable route via JS-disabled SSR fetch. The atom and layer are byte-identical to the Round-5 fix; the Round-6 changes are entirely in `e2e/fab.spec.ts`.

## T1 - overlay route omitted from the preventive SSR spec (HIGH, TEST-COVERAGE, Reviewer #1 changes_requested; 1/5 blocking)

**The defect.** The Round-5 SSR describe block asserted the resolved `transform` on the list routes (`/`, `/messages/inbox`) and the compose routes (`/post/discussion`, `/messages/new`) but excluded the overlay routes. Its comment claimed `/discussion/<id>` returns HTTP 403 and `/messages/[id]` returns HTTP 500, so neither overlay route is SSR-reachable for the admin id-0 session. The 403 claim is FALSE: a real seeded discussion deep-link `/discussion/<id>/<slug>` returns HTTP 200 for the admin session and SSRs the FAB atom at `transform: scale(0) translateY(0px)` with the overlay-family class string (`pointer-events-none` present, `fab-transition` absent). The 500 on `/messages/[id]` is real but pre-existing (mobile-tabs.ts:38, outside DV09); the FAB atom still renders on the SSR error page at scale 0. Plan §6.3 explicitly requires a raw-SSR assertion for the discussion overlay deep-link, so the omission left the overlay family uncovered by the preventive spec on a factual mistake, not deliberate scoping.

**Empirical confirmation.** Direct SSR-HTML inspection via `curl` (no JavaScript) against the running dev server, with the minted admin id-0 session cookie:

```
/discussion/<id>/<slug>   HTTP 200   style="transform: scale(0) translateY(0px); transform-origin: center;"
                                   class="...pointer-events-none"   (fab-transition ABSENT)
/post/discussion          HTTP 200   style="transform: scale(0) translateY(0px); transform-origin: center;"
                                   class="...pointer-events-none fab-transition"
/                         HTTP 200   style="transform: scale(1) translateY(0px); transform-origin: center;"
/messages/1               HTTP 500   (pre-existing mobile-tabs.ts:38) BUT the FAB atom still renders at scale 0
```

The overlay family (scale 0, no transition class) is DISTINCT from the compose family (scale 0, transition class present), so the compose routes do NOT prove the overlay serialization path; both must be covered.

**Fix (thorough).** The SSR describe block is restructured so each assertion carries a family classification (`list` / `overlay` / `compose` / `error-scale-0`) and asserts BOTH the resolved transform AND the family-specific class string. A new dynamic overlay test resolves a REAL seeded discussion id+slug at runtime by fetching the homepage SSR HTML and extracting the first `/discussion/<id>/<slug>` href via `firstOverlayDiscussionPath` (no hardcoded id; the test tracks the seed). A new messages error-page test asserts the pre-existing 500 AND that the FAB atom still renders a valid resolved transform on the error page. The false 403 rationale is deleted from the comment.

## T2 - Family B back monotonicity flaked ~1/3 under load (MEDIUM, TEST-RELIABILITY, Reviewer #3 on an acceptable verdict)

**The flake.** The Family B back trajectory is correct (0 -> 1, monotonic, 0.5-crossing), but CDP dispatches every `touchMove` synchronously before the first rAF, so the first sampled frame can land mid-drag (~0.5) instead of at the drag-start resting value (~0). That single leading sample is a harness artifact followed by the real trajectory; untrimmed it creates a leading spike that violates `assertNonDecreasingWithinTolerance`. The existing `trimTrailingNoise` handled only the trailing plateau.

**Fix (thorough).** A symmetric `trimLeadingArtifact` mirrors `trimTrailingNoise`: it finds the LAST sustained start-value plateau and discards everything before it. `assertNonDecreasingWithinTolerance` now applies BOTH trims before the monotonicity check. Verified against the CDP leading spike `[0.5, 0.09, 0.00, 0.00, 0.03, ..., 1.0]` and the documented trailing cases. Structural harness-artifact fix, not a tolerance loosening (the 0.25 tolerance is unchanged).

## T3 - Family C back `lastScale > 0.85` flaked ~20% under load (MEDIUM, TEST-RELIABILITY, Reviewer #4 on an acceptable verdict)

**The flake.** The Family C back trajectory is correct (0 -> 1, monotonic, 0.5-crossing, intermediate present), but the absolute LAST sample dips to ~0.84 because the 1.8s sampler window cuts off ~16ms before the 200ms CSS ease fully settles under load. The timing-sensitive endpoint assertion `capture.samples[last] > 0.85` then fails on a correct run.

**Fix (thorough).** The brittle endpoint assertion is replaced by a robust trajectory-SHAPE assertion (`assertScaleInCompletedShape`): the trajectory REACHED near-1 at some point (`maxScale > 0.9`), it is monotonic non-decreasing, and it crossed 0.5 inside the window. Lowering the threshold to 0.83 was rejected as a band-aid; the shape assertion is the structural fix. Applied to BOTH Family C back variants (discussions and messages).

## T4 - `SAMPLER_WINDOW_MS` comment inaccuracy (LOW, DOC, Reviewer #1)

**The defect.** The spec comment claimed the 1800ms window "matches" the layer's `SAMPLER_TIMEOUT_MS = 2000`. It does not: 1800 < 2000.

**Fix (thorough).** The comment is corrected to state the actual relationship: the spec window is set 200ms SHORTER than the layer cap on purpose, with 200ms slack, so a correct run resolves and disarms within the window and the spec reads a settled trajectory rather than one cut off by the layer's own disarm. Both comment locations now state this truthfully.

## Round-6 revision decisions (implemented)

1. **T1 - dynamic overlay SSR coverage + family class-string assertions.** The SSR describe block restructured to assert family-specific class strings (overlay: `pointer-events-none` present, `fab-transition` absent; compose: both present; list: neither). New dynamic overlay test resolves the discussion id+slug from the homepage SSR. New messages error-page test documents the pre-existing 500 and asserts the atom still renders a valid transform. False 403 rationale deleted.
2. **T2 - symmetric noise-trim.** `trimLeadingArtifact` added mirroring `trimTrailingNoise`; `assertNonDecreasingWithinTolerance` applies both trims. Tolerance unchanged.
3. **T3 - robust trajectory-shape endpoint assertion.** `lastScale > 0.85` replaced by `assertScaleInCompletedShape` (`maxScale > 0.9` + monotonic + 0.5-crossing) on both Family C back variants.
4. **T4 - truthful window comment.** Both comment locations corrected to state 1800ms is 200ms shorter than the 2000ms layer cap, on purpose.
5. **Journal.** A "C00 Round-6 revision" section appended to `docs/DV09-C00-Journal.md` documenting each item's cause + structural fix, the dynamic overlay-id resolution, the multi-run stability evidence, and the re-verify results.

## Multi-run stability evidence

`bun run test:e2e e2e/fab.spec.ts` run 4 times on dedicated fresh dev servers (`E2E_PORT=5193/5194/5195/5196`, `reuseExistingServer: false`, system chromium via `executablePath`):

```
RUN 1 (port 5193): 21 passed (39.7s)
RUN 2 (port 5194): 21 passed (38.4s)
RUN 3 (port 5195): 21 passed (38.4s)
RUN 4 (port 5196): 21 passed (38.3s)
```

84/84 across 4 runs, zero flakes. The count rose from 19 (Round-5) to 21: +1 overlay SSR spec (dynamic id) +1 messages error-page SSR spec. The T2 leading-spike flake and the T3 endpoint flake are gone across all 4 runs. (The dev-server `[500] GET /messages/1` log lines and the `mobile-tabs.ts:38` stack trace during run 1 are the EXPECTED pre-existing 500 that the messages error-page test documents and asserts around; they are not test failures.)

## Preventive SSR test fails-old / passes-new (re-confirmed after Round-6)

With the atom reverted to the shorthand-bound-to-`$derived` defect form (`const transform = $derived(...)` + bare `style:transform`), the SSR describe block run in isolation returns **6 failed / 0 passed**, every failure reporting the exact defect signature:

```
Expected substring: not "function("
Received string: "transform: function(new_value) { ..."
```

The new overlay test and the messages error-page test are among the 6 failures, so the regression catch now covers the overlay family too. With the atom restored to the value-binding form, the same block returns **6 passed / 0 failed**. The preventive property holds after the Round-6 restructure (the family class-string and dynamic-overlay additions did not weaken the regression catch).

## Re-verify (post-Round-6)

- `bun run check`: **0 errors / 0 warnings** (1431 files).
- `bun test src/`: **206 pass / 0 fail**.
- `bunx tsc --noEmit -p e2e/tsconfig.json`: **EXIT 0**.
- `bunx eslint --no-warn-ignored` on the changed files (atom, layer, utils, store, `e2e/fab.spec.ts`): **0 errors**.
- `bin/similarity-ts ./src --types`: **EXIT 0** (46 similar pairs below the hard-duplicate threshold; same set as clean master).
- `bun run lint`: exits 1 only on the pre-existing `src/app.css` prettier nit (reproduces on clean master; DV09 does not touch `app.css`).
- `bun run test:e2e e2e/fab.spec.ts`: **21 pass / 0 fail** (4/4 isolated runs, see above).
- The DV09 e2e surface is unchanged outside `e2e/fab.spec.ts`; the new helpers (`firstOverlayDiscussionPath`, `assertScaleInCompletedShape`, `trimLeadingArtifact`, `extractFabTag`) are scoped to `fab.spec.ts`. The full-suite baseline (94 pass / 1 fail, the pre-existing `header-tabs-replay` gesture flake) is unchanged from Round-5; the DV09 diff does not touch the header-tabs-replay subsystem.
- Organic-clean: unchanged from Round-5. The shared primitives (`scroll-chrome.svelte.ts`, `MobileTabPager.svelte`, `GesturePageLayout.svelte`, `AppShell.svelte`, `+layout.svelte`, `active-gesture-track.svelte.ts`) contain zero DV09-introduced `fab`/`post`/`messages`/`discussions` tokens.

## Loop-exit status

Round 7 pending. The product-correctness consensus is unanimous this round (all three families ramp correctly; SSR serialization fixed and preventively tested). The one changes*requested item (T1 overlay SSR coverage gap) is fixed structurally (dynamic overlay coverage + family class-string assertions + messages error-page coverage, with the false-403 rationale deleted). The two reliability concerns (T2 leading-spike trim, T3 endpoint shape assertion) are fixed structurally (symmetric trim, robust shape assertion) and confirmed flake-free across 4/4 runs. The comment inaccuracy (T4) is corrected. Round 7 should re-confirm the multi-run stability holds (the T2/T3 fixes are recent) and scrutinize whether the dynamic overlay-id resolution is robust to a seed that renders discussion links with unusual slug characters (the regex character class `[A-Za-z0-9%*-]` is the surface to re-examine), and whether any new shorthand-bound-to-`$derived` form has appeared anywhere in the DV09 surface.
