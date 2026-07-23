# DV20 Cycle 5b2 - Audit 124 (R124)

**Date:** 2026-07-22. **Round:** R124, the twenty-second spec-scoped round.
**Counter after:** 0/5 (auditor A PASS; auditor B BLOCK). **Gate:** green
(comment-only fixes; R122's full e2e remains valid).

Auditor A voted PASS. Auditor B voted BLOCK on three sibling comments in the
rAF / writer-attribution overclaim class. Notably A's own mechanism description
("the orchestrator calls executor.onDragMove (which calls #publish writing via
driver) then the orchestrator's #publish writes the pager store") agrees with B's
finding, but A did not apply it to the three comments that say the publication
drives or writes the track. The orchestrator independently verified the mechanism:
the executor's #publish calls publishFrame(state, plan, driver), and
LiveNavDomDriver.write sets pageTrack.style.transform (nav-dom-driver-live.ts:118-127);
the orchestrator's publication is a separate reactive record for FAB / Header. The
three comments contradicted NavPipelineHost's own top docstring (line 11: "The
track's transform is written by LiveNavDomDriver each frame"). B notes A111 / A116
introduced the "publication" phrasing, so this is a regression from those rounds'
rAF-ownership fixes. All three fixed.

## B findings (3 siblings, fixed)

- **B1 (NavPipelineHost.svelte:506-508, concern).** "the slide is driven by the
  orchestrator's per-pointermove publication during a drag and the executor's rAF
  during a commit/cancel slide". The slide (track translate) is written by the
  executor via LiveNavDomDriver in both phases (drag: executor.onDragMove
  synchronously per pointermove; commit: the executor's rAF), not by the
  publication. Fixed to attribute the write to the executor via LiveNavDomDriver.
- **B2 (NavPipelineHost.svelte:509-511, concern).** "The transform is written by
  the orchestrator's publication (...)". The transform is written by
  LiveNavDomDriver (per the file's own top docstring at line 11). Fixed to
  "written by LiveNavDomDriver each frame, and also by the SSR seed, the at-rest
  $effect, and the forward-enter seed when at rest".
- **B3 (Header.svelte:319, concern).** "stays frame-synced with the
  NavPipelineHost Page panel that same publication drives". The Page panel's
  transform is written by the executor via LiveNavDomDriver from the same
  per-pointermove progress, not by the publication. Fixed to attribute the write
  to the executor via LiveNavDomDriver.

The orchestrator's broad grep confirmed these three were the only sites
conflating the publication with the track writer.

## A note (PASS)

Auditor A examined End state, §5 invariant, Constraints, migration completeness,
and comment accuracy; confirmed all R122 / R123 fixes in place. A's carried
nitpicks (FloatingActionButton.svelte:14-18 style:transform attribution;
header-mode.ts and route-config.ts future markers) remain tracked, non-blocking.

## Gate

check 0 errors / 0 warnings (1467 files; svelte-check confirms the IDE's TS 6133
on NavPipelineHost.svelte:118 rightEl is a false positive: rightEl is bound at
line 670 via bind:this, which svelte-check understands but the bare TS server does
not); lint exit 0 (similarity informational; type duplicates 0); prettier clean;
no U+2014. Comment-only fixes; R122's full e2e (210 passed / 0 flaky) remains
valid. Counter 0/5 (B's concern resets). R125 audits the fixed pipeline under the
spec scope.
