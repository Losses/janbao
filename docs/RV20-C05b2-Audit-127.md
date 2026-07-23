# DV20 Cycle 5b2 - Audit 127 (R127)

**Date:** 2026-07-23. **Round:** R127, the twenty-fifth spec-scoped round.
**Counter after:** 0/5 (both auditors BLOCK). **Gate:** green (comment-only fixes;
R122's full e2e remains valid).

Both auditors voted BLOCK and independently surfaced the SAME two findings (strong
corroboration). Both are in Header.svelte.

## Findings (2, corroborated by both auditors, fixed)

- **Header.svelte:327 (very low).** The trackMorph comment's outside-transition
  branch called `pager.tapMorph` "the orchestrator's tap-scrub rAF publication".
  `tapMorph` is a pager-store field (written via `pager.setTapMorph` by the
  orchestrator's tap-scrub rAF), not an OrchestratorPublication field. A sibling
  of the R126 publication-vs-pager-store class, missed because it sits nine lines
  below the R126 B1 fix (line 316-318) in the SAME comment block. Fixed: "a
  pager-store field the orchestrator's tap-scrub rAF writes".
- **Header.svelte:163 (very low).** The morph drag-branch comment said
  backMorph===null means "(no in-flight publication)", but the branch only runs
  when `pager.dragging` is true, which requires `publication.inFlight === true`.
  The null-backMorph case during a drag is a centerTab (thread) route or a
  bidirectional tab-to-tab transition, where #republishToPager writes
  backMorph:null end-to-end while the publication IS in flight. The parenthetical
  was inverted. Fixed: "(centerTab or tab-to-tab publishes null)".

## Note on this round's prompt

R127's launcher prompt included a "Cycle history" recap and a pre-explained
publication-vs-pager-store distinction. The owner flagged this mid-round as
focus-shifting (it biases the auditors toward the recently-fixed class). Both
findings this round are in that class, illustrating the bias; they are nonetheless
real defects and are fixed. R128 onwards uses a stripped prompt (read the
audit-prompt file + spec, find ANY defect, sibling search, constraints, report)
with no cycle recap and no pre-explained mechanisms.

## Gate

check 0 errors / 0 warnings (1467 files); lint exit 0 (similarity informational;
type duplicates 0); prettier clean; no U+2014. Comment-only fixes; R122's full
e2e (210 passed / 0 flaky) remains valid. Counter 0/5. R128 audits the fixed
pipeline under the spec scope.
