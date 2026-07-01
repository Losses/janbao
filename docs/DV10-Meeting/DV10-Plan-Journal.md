# DV10 - Plan Journal

Append-only log of the 5-agent role-less full-audit loop for the DV10 FAB scale drive-model rework. Each round: 5 independent auditors examine `docs/DV10-Plan.md` against the real codebase; loop until 5/5 unconditional PASS (DV04 pattern). Owner-locked decisions (pure-function overlay scale, Family A keeps its sampler, full-range scaleFromFraction, click-nav CSS transition for all swaps, no Header regression) are not relitigated.

## Round 1 - not 5/5 PASS → revised (3/5 returned, 2 rate-limited)

Full detail: `DV10-Audit-R1.md`. Auditors 2 and 4 were rate-limited by the API mid-run; they are re-run in Round 2. Of the 3 returned: 2 FAIL, 1 PASS.

Convergent blockers:

- **B1 (BLOCKING, auditors 1, 5).** Publishing `backMorph` on the GPL centerTab branch regresses Header's thread-route morph. Header reads `pager.backMorph ?? (currentHasTabs ? 1 : 0)` (`Header.svelte:142-143`); thread routes are `'root'` mode and rely on `backMorph === null` to keep `morph = 1`. A non-null thread `backMorph` would raise the tab bar, morph the hamburger, and crossfade the title mid-swipe. `backMorph` is overloaded - Header's deep-page morph AND the proposed FAB gesture signal.
- **B2 (BLOCKING, auditor 1).** Splitting the atom `transform` into individual `scale`/`translate` properties breaks the SSR assertion block (`fab.spec.ts:117-290` regex-matches `transform: scale() translateY()`), `readFabTransform` (`:831` reads `fab.style.transform`), and every trajectory sampler that parses `getComputedStyle(fab).transform`. The plan underestimated this as a single-point edit.

Revision decisions:

- **FAB-only `coverProgress` field.** The pager store gains `coverProgress: number | null`. GPL publishes it on BOTH the centerTab and deep branches from the deadzone-free `rawDragOffset/viewportWidth` already computed. Header does not read it; `backMorph` stays `null` on thread routes. FAB reads `pager.coverProgress` for the overlay family. Removes the overload and the Header regression.
- **Keep the combined atom `transform`.** No property split. The `.fab-transition` class still transitions `transform`. Cost: a route-swap transition also eases `translateY` (scroll-hide); accepted as minor because the FAB scales during a route swap anyway and `scroll-chrome` is stable. No SSR/test breakage.
- **`familyNeedsSamplerDuringDrag` → list-only.** Overlay drops the sampler; the arm effect never arms it for overlay.
- **`fab-scale.test.ts` added to the test-rewrite list** (asserts the `2f-1` curve directly).
- **`discreteNavInFlight` clears on `navInFlight` false / `afterNavigate`** too, not only on the next family swap.
- **D assertion strengthened** to a monotonic rise ≥0.7 after the reversal trough.
- **Family B back swipe rewritten to realistic speed** (the synchronous `swipeHorizontal` compression hid the thread defect).

Verified-TRUE facts carried forward: centerTab branch publishes `backMorph: null` (`GesturePageLayout.svelte:354`); Header thread routes are `'root'` mode relying on that null; `MobileTabBar` is safe (gated on `targetIndex !== null`); `scaleFromFraction`'s 0.5 threshold is the direct cause of B/D; `helpers.ts:swipeHorizontal` compresses drags synchronously.

## Round 2 - 1/5 PASS → revised

Full detail: `DV10-Audit-R2.md`. R1 blockers (B1 `backMorph` overload, B2 atom split) independently verified FIXED by all five auditors.

Convergent blocker:

- **B3 (BLOCKING, auditors 1-major, 3, 4, 5).** The centerTab branch's `dragProgress` (`GesturePageLayout.svelte:343`, `Math.max(0, Math.min(1, -dragOffset/viewportWidth))`) is sign-broken for `swipeDirection === 'right'` (back-swipe): `dragOffset > 0` clamps `-dragOffset` to 0, so `coverProgress` stayed 0 through the thread back-swipe - bug B unfixed on `/discussion/*` and `/messages/<id>`. The v2 claim "reuse the deep branch's computation" was false; the deep branch is direction-aware (`:374-377`), the centerTab variable is not.

