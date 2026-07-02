# DV11 - Audit Round 3

5 independent role-less auditors examined `docs/DV11-Plan.md` (v3, track-dest + reactive source pin + synchronous `neighborOffset`) against the codebase at `6a35937`. Result: **not 5/5 PASS**. 2 PASS / 3 FAIL, all high confidence. The v3 simplification (drop `pinSource`/`snapInProgress`/imperative effect; reuse `dragOffset` lifecycle; reactive transform; synchronous `neighborOffset = 0`) is unanimously endorsed as correctly dissolving R2's blockers. Three real defects survive that v3 did not consider; none overturns the track-dest approach.

> Process note: v3 still carried a §8 "Audit points" list and the round prompt referenced the prior audit docs. Both steer auditors toward the author's self-identified concerns and are removed for Round 4 (the plan will carry no audit-points section; the R4 prompt will give no prior-round context). The R3 findings below stand on their own code-verified merit regardless.

## Tally

| Auditor | Verdict | Blocking | Major | Minor | Organic           |
| ------- | ------- | -------- | ----- | ----- | ----------------- |
| 1       | PASS    | 0        | 0     | 3     | clean             |
| 2       | PASS    | 0        | 0     | 3     | clean             |
| 3       | FAIL    | 0        | 2     | 3     | has-special-cases |
| 4       | FAIL    | 1        | 2     | 3     | clean             |
| 5       | FAIL    | 1        | 0     | 3     | has-special-cases |

Result line: **not 5/5 PASS → revised.**

## Convergent blockers

### B1 - Cancel-branch restore corrupts the window for deep-path cancels (BLOCKING, auditor 5)

`swipeEnd`'s else-branch (`MobileTabPager.svelte:244-248`) is the cancel path for ALL swipe types. v3 §5 adds `window.scrollTo(0, sourceScrollY); neighborOffset = sourceScrollY` there unconditionally. But the entry block (§4.4) lives in the `:183` tab-slide else-branch, which a deep-path gesture never reaches (it took the `:173` if-branch). So for a deep-path cancel, `sourceScrollY` is `0` (initial) or STALE from a prior tab-slide, and the deep path itself never scrolled the window - yet the restore jumps the window to `0`/stale. Reproducible: on `/activity` scrolled to Y, start a back-swipe toward a cached thread (`showDeepPreview`), release below `SWIPE_COMMIT` → window jumps to top. `e2e/swipe-forward-back-deep-page.spec.ts` only tests deep COMMITS (always past threshold), so this is uncovered.

### B2 - The §6.2 dest-no-jump assertion is vacuous (BLOCKING, auditor 4)

The e2e holds mid-drag with `waitForTimeout(200)` before measuring (`e2e/tab-swipe-preview-height.spec.ts` pattern). The `neighborOffset` rAF (`:332-336`, ~16 ms) has synced to 0 long before measurement, so the one-frame dest jump (first-move flush, pre-rAF) is over before the assertion runs. The test passes whether or not the synchronous `neighborOffset = 0` is present - it certifies nothing, yet the plan advertises it as pinning "no dest jump." A test whose pass/fail is independent of the fix it claims to pin is a certification blocker.

## Convergent majors (non-blocking, addressed in revision)

- **M1 - Boundary rubber-band fires `scrollTo(0,0)` on a scrolled source (auditors 3, 4, 5).** The entry block fires on every first move with `dragOffset === null`, including a rightward drag at `activeIndex === 0` / leftward at the last tab, where `follow()` (`:162-167`) deliberately returns `0.4 * deltaX` (rubber-band, no neighbour). On a scrolled source (Discussions is the tallest panel), the document jumps to top during a gesture that should be inert. v3 §4.6 marks skipping the pin "optional" and mischaracterises the `scrollTo` as a no-op; the skip must be mandatory, gated on "there is a real neighbour in the drag direction."
- **M2 - Direction reversal leaves `destIndex` pointing at the wrong neighbour (auditor 3).** v3 captures `swipeDirection` once on the first move. A gesture that starts rightward (`destIndex = activeIndex − 1`) then reverses past the origin into the forward commit zone commits `switchTo(activeIndex + 1)` - the opposite neighbour - while `viewportHeight` was sized for the left neighbour. Height discontinuity at commit + a clip/gap for the reversal case.
- **M3 - Commit-time exiting-source vertical jump, mischaracterised as "clipping" (auditors 4, 5).** At commit the source transform flips `translateY(-sourceScrollY)` → `translateY(neighborOffset)` in the same flush `dragOffset → null`, a `sourceScrollY`-px content shift on the exiting panel during the 200 ms snap. Auditor 5 verified this is symmetric with the CURRENT code's own commit jump (`switchTo:193`/`switchBackward:213` already `scrollTo(0,0)` before the snapshot), so it is NOT a new regression - but v3's §7 calls it "clipping," which hides the actual artifact.

