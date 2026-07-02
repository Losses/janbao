# DV12 - Plan Journal

Append-only log of the 5-agent role-less full-audit loop for the DV12 Header tab-descent cross-tab-exit fix plan. Each round: 5 independent auditors examine `docs/DV12-Plan.md` against the real codebase; loop until 5/5 unconditional PASS (DV04 pattern). The confirmed cause (the `(navInFlight && !settling)` term in `Header.svelte:193` `slideT` suppresses the tabs layer transition during a cross-tab chip exit) is owner-locked and not relitigated; the audit evaluates whether the proposed mechanism fixes it without regression.

## Round 1 - 0/5 unconditional PASS → revised

5 independent role-less auditors examined `docs/DV12-Plan.md` (R1 primary: a `crossTabChip` flag latched as `lastExitChip` on the navigation store, read in `slideT`). Result: 2 FAIL, 3 PASS, all 3 PASS based on a wrong GPL-branch identification (and 2 of them carrying a blocking `clearPendingNav` latch-cleanup finding), so 0/5 unconditional. Full detail: `DV12-Audit-R1.md`.

Convergent blockers:

- **[CRITICAL] The defect is branch-agnostic; the R1 primary did not fix it.** The spec's `/bookmarks` → `/messages/inbox` back-arrow path takes the GPL SAME-PANEL branch (`GesturePageLayout.svelte:789-814`), not the cross-tab chip branch. Owner source-verified: `resolvedLeftHref` (`:112-120`) falls back to `navStore.backTarget`; `backTargetFor` (`navigation-logic.ts:57-64`) returns `stack[stack.length-2]` = `/messages/inbox`; `matchesPreRenderedPanel` (`:759`) = true. The R1 `crossTabChip` flag is set only on the cross-tab branch (`:783`), so it never applies to the spec scenario, and even for cross-tab routes it leaves the same-panel branch unfixed. Both branches call `setPendingNav` → `executePendingNav` → `navInFlight=true` → landing jump. (Auditors 2, 5; owner-verified. Auditors 1, 3, 4 mis-traced the branch.)
- **The `(navInFlight && !settling)` term's `navInFlight` part is vestigial.** `git blame` (`c2c7616`) shows the term was refactored from `dragging || navInFlight` to `(navInFlight && !settling)` to exempt the gesture settle. For the gesture path the term is never true anyway (settling clears with navInFlight via Effect D). It is true only for click/tab-tap navs, where it causes the landing jump. (Auditors 2, 5 direction; owner-verified.)
- **§4.3-vs-Variant-B disagreement (Auditor 5).** Auditor 5 proposed keeping only `settling` (Variant B), claiming §4.3 (remove the whole term) double-animates the settle. Owner traced `runSettleDriver:428`: `settleProgress` jumps once (not frame-by-frame); the CSS transition animates the single jump; `slideT` is `'200ms'` during settle today. So §4.3 keeps settle byte-identical; Variant B would change settle to `'none'` and risk snapping the gesture release. The gesture-suite e2e is the empirical decider.
- **Citation drift (auditors 1, 3, 5).** `onBack` at `Header.svelte:687-699` (not 654-666); Effect D at `:351-362`; `beforeNavigate` guard at `GesturePageLayout.svelte:741-748`; gesture `setPendingNav` callers at `:639,651,662,689,699`.
- **Organic concern (auditors 1, 2, 5).** `crossTabChip`/`lastExitChip` is a Header-layer concern leaking into the shared navigation store + GPL. Dropped in R2.

Revision decisions (R2):

1. Primary mechanism → remove the whole `(navStore.navInFlight && !settling)` term from `slideT` (`Header.svelte:193-196`), becoming `dragging || searchScrubbing ? 'none' : 'transform 200ms ease-out, opacity 200ms ease-out'`. Branch-agnostic; Header-local; preserves the gesture-settle behavior (slideT stays `'200ms'` during settle, byte-identical).
2. Drop §4.2 (`crossTabChip`/`lastExitChip` latch) - wrong branch, not branch-agnostic, shared-primitive leak.
3. Drop §4.4 (settle-driven back-to-tab) - unnecessary; a `transform` transition runs on the compositor once started, so the headless main-thread block (caused by `'none'`, not a dropped transition) does not produce a partial snap.
4. Files shrink to one: only `Header.svelte` changes (the `slideT` term). No shared primitive touched.
5. Fix all citation drift.
6. Empirical gate: run `e2e/header-tabs-replay.spec.ts` (and the full no-regression suite) with the term removed; the §4.3-vs-Variant-B decider.

## Round 2 - 4/5 PASS + 1 FAIL → revised

5 auditors examined the R2 plan (single Header-local term removal, branch-agnostic). Result: 4 PASS, 1 FAIL. The mechanism was judged sound by all 5; the single FAIL (Auditor 3, plus a non-blocking flag from Auditor 4) converges on one plan-internal inconsistency. Full detail: `DV12-Audit-R2.md`.

Convergent blockers / calibration:

