# DV20 Cycle 5b2 - Audit 119 (R119)

**Date:** 2026-07-22. **Round:** R119, the seventeenth spec-scoped round.
**Counter after:** 0/5 (auditor A PASS; auditor B BLOCK on the pre-fix state).
**Gate:** green (comment-only fix).

Auditor A voted PASS (zero in-scope concerns; read every docstring in the
navigation / animation files; all R116 / R117 fixes held). Auditor B voted BLOCK
on one concern; the orchestrator independently verified it, fixed it, and re-ran
the broad sibling grep. Per the model any concern resets the counter, so R118's
two PASS votes are wiped: counter 0/5.

## B finding (1, fixed)

- **B1 (header-mode.ts:25-27, low).** The file-level docstring claimed "the morph
  progress itself comes from the pager store's `backMorph`," an unqualified
  sole-source claim. The Header's `morph` `$derived.by` (Header.svelte:153-176)
  has three sources: `pager.backMorph` during a drag (lines 164-168);
  `orchestrator.settleProgress` interpolated between the `settleLatched`
  `outgoingHasTabs` / `incomingHasTabs` endpoints during a settle (lines 170-174,
  NOT the pager store); and the static tab-ness at rest (line 175). The comment
  captured the drag branch only and read as a sole-source claim; it predates the
  Step-3 migration of the settle ease onto the orchestrator. Same class as the
  R110 to R118 forward-looking-docstring overclaims. Fixed: the docstring now
  states `resolveHeaderMode` returns the at-rest mode only, and the live morph
  progress is a separate value sourced in Header.svelte's `morph` derivation
  (pointing to the authoritative source rather than duplicating its enumeration,
  so it cannot drift). The orchestrator's independent broad grep ("comes from" /
  "sourced from" / "the morph" / "morph itself" plus iconProgress / titleCrossfade
  source claims) confirmed this was the only unqualified single-source claim in
  the class; every other morph-source mention is phase-qualified (drag / settle /
  scrub) or about a different concept.

## A note (PASS)

Auditor A examined End state, §5 invariant, Constraints, migration completeness,
and comment accuracy; read every docstring in the navigation / animation files;
confirmed all R116 / R117 fixes held. A also verified the OrchestratorPublication
3-item macro-field list (`backMorph`, `tapMorph`, `transitionTarget`) is an
accurate enumeration of the macro morph / FROM-TO fields (the canonical
Header.svelte:25-30 list's other two pager fields, `dragging` /
`scrubIconEndpoint`, are drag-state signals, not macro fields).

## Out-of-scope observations (not fixed, do not affect the vote)

- `src/app.css:312, 318` references the deleted `MobileTabPager`'s
  `.mobile-tab-pager-viewport` class; the `:has(.mobile-tab-pager-viewport)`
  selector never matches (pager deleted) and the surrounding comment lists "Two
  exclusions, both structural" when only one remains. Behavior is correct (the
  rule applies the gutter padding universally to non-fixed-viewport content); only
  the comment and the vestigial selector are stale. Out of scope: `app.css` is a
  global stylesheet, not a navigation / animation file per the audit prompt's
  `.ts` / `.svelte.ts` / `.test.ts` enumeration, and the rule is a layout (content
  gutter) rule, not a pipeline mechanism. The `mobile-content-gutter-excludes-pager`
  memory is stale on the same point. Flagged for whatever cycle owns further
  cleanup.
- `nav-dom-driver-live.ts:128-147` retains dead FAB / Header write branches (R117
  flag; the driver's general capability; the spec does not call for pruning).
- `swipe.ts:109-132` `suppressNextClick` 400 ms `setTimeout` (gesture-detection
  layer; R117 flag).
- `DualColumnLayout.svelte:304-307` retains `transition: opacity 300ms, filter
300ms` for the desktop-only sidebar hover effect (A flag; not the mobile
  page-transition layer).

## Gate

check 0 errors / 0 warnings (1470 files); lint exit 0 (similarity findings
informational; type duplicates 0); prettier clean; no U+2014. Comment-only fix;
R98's full e2e (210 passed / 0 flaky) remains valid (no behavior change). Counter
0/5 (R119 had a concern; R118's two PASS votes reset). R120 audits the fixed
pipeline under the spec scope.
