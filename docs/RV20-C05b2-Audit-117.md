# DV20 Cycle 5b2 - Audit 117 (R117)

**Date:** 2026-07-22. **Round:** R117, the fifteenth spec-scoped round, the
first round under the strengthened sibling-search prompt. **Counter after:**
0/5 (both auditors BLOCK on the pre-fix state). **Gate:** green (comment-only
fixes).

Both auditors voted BLOCK on 2 combined comment-accuracy concerns, in two
DIFFERENT classes (not siblings of one another). The strengthened sibling-search
requirement (abstract to a class, multi-phrasing broad grep, read every hit,
report all siblings together) let each auditor exhaust its own class in one
round; the orchestrator independently re-ran the broad grep for each class and
cross-checked. All fixed.

## A finding (1, fixed)

- **A1 (nav-pipeline-orchestrator.svelte.ts:264-265, concern).** The
  `OrchestratorPublication` interface docstring overclaimed "the Header reads
  the macro + settle/scrub fields directly off this orchestrator singleton (not
  via the pager store)." The Header actually reads the macro morph / FROM-TO
  fields (`backMorph`, `tapMorph`, `transitionTarget`) VIA the pager store
  (Header.svelte:164, 221, 308, 328-331, 358, 367), and reads only the settle /
  scrub fields directly off the orchestrator singleton
  (`orchestrator.settleActive/Progress/Latched/Direction`, `searchScrubbing`,
  `settleAwaitTitle` at Header.svelte:120-124, 299). The interface docstring
  contradicted the publication getter docstring 60 lines below (657-667), which
  correctly states the Header is a reader of `backMorph` (a pager field) and only
  the settle ease is read directly off the orchestrator. Fixed: the interface
  docstring now splits the read paths (macro morph / FROM-TO via the pager store;
  settle / scrub directly off the singleton), matching the getter and the spec's
  Step 5. The orchestrator's independent grep ("Header ... directly ...
  orchestrator", "reads ... macro ... directly", and the reverse settle-via-pager
  phrasings) confirmed this was the only site of this class.

## B finding (1, fixed)

- **B1 (nav-executor-logic.ts:10-13, concern).** The file-level docstring
  overclaimed that the executor's rAF "writes the per-frame visual for every
  consumer (page track, FAB, Header) through an injected NavDomDriver." In the
  production pipeline the executor's rAF writes only the page track; the FAB and
  Header are reactive readers of the orchestrator's publication. The production
  wiring passes null FAB / Header element refs to the driver
  (NavPipelineHost.svelte:371, NavPipelineTabHost.svelte:252) and the plan omits
  the `fab` / `header` fns, so the driver's `write()` only ever fires its
  page-track branch (the `if (pageTrack)` / `if (fab && visual.fab)` /
  `if (header && visual.header)` guards at nav-dom-driver-live.ts:121, 129, 135).
  A sibling of the R104 / R108 / R112 / R113 / R115 / R116 rAF-ownership-overclaim
  class, missed because prior greps targeted the consumer-facing phrasings ("one
  rAF", "single rAF", "the rAF drives every motion") and not the executor-file
  phrasing "writes the per-frame visual for every consumer (page track, FAB,
  Header)." Fixed: the docstring now states the loop writes only the page track;
  the FAB and Header are reactive readers; the null element refs plus the omitted
  plan fns mean only the page-track write branch fires. The orchestrator's
  independent broad grep (9 phrasings across `src/lib`) confirmed this was the
  only remaining site of the class; the driver-file mentions of "page-track /
  FAB / Header" describe the interface capability and are qualified by
  nav-dom-driver.ts:43-46 ("the fab / header fields are optional ... the driver
  skips that write branch"), so they are accurate.

## Out-of-scope observations (A; not fixed, do not affect the vote)

- `nav-dom-driver-live.ts:128-147` retains FAB / Header write branches in
  `LiveNavDomDriver.write` that are dead in production (null element refs plus
  omitted plan fns). Documented as the driver's general capability; the C05b2
  spec does not call for pruning them. Flagged for whatever cycle owns further
  pipeline cleanup.
- `swipe.ts:109-132` `suppressNextClick` uses a 400 ms `setTimeout`
  (gesture-detection layer, click-suppression cleanup), not the animation layer.
  Outside the §5 "no setTimeout in the animation layer" bar.

## Gate

check 0 errors / 0 warnings (1470 files); lint exit 0 (similarity findings
informational; type duplicates 0); prettier clean; no U+2014 in either edited
file. Comment-only fixes; R98's full e2e (210 passed / 0 flaky) remains valid
(no behavior change). Counter 0/5 (R117 had two concerns; not a PASS round).
R118 audits the fixed pipeline under the spec scope.
