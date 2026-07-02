# DV13 - Plan Journal

Append-only log of the 5-agent role-less full-audit loop for the search-back hamburger-arrow flash fix. Each round: 5 independent auditors examine `docs/DV13-Plan.md` against the real codebase; loop until 5/5 unconditional PASS (DV04 / DV09 pattern). Owner-locked decision: the fix is a one-expression change to `iconProgress` in `Header.svelte`, freezing the icon on `isSearch || searchScrubbing`. The loop audits whether that fix is correct and complete and whether the plan's analysis is accurate.

## Round 1 - 4/5 PASS, 1/5 has-special-cases -> revised

5 independent role-less auditors examined `docs/DV13-Plan.md` against the codebase at `master` (post-DV12 `cee9142`). Result: **4/5 PASS, 1/5 has-special-cases** (auditor 3, medium confidence). Full detail: `DV13-Audit-R1.md`.

The fix expression is unanimously endorsed (correct for the defect path, organic-clean, no feedback loop, both terms load-bearing). The dissent is on the plan's ANALYSIS TEXT, not the fix:

- **A1 (auditor 3).** §3 / §8.4 claim a gesture back-swipe from `/search` does not enter `startSearchScrub`. Auditor 3's static trace said the landing flush has `dragging === false` and (if Effect D clears `settling` before Effect E reads it) Effect E would fire the scrub, jumping `morph` 1 -> 0 -> 1 and visibly defecting `rootLayerStyle` / `searchProgress`.
- **A2 (auditor 3).** §4 attributes the iteration-0 intermittency mask to "the title idle branch latches `settling` on the initial `/` load". Auditor 3 traced Effect C: `/` has `title === ''`, so the idle branch takes `else if (!newTitle && !isDeep)` and arms NO settle. The stated mechanism does not match the code.

### Empirical resolution (this round)

Per the `svelte-effect-pre-same-flush-rerun` and `audit-prompts-open-ended` memories ("verify empirically; the implementer's empirical observation beats static trace"), both A1 and A2 were settled with DV12's committed `window.__headerMorphProbe` per-flush snapshot via a throwaway diagnostic (deleted after):

- **A1 RESOLVED in the plan's favour.** A CDP touch back-swipe `/search` -> `/` shows `min morph on / after landing = 1.000`. The gesture's commit settle (Effect B at release, `settling = true`, `pendingNav = '/'`) drives `morph` 0.57 -> 1.00 via branch 2 and holds `settling = true` through the landing flush; Effect E reads `settling === true` (untracked, `:399`) and returns early. The scrub never fires; `morph` never dips; there is no `rootLayerStyle` jump. Auditor 3's static `$effect.pre` ordering argument was wrong: `settling` stays true long enough to block Effect E at the landing flush. The plan's §3 / §8.4 claim was correct; promoted from §11 UNVERIFIED to verified-with-evidence.
- **A2 RESOLVED in auditor 3's favour.** The probe shows iteration 0 `settling = true` (`sp` 0 -> 1, `pendingNav = '/'`), iterations 1+ `settling = false` (scrub fires, `morph` scrubs 0 -> 0.78). Auditor 3 is correct that the title idle branch does not arm this settle. The settle is a COMMIT settle lingering from the initial-load / first-forward-nav sequencing. The plan's §4 mechanism is corrected to match the observation; the conclusion (the mask is moot once `iconProgress` is frozen) is unchanged.

### Revision decisions

