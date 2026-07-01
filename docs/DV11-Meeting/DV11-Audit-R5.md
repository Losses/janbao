# DV11 - Audit Round 5

5 independent role-less auditors examined `docs/DV11-Plan.md` (v5) under a clean open-ended prompt. Result: **not 5/5 PASS**. 2 PASS / 3 FAIL, all high confidence. The track-dest core and the `sourcePinned` deep-path gating (R4 B1) are endorsed. The remaining defects are all on the source-pin sub-mechanism; one is a new blocker.

## Tally

| Auditor | Verdict | Blocking | Major | Minor | Organic |
| ------- | ------- | -------- | ----- | ----- | ------- |
| 1       | PASS    | 0        | 0     | 3     | clean   |
| 2       | PASS    | 0        | 1     | 3     | clean   |
| 3       | FAIL    | 0        | 2     | 3     | has-special-cases |
| 4       | FAIL    | 1        | 1     | 4     | has-special-cases |
| 5       | FAIL    | 1        | 2     | 3     | has-special-cases |

Result line: **not 5/5 PASS → revised (or rescope).**

## Convergent findings

### Cross-branch reversal leaks `sourcePinned` onto the deep path (BLOCKING, auditor 4)

A single gesture can cross branches: it starts as a forward tab-slide (`:183` else, sets `sourcePinned=true` at entry), then the finger reverses to a back-swipe where `backSwipeShouldPopHistory(activeIndex-1)` is true (a deep page sits behind the current tab - reachable, e.g. thread→forward-to-activity→reverse). That move takes the `:174` snapshot branch while `sourcePinned` is still true, so `viewportHeight = panelHeights[destIndex]` flips on the deep path and the source transform pins - contradicting owner requirement §3.5 (deep path byte-identical) and the plan's §4.6 "sourcePinned never set on deep paths." Not covered by any planned test (the e2e uses monotonic drags between two tab roots).

### Boundary→reversal leaves the defect live (MAJOR, auditors 2, 3)

The entry block fires only on the first move, and only when the real-neighbour gate passes. A swipe that STARTS at a boundary in a no-neighbour direction (e.g. forward on the last tab) never sets `sourcePinned`; if the user then reverses toward a real neighbour, `dragOffset !== null` blocks the entry block from re-firing, so `viewportHeight` reads `activeIndex` (source height) for the entire reversed reveal - the original clip/gap defect resurfaces. Narrow, but real.

### §6.2 source-pin test is not capturable (MAJOR, auditors 3, 5; minor 1, 2)

`holdSwipeMidDrag` dispatches touchMoves back-to-back with no inter-move render yield, so Svelte batches the entry writes into one flush and there is no painted intermediate "entry frame" to sample. The "source section's first-visible content top stays at the viewport top across the entry frames" assertion cannot be implemented with the specified harness. The same vacuity failure mode as R3 B2 / R4 M3.

### §6.3(b) overlay-not-clipped assertion is false (BLOCKING, auditor 5)

The plan §6.3(b) asserts "the `[data-deep-preview]` overlay's visible extent is not clipped below its `innerHeight` box." But the overlay (`height: ${window.innerHeight}px`, 851) sits inside the `overflow-hidden` viewport whose height is `panelHeights[activeIndex]` (e.g. messages 646) - so the overlay IS clipped at the viewport bottom today, and DV11 (correctly) does not change this. The assertion either fails against the unchanged design or is vacuous.

### Commit-time source shift is NEW and unbounded (MAJOR, auditors 4, 5)

At commit the source transform flips `translateY(-sourceScrollY)` → `translateY(0)`, a `sourceScrollY`-px downward jump on the exiting panel. `sourceScrollY` is unbounded (thousands of px on a long list). Acknowledged in §7 but not asserted or bounded.

## Root observation (for the rescoping decision)

Every R3-R5 blocker/major is on the **source pin** sub-mechanism (capture `sourceScrollY`, `scrollTo(0,0)`, `translateY(-sourceScrollY)`, cancel/commit/cross-branch release). The pin exists to prevent the SOURCE from flashing to top when the viewport height changes at swipe entry - a source-side artifact, NOT the reported dest defect. The track-dest viewport (`panelHeights[destIndex]` during the swipe) is what fixes the reported defect, and it is unanimously endorsed and stable across all five rounds.

The source-side has an irreducible artifact under any single-viewport approach: either an **entry-jump** (no pin: the document reflows and the scrolled source snaps to top at swipe start) or a **commit-jump** (pin: the source stays through the drag then snaps when the pin releases at commit). Avoiding both would require keeping the source pinned through the 200 ms commit snap, which needs a transitionend/release hook the pager does not have (the R1/R2 finding).

## Two paths

- **(A) Drop the source pin.** Ship the track-dest viewport alone (`panelHeights[tabSlideActive ? destIndex : activeIndex]`, a per-move `tabSlideActive` flag, no `sourceScrollY`/`scrollTo`/cancel-restore). Fixes the reported dest defect. Accepts the entry-jump (forward swipe from a scrolled tall source shows the source from its top) as a documented trade-off. Dissolves every R3-R5 pin blocker (cross-branch reversal, boundary→reversal, cancel-restore, commit-jump, source-pin test) - there is no pin state to leak. Likely converges in one more round. The entry-jump is the only remaining source-side artifact.
- **(B) Keep the source pin, fix its edge cases.** Cross-branch clear (reset `sourcePinned` when entering the `:173` deep branch mid-gesture); always-pin-at-first-move (drop the real-neighbour gate so boundary→reversal engages); bound/document the commit-jump; reframe §6.2 as "pin is active mid-swipe" (measure after the held move, not the entry frame); fix §6.3(b) to assert the deep-path viewport equals `panelHeights[activeIndex]` (DV11 did not change it), not the overlay's clip. More edge cases likely surface in R6+.

The choice is a scope/UX trade-off (entry-jump vs commit-jump + more rounds), not a correctness fork: both fix the reported dest defect.

## Verified-TRUE facts carried forward (Round 5 additions)

- A single gesture can cross the `:173`/`:183` branch boundary as `deltaX` flips sign (the branch is re-evaluated per move); `sourcePinned`, once set on a tab-slide first move, persists into a deep-branch move unless explicitly cleared. (Auditor 4.)
- The deep-preview overlay (`:421-438`) is `height: ${window.innerHeight}px` inside the `overflow-hidden` viewport and IS clipped at `panelHeights[activeIndex]` today when the active tab is shorter than the screen; `e2e/swipe-forward-back-deep-page.spec.ts` reads the overlay's own box, not the ancestor-clipped extent, so it does not assert the clip either way. (Auditor 5.)
- The source-side artifact is irreducible under a single viewport: entry-jump (no pin) or commit-jump (pin); avoiding both needs a release hook the pager lacks.
- `holdSwipeMidDrag` dispatches touchMoves back-to-back with no render yield (confirmed by auditors 3, 5 reading `e2e/tab-swipe-preview-height.spec.ts:81-99`); an entry-frame sampler needs a different dispatch cadence or a structural (non-frame-sampling) assertion.
- All R1-R4 verified facts remain valid; v5's `sourcePinned`-gated viewport genuinely dissolves R4 B1 for monotonic gestures.
