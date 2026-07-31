# RV21-C01 Audit 51 (R51)

**Date:** 2026-07-30. **Round:** R51. **Votes:** auditor A BLOCK, auditor
B BLOCK (B's finding is A's site 2). **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): 4 per-tick-clamp protected-signal mis-attributions

The settle rAF clamp bounds `settleProgress` (read by title spans only);
the executor `sampleFrame` clamp bounds `publication.progress` (page-track
only); the morph / FAB / search axis read `settleMorphFraction`
(unclamped). Four comments mis-attributed the protected signal:

- `orchestrator:3316` "cannot pop the Header morph / title crossfade" ->
  title-span crossfade only (morph reads `settleMorphFraction` unclamped).
- `nav-executor-logic.ts:365` "bounding the title-span and page-track" ->
  title-span only (page-track reads `publication.progress`).
- `nav-executor-logic.ts:405` "FAB scale (reads publication.progress)" ->
  page-track only (FAB reads `settleMorphFraction` during a settle).
- `nav-executor-logic.test.ts:533` "title-span / page-track" ->
  page-track only (title-span reads `settleProgress`).

All four rewrote with accurate attribution.

## Auditor B finding (CONFIRMED, = A site 2)

`nav-executor-logic.ts:365` "title-span and page-track" (same site as A's
site 2; already fixed by A's reword). B also noted the R50 journal entry
carried the same "page track" phrasing (.md nitpick); synced below.

## Verify

`bun run check` 0/0; `bun run lint` exit 0; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R51: 0/5.
