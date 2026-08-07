# RV21-C01 Audit 153 (R153)

**Date:** 2026-08-07. **Round:** R153. **Votes:** auditor A BLOCK (1),
auditor B BLOCK (1). **Counter after: 0/5.**

## Outcome

Two defects: one from R152's own fix (0..1 clause inconsistency), one
correcting R150's wrong re-addition of `/offline/bookmarks`. Both fixed.

## A's finding -- `e2e/search-enter-exit-asymmetry.spec.ts:54`

**R152 regression:** R152 fixed the NULL clause (adding "non-centerTab"
qualifier to "during tab-to-tab transitions") but left the 0..1 clause
inconsistent. An in-flight centerTab tab-to-tab drag now falls into
NEITHER clause (it IS tab-to-tab, excluded from 0..1 by "non-tab-to-tab";
it's NOT "non-centerTab tab-to-tab", excluded from null).

Fixed: "0..1 during any in-flight transition except non-centerTab
tab-to-tab" -- correctly covers all in-flight cases including centerTab
tab-to-tab (which publishes raw).

## B's finding -- `e2e/reproduce-dv20-drag-sync.spec.ts:97`

**R150 correction:** R150 re-added `/offline/bookmarks` to the definite
null-backMorph list citing R142's reasoning. R142's reasoning was about
the settle-arm's `backMorphIsNull` computation, but R142's fix didn't
account for `updateBackTarget` (NavPipelineHost's post-mount `$effect`)
which overwrites `inputs.toTabIndex` to strict `#tabIndexFor('/offline')
= -1` before any gesture begins. So at gesture time `#gestureToTabIndex
= -1`, and the publication computes `backMorphValue = (0 >= 0 && -1 >= 0)
? null : raw = false -> RAW` -- NOT null.

This is a significant finding: R148 noted the `updateBackTarget`
strict-overwrite divergence as a "borderline" but classified it only on
§5 consistency grounds, not on whether the comment's literal "null end
to end" claim survives the overwrite.

Fixed: removed `/offline/bookmarks` from the null list (matching R139's
original removal, now for the correct reason).

## Verify

`bun run check` 0/0; `bun run lint` exit 0; `bun test src/lib` 552/0;
prettier clean; no U+2014 em-dash. Comment-only changes.

## Disposition

Counter after R153: 0/5. The `updateBackTarget` strict-overwrite fact is
a fundamental runtime nuance that R142's framing (loose for non-bidi
backward) missed. R154 is expected to fix the 4 orchestrator docstrings
that encode the outdated "loose for non-bidi backward" framing.

**No git mutation.** No commits, no branches, no pushes.