1. §3 / §8.4 / §11 - add the Q1 evidence and move the gesture-path claim from UNVERIFIED to verified.
2. §4 - replace the title-idle-branch mechanism with the observed commit-settle mechanism; cite the probe evidence (iter 0 `settling = true`, iter 1+ `settling = false`).
3. §6.1 - parenthesize the fix: `const iconProgress = $derived((isSearch || searchScrubbing) ? 0 : 1 - morph);` (auditor 5 C1, matches `slideT`'s style).
4. §10 - correct the desktop rationale: the fix is a desktop no-op because `BurgerArrowIcon` is inside the `md:hidden` mobile block, not because the scrub is absent (auditor 4 C2).
5. §9 - add the single-target audit-gate note (auditor 5 C3).

The fix expression is unchanged from Round 1. Round 2 re-audits the revised plan (analysis text corrected, fix identical).

## Round 2 - 3/5 PASS, 2/5 has-special-cases -> revised

5 auditors examined the Round-1-revised plan. Result: **3/5 PASS, 2/5 has-special-cases** (auditor 5, and output-2). Full detail: `DV13-Audit-R2.md`. The fix expression `(isSearch || searchScrubbing) ? 0 : 1 - morph` remains unanimously endorsed. The two dissenters' blockers are all plan-text/comment rigor:

- **B1 (auditor 5).** The §6.1 comment to be written into `Header.svelte:192` contains an error-history clause ("Without the scrub term ... flashes into an arrow") that violates `no-error-history-comments`; the save-time hook would block the edit.
- **B2 (auditor 5).** §10's "removing the `if (settling) return` mask is a cleanup, not a fix" is false: the mask gates `startSearchScrub`, which drives `morph` branch 1b consumed by `rootLayerStyle` / `searchProgress` / `tabProgress` / `trackStyle` / `searchButtonStyle` / `tabBarStyle`. Removing it would defect those consumers during a settle.
- **C1 (auditor 3 + auditor 5 output-2).** The §3 gesture mechanism said Effect E reads `settling === true` "in the same flush" as Effect D ends the settle. Effect D (declared `:359`) runs before Effect E (`:378`) in a flush, so the "same flush" framing is statically inconsistent with the outcome.

### Empirical resolution of C1 (re-read of the Round-1 probe data)

The Round-1 `__headerMorphProbe` trajectory shows the mechanism is INTER-flush, not intra-flush. At the route-change flush `currentPath` flips to `/` but `navInFlight` is still `true` (SvelteKit `afterNavigate` has not fired). Effect D ends the settle only when `navInFlight` clears (it tracks `navInFlight`/`pendingNav`), so at the route-change flush `settling` is still `true`; Effect E re-runs, reads `settling === true` via untrack at `:399`, returns early. At the next flush `navInFlight` clears and Effect D runs `endSettle()`, but Effect E does not re-run (no tracked-dep change). The scrub never fires; `min morph on / after landing = 1.000`. The mechanism is sound and matches the observation.

### Revision decisions

1. §3 / §8.4 - rewrite the gesture mechanism to the inter-flush form (navInFlight clears in a later flush than the route change; settling holds through the route-change flush; Effect E returns at `:399`; Effect D ends the settle next flush; Effect E does not re-run).
2. §6.1 - rewrite the comment to current intent only (no defect narrative; drop the brittle line-range citation).
3. §10 - correct the mask rationale (B2): load-bears for non-icon search consumers; out of scope.
4. §11 / §12 - promote the destination-agnostic claim to statically verified; parametrized e2e deferred to implementation.

The fix expression is unchanged. Round 3 re-audits.

## Round 3 - 5/5 PASS (FINAL, unconditional). Loop exit.

5 independent role-less auditors examined the Round-2-revised plan. Result: **5/5 PASS (FINAL, unconditional, all high confidence, zero blocking)**. Full detail: `DV13-Audit-R3.md`. Both Round-2 dissenters returned PASS, confirming B1 (§6.1 comment rewritten to current intent), B2 (§10 mask rationale corrected), and C1 (§3 gesture mechanism corrected to the inter-flush form) are resolved.

The fix `const iconProgress = $derived((isSearch || searchScrubbing) ? 0 : 1 - morph);` is unanimously endorsed across all three rounds. Organic-clean (single-target, reuses the established `searchScrubbing` discriminant). SSR-safe. Robust to the gesture-path mechanism.

Carried-to-implementation notes (non-blocking, NOT re-audited):

- (a) The committed `e2e/search-back-hamburger-flash.spec.ts` commentary contains defect-narrative past-state language. The implementer MUST clean these comments when editing the spec (the `no-history-comments` hook scans `.ts` edits), and add parametrized coverage for `/activity` and `/messages/inbox` per §12.
- (b) §10 consumer enumeration is slightly over-broad (some consumers gate on `isSearch` and resolve to at-rest on the back path; the mask load-bears via `rootLayerStyle`/`layerDownStyle` which read `morph` unconditionally). The conclusion holds; `.md` prose only.
- (c) §8.7 scrub-interrupted latent stuck-state (`searchScrubbing` not cleared before the `from === to` bail) is pre-existing and out of scope; harmless for the icon.

Loop exit condition met. Plan approved for implementation. Implementation proceeds under `DV13-C00-Journal.md` + `RV13-C00-Audit-##` (per the DV08 / DV09 pattern).
