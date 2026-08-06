# RV21-C01 Audit 137 (R137)

**Date:** 2026-08-06. **Round:** R137. **Votes:** auditor A BLOCK,
auditor B BLOCK. **Counter after: 0/5.**

## Outcome

Two confirmed defects: **one correctness bug (F1, the first in the
R100-R137 loop)** and one comment inaccuracy (F2). Both fixed. Counter 0/5.

## F1 (HIGH, correctness + §5 violation) -- morph snap at drag-to-settle handoff for backward-to-thread/compose

`#dragMorphAtSettleTakeover`'s `dragMorphWasStatic` classification used
`isTabToTab = outgoingHasTabs && incomingHasTabs` with **loose**
`incomingHasTabs = getCurrentTabIndex(target) >= 0` (pill-mapping). But
the publication's null-`backMorph` condition uses **strict** `#tabIndexFor`
(`isTabRootPath`) and `tag === 'tab'`. For a thread/compose target
(pill-maps to a tab index but is NOT a tab root and has `tag: 'detail'`),
the publication yields `backMorph: rawDragFraction` (dynamic morph
`1 - bm`), but the helper classified `dragMorphWasStatic = true` (static)
→ `startMorph = atRestMorph(outgoing) = 1`, while the drag's last frame
was `1 - bm_release` → **morph snap** at the handoff. Reachable: back-swipe
from any tab root toward a thread/compose (e.g. `/activity` →
`/discussion/<id>`). A's trace confirmed the snap empirically.

**Fix:** replaced the `isTabToTab` approximation with a `backMorphIsNull`
parameter computed at each call site from `#republishToPager`'s actual
null condition: `(inputs.bidirectional && getRouteData(target).tag ===
'tab') || (inputs.fromTabIndex >= 0 && isTabRootPath(target))`. This
matches the publication exactly (no loose/strict divergence). Applied to
both call sites (gesture-release `:3493`, discrete-nav `:2764`), the
helper signature/body `:3637`, and the docstring. Verified: `bun run check`
0/0; `bun test src/lib/stores src/lib/utils` 398/0 (no regressions).

B did NOT flag F1 (claimed the helper "matches the Header's drag branch
end-to-end") -- A's specific trace of the backward-to-thread case proved it
doesn't. This is the first correctness bug found in the convergence loop
(R100-R136 were all comment-accuracy).

## F2 (concern, comment) -- `#republishToPager` "Two reach paths" non-exhaustive

The `holdPillAtFromIdx` branch comment said "Two reach paths: backward-to-
deep-page and forward-last-tab-to-`/search`," but the branch fires for
ALL non-tab targets (including backward-to-thread/compose/`/search`). And
"the deep-page morph for a backward gesture" is wrong for backward-to-
`/search` (the `targetIsSearch` skip holds the morph; `searchProgress`
consumes `backMorph`). Fixed: broadened to the actual reach-path list and
corrected the morph attribution per target type.

## Verify

`bun run check` 0/0; `prettier --check` clean; no U+2014 em-dash;
`bun test src/lib/stores src/lib/utils` 398/0; F1 runtime change verified
(types + tests green, no regressions).

## Disposition

Counter after R137: 0/5. F1 is a genuine §5 morph-snap bug (first
correctness defect of the loop); F2 is a comment. Both fixed.

**No git mutation.** No commits, no branches, no pushes.
