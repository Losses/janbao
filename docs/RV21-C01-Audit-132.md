# RV21-C01 Audit 132 (R132)

**Date:** 2026-08-05. **Round:** R132. **Votes:** auditor A PASS,
auditor B BLOCK. **Counter after: 0/5.**

## Outcome

A PASSed (zero concerns); B BLOCKed on 1 finding. They DISAGREED on the
single site. The orchestrator verified B's finding is a genuine inaccuracy
(not a defensible simplification) and fixed it. R132 is BLOCK (1 confirmed
concern). Counter 0/5.

Trajectory: R130=12, R131=10 (4 confirmed), R132=1 (1 confirmed). The
refined R132 prompt (pre-empting the Class-2 "tab-to-tab includes offline
LIST" over-reach; requiring genuine inaccuracy not mere concision) plus
the accumulated fixes shrank the pool sharply.

## The finding -- `e2e/search-enter-exit-asymmetry.spec.ts:54-55`

The `backMorph` field docstring's first clause read "0..1 during any
in-flight non-tab-to-tab transition and at rest on a NavPipelineHost
route." This is literally wrong for centerTab NavPipelineHost routes
(thread/compose): `resetPagerStore` (line 4540) sets `backMorph: null` at
rest for `centerTab !== undefined`, not a 0..1 number. (Deep pages, the
non-centerTab NavPipelineHost case, get `backMorph: 0` at rest, line 4591.)
The clause sharpened into a contradiction with the (R131-broadened) second
clause "null at rest on a centerTab route or a tab host."

A judged it a defensible "X in case A; null in case B (B refines A)"
technical-writing pattern. The orchestrator rejected that defense: the
first clause states a falsehood for a real subset (centerTab NavPipelineHost
routes), and the bar (no borderline) plus the low-risk precision fix
favor correcting it.

Fixed: "at rest on a NavPipelineHost route" -> "at rest on a non-centerTab
NavPipelineHost route." Now the clauses partition cleanly (non-centerTab
NavPipelineHost = 0; centerTab / tab-host = null).

## A's clean PASS

A re-derived every multi-path field/parameter docstring against its full
caller set, verified Fix A/B/C/D, §5, the R120-R131 fixes intact, no dead
exports, no past-state markers, and examined 5 borderline cases (judged
all defensible). A's only point of disagreement with B was the one finding
above.

## Verify

`bun run check` 0/0; `prettier --check` clean; no U+2014 em-dash;
comment-only change.

## Disposition

Counter after R132: 0/5. The pool has shrunk to a single confirmed defect
this round. The refined prompt (genuine-inaccuracy filter + Class-2
pre-emption) is working. R133 tests whether the layer is now clean enough
for the first PASS of a new run.

**No git mutation.** No commits, no branches, no pushes.
