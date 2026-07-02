# DV13-C00 - Implementation Journal

Development log for the DV13 search-back hamburger-arrow flash fix. Spec: `docs/DV13-Plan.md` (5/5 PASS, FINAL, unconditional, after 3 audit rounds). After implementation, a 5-agent role-less full audit (architecture + code quality, open-ended) runs in a loop; each round's verdicts are recorded in `RV13-C00-Audit-[NN].md`. Work is "done" only when a round returns 5/5 unconditional accept.

## Provenance of the fix expression

The fix expression `const iconProgress = $derived(isSearch || searchScrubbing ? 0 : 1 - morph);` was applied at `34da843` (the DV13 commit), the implementation of this plan. The prior commit `cee9142` (DV12) still held the pre-fix `const iconProgress = $derived(isSearch ? 0 : 1 - morph);` (verified via `git show cee9142:src/lib/components/organisms/Header.svelte`); the `__headerMorphProbe` sink committed there is an unrelated DV12 diagnostic. DV13 is the plan-driven fix: the plan (`docs/DV13-Plan.md`) derives the root cause, proposes the freeze-on-`searchScrubbing` discriminant, passes a 3-round 5-agent audit (`docs/DV13-Meeting/DV13-Audit-R1.md` .. `R3.md`), and the implementation applies and empirically confirms it. The working-tree diff captured here is the post-`34da843` refinement: a prettier normalization (redundant outer parens stripped, matching `slideT`'s paren-free style) and a comment cleanup, plus the e2e rewrite.

## Phase map

1. **Plan + plan-audit loop** (Phase A, complete): `docs/DV13-Plan.md` + 3 audit rounds, 5/5 PASS at Round 3.
2. **Implementation** (this phase): prettier-normalize the expression; clean the comment to current intent; rewrite the e2e to a regression guard with parametrized destination coverage.
3. **Verify**: `bun run check`, `bun run lint`, `bun test src/`, `bun run test:e2e e2e/search-back-hamburger-flash.spec.ts`, regression sweep.
4. **Impl-audit loop**: 5-agent open-ended full audit -> `RV13-C00-Audit-[NN].md` per round -> loop until 5/5 acceptable.

## Log

### Implementation - 2026-07-02

**Header.svelte (cosmetic normalization of the already-applied fix).**

- `src/lib/components/organisms/Header.svelte:195` - the expression `const iconProgress = $derived((isSearch || searchScrubbing) ? 0 : 1 - morph);` is normalized to `const iconProgress = $derived(isSearch || searchScrubbing ? 0 : 1 - morph);`. Prettier strips the outer parens because `||` binds tighter than `?:`, so they are redundant; the bare form matches the sibling `slideT` discriminant at `:203-205` (`dragging || searchScrubbing ? 'none' : ...`), which is also paren-free. Semantically identical; the Round-2 C1 parenthesization recommendation is moot under the repo's prettier normalization.
- The comment above the expression is cleaned to current intent: the "Outer parens mirror slideT's discriminant style" line (which referenced parens prettier removes) is replaced with "mirroring slideT's in-flight discriminant". No past-state / error-history language.

**e2e: regression guard + parametrized destination coverage.**

- `e2e/search-back-hamburger-flash.spec.ts` is rewritten from a defect-reproduction spec to a current-intent regression guard:
  - The top docstring states the INVARIANT (the hamburger stays a hamburger across `/search` <-> tab-root) and the FIX mechanism (`iconProgress` freezes on `isSearch || searchScrubbing`), not the historical bug narrative. Comments throughout are rewritten to current intent (the `no-history-comments` hook scans `.ts` edits).
  - `summarizeFlash(log, destPath)` is generalized from a `/`-only summary to a per-destination summary, so the same harness covers any tab root.
  - The DEFECT / INTERMITTENCY tests are renamed to REGRESSION / INTERMITTENCY and assert the invariant (`maxTargetOnDest <= 15deg`) rather than reproduce the flash.
  - A new `DESTINATIONS` describe block parametrizes `/search` -> `/activity` and `/search` -> `/messages/inbox` (the §12 statically-verified claim), asserting the icon stays in the hamburger band on each tab-root destination.
- Six tests total: CALIBRATION, REGRESSION (`/`), INTERMITTENCY (5-iteration loop), ASYMMETRY (forward), and the two DESTINATIONS cases.

### Organic-clean gate (verified)

`git diff --stat -- src/` shows ONLY `src/lib/components/organisms/Header.svelte` (the comment + expression normalization). `grep -rn iconProgress src/` returns exactly two hits: the declaration (`:195`) and the sole consumer `<BurgerArrowIcon progress={iconProgress}>` (`:772`). No other `src/` file is touched by DV13. No new tokens enter any shared primitive; the change is to an already-Header-local derived value.

### Test results

- `bun run check` (svelte-check + tsc): **0 errors / 0 warnings** across 1431 files.
- `bun run lint` (prettier -> eslint -> similarity-ts): prettier **clean** on both changed files; eslint **0 errors**; similarity-ts type-duplicates **0** (unchanged from master).
- `bun test src/`: **202 pass / 0 fail** (no new unit tests; `iconProgress` is a `$derived` inside a Svelte component, not runes-free, so it is not unit-testable under `bun test` per the `bun-test-no-runes-loader` memory).
- `bunx tsc --noEmit -p e2e/tsconfig.json`: the e2e spec type-checks.
- `bun run test:e2e e2e/search-back-hamburger-flash.spec.ts`: **6 pass / 0 fail**. Per-iteration and per-destination `maxTargetOnDest = 0.0deg` across the board.
- Regression sweep (header neighbours): `header-title-replay` (3), `search-enter-exit-asymmetry` (3), `header-hide-on-scroll` (2), `header-tabs-replay` (1) -> **9 pass / 0 fail**. The fix changes only `iconProgress`; the sibling `morph` consumers (the title crossfade, the tab layer, the search track) are untouched and stay green.

### Empirical evidence (post-fix)

```
REGRESSION     /search -> /                  maxTargetOnDest = 0.0deg
INTERMITTENCY  5-iteration loop              [0.0, 0.0, 0.0, 0.0, 0.0]
ASYMMETRY      / -> /search                  maxTargetOverall = 0.0deg
DESTINATIONS   /search -> /activity          maxTargetOnDest = 0.0deg
DESTINATIONS   /search -> /messages/inbox    maxTargetOnDest = 0.0deg
```

Every transition keeps the icon target rotation at 0deg (hamburger) for every sampled frame. The pre-fix signature (`0.0, 180, 180, 180, 180` on the loop; `180` on the single back) is gone.

## Concerns for RV13 reviewers to scrutinize first

1. **Root-cause fit.** The fix was applied at `34da843` (DV13) per this plan. Review the plan's root-cause derivation against the `34da843` source and confirm the freeze-on-`searchScrubbing` discriminant is the correct root-cause fix (not a band-aid over a deeper `morph`-coupling issue). The plan's §6.3 rejected alternatives (freeze on `morph === 0`; drop `isSearch`; separate `deepMorph` signal) are the surface to re-examine.
2. **The gesture back-swipe path is robust by construction.** The fix freezes `iconProgress` on `searchScrubbing` unconditionally, so whether or not the scrub fires on the gesture path (the SvelteKit flush-ordering detail in plan §3) the icon stays at 0. A gesture-path e2e is not required for DV13.
3. **The `if (settling) return` mask in Effect E (line 399) is left in place.** It no longer affects `iconProgress` (the fix freezes it unconditionally) but still gates `startSearchScrub` for the non-icon search consumers (`rootLayerStyle`, `layerDownStyle`, the search track / scope-tab / button). Removing it is a behavior change to the search-track animation and is out of scope; confirm it is not dead code that misleads.
4. **The destination-agnostic claim** is statically verified (Effect E fires on any `currentHasTabs` flip + `isSearch` flip) AND e2e-covered for `/`, `/activity`, `/messages/inbox`.

## C00 Round-1 (FINAL)

Round 1 of the implementation audit returned **5/5 acceptable (FINAL)**, all high confidence, zero blocking. Full detail: `docs/RV13-C00-Audit-01.md`. The fix expression, the e2e regression suite, the organic-clean gate, and the comment hygiene were all endorsed. Loop exit condition met.

Convergent verification:

- The fix `iconProgress = isSearch || searchScrubbing ? 0 : 1 - morph` is correct across every walked transition (forward, back, /activity, /messages/inbox, gesture, /search<->deep, root<->deep, SSR).
- The e2e sampler reads `180 * iconProgress` directly off the `BurgerArrowIcon` mask group's inline `rotate(Xdeg)`; the selector `header svg mask g` is unique; the `<= 15deg` band cannot pass on broken code (pre-fix `maxTargetOnDest = 180`); the CALIBRATION `destFrameCount > 10` precondition prevents a false pass.
- Organic-clean: `git diff -- src/` is single-target (`Header.svelte` only, the expression + comment); `grep -rn iconProgress src/` = 2 hits (declaration `:195` + consumer `:772`).
- The journal's `cee9142` provenance claim was corrected to `34da843` (the DV13 commit) after auditor 5 flagged it via `git show cee9142:`.

Carried-to-future (non-blocking, NOT re-audited):

- **(a) Mid-scrub `/search` -> deep over-freeze (auditor 1).** If the user navigates from `/search` to a deep route within the ~200ms enter-scrub window, Effect E returns at `curTabs === prevTabs` (both false) without re-invoking `startSearchScrub`, so the prior scrub's rAF is not cancelled; `searchScrubbing` stays true for the remainder of the scrub, freezing `iconProgress` to 0 (hamburger) on a deep page where the correct value is the arrow (up to ~200ms of hamburger-then-snap-to-arrow). Low-probability (the search page does not render synchronously tappable deep links), visual class differs from the DV13 flash (delayed arrow, not arrow-then-hamburger). Minimal fix: cancel any in-flight scrub when exiting search toward a non-tab-root route (e.g. in Effect E, when `curTabs === prevTabs && curIsSearch !== prevS && !curIsSearch`, clear `searchScrubbing` and cancel `searchScrubRafId`). Out of DV13 scope; deferred to a follow-up.
- **(b) e2e asserts only the icon TARGET rotation, not the painted (computed) rotation (auditor 1).** `maxPaintedOnDest` is collected but not asserted. A stuck CSS transition could in theory pass the target assertion while the painted icon is mid-arrow. The BurgerArrowIcon transition (`transform 200ms ease-out`) means a sustained target excursion paints fully, so the risk is theoretical. Consider tightening one assertion to also bound `maxPaintedOnDest`.
- **(c) `FlashSummary.maxTargetOverall` is a populated-but-unread field (auditor 5).** Harmless diagnostic surface. Optionally remove or wire into the ASYMMETRY test (which currently recomputes its own max).

Gates: `bun run check` 0/0 (1431 files); `bun test src/` 202 pass / 0 fail; `bun run test:e2e e2e/search-back-hamburger-flash.spec.ts` 6 pass / 0 fail; regression sweep (header-title-replay, search-enter-exit-asymmetry, header-hide-on-scroll, header-tabs-replay) 9 pass / 0 fail.

Loop exit. DV13 C00 is implementation-complete: plan 5/5 PASS (3 rounds) plus implementation 5/5 acceptable (1 round). Ready for commit/merge.
