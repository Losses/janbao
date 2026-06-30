# RV09-C00 - Implementation Audit Round 03

5 role-less full auditors (architecture + code quality) re-reviewed the DV09 implementation after the Round-2 revision (Family B sampler-driven in both directions, `chipExitActive` gated to cross-tab list-route navs only, `transitionEnabled` gated to `family === 'compose'`, sampler gap-holdover, e2e rewritten to sample the trajectory) under an OPEN-ENDED audit standard: "independently find ANY defect empirically; do not trust the journal or that e2e passes; sample real trajectories not endpoints; assess whether each e2e assertion actually exercises the required behavior." vs `docs/DV09-Plan.md` (5/5 FINAL) + the post-Round-2 working-tree diff. Result: **3 acceptable / 2 changes_requested (test-reliability) → revised**. `organicIntegration` = **clean for all 5 reviewers' verdicts**, BUT the revision agent's gate re-scan found one DV09-new shared primitive (`active-gesture-track.svelte.ts`) whose docstrings leaked the `fab` token; fixed in this revision (see C2.1).

Workflow: a single consolidated review of the converged verdicts, distilled from the five independent reviewers' notes. The convergent finding is a PRODUCT-correctness consensus (all 5 empirically verified every transition family) plus two TEST-RELIABILITY blockers raised by the two `changes_requested` reviewers on the e2e harness, not on the layer.

## Tally

| Auditor | Verdict           | Blocking | Concerns | Organic | Confidence |
| ------- | ----------------- | -------- | -------- | ------- | ---------- |
| 1       | changes_requested | 1        | 2        | clean   | high       |
| 2       | acceptable        | 0        | 2        | clean   | high       |
| 3       | acceptable        | 0        | 3        | clean   | high       |
| 4       | acceptable        | 0        | 2        | clean   | high       |
| 5       | changes_requested | 1        | 2        | clean   | high       |

## Convergent PRODUCT-correctness consensus (all 5, empirically)

All 5 reviewers independently sampled real `getComputedStyle(fab).transform` trajectories across each transition family (the Round-2 open-ended prompt explicitly forbade trusting the journal or the "e2e passes" signal). The consensus:

