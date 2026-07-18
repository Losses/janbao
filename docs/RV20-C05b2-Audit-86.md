# RV20-C05b2 - Audit Round 86

Result: **A PASS-WITH-CONCERNS (1 dead-code, FIXED); B PASS (no defect).**
Counter stays **0/5**.

## A's finding (FIXED)

**Dead module `src/lib/stores/active-gesture-track.svelte.ts` (LOW, FIXED).** A
traced that the module is an orphan: zero importers under `src/` or `e2e/`, no
caller of `setActiveGestureTrack`/`clearActiveGestureTrack`, and the root
`+layout.svelte` does not call `initActiveGestureTrack()`. The orchestrator
independently re-verified with grep across all of `src/` and `e2e/`: no static
reference, no `__activeGestureTrack` dev hook, no test. The module is
unreferenced and was left behind when its original wiring (AppShell / root
layout, per the DV09 journal) was removed; C05b2 commit A06 even rewrote its
docstring without noticing it was dead. This is the same deletion principle the
cycle applied to `GesturePageLayout` / `MobileTabPager` (End-state #5: "both
were dead, zero imports"). Fix: deleted the file. grep + `tsc` confirm zero
remaining references and the deletion is runtime-neutral (no importer = no
side-effect on load), so the full-e2e result from the prior state (207 passed /
0 flaky) still holds. Horizontal check: grepped every `src/lib/stores/*.svelte.ts`
and `src/lib/utils/nav-*.ts` for import counts; `active-gesture-track` was the
only zero-importer store module. No sibling dead modules.

## B's verdict

**PASS, no defect.** B read the full spec and macro plan, traced 16 trajectories
(back-swipe thread/deep/tab, tab-click, cross-tab interrupt, forward enter,
within-tab pagination, boundary void-swipe, backward-to-deep-from-leftmost-tab,
forward/backward deep-to-deep handshake, root↔search and deep↔search tap-scrub,
re-grab mid-commit with `rawStart = startProgress`, mobile↔desktop flip,
non-pipeline detour), and ran horizontal checks over every transition-start seed
site, every `#lastDispatchWasDeepToDeep` / `#lastLandWasPipelineCommit` clear
site, the `releaseInputs` survivors, the suppress-slide siblings, and the
reduced-motion siblings. All invariants held. B noted one non-defect observation
(the reducer's `resolved` branch preserving `sub === 'committing'` is unreachable
from current callers because the orchestrator always fires `onInterrupt` first;
defensive, not flagged).

## Gate outputs (post-fix, 2026-07-18, orchestrator-run)

```
$ bun run check                       0 errors / 0 warnings (1457 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores src/lib/actions    400 pass / 0 fail
$ bun run test:e2e                    207 passed / 0 flaky (exit 0)
```

The file count dropped 1458 -> 1457 (the deleted module). The e2e result is
unchanged from the prior state: the deletion is runtime-neutral (grep + tsc
confirm zero importers), so it cannot affect any e2e outcome; the prior run's
207 passed / 0 flaky applies.

R87 audits this state.