## Convergent revision suggestion → v4 direction

1. **Derive `destIndex` live from the `dragOffset` sign, drop `swipeDirection`.** `destIndex = dragOffset === null ? activeIndex : dragOffset > 0 ? clamp(activeIndex − 1) : clamp(activeIndex + 1)`. A reversal flips `destIndex` with the live sign; a boundary clamp collapses it to `activeIndex`. Dissolves M2 and half of M1.
2. **Gate the entry block on "has a real neighbour in the drag direction," using the raw `deltaX` at the first move** (since `dragOffset` is null there): `(deltaX > 0 && activeIndex > 0) || (deltaX < 0 && activeIndex < last)`. Boundary rubber-bands skip the `scrollTo`/pin entirely → truly inert. Dissolves M1.
3. **Guard the cancel-branch restore with a `sourcePinned` flag** set true ONLY by the tab-slide entry block, false on any release. Deep-path cancels leave it false → no restore → no window corruption. Dissolves B1. (A 1-bit guard on the cancel path, not a lifecycle driver; the lifecycle remains `dragOffset`.)
4. **Replace the §6.2 dest-no-jump hold-and-measure with a per-frame rAF trajectory sampler** installed BEFORE the swipe: record the dest section's top every frame through the entry, assert it is within the viewport at every sampled frame (no frame where a stale `neighborOffset` pushes it below). Dissolves B2.
5. **State the commit-time source jump honestly** in risks (transient on the exiting panel, symmetric with current behaviour, not a new regression). Dissolves M3's mischaracterisation.
6. **Remove the §8 "Audit points" section entirely** (process correction: the plan must not seed the auditors).

## Verified-TRUE facts carried forward (Round 3 additions)

- The track-dest core, the `:173` structural deep-path exclusion, the reactive transform, the synchronous `neighborOffset = 0`, and the `dragOffset`-lifecycle release are all verified correct (auditors 1, 2 PASS; auditors 3-5 endorse the core, fault only the edge cases). R1/R2 blockers stay dissolved.
- `swipeEnd`'s else-branch (`:244-248`) is the cancel path for ALL swipe types (forward/back/tab-slide/deep), reached when no commit condition holds.
- `follow()` (`:162-167`) returns `0.4 * deltaX` at boundaries (same sign, no real neighbour); a boundary drag still enters the `:183` else-branch.
- `dragOffset`/`rawDragOffset` reflect the live drag direction; `dragOffset > 0` = rightward/back, `< 0` = leftward/forward. A live-sign `destIndex` tracks reversal.
- The deep-preview back-commit `setTimeout` branch (`:233-237`) intentionally leaves `dragOffset` non-null through the 300 ms slide; `swipeDirection` (being dropped) was never set on that path, so `destIndex` collapsed to `activeIndex` - a no-op. v4's live-sign `destIndex` is likewise a no-op there (deep path doesn't enter the `:183` else).
- The `(tabs)` snapshot source-scroll loss on tab commit is pre-existing (`switchTo:193`/`switchBackward:213` `scrollTo(0,0)` before navigation); v3/v4 does not worsen it.
- `e2e/tab-swipe-preview-height.spec.ts` never scrolls the source and measures ~200 ms after the held move; its 3 assertions cannot exercise the source pin, the one-frame dest transient, or the cancel/edge paths. The §6.2 per-frame sampler is the only thing that would.
