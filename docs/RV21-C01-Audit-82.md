# RV21-C01 Audit 82 (R82)

**Date:** 2026-08-02. **Round:** R82. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

A deeper round: auditor A ran four parallel comment-accuracy sweeps and
surfaced a backlog (14 findings) the prior 1-2-finding rounds had missed;
R77's double-PASS was, in hindsight, under-thorough at this depth.
Auditor B found 2 more. 16 findings total; 14 fixed, 2 deferred as
non-defects (over-reaches, same discipline as R75-F2).

## Fixes applied (14, all verified against code)

- **F1** Header:21-32 intro "derives every visual from them" omitted the
  `dragMorphAnchor` / `searchAnchor` / `dragSearchAnchor` getters the
  morph / searchProgress derivations consume (Header:194/247/267/569/573).
  Added them.
- **F4** orchestrator:1234 "easing into deep mode on a thread, compose,
  or deep page" -- thread/compose mount `centerTab` and pill-map to a tab
  (tab-mode, morph holds at 1, not deep mode). Narrowed to a deep page.
- **F5** orchestrator:3934 "root<->search ENTER flip" -- "ENTER"
  (unidirectional) contradicts "<->" (bidirectional); the arm fires on
  `currentIsSearch !== prevIsSearch`. Dropped "ENTER".
- **F6** NavPipelineHost `rightEl` dead binding (decl + `bind:this`, zero
  reads -- `grep rightEl` returns only those two). Removed both.
- **F7** NavPipelineHost:112/266 "the centre panel is the scroll-chrome
  source" -- code is `scrollChrome.override ?? centerEl` (:270). Added
  the override fallback.
- **F8** swipe-back-pill-flicker:97 past-state marker ("old ... log was
  removed"). Rewrote to current.
- **F9** swipe-back-pill-flicker:16 "active:true ... via the
  orchestrator's `$derived`" -- `active` is on the pager store (written
  by `#republishToPager`), not the OrchestratorPublication `$derived`.
  Corrected the mechanism.
- **F10** reproduce-dv20-search-swipe:78 snap values "0deg -> ~119deg /
  0% -> -66%" tied to "destination's at-rest morph" -- those values =
  morph ~= 0.34, not the destination's at-rest (0 -> 180deg / -100%).
  Dropped the suspect values, kept the qualitative warning.
- **F11** fab-deep-page-boundary:13 "24 non-FAB routes ... kind:'deep'"
  -- `grep -c "kind: 'deep'"` = 12 (thread/compose are
  kind:'discussions'/'messages'). Corrected to 12.
- **F12** messages-back-swipe:1659 "destMorph = atRestMorph(outgoingHasTabs)"
  -- code is `atRestMorph(incomingHasTabs)` (value coincides for a
  centerTab route; attribution was wrong). Fixed.
- **F13/F14** backtarget:87/103 past-state markers ("the old spinner").
  Rewrote to current.
- **B-F1** BurgerArrowIcon:27 "the morph reads pager.tapMorph \*
  scrubIconEndpoint" -- `morph` does not read tapMorph (Header:155 "the
  tap scrub does not touch morph"); `iconProgress` does (:314). Reframed
  with `iconProgress` as the subject.
- **B-F2** intra-tree-deep-to-deep:16 "=== leftHref" -- code is
  `=== resolvedLeftHref` (NavPipelineHost:157). Fixed the identifier.

## Deferred (reviewed, not defects -- over-reaches)

- **F2** Header:469 "0->1 on a backward-exit (transitionTarget !==
  currentPath, leaving /search)" -- the morph-direction is scoped to
  "leaving /search" (backward-exit), accurate; does not claim `!==`
  always means morph 0->1.
- **F3** Header:625/635/879 "searchProgress reads the pager-store fields
  the orchestrator writes" -- true (it does read them), not an
  exclusivity claim.

## Orchestrator verification

Independently verified each fixed finding against the code before editing
(centerTab mounts + pill-maps; the arm condition; `grep rightEl`;
`scrollChrome.override ?? centerEl`; OrchestratorPublication has no
`active`; iconProgress = 1 - morph so morph 0 -> 180deg/-100%;
`grep -c "kind: 'deep'"` = 12; `destMorph = atRestMorph(incomingHasTabs)`;
Header:155 + iconProgress:314; NavPipelineHost:157).

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean. F6 was
a code change (dead-binding removal); the rest are comment-only.

## Disposition

Counter after R82: 0/5.
