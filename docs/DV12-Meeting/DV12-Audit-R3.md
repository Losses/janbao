# DV12 - Audit Round 3 (FINAL)

5 independent role-less auditors examined the R3-revised `docs/DV12-Plan.md` (regression spec now Modified; CALIBRATION update; citation `23d711b9`; `runSettleDriver:429`; §6.2 tightened; FAB specs added to the gate; mechanism unchanged from R2 — remove the whole `(navStore.navInFlight && !settling)` term from `slideT`) against the codebase at `master`. Result: **5/5 PASS (FINAL, unconditional, all organic=clean, all high confidence, zero blocking)**. Loop exit condition met.

## Tally

| Auditor | Verdict | Blocking | Organic | Confidence |
| ------- | ------- | -------- | ------- | ---------- |
| 1       | PASS    | 0        | clean   | high       |
| 2       | PASS    | 0        | clean   | high       |
| 3       | PASS    | 0        | clean   | high       |
| 4       | PASS    | 0        | clean   | high       |
| 5       | PASS    | 0        | clean   | high       |

Result line: **5/5 PASS (FINAL, unconditional). Loop exit.**

## Verified (R3 fixes, against source)

- **R2 B1 (§5/§7 CALIBRATION contradiction) RESOLVED.** R3 §5 lists `e2e/header-tab-descent-cross-tab-exit.spec.ts` under Modified; §7 replaces "must keep passing" with "updated alongside the fix"; the git-diff gate describes ONLY the CALIBRATION assertion flip + name + doc-comment rewrite. All three sections are mutually consistent. The actual test's assertions match the plan's described update line-for-line: `backLanding.slideNone` flips `.toBe(true)` → `.toBe(false)`; `backLanding.navInFlight === true` STAYS (the fix does not change `navInFlight` — `executePendingNav:195` sets it, `handleAfterNavigate:133` clears it, both untouched); forward-landing `slideNone === false` STAYS; the DEFECT test (`suppressed.length === 0`) STAYS and flips fail→pass. (All 5; Auditor 3 line-matched the actual test.)
- **Citation `23d711b9` correct.** `git blame -L 194,194 -- src/lib/components/organisms/Header.svelte` attributes the `(navStore.navInFlight && !settling)` term (line 194) to `23d711b9` ("fix: Fab not following the gesture", 2026-06-30); the surrounding `slideT` block lines are `c2c7616`. Verified independently by auditors 1, 2, 3, 4, 5 and the owner.
- **`runSettleDriver:429` correct.** `settleProgress = settleTarget` is the single-`requestAnimationFrame` write at `:429` (callback registered at `:427`); no per-frame interpolation. (All 5.)
- **§6.2 no-double-animation reasoning tightened.** The Header `translateY` (`rootLayerStyle`) and the GPL `translateX` (track) are independent transforms on different DOM elements; they cannot animate each other regardless of `startPendingNavPoll` timing (800ms cap / `trackEl===null` branch). (Auditor 3 R2 N2, applied in R3.)
- **FAB-specs gate sound (insurance-only).** `FloatingActionButtonLayer.svelte:362` reads `navStore.navInFlight && navStore.direction === 'forward'` directly (in `chipExitActive`); it never imports Header and never reads `slideT`. The Header-local term removal cannot affect FAB scale. `slideT`'s only readers are Header's own `rootLayerStyle` (`:532`) and `layerDownStyle` (`:537`) and the dev probe (`:556`). (All 5; auditors 1, 3, 5 located the FAB read.)

## Confirmed-still-holding (R1+R2 design, NOT re-litigated)

