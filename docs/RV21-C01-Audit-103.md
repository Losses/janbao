# RV21-C01 Audit 103 (R103)

**Date:** 2026-08-03. **Round:** R103. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

Four findings, all consequences of R102's searchProgress fallback change.
R102 introduced two snaps and broke the R24-A single-source-of-truth
invariant. R103 reverts R102 and documents the R26-A hold-at-anchor
design.

## Auditor A (3 findings, CONFIRMED)

**F1 (correctness):** R102 changed the bm===null fallback from
`return dragSearchAnchor.search` to `return isSearch ? 1 : 0`,
introducing a ~393px searchProgress snap at the settle-to-drag handoff
(panel snaps from 1 to 0 in one frame). The morph axis's analogous
branch still holds at anchor (R8-A F2) -- the search axis was the sole
asymmetric outlier.

**F2 (correctness + architectural):** R102 broke the R24-A invariant
between `#searchProgressAtSettleInstant` (the helper) and the Header.
The helper still returned the shift formula (= `anchor.search` for
bm===null), but the Header returned at-rest. At the drag-to-settle
handoff (release), the helper captured 1 but the Header was rendering 0
→ snap from 0 to 1, then settle lerps 1→0 ("snap-in-then-slide-out").

**F3 (stale comment):** The helper's dragSearchAnchor branch comment
(`:4468-4469`) claimed "`anchor.search === 0`" -- wrong post-R91 (the
re-seed can produce `{1, 1}`). Fixed: "typically 0 but can be 1 (a
`/search`-commit settle re-grabbed via R91's re-seed)."

## Auditor B (1 finding, CONFIRMED)

**F1:** R102 left the stale "hold at `anchor.search` instead" sentence
from pre-R102, creating a contradictory comment block (old: "hold at
anchor.search" + new: "return at-rest"). Fixed by the revert (the
comment now consistently describes the hold-at-anchor design).

## Fix: REVERT R102 + document the R26-A design

Reverted line 614 from `return isSearch ? 1 : 0` back to
`return dragSearchAnchor.search`. Rewrote the comment to describe the
R26-A hold-at-anchor design: the search axis holds at `anchor.search`
for the drag's duration (mirrors the morph axis's `nullBmAnchor` hold).
For a `/search`-commit settle re-grabbed into a tab-to-tab swipe,
`anchor.search = 1` (panel was fully slid in); the hold keeps it
visible for the drag's duration and the release settle eases it back
out. The alternative (snapping to at-rest) would introduce a
discontinuity at BOTH the re-grab and the release boundaries.

Fixed the helper comment F3 claim 2.

## Orchestrator verification

A: verified the two snaps (re-grab: 1→0; release: helper captures 1
but Header at 0 → 0→1 snap). The R26-A guard passes because it
exercises bm!==null, not the bm===null pre-route-swap case. B: verified
the stale-sentence contradiction. `bun run check` 0/0; prettier + em-dash
clean. Code change (revert) + comment rewrites.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
A-F1 a code change (revert of R102); A-F3 + B-F1 comment-only.

## Disposition

Counter after R103: 0/5. R102's fix was reverted because it violated the
R26-A hold-at-anchor design and introduced two snaps (worse than the
hold-visible it replaced). The R26-A design (continuity over at-rest
correctness for the bm===null re-grab edge case) is the intentional
trade-off, now documented clearly.
