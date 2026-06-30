# RV09-C00 - Implementation Audit Round 02

5 role-less full auditors (architecture + code quality) re-reviewed the DV09 implementation after the Round-1 revision (kept FAB atom mounted on overlay/compose routes, added the Family C CSS transition, reworded the leaking comments, corrected the journal) vs `docs/DV09-Plan.md` (5/5 FINAL) + the post-revision working-tree diff. Result: **2 changes_requested / 2 acceptable / 1 inconclusive (API 429 rate-limit) → revised**. `organicIntegration` = **clean for all 4 verdict-bearing reviewers** (the shared primitives still contain no `fab`/`post`/`messages`/`discussions` tokens; `git diff --stat` on the enumerated untouched targets is empty).

Workflow: a single consolidated review of the converged verdicts, distilled from the five independent reviewers' notes (the convergent blocker is the 2 `changes_requested`; the secondary findings are tallied by how many of the five flagged each). Round-3 input is the revision described in "Round-2 revision decisions".

## Tally

| Auditor | Verdict           | Blocking | Concerns | Organic | Confidence |
| ------- | ----------------- | -------- | -------- | ------- | ---------- |
| 1       | changes_requested | 1        | 1        | clean   | high       |
| 2       | changes_requested | 1        | 2        | clean   | high       |
| 3       | acceptable        | 0        | 3        | clean   | high       |
| 4       | inconclusive      | -        | -        | -       | - (429)    |
| 5       | acceptable        | 0        | 3        | clean   | high       |

## Blocking issue (deduplicated, the convergent finding)

**Family B is not gesture-driven + the Family B e2e specs are tautological (HIGH, 2/5 blocking; empirically reproduced by both blockers, independently).** The Round-1 revision kept the FAB atom mounted on overlay routes and routed `foregroundFraction` through `listForegroundFromThreadCover(pxToFraction(m41, panelWidth))` on the paper assumption that `m41` is the live GPL track transform during a drag. It is not. On a thread route the GPL publishes `fractionalIndex = centerTab` (CONSTANT) throughout the drag (`GesturePageLayout.svelte:347-360`); the rAF sampler (which reads the live track `m41`) is suppressed during drag; the drag branch therefore reads `tabFraction(pager.fractionalIndex, tabIndex)`, which pins at 1 the instant a drag begins.

Empirical trajectory captured by both blockers via `getComputedStyle(fab).transform` sampled across a real Family B back-swipe (thread -> list): the FAB scale is **1 for the entire drag**. It does not ramp 0 -> 1 over the second half as the plan §4.3 / §6.5 require. The forward tap appears to work only because the atom's own CSS transition (`transition: transform 200ms ease-out`) approximates the ease over the route swap; the journal's claim that "Family B is sampler-driven" is inaccurate for the forward direction and flatly wrong for the back-swipe direction.

The Family B e2e specs pass anyway because they assert only endpoints (`firstScale` / `maxScale` / `lastScale`) and never the trajectory. Reviewer #2 additionally observed a spurious delayed `1 -> 0 -> 1` blink at the resting resolve, because `transitionEnabled = !samplerActive` suppresses the CSS transition at exactly the moment the resting scale resolves.

The two `acceptable` reviewers trusted the journal's "sampler-driven" claim and the "e2e passes" signal; the two `changes_requested` reviewers ignored both and sampled the real `getComputedStyle(fab).transform` across the real gesture. The convergent finding is the trajectory evidence, not the verdict split.

## Notable concerns (non-blocking, by reviewer)