- **Gesture-settle byte-identical.** On a gesture commit, `settling=true` is held through the entire `navInFlight=true` window (Effect D `Header.svelte:351-362` clears `settling` only when `pendingNav===null && !navInFlight`); at the landing flush `afterNavigate` has not fired yet so `navInFlight=true` and `settling` is still true. The term `(navInFlight && !settling)` is `(true && false) = false` at every frame of the gesture path today — it is dead code there. Removing it changes nothing. On the click path `settling` is never set (no preceding gesture), so the term is `(true && true) = true` and is the sole cause of the landing jump. The term distinguishes exactly the two paths. (Auditor 2 R3 supplied the decisive flush-by-flush proof; all 5 concur.)
- **Defect fixed, both branches, all 26 GPL routes.** Both `beforeNavigate` branches call `setPendingNav` (`:783` cross-tab, `:813` same-panel) → `executePendingNav` (`:195`) → `navInFlight=true` at landing while `currentHasTabs` flips and `morph` jumps 0→1. Branch-agnostic; covers every GPL back-to-tab path. (Auditor 3 enumerated all 26.)
- **Compositor immunity.** A `transform` transition committed at landing runs on the compositor and is not broken by the main-thread commit block; the headless three-frame gap was caused by `slideT='none'` (no transition), not a dropped transition. The tabs-layer div is always rendered, no `display:none` ancestor, parent `<header>` transform stable at landing. (All 5; Auditor 5 R2 caveat re-confirmed.)
- **Completeness.** No click/tab-tap path produces an undesired animation: `navInFlight=true && settling=false` on a click occurs only for GPL-mediated exits to tab roots (`:751` `isTabRootPath` gate), where animating `morph 0→1` is desired; no tab route sets `headerTitle`, so Effect C never sets `settling` on a tab landing; deep→deep has `morph` rest 0 both sides; the `/search → /messages/inbox` case resolves via Effect E's same-flush `searchScrub` (no flash). (Auditors 1, 5.)

## Non-blocking (carried to implementation, NOT re-audited — DV09 R5 precedent)

- **(a) CALIBRATION name + doc-comment rewrite is the whole name + comment, not a parenthetical.** The test name's mid-clause "back descent suppresses it" and the file-header doc-comment block (lines 19-43, "takes the CROSS-TAB EXIT path") both encode the broken-behaviour story and need rewriting alongside the trailing parenthetical. Applied to §5 in the FINAL plan (the rewrite is now enumerated as three places: assertion flip, whole-name, doc-comment block). (R3 auditors 1, 2, 3, 4 convergent.)
- **(b) The `/search → /messages/inbox` completeness case.** On this path Effect E fires `startSearchScrub` in the same flush and `morph` resolves to the scrub value before the DOM update (Svelte 5 same-flush derived recomputation), so `slideT` flips to `'none'` and `morph` never commits a stale rest-1 intermediate — no flash. The plan's §6.5 covers the gist ("searchScrubbing keeps its own term; unaffected"); the specific path is safe and non-obvious. Recorded here; no plan change required. (R3 Auditor 5.)
- **(c) `opacity 200ms ease-out` in `slideT`** is a no-op on both layers (neither `rootLayerStyle` nor `layerDownStyle` sets inline `opacity` outside search mode). Pre-existing; unchanged by the fix. (R2 Auditor 1; carried.)
- **(d) `trackStyle`/`searchButtonStyle`/`tabBarStyle`** (`Header.svelte:587,599,606`) keep their own bare `navInFlight` reads and stay suppressed during a chip exit; invisible outside `isSearch` (zero delta on `translateX`/`left`/`max-height`). Documented in §6.9/§8; out of scope. (R2/R3 auditors 1, 3, 4, 5.)
- **(e) `FloatingActionButtonLayer` lives at `src/lib/components/templates/`**, not `organisms/`. The plan is path-agnostic about it. Cosmetic. (R3 Auditor 5.)
- **(f) The DEFECT spec asserts `slideT !== 'none'` (a slideT-string check), not a monotonic trajectory.** The separate "empirical trajectory probe (audit-time)" gate in §7 covers trajectory. (R2 Auditor 1.)

## Loop-exit statement

Loop exit condition met: 5/5 unconditional PASS. Plan approved for implementation. The implementation changes ONLY `src/lib/components/organisms/Header.svelte` (the `slideT` term removal, one expression) and `e2e/header-tab-descent-cross-tab-exit.spec.ts` (the CALIBRATION symmetry rewrite); no shared primitive is touched. Implementation proceeds under `DV12-C00-Journal.md` + `RV12-C00-Audit-##` (per the DV08/DV09 pattern), gated by `bun run check` 0 errors, `bun run lint` exit 0, the §4.4 empirical gesture-suite gate (`header-tabs-replay.spec.ts` with the term removed stays green), and the no-regression suite (including the FAB specs).