- **Family A (tab swipe)** ramps smoothly 1 -> 0 across the drag and snap, crossing 0.5 mid-window. Sampled trajectory (Reviewer #3): `n=33, traj=[1.00,0.90,0.81,0.62,0.53,0.34,0.24,0.05,0.00,...]`.
- **Family B forward (list -> thread tap)** drops 1 -> 0 across the first half via the sampler reading the live GPL track `m41`. Sampled trajectory (Reviewer #1): `n=23, traj=[1.00,1.00,1.00,0.83,0.00,0.00,...]`.
- **Family B back (thread -> list swipe)** ramps 0 -> 1 across the second half, finger-driven (the Round-1/2 defect where the scale pinned at 1 for the whole drag is fixed). Sampled trajectory (Reviewer #5): `n=68, traj=[0.00,...,0.00,0.03,0.15,0.17,0.54,0.88,0.99,1.00,...]`.
- **Family C (compose)** eases the discrete foregroundFraction swap via the atom's 200ms CSS transition. Sampled trajectory (Reviewer #2): `n=27, traj=[1.00,1.00,0.74,0.41,0.16,0.01,0.00,...]`.
- **Deep-link no-flash**: `/discussion/*` and `/post/discussion` SSR at scale 0 (no forward nav in flight, so the holdover does not apply).
- **Scroll-hide translateY** slides off the bottom edge in lockstep with the Header's hide-on-scroll (shared `scroll-chrome` store); `pointer-events: none` gates the fully-hidden state.
- **Organic-clean**: the shared primitives (`MobileTabPager.svelte`, `GesturePageLayout.svelte`, `scroll-chrome.svelte.ts`) contain zero `fab`/`post`/`messages`/`discussions` tokens including in comments. (The DV09-new `active-gesture-track.svelte.ts` had two `fab` mentions in its docstrings that all 5 reviewers missed; found by the revision agent's gate re-scan and fixed in C2.1.)

The two `changes_requested` verdicts do NOT dispute any of the above. Their blockers are about the e2e harness's reliability on this correct code.

## Blocking issues (deduplicated, the two test-reliability blockers)

**T1 - `sampleFabScale` does not survive cross-document navigation (HIGH, 2/5 blocking; Reviewer #1 primary).** In `e2e/fab.spec.ts`, the Round-2 helper installed `window.__fabScale` (a rAF sampler) via `page.evaluate` on the pre-navigation document. For the Family B back-swipe spec, `swipeBack` navigates `/discussion/*` -> `/`, and the sampler's execution context is torn down mid-loop. Failures observed: `Cannot read properties of undefined (reading 'samples')`, or samples read from the wrong document. Empirically ~40% flake on correct code. A test whose pass/fail is decoupled from correctness is the Round-2 anti-pattern; it must be reliable.

**T2 - sampler window too tight (HIGH, 2/5 blocking; Reviewer #5 primary).** The 900ms rAF cap plus `waitForTimeout(350)` is too short for the holdover plateau (~530ms) plus the GPL's late track-bind under dev-server contention, so the Family B forward `lastScale = 1` endpoint fires on correct code (~50% fail under contention).

**T3 - forward specs would not catch a step-function/snap animation (MEDIUM, 2/5; Reviewers #3, #4).** The forward specs asserted endpoints + non-increasing + 0.5-crossing, but a one-frame snap `[1,1,...,0,0]` would pass all three. The back spec already had `samples.some(s => s > 0.3 && s < 0.7)`; the forward specs lacked it.

## Notable concerns (non-blocking)

- **Forward holdover timing skew under contention (#3).** The forward-nav holdover's release timing rests on empirical not structural proof. Acceptable; re-verify on any GPL rAF change.
- **`messages-thread` Family B path uncovered by e2e (#5).** The messages-thread back-swipe path has no dedicated e2e. Math is symmetric with the discussions path and unit-covered; e2e gap is acceptable.
- **Full-suite HMR / gesture-timing flakes (#2).** The full e2e suite occasionally flakes on `header-tabs-replay` under HMR contention. Pre-existing (reproduces on clean master); not a DV09 regression.
- **Stray reviewer probe files (process, #1).** Parallel reviewers left probe specs in the shared tree during Round 3. Cleanup required before merge.
- **`onDestroy` browser-guard drift (#4).** `MobileTabPager.svelte` and `GesturePageLayout.svelte` `onDestroy` callbacks call `clearActiveGestureTrack()` without a `browser` guard; the journal claims they are browser-guarded. Empirically SSR-safe (`trackEl === null` short-circuits; `clearActiveGestureTrack` only nulls `$state`), but the plan §4.5/§4.10 contract and the FAB layer's own pattern require the guard.
- **Organic-clean leak in active-gesture-track docstrings (revision-agent finding).** The DV09-new file `src/lib/stores/active-gesture-track.svelte.ts` module docstring and `initActiveGestureTrack` docstring said "the FAB layer in AppShell" as the illustrative consumer. Plan §4.11/§7 prohibit `fab`/`post`/`messages`/`discussions` tokens in shared primitives including comments. All 5 Round-3 reviewers marked organic-clean, which means none grepped the new file's comments. Fixed by rewording to "an ancestor component" / "an ancestor consumer".
- **Journal "sampler-driven" inaccuracy (resolved in Round 2).** No longer outstanding.

## Round-3 revision decisions (implemented)

1. **T1 - sampler robust across navigation.** `sampleFabScale` reworked: `page.exposeBinding('__pushFabSample', cb)` registers a Node-side callback that appends each sample to a buffer on the Page object (survives the document swap); `page.addInitScript(samplerScript)` re-arms the rAF loop on every new document, gated by a per-document `__fabArmed` flag; `page.evaluate(samplerScript)` kicks the loop off on the current document (addInitScript does not run retroactively). The Node-side buffer is the single source of truth. Mirrors the `captureEnterAnimation` trajectory sampler in `e2e/helpers.ts` plus the `addInitScript` pattern in `prepareContext`.
2. **T2 - sampler window matches the layer's own cap.** `SAMPLER_WINDOW_MS = 1800` (matching the layer's `SAMPLER_TIMEOUT_MS = 2000`), enforced on the Node side via `waitForTimeout` so a document swap cannot strand the cap. Forward specs keep the `minScale < threshold` shape alongside the trajectory assertions.
3. **T3 - forward intermediate-value assertion.** `samples.some(s => s > 0.3 && s < 0.7)` added to Family A forward, Family B forward, Family C forward.
4. **C1 - probe cleanup.** Read-only `git status` + exhaustive `find e2e` scan found ZERO stray probe files. The only e2e file DV09 ships is `e2e/fab.spec.ts`. C1 is a no-op.
5. **C2 - onDestroy browser-guard.** `if (!browser) return;` added at the top of the onDestroy body in `MobileTabPager.svelte` and `GesturePageLayout.svelte` (`browser` imported from `$app/environment`). Defensive only; no behavior change on the client.
6. **C2.1 - organic-clean leak in active-gesture-track docstrings.** The two "the FAB layer in AppShell" mentions in `src/lib/stores/active-gesture-track.svelte.ts` reworded to "an ancestor component" / "an ancestor consumer".
7. **C3 - journal.** A "C00 Round-3 revision" section appended to `docs/DV09-C00-Journal.md` documenting T1/T2/T3, the onDestroy guard, the probe cleanup, the organic-clean fix, and the multi-run stability evidence.
8. **Audit-02 prettier nit.** `docs/RV09-C00-Audit-02.md` reformatted with `bunx prettier --write`.

## Multi-run stability evidence

`bun run test:e2e e2e/fab.spec.ts` run 5 times in isolation (each invocation starts a fresh dev server on the dedicated port):

```
RUN 1: 13 passed (32.1s)
RUN 2: 13 passed (31.9s)
RUN 3: 13 passed (32.0s)
RUN 4: 13 passed (31.8s)
RUN 5: 13 passed (31.9s)
```

65/65 across 5 runs, zero flakes. The Round-2 ~40% cross-doc flake (T1) and ~50% window-too-tight flake (T2) are both resolved.

## Re-verify (post-Round-3)

- `bun run check`: **0 errors / 0 warnings** (1431 files).
- `bun test src/`: **206 pass / 0 fail**.
- `bunx tsc --noEmit -p e2e/tsconfig.json`: **EXIT 0**.
- `bunx eslint` on the changed Svelte files: **0 errors** (`fab.spec.ts` is in the e2e ignore set, type-checked by the playwright tsconfig).
- `bin/similarity-ts ./src --types`: **EXIT 0** (46 similar pairs below the hard-duplicate threshold; same set as clean master).
- `bun run lint`: exits 1 only on the pre-existing `src/app.css` prettier nit (reproduces on clean master at `a8693dd`; DV09 does not touch `app.css`).
- `bun run test:e2e e2e/fab.spec.ts`: **13 pass / 0 fail** (5/5 isolated runs, see above).
- Full e2e suite: **88 pass / 1 fail**. The single failure is the pre-existing `header-tabs-replay` gesture-timing flake (documented in Audit-01/02; reproduces on a clean-master worktree baseline; the DV09 diff does not touch the header-tabs-replay subsystem).

## Loop-exit status

Round 4 pending. The PRODUCT is empirically correct (5/5 consensus) and the e2e harness is now reliable (5/5 isolated runs, 65/65). Round 4 should re-confirm the open-ended audit standard holds with the hardened harness and re-examine the secondary findings (forward holdover timing skew, messages-thread e2e gap) for any new evidence.
