# RV20-C05b2 - Audit Round 83

Result: **A PASS-WITH-CONCERNS (1 concern, REAL, FIXED); B PASS-WITH-CONCERNS (1
concern, FALSE POSITIVE, REVERTED with evidence).** Counter stays **0/5** (A's
real concern resets the accumulator). The orchestrator's independent full-suite
e2e re-verification caught that the initial fix for B broke five existing tests;
re-analysis adjudicated B a false positive. A's fix is kept.

## A's finding (REAL, FIXED)

**`#lastDispatchWasDeepToDeep` survives an interrupted deep-to-deep commit's
pre-dispatch window and suppresses the next route's forward-enter
(CONCERN, FIXED).** A deep-to-deep forward intercept (e.g. `/profile` ->
`/profile/settings`) sets the flag true and starts the commit rAF with
`#navDispatchInFlight` still false. If a second nav to a non-tab-root,
non-deep-to-deep pipeline route (e.g. `/search`) arrives before the commit rAF
reaches `#dispatchNav`, it takes the `(!isTabRootPath(to) && !isDeepToDeep)`
early-return block, which did not clear the flag. `releaseInputs` and
`configure` do not clear it either (by design), so the destination host's
`shouldEnter` read `publication.lastDispatchWasDeepToDeep === true` and
suppressed `playEnterAnimation`: a hard cut instead of the forward-enter slide.

Fix: clear `this.#lastDispatchWasDeepToDeep = false` in that early-return block
(`nav-pipeline-orchestrator.svelte.ts:1890`). The flag is SET only in the
deep-to-deep intercept branch above this block, so clearing it here only affects
a different, non-deep-to-deep nav arriving while a prior deep-to-deep commit is
mid-flight. The docstring (lines 583-629) was rewritten to document FOUR clear
sites (`#landAtRest`, the supersede branch, this early-return block, `unmount`),
removing the prior "three sites are complete" claim. Horizontal check: every
set/clear/read site of the flag enumerated; no other interruption path strands a
stale true (tab-click intercept during the window sets it false at line 1969;
within-tab pagination and `#beginGesture` cannot co-occur with a stale flag).
Preventive e2e `e2e/deep-to-deep-pre-dispatch-interrupt.spec.ts` added; its
`phaseCount >= 2` assertion was replaced with a durable `lastPhase.maxDelta > 50`
check (`playEnterAnimation` runs synchronously in the destination onMount), which
is invariant to the source-host slide's rAF timing.

## B's finding (FALSE POSITIVE, REVERTED)

**Header morph snaps (no crossfade) on an intercepted `/search` -> tab-root nav
(CONCERN raised; adjudicated FALSE POSITIVE).** B traced that the morph rests at
0 on `/search` and 1 on a tab root, that the idle settle arm fires only on title
change, and that `/search` and every tab root share the empty-string title, so
the settle was never armed and the morph snapped 0 -> 1.

The initial fix (arm the settle also on a `currentHasTabs` flip) was applied and
passed its targeted spec, but the orchestrator's independent FULL e2e run showed
it broke five existing tests (`search-back-hamburger-flash` x4,
`search-enter-exit-asymmetry` DV17 NB27). Re-analysis revealed the finding is a
false positive:

1. The morph's at-rest branch returns `currentHasTabs ? 1 : 0` (0 at `/search`,
   1 at a tab root), but the resulting `rootLayerStyle` is identical at both
   endpoints: `transform: none` at `/search` and `translateY(-(1-1)*100%) =
   translateY(0%)` at the tab root. The "snap from 0 to 1" produces no visible
   layer-group motion.
2. The icon is held at the hamburger on `/search` by the `isSearch || ...`
   freeze in `Header.iconProgress` (`return isSearch || (searchScrubbing &&
   currentHasTabs) ? 0 : 1 - morph`), so `/search` shows the hamburger, not the
   back-arrow. B's premise that `/search` rests at morph=0 and therefore shows
   the back-arrow missed this freeze.
3. Arming a settle on the tab-ness flip would drive `rootLayerStyle.translateY`
   from `-100%` to `0%` (a MobileTabBar descent, caught by DV17 NB27) and, during
   the settle, `iconProgress = 1 - morph` would read 1 (full back-arrow, 180deg)
   for a frame, a hamburger flash caught by `search-back-hamburger-flash`.

Reverted to the title-only arm (`nav-pipeline-orchestrator.svelte.ts:2720`); the
docstring (lines 2697-2719) rewritten to document why a tab-ness-flip arm is
rejected. The preventive e2e the initial fix added
(`e2e/header-search-to-tab-crossfade.spec.ts`) was deleted: it codified the false
positive (it asserted `settling === true` at the landing flush, which is the
exact behavior the existing tests prohibit).

## Orchestrator process note

The initial fixer for B ran only the targeted spec (`header-search-to-tab-crossfade.spec.ts`,
3/3 pass) and reported green; it did not run the full e2e. The orchestrator's
independent full-suite run caught the five regressions. Lesson recorded: a fix
is gate-green only when the FULL e2e passes, not when a targeted spec does; a
fix prompt must require the full suite (or the orchestrator must run it), and a
fixer that breaks existing tests has the wrong fix.

## Gate outputs (post-recovery, 2026-07-18, orchestrator-run)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores src/lib/actions    400 pass / 0 fail
$ bun run test:e2e                    205 passed + 1 flaky (exit 0)
```

The single flaky is `e2e/fab.spec.ts:436` (the pre-existing CDP-touch flake).
(`fab-release-snap.spec.ts:192`, the same CDP-touch bug class, flaked in one
earlier run and passed here and in isolation; both are the documented NixOS
CDP-touch sensitivity, not regressions.)

R84 audits this state.
