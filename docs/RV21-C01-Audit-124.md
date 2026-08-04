# RV21-C01 Audit 124 (R124)

**Date:** 2026-08-04. **Round:** R124. **Votes:** auditor A BLOCK,
auditor B BLOCK. **Counter after: 0/5.**

## Outcome

A and B INDEPENDENTLY converged on the identical defect (strong
corroboration): the `DragMorphAnchor` symmetric-reference sentence
over-narrowly characterizes `startMorph`. Two sibling sites, identical
phrasing:

- `orchestrator:734-735` (`#dragMorphAnchor` field docstring)
- `header-probe.ts:77-78` (`DragMorphAnchor` interface docstring)

Both read: "Symmetric to how the settle's `startMorph` captures the
drag's terminal value at release." This characterizes `startMorph` by
only the gesture-release path. The symmetry it draws -- a drag taking
over a settle (`#dragMorphAnchor`) vs a settle taking over a drag
(`startMorph`) -- has TWO settle-takes-over-drag cases: the gesture
release (startMorph = drag's terminal at release) AND the discrete-nav
interrupt (startMorph = `liveDragMorph` = the drag's value at the
interrupt instant, the drag cut short, never terminal). "the drag's
terminal value at release" covers only the first.

This is the same class as R120 (Header.svelte:275, header-probe.ts:39
startMorph docstrings) and R121 (`#atRestMorph` justification): a
multi-path value characterized by one path without a qualifier. R120
established the canonical characterization ("the drag branch's value at
the settle-arm instant"); the DragMorphAnchor sentence (5 lines below
the R120-fixed `startMorph` docstring in header-probe.ts) kept the
pre-R120 phrasing. B also noted it is internally inconsistent with its
own "null when ... after the drag ends (the next settle's arm ...
clears it)" clause, which already acknowledges multiple settle-arm types.

## Why R122 and R123 missed it (and R124 caught it)

R122 and R123 both double-PASSed (counter reached 2/5) without flagging
this sentence. Their auditors re-derived the `startMorph` field
docstrings and the `#atRestMorph` justification, but did not re-derive
the DragMorphAnchor symmetric-reference sentence against startMorph's
paths. R124's auditors took that extra step. This is the convergence
bar correcting a premature PASS -- the counter resets to 0/5 (R122 +
R123's two passes wiped). The bar does not lower.

## Fix

Both sites rewritten to the canonical characterization:
"Symmetric to how the settle's `startMorph` captures the drag's value at
the settle-arm instant." This covers both the gesture-release and the
discrete-nav-interrupt cases (the settle-arm instant is whenever the
settle takes over), and aligns with the R120 `startMorph` docstring 5
lines above.

## Orchestrator verification

Re-grepped `terminal value at release` across `src/lib` + `e2e`: the
only remaining hit is `header-probe.ts:26` ("whose terminal value at
release can disagree") -- a DIFFERENT concept (the drag-branch
gesture-feedback morph's terminal, not a `startMorph` characterization).
Accurate; not a defect. Both auditors' sibling sweeps concur the 2
DragMorphAnchor sites are the only unfixed siblings of the class.

## Verify

`bun run check` 0/0; `prettier --check` clean on both edited files; no
U+2014 em-dash; comment-only change.

## Disposition

Counter after R124: 0/5. The over-narrow-characterization class (R120,
R121, R124) keeps surfacing one or two residual sites per deep audit.
Fixed. The loop restarts its PASS count from R125.

**No git mutation.** No commits, no branches, no pushes.
