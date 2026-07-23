# DV20 Cycle 5b2 - Audit 125 (R125)

**Date:** 2026-07-22. **Round:** R125, the twenty-third spec-scoped round.
**Counter after:** 0/5 (auditor A BLOCK; auditor B PASS). **Gate:** green
(comment-only fix; R122's full e2e remains valid).

Auditor A voted BLOCK; auditor B voted PASS. A escalated a comment that R121 to
R124 had tracked as a non-blocking nitpick (FloatingActionButton.svelte:14-18) to
a real defect, and the orchestrator's independent verification confirms A is
correct.

## A finding (1, fixed)

- **A1 (FloatingActionButton.svelte:14-18, concern).** The atom's docstring said
  "The layer is a reactive reader of both sources and binds them through the
  inline `style:transform` binding; the atom has no transition directive." This
  mis-attributes the style:transform binding site: the layer
  (FloatingActionButtonLayer.svelte) has no style:transform (it derives scale and
  translateY and passes them as props); the inline style:transform binding lives
  on the atom itself (line 64). The comment also contradicted the same
  docstring's first paragraph ("The transform binds a SINGLE scale(s)
  translateY(y) string..."), which correctly places the binding on the atom.
  Fixed: the docstring now states the layer derives scale and translateY and
  passes them as props to the atom, which applies the inline style:transform
  binding; the atom carries no CSS transition directive.

## Process note (orchestrator self-correction)

R121 to R124 all recorded this same FloatingActionButton.svelte:14-18
observation as a non-blocking nitpick ("imprecise attribution, not wrong"), and
the orchestrator deferred fixing it ("does not second-guess a PASS by
pre-emptively rewriting comments the auditors judged acceptable"). A's strict
reading is correct: the comment is literally inaccurate (attributes the binding
to the layer when it is on the atom) and internally contradictory. The
orchestrator should have independently verified (read the code) rather than
perpetually deferring to the "below the bar" judgment. Lesson recorded in
auto-memory: a nitpick that recurs across rounds should be independently
verified, because it may be a real inaccuracy under-classified by prior auditors.

## B note (PASS)

Auditor B voted PASS; ran an exhaustive publication-writes-track sibling search
(seven phrasings) confirming the R124 fixes hold and no remaining instances;
verified the "frame-synced / lockstep" phrasings correctly describe the
publication and the track as separate values. B did not flag the
FloatingActionButton:14-18 comment (the split that surfaces a long-deferred
inaccuracy).

## Gate

check 0 errors / 0 warnings (1467 files); lint exit 0 (similarity informational;
type duplicates 0); prettier clean; no U+2014. Comment-only fix; R122's full e2e
(210 passed / 0 flaky) remains valid. Counter 0/5 (A's concern resets). R126
audits the fixed pipeline under the spec scope.