- **Journal "sampler-driven" inaccuracy (#2).** `docs/DV09-C00-Journal.md` states Family B is sampler-driven. The CSS transition carries the forward direction; the back-swipe direction is broken. The journal must be corrected to state which mechanism carries each direction.
- **`transitionEnabled` twice-flip (#3).** `transitionEnabled` flips twice per Family C transition (journal said once). Non-blocking; the second flip is masked by the 200ms ease.
- **`samplerHasPublished` stale-latch (#5).** `samplerHasPublished` is not reset in `stopSampler`. Theoretical stale-latch gap, masked in practice by the per-arm reset in `startSampler`.
- **`|| navInFlight` dead term (#3).** A dead `|| navInFlight` term in `forwardNavHoldoverActive`. Non-blocking; the other disjunct covers the case.
- **Holdover-release timing rests on empirical not structural proof (#3).** The holdover-release timing is verified empirically, not from a structural argument. Acceptable for now; re-verify on any GPL rAF change.
- **messages-thread Family B path uncovered by e2e (#5).** The messages-thread back-swipe path has no dedicated e2e. Math is symmetric with the discussions path and unit-covered; e2e gap is acceptable.
- **`RV09-C00-Audit-01.md` trips prettier (#5).** A markdown table pipe in the Round-1 doc trips prettier. Cosmetic; correct when the doc is next touched.

## Process honesty: Round-2 prompt bias

Round 2's review prompt was framed as "verify the Round-1 fixes," with the attack-surface bullets describing the specific fixes (Family B fix, Family C fix, comment rewording, journal correction). This biased the auditors toward CONFIRMING the described fixes rather than independently determining correctness, and focused them on the delta instead of the whole implementation. The two reviewers who IGNORED the framing and sampled the actual `getComputedStyle(fab).transform` across the real gesture found the defect. The two who trusted the journal plus the "e2e passes" signal accepted it. A fair, open-ended audit would have had all five find it.

The audit standard has been corrected for Round 3: prompts now lead with "independently find ANY defect empirically; do not trust the journal or that e2e passes; sample real trajectories not endpoints; assess whether each e2e assertion actually exercises the required behavior."

## Round-2 revision decisions (implemented)

1. **Family B is sampler-driven in BOTH directions.** A new pure helper `familyNeedsSamplerDuringDrag(family)` (true for the overlay family) gates sampler arming during a Family B drag. The layer routes `foregroundFraction` through `listForegroundFromThreadCover(pxToFraction(liveGPLTrackM41, panelWidth))`, so the back-swipe scales 0 -> 1 over the second half (finger-following) and the forward-enter scales 1 -> 0 over the first half. The CSS transition no longer carries Family B.
2. **`chipExitActive` gated to cross-tab list-route navs only.** A same-tab back-swipe or an overlay-compose nav no longer drops the post-commit snap to scale 0.
3. **`transitionEnabled` gated to `family === 'compose'` only.** Clean A/B-vs-C separation. The CSS transition no longer approximates Family B, removing the spurious `1 -> 0 -> 1` blink and the twice-flip artifact.
4. **Sampler gap-holdover across the route-swap instant.** `forwardNavHoldoverActive` is gated on `!pager.dragging`; the wall-clock cap is raised 800 -> 2000ms to cover the route-swap bind gap.
5. **e2e rewritten to sample the trajectory, not endpoints.** `e2e/fab.spec.ts` now samples `getComputedStyle(fab).transform` via a rAF dialog and asserts: `sampleCount >= 6`, monotonicity (with trailing-noise trim), a 0.5 crossing inside the window, and for the Family B back-swipe a sample strictly in `(0.3, 0.7)` mid-swipe.
6. **Journal correction.** `docs/DV09-C00-Journal.md` corrected to state that Family B is sampler-driven in both directions and that the CSS transition carries Family C only.

Empirically sampled trajectories post-fix: back-swipe n=68 ramps 0 -> 1 second half; forward tap n=23 drops 1 -> 0 first half; tab swipe n=33 smooth descent; compose n=27 CSS-eased. All cross 0.5 mid-window.

Re-verify: `bun run check` 0/0; `bun test src/` 206/0; `e2e/fab.spec.ts` 13/13; full suite 88/1 (only the pre-existing `header-tabs-replay` failure, confirmed via a separate worktree baseline).

## Loop-exit status

Round 3 (open-ended audit standard) concluded; see `docs/RV09-C00-Audit-03.md`.
