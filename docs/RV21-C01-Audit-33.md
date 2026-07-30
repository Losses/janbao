# RV21-C01 Audit 33 (R33)

**Date:** 2026-07-30. **Round:** R33. **Votes:** auditor A BLOCK, auditor
B BLOCK (different findings). **Counter after:** 0/5 (BLOCK resets).

Two independent fresh-context auditors. Both BLOCKED on different
`.spec.ts` code-comment inaccuracies. The orchestrator cross-checked
every claim against the code and `#republishToPager` and confirmed all
of them.

## Auditor A finding (CONFIRMED)

`e2e/messages-back-swipe.spec.ts:3350-3354` (R24-A accelerateInFlight
docstring) misdescribes its own assertion window and the search-track
motion timing:

- "samples a +-300ms window around the accelerate flip": the actual code
  at L3432 is `frames.slice(0, accelIdx + 1)` (a one-sided slice of the
  pre-flip frames plus the flip frame, no post-flip). The R10-A F1 FAB
  guard it claims to follow uses `Math.abs(f.t - T) <= 300` (symmetric).
- "in the second half of the slide": the search-track motion is the
  settle-anchor lerp across the whole ~160ms slide (ease-out), not a
  second-half phenomenon (that is FAB-specific `(p - 0.5) * 2`).
- The same test's inline comment at L3414-3420 correctly describes the
  one-sided window and whole-slide motion, so the docstring directly
  contradicts it.

## Auditor B findings (CONFIRMED)

B ran an empirical probe (backMorph per rAF on `/search` after a
saturated forward-swipe): `pager.backMorph` is a non-null number
throughout the enter settle (0 -> 1), collapsing to `0` only at the
at-rest reset. The orchestrator confirmed this against
`#republishToPager` (orchestrator L4758-4759): for the forward-last-
tab-to-`/search` shape `backMorph = rawDragFraction` (non-null); null is
published only for tab-to-tab.

1. `e2e/messages-back-swipe.spec.ts:3467-3469` (R26-A docstring): "the
   re-grab's live `backMorph` publication replaces the enter settle's
   null backMorph" is wrong; backMorph is non-null throughout the enter
   settle. The actual boundary signal is the `transitionTarget` flip
   `/search` -> `/messages/inbox` plus the `dragging` flip.
2. `e2e/search-enter-exit-asymmetry.spec.ts:54` (SearchHdrFrame.backMorph
   type doc): "or null when no swipe-back is in progress" is wrong;
   backMorph is non-null during any in-flight non-tab-to-tab transition
   (including the forward enter, which is not a swipe-back) and is the
   number 0, not null, at rest on a NavPipelineHost route.

## Sibling search (orchestrator, independent)

Grepped `+-Nms window | second half | slice(0, | backMorph-activation |
null backMorph | null when no swipe` across `src/lib` + `e2e/`. The
three sites above are the complete defect set. The other window claims
(R10-A F1 L2561/L2667 `Math.abs <= 300` symmetric, R14 L2918 `<= 200`,
R26-A L3536 / R28 L3589 slice-based) all match their code.

## Extra cleanup (dead code, flagged by IDE diagnostics on the edited file)

`e2e/search-enter-exit-asymmetry.spec.ts` had two pre-existing unused
declarations (not introduced by R33; surfaced when the file was
re-analysed after the type-doc edit): an unused `norm(vals, peak)`
helper (dead code) and an unused `w` parameter on a `waitForFunction`
callback. Both removed (the waitForFunction body uses `window`, not the
arg). `bun run check` does not flag these (tsconfig has no
noUnusedLocals), but "dead code in the pipeline" is a defect class, so
they were fixed in passing.

## Disposition

All five issues fixed this round (see the R33 fix journal entry). No
code change this round; counter after R33: 0/5.