- **[B1, blocking] §5/§7 CALIBRATION contradiction.** §5 listed `e2e/header-tab-descent-cross-tab-exit.spec.ts` under "Unchanged" and §7 said "CALIBRATION must keep passing", but the CALIBRATION test asserts the BROKEN behaviour (`backLanding.slideNone === true`); post-fix it flips to false and fails. The plan cannot keep CALIBRATION passing, keep the spec unchanged, AND fix the defect. (Auditor 3 blocking; Auditor 4 non-blocking.)
- **Citation calibration (Auditor 3; owner `git blame`-verified).** The `(navInFlight && !settling)` term (line 194) was added by `23d711b9` ("fix: Fab not following the gesture", 2026-06-30), NOT `c2c7616` (which carried the older `dragging || navInFlight` form). Auditors 1, 2, 5 repeated `c2c7616` without blaming it.
- `runSettleDriver` `settleProgress` write is at `:429`, not `:428` (auditors 1, 2, 5).
- §6.2 "sequential, not parallel" reasoning tightened: the no-double-animation holds because Header `translateY` and GPL `translateX` are independent transforms on different elements, not because of poll timing.

All central claims VERIFIED 5/5: gesture-settle byte-identical (Auditor 1 supplied the flush-by-flush proof that `settling` stays true through the `navInFlight` window on the gesture path and is never set on the click path, so the term distinguishes exactly the two paths); defect fixed on both branches; compositor immunity; completeness (no undesired-animation click path). Auditor 5 retracted its R1 Variant B.

Revision decisions (R3):

1. §5: admit the regression spec is Modified - the CALIBRATION back-landing `slideNone` assertion flips true → false and the test name updates asymmetry → symmetry (`navInFlight === true` stays; forward-landing + DEFECT unchanged).
2. §2: citation `c2c7616` → `23d711b9` (git-blame-verified), with a note that the term's FAB-commit origin is incidental to Header's own layer.
3. §3/§4/§9: `runSettleDriver:428` → `:429`.
4. §6.2: tighten the no-double-animation reasoning to independent-transforms-on-different-elements.
5. §7: add the FAB specs (`fab.spec.ts`, `fab-deep-real-interaction.spec.ts`, `fab-release-snap.spec.ts`) to the no-regression gate as insurance.

The R3 mechanism is unchanged from R2 (single Header-local term removal, branch-agnostic); R3 is a documentation/scope correction resolving B1 plus citation accuracy.

## Round 3 - 5/5 PASS (FINAL, unconditional). Loop exit.

5 auditors examined the R3 plan (R2 mechanism unchanged; regression spec now Modified; citation `23d711b9`; `runSettleDriver:429`; §6.2 tightened; FAB specs added to the gate). Result: **5/5 PASS (FINAL, unconditional, all organic=clean, all high confidence, zero blocking)**. Full detail: `DV12-Audit-R3.md`.

All R2 fixes verified against source: §5/§7 CALIBRATION contradiction RESOLVED (spec now Modified; actual test's assertions match the plan's described update line-for-line; `backLanding.navInFlight === true` correctly retained as a witness); citation `23d711b9` correct (`git blame -L 194,194`); `runSettleDriver:429` correct (single-rAF `settleProgress` write).

All central claims re-verified 5/5: gesture-settle byte-identical (Auditor 2's flush-by-flush proof: on the gesture path `settling=true` is held through the whole `navInFlight` window, so the term is dead code there); defect fixed on both branches across all 26 GPL routes; compositor immunity; completeness (no undesired-animation click path, including the non-obvious `/search → tab` case that resolves via Effect E's same-flush `searchScrub`); FAB-specs gate insurance-only (FAB reads `navInFlight` directly at `FloatingActionButtonLayer.svelte:362`, never Header's `slideT`).

Carried-to-implementation notes (non-blocking, NOT re-audited - DV09 R5 precedent): (a) the CALIBRATION rewrite is the whole test name (incl. the "back descent suppresses it" mid-clause) + the file-header doc-comment (lines 19-43), not just the parenthetical - applied to §5 in the FINAL plan; (b) the `/search → /messages/inbox` same-flush-scrub completeness path is safe and non-obvious; (c) `opacity 200ms` in `slideT` is a pre-existing no-op; (d) `trackStyle`/`searchButtonStyle`/`tabBarStyle` keep their own `navInFlight` reads (documented, out of scope); (e) `FloatingActionButtonLayer` lives under `templates/`; (f) the DEFECT spec is a slideT-string check, trajectory covered by the separate audit-time probe gate.

Loop exit condition met. Plan approved for implementation. Implementation changes ONLY `Header.svelte` (the `slideT` term removal) and `e2e/header-tab-descent-cross-tab-exit.spec.ts` (the CALIBRATION symmetry rewrite); no shared primitive touched. Proceeds under `DV12-C00-Journal.md` + `RV12-C00-Audit-##`, gated by `bun run check` 0/0, `bun run lint` exit 0, the §4.4 gesture-suite gate, and the no-regression suite (incl. FAB specs).
