# RV21-C01 Audit 91 (R91)

**Date:** 2026-08-02. **Round:** R91. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

Three findings: one **§5 behavioral violation** (code fix), two
comment-accuracy fixes.

## Auditor A-F1 (CONFIRMED, §5 violation): search-axis snap at re-grab-into-release

**Site:** `#armSettleEaseFromGesture` (`orchestrator:3432-3570`).

The gesture-release site captured the morph terminal (`startMorph` via
`#dragMorphAtSettleTakeover`) and the FAB terminal (`capturedFabScale` via
`#fabScaleAtSettleInstant`, re-seeded `#enterFabAnchor` after the arm) but
had NO search-axis counterpart. For a re-grab whose `#dragSearchAnchor`
shifted the gesture formula, clearing `#dragSearchAnchor` (via the arm)
without re-seeding `#searchAnchor` caused `searchProgress` to snap from
the shift-formula value to the bm-formula value in one frame at the
release (a ~196px search-track jump on a 393px viewport). The docstring
rationale ("the drag's terminal gesture-branch value already equals the
target's at-rest searchProgress") was wrong for re-grab cases.

**Fix (code):** Added `const capturedSearchProgress =
this.#searchProgressAtSettleInstant();` before the arm (alongside
`capturedFabScale`), and a post-arm re-seed
`this.#searchAnchor = { start: capturedSearchProgress, dest: destSearch }`
(alongside the FAB re-seed), mirroring the FAB pattern exactly. Updated
the docstring rationale. The 4 other `#searchAnchor` reach paths
(playEnterAnimation, discrete-nav arm, accelerateInFlight, notifyHeaderState
absorb) all use this capture-before-arm + re-seed-after-arm pattern; the
gesture-release site was the sole asymmetric outlier.

**Verify:** `bun run check` 0/0. Targeted e2e `messages-back-swipe.spec.ts`
41 passed (incl. R24-A accelerateInFlight, R26-A re-grab, R28 mid-re-grab
discrete-nav search-track continuity tests).

## Auditor A-F2 (CONFIRMED): stale "end to end" comment

**Site:** `orchestrator:4503-4506` (`resetPagerStore` centerTab branch).
"backMorph: null so the Header stays in root mode end to end" -- stale
from pre-Fix-A (Fix A changed the centerTab branch to publish
`backMorph: rawDragFraction` during drags, so the Header eases toward
back-arrow mid-swipe, not "end to end"). Also: the at-rest morph reads
`currentHasTabs`, not `backMorph`. Rewrote to reflect both.

## Auditor B-F1 (CONFIRMED): `(F,F,*)` shape notation

**Site:** `orchestrator:3071`. The comment used `(F,F,*)` shape notation,
but the layer's convention (siblings at `:2932` `(F,F,T)`, `:2937`
`(F,T,F)`, e2e messages-back-swipe:2969 `(T,T,F)`) is
`(source.hasTabs, dest.hasTabs, dragTarget.hasTabs)`. The flagship shape
(forward-swipe-to-`/search` from `/messages/inbox` interrupted by
`goto('/activity')`) is source=tab(T), dest=tab(T), dragTarget=`/search`(F)
-> `(T,T,F)`, not `(F,F,*)`. Fixed to `(T,T,F)`.

## Orchestrator verification

Independently verified all three before editing. A-F1: confirmed the
structural asymmetry (morph + FAB capture/re-seed present, search absent;
`grep #searchAnchor =` confirms 4 write sites, none in
`#armSettleEaseFromGesture`) and the behavioral plausibility (shift formula
≠ bm-formula at the release boundary for re-grabs). A-F2: confirmed Fix A
changed the centerTab publication. B-F1: confirmed the hasTabs convention
and the flagship's actual shape.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean;
`messages-back-swipe.spec.ts` 41 passed. A-F1 a code change (search
capture+re-seed); A-F2 + B-F1 comment-only.

## Disposition

Counter after R91: 0/5. A-F1 is the first **behavioral §5 fix** in the
R70-R91 comment-accuracy phase -- a real search-axis snap at the
drag-to-settle handoff for re-grab-into-release from `/search`.
