# RV20-C05b2 - Audit Round 88

Result: **A PASS (no defect); B FAIL (1 concern, FIXED).** Counter stays **0/5**.
B found a serious user-facing defect: the MobileTabBar became non-interactive at
rest on a tab root whenever the navigation back-target was a deep page (primary
navigation dead after a common deep-page exploration pattern). Confirmed real,
fixed, regression-tested.

## A's verdict

**PASS, no defect.** A read every key file, traced 19 trajectories (back-swipe
deep/thread, backward-to-deep from leftmost/non-leftmost tab, tab-to-tab,
forward-swipe, tab-click exit, deep-to-deep push/popstate, forward enter,
within-tab pagination, root/deep tap-scrub, mid-commit re-grab, pointercancel,
boundary void-swipe, mobile to desktop flip, AppShell remount, mid-settle
title re-arm, finish-then-new, non-pipeline detour), and verified every invariant
(one rAF per channel, no CSS transitions / setTimeout in the animation layer,
one mechanism per concern, state-machine authority) plus the field clear-site
counts and the `#commitStartRaw`/`rawStart`/`#publish`-clamp seed sites. A
documented the cycle's accepted tradeoffs (dynamic-title settle latched pair,
opposite-direction extrapolated startProgress clamp/track divergence, deep-to-deep
landing content swap) as non-defects.

## B's finding (FIXED)

**MobileTabBar non-interactive at rest on a tab root with a deep back-target
(SERIOUS, FIXED).** `Header.svelte` derived `tabsIn` fell back to `targetHasTabs`
at rest (asymmetric with `tabsOut`, which used `currentHasTabs`). The
`rootLayerStyle` pointer-events clause `morph > 0.5 && tabsIn ? 'auto' : 'none'`
then evaluated to `none` at rest on a tab root whenever the back-target was a deep
page (`targetHasTabs === false`), so the tab bar rendered visible but unclickable.

Scenario: `/` -> `/bookmarks` -> `/profile` (two deep pages) -> tap the Discussions
tab. The tab tap resolves `hopForHref('/') === 'push'` (previous entry is
`/bookmarks`, not `/`), so it is not a popstate; the orchestrator intercepts and
the landing on `/` leaves `navStore.backTarget === '/profile'` (a deep page). At
rest `tabsIn === targetHasTabs === false` -> `pointer-events: none`. The simpler
`/` -> `/profile` -> tap `/` does not repro (it is a popstate that pops the stack
to a single entry, leaving `backTarget === '/'`); the bug needs the two-deep-page
chain so the tab tap pushes.

Fix: `tabsIn`'s at-rest fallback is now `currentHasTabs` (matching `tabsOut`) -
the tab bar's visibility and interactivity follow the route the user is on, not
the back-target. `targetHasTabs` remains in use only where it is correct
(`isDeepToDeep` mid-drag, the dev probe). Horizontal check: `tabsIn`/`tabsOut`
feed only `rootLayerStyle`, `layerDownStyle`, and the dev probe; no other at-rest
misuse. Preventive e2e `e2e/tab-bar-interactive-with-deep-backtarget.spec.ts`
(two tests: a behavioral tap-and-assert-URL and a structural pointer-events read)
verified to FAIL with the bug (`targetHasTabs`) and PASS with the fix
(`currentHasTabs`).

## Gate outputs (post-fix, 2026-07-19, orchestrator-run)

```
$ bun run check                       0 errors / 0 warnings (1457 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores src/lib/actions    400 pass / 0 fail
$ bun run test:e2e                    209 passed / 0 flaky (exit 0)
```

The two new tests ran in the full suite. R89 audits this state.
