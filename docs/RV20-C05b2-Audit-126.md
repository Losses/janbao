# DV20 Cycle 5b2 - Audit 126 (R126)

**Date:** 2026-07-23. **Round:** R126, the twenty-fourth spec-scoped round.
**Counter after:** 0/5 (auditor A PASS; auditor B BLOCK). **Gate:** green
(comment-only fixes; R122's full e2e remains valid).

Auditor A voted PASS; auditor B voted BLOCK on a 7-sibling class: comments in
Header.svelte and BurgerArrowIcon.svelte that call pager-store fields
(`pager.backMorph` / `pager.tapMorph`) or derivations reading them
(`searchProgress`, `trackMorph`, `iconProgress`) "the orchestrator's publication",
conflating two distinct reactive surfaces. The orchestrator's
OrchestratorPublication interface docstring (the R117 fix) is explicit that
`backMorph` / `tapMorph` / `transitionTarget` are PAGER-STORE fields written via
#republishToPager; only the settle / searchScrubbing fields live on the
publication. This is the A111 / A116 regression R124 partially fixed: those rounds
swapped "the orchestrator's rAF" to "the orchestrator's publication" to fix the
rAF-ownership overclaim, but introduced a publication-vs-pager-store conflation.
R124's grep scope (publication-WRITES-track) caught three sites and missed these
seven (publication-vs-pager-store-field). A's grep shared R124's scope and missed
them; B broadened to the conflation class and caught all seven.

## B findings (7 siblings, fixed)

- **B1 (Header.svelte:316-318).** The trackMorph parenthetical called
  `pager.backMorph` "the orchestrator's publication". Fixed: "a pager-store field
  the orchestrator writes via #republishToPager".
- **B2 (Header.svelte:202-203).** The title-view called `pager.backMorph` "the
  orchestrator's synchronous per-pointermove publication". Fixed: "a pager-store
  field the orchestrator writes synchronously per pointermove".
- **B3 (Header.svelte:374-378).** The trackStyle comment said "the orchestrator's
  publication ... drives every frame" but searchProgress / tabProgress read
  pager-store fields, not the publication. Fixed: "the orchestrator writes the
  pager-store fields these derive from, every frame".
- **B4 (Header.svelte:381-383).** The search-button comment "sync'd with the
  orchestrator's publication". Fixed: "searchProgress reads the pager-store fields
  the orchestrator writes".
- **B5 (Header.svelte:625-630).** The search-button HTML comment "the
  orchestrator's publication ... drives searchProgress". Fixed: "the orchestrator
  writes the pager-store fields searchProgress reads".
- **B6 (Header.svelte:31-36).** The file-level §5 summary "the orchestrator's
  publication ... drives every motion" contradicted the breakdown at lines 21-30
  (which lists publication settle / scrub fields AND pager-store morph fields).
  Fixed: "the orchestrator (publication record + pager-store morph fields it
  writes via #republishToPager)".
- **B7 (BurgerArrowIcon.svelte:28-33).** The file-level summary "the orchestrator
  owns the morph's motion through its publication" contradicted the breakdown at
  22-28 (drag = pager.backMorph; scrub = pager.tapMorph; settle = settleProgress).
  Fixed: "drag and scrub via the pager-store fields above; settle via the
  publication".

## Additional fix (A's borderline, independently verified)

- **Header.svelte:337-340.** A flagged this as borderline-PASS: "the consumers
  (track / search button / scope-tab bar) are pure functions of this value
  [searchProgress]", but the scope-tab bar is driven by `tabProgress`
  (Header.svelte:391-393), not searchProgress. The orchestrator independently
  verified this is a real inaccuracy (not just imprecision) and fixed it per the
  "fix architecture cleanliness at all costs" directive: the comment now lists
  only track / search button as searchProgress consumers and notes the scope-tab
  bar uses tabProgress. (Applying the recurring-nitpick-verify lesson: a borderline
  case an auditor flags is independently verified rather than inherited as a pass.)

## Gate

check 0 errors / 0 warnings (1467 files); lint exit 0 (similarity informational;
type duplicates 0); prettier clean; no U+2014. Comment-only fixes; R122's full
e2e (210 passed / 0 flaky) remains valid. Counter 0/5 (B's concern resets). R127
audits the fixed pipeline under the spec scope.
