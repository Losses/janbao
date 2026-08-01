# RV21-C01 Audit 67 (R67)

**Date:** 2026-07-31. **Round:** R67. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): test:485-486 title-span attribution

`src/lib/utils/nav-executor-logic.test.ts:485-486` said "pops the
title-span and page-track positions" -- the title-span reads
`settleProgress` (settle rAF), not `publication.progress` (commit rAF);
the commit rAF's jump cannot pop the title-span. R66-B fixed the
docstring at `:405` and the section header at `:489` but missed `:485`.
Rewrote to "page-track position" + note the title-span reads
`settleProgress`.

## Auditor B finding (CONFIRMED): header-probe:116 inFlight guard

`src/lib/utils/header-probe.ts:115-116` DragSearchAnchor docstring
parenthetical listed `settleActive && #searchAnchor !== null` -- omitted
`publication.inFlight` (the actual guard at `orchestrator:1793` is a
four-way conjunction: `browser && settleActive && #searchAnchor !== null
&& publication.inFlight`). Added `publication.inFlight` (matching the
sibling field docstring at `orchestrator:748`).

## Verify

`bun run check` 0/0; prettier + em-dash clean. Comment-only; runtime
unchanged.

## Disposition

Counter after R67: 0/5.
