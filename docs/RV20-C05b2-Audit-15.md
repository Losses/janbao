# RV20-C05b2 - Audit Round 15 (architect-run, 2 independent auditors, MINIMAL prompt)

Result: **A PASS-WITH-CONCERNS (1 MED + 5 LOW); B PASS-WITH-CONCERNS (1 MED +
2 LOW/CONCERN).** Counter stays **0/5** (both PWC). The two MED findings are
pre-existing deviations now documented as Known (#6 thread cross-tab back-target;
#9 activeIndex=0 empty proxy - a consensus finding both auditors flagged). The
fixable items are fixed. Gate re-run after the fix.

R15 used the MINIMAL prompt (spec + Plan + "find any defect" + forbidden-reads +
output format; no scope framing). Both auditors independently traced real
trajectories.

## Consensus: activeIndex=0 backward-to-deep-page reveals empty space (A #2 = B #1)

Both auditors independently found the same defect. At the leftmost tab
(`fromTabIndex === 0`) a backward-to-deep-page back-swipe resolves a slide plan
that shifts panel 0 off-screen right with no panel to its left, so the slide
reveals empty space for its duration; on commit `history.back()` lands on the
deep page correctly. Known #9's wording ("the slide reveals the PREVIOUS TAB's
panel as a visual proxy") assumed `fromTabIndex >= 1` and excluded the
leftmost-tab case.

**RESOLUTION:** documented as Known #9 (extended to cover the activeIndex=0
empty-space case explicitly). The clean visual fix is the existing `TODO(5b3)`
deep-snapshot overlay (it fills the empty space at activeIndex=0 and replaces the
wrong proxy at activeIndex>=1 - one fix for both). A 5b2 partial fix (snap or
suppress the slide at activeIndex=0) would bridge against the activeIndex>=1
behaviour and violate the unify-don't-bridge principle. The
`#backwardTabTarget` docstring is corrected to describe both cases accurately.
Preventive e2e added (`backtarget.spec.ts`) asserting the landing correctness
(history.back to the deep page) for the activeIndex=0 trajectory.

## A #1 (MED) - thread reached cross-tab backs to the tab root, not the source

When a thread is reached cross-tab (e.g. `/activity` -> `/discussion/<id>`),
`seedStackForLanding` re-seeds the destination tab's stack to
`[tabRoot, thread]`, so the orchestrator's mount-supplied `backTarget` resolves
to the tab root, not the cross-tab source. A gesture back-swipe lands on the tab
root while OS back returns to the source. This violates macro-plan §3 ("a thread
reached from elsewhere backs to where the user came from").

**RESOLUTION:** documented as Known #6 (extended with a fourth macro-plan
divergence). The fix - route the thread host's back-target through
`previousEntryPathname()` as `#backwardTabTarget` does for the tab host - ripples
into the left-panel preview rendering (the preview must match the real
back-target, which for a non-profile/admin source hits the Known #16 no-preview
gap). So the target fix is coupled with the 5b3 deep-snapshot overlay; fixing
only the target without the overlay would trade a wrong-target-with-preview for a
right-target-without-preview. Pre-existing (predates 5b2), not a 5b2 regression.

## A #3 (LOW) - `resetPagerStore` cleared `committed` only in the deep-page branch

The thread (`centerTab`) and bidirectional branches did not pass `committed`,
relying on `unmount` + `#landAtRest` to clear it via external sequencing.

**FIX:** both branches now pass `committed: null` for consistency with the
deep-page branch. Defense-in-depth; no visible artifact before or after.

## A #4 (LOW) - non-profile/admin back-targets render no preview panel

`PREVIEW_PANEL_CONFIG` covers only profile and admin. For a thread/deep host
whose back-target is `/bookmarks`, `/notifications`, `/search`, or
`/messages/<id>`, the left-panel renders nothing during the slide.

**RESOLUTION:** documented as Known #16 (new). Same root cause + fix path as
Known #9 (the 5b3 deep-snapshot overlay fills the preview).

## A #5 (LOW) - Header reads the dead `navStore.navInFlight`

**RESOLUTION:** already documented as Known #12 (the Header animation layer;
R13 corrected the Effect D docstring that describes this dead signal).

## A #6 (LOW) - `isPipelineSwipeDisabledRoute` mutex-dependent mis-classification

**RESOLUTION:** already documented as Known #4 (R14 added `/messages/add/[userId]`
to the list).

## B #2 (LOW) - `#backwardTabTarget` docstring claimed a proxy that does not exist at activeIndex=0

**FIX:** the docstring now describes both the `fromTabIndex >= 1` (previous-tab
proxy) and `fromTabIndex === 0` (empty space) cases, and the TODO(5b3) overlay
note covers both.

## B #3 (LOW/CONCERN) - the activeIndex=0 backward-to-deep-page trajectory had no e2e

**FIX:** a new test in `backtarget.spec.ts` drives `/bookmarks` -> tap discussions
-> back-swipe on `/` and asserts the landing on `/bookmarks`.

## Gate outputs (post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    418 pass / 0 fail
$ bun run test:e2e                    197 passed, EXIT=0 (8.3m, clean run)
```

Consecutive pass votes: **0/5** (both PWC; the two MED findings are pre-existing
deviations now documented as Known #6 + #9, the LOW items fixed or already
Known). R16 audits the post-fix state.