Majors (M1–M6):

- **M1.** `coverProgress` as a required `PagerUpdate` field breaks 6 unlisted `pager.set` call sites (MobileTabPager ×3, SearchScopePager ×3, GPL reset). v3 makes it OPTIONAL.
- **M2.** §4.5's claim "arm-effect never arms for overlay" was false (only the `:411` disarm-guard checks family, during drag). v3 gates the arm-effect itself to `family === 'list'`.
- **M3.** Removing `pxToFraction`/`listForegroundFromThreadCover`/`familyRestsAtSampleOne` left dead branches in `sampleFraction`/`fractionFromSample`/`isRestingTarget`. v3 collapses those to list-only.
- **M4.** `fab-release-snap.spec.ts` not in the rewrite list; thresholds coupled to the `2f-1` curve. v3 adds it.
- **M5.** `discreteNavInFlight` double-clocks the Family A sampler on overlay→list back-swipe commit. v3 tightens the gate to `(!pager.dragging && !samplerActive) || (discreteNavInFlight && !samplerActive)`.
- **M6.** The `discreteNavInFlight` stale-latch clear effect (reading `navStore.navInFlight`/`afterNavigate`) was not in §5. v3 adds it.

Revision decisions: centerTab `coverProgress` uses the deep branch's direction-aware `rawDragOffset` normalization; `coverProgress` optional on `PagerUpdate`; arm-effect family-gated; helpers' callers collapsed; transition gate tightened; stale-latch clear effect added; `fab-release-snap.spec.ts` re-derived; `restingFraction` defined (overlay/compose 0, list `tabFraction`); deep→deep swap accepted with a no-persistent-flash e2e; deadzone-free `coverProgress` documented as intentional chrome/content phasing (matches Header).

Verified-TRUE facts carried forward: `GesturePageLayout.svelte:343` sign-broken for right-swipe; `:374-377` deep branch direction-aware reference; `mobile-pager.svelte.ts:33` `backMorph` required (so `coverProgress` optional); arm-effect `:390-416` does not gate on family; helper call-sites at `:281,294,348`; `fab-release-snap.spec.ts:163-168,186,216,244` curve-coupled.

## Round 3 - 5/5 PASS → approved (v3.1 amendment)

Full detail: `DV10-Audit-R3.md`. All five auditors returned PASS. The R2 convergent blocker (B3 centerTab sign) and all six R2 majors (M1–M6) independently verified FIXED at the code level.

Convergent major (non-blocking, folded into v3.1):

- **MA1 (auditors 3, 4, 5).** `mobile-pager.svelte.ts:51-57` `set()` body copies only `fractionalIndex/dragging/active/backMorph/targetIndex`. v3 §5 said "add the field" but not the body assignment. Without `coverProgress = update.coverProgress ?? null` in `set()`, GPL's writes never reach the `$state` and the reset never clears a stale value. v3.1 specifies the body line (mirroring `targetIndex`'s `:56` fallback) and the `$state` + getter.

Other v3.1 folds: `fab-scale.test.ts` deletes the `pxToFraction`, `listForegroundFromThreadCover`, AND `familyRestsAtSampleOne` describe blocks + imports (v3 named only the last); the thread-route e2e also samples post-commit (no mid-commit flash to 0); `restingFraction` resolves `activeTab` via `pager.active ? fractionalIndex : getCurrentTabIndex(pathname)` for SSR; the clear effect reads `navStore.navInFlight` + `page.url.pathname` (`afterNavigate` is a hook name, not a reactive source); deep→deep pop is honestly stated as an UN-eased single frame (same family, latch does not arm); chip-exit precedence re-stated; the `:411` disarm-guard is retained defensive dead code or deleted.

Approval: the plan is approved for implementation. The overlay family is a pure function of the live `coverProgress` signal (no sampler, no holdover, no gap-holdover); the two pragmatic special-cases (Family A sampler for snap continuity, `discreteNavInFlight` timer latch for mount-gap transition) remain with honest justification and a deferred-cleanup path (MobileTabPager publishes continuous snap-progress so Family A also drops the sampler).
