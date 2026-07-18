# RV20-C05b2 - Audit Round 85

Result: **A PASS-WITH-CONCERNS (1 very-low behavior + 1 comment, both FIXED); B
PASS-WITH-CONCERNS (2 comment-accuracy, both FIXED).** Counter stays **0/5**.

## A's findings

1. **Header-state fields cleared by `unmount()` not restored on a flip-back
   (VERY LOW, FIXED).** `unmount()` (the mobile to desktop teardown) cleared the
   five cached header-state fields (`#headerStateInitialized`,
   `#prevHeaderTitle`, `#prevHeaderHasTabs`, `#prevHeaderIsSearch`, `#headerT`).
   They are re-populated only by `notifyHeaderState` (from the Header's
   `$effect.pre`), and `configure()` (the desktop to mobile flip-back) does not
   restore them. The Header persists across the flip (AppShell stays mounted),
   so its `$effect.pre` does not re-fire between `unmount()` and the next
   `configure()`. Concrete failure: a back-swipe after a flip-without-navigation
   read empty/null latched endpoints, running a ~200ms title crossfade against
   empty titles (self-healing on the next navigation). Fix: `unmount()` no longer
   clears these five fields. Verified load-bearing fact: `notifyHeaderState`
   writes `#headerT = t` unconditionally BEFORE its `!#mounted` guard, and its
   `!#mounted` branch refreshes the three prev fields when no settle is active,
   so the fields stay current during desktop-mode navigation; a real Header
   re-mount (an AppShell unmount/remount across a `/entry/*` detour) still resets
   them via `resetHeaderState` called from the Header's `onMount`. No regression.

2. **`unmount()` block comment inaccuracy (comment, FIXED).** The comment
   claimed "the first configure after the re-mount re-installs the watchers";
   `configure()` does not. Rewritten to describe what `unmount()` actually tears
   down (the settle + tap-scrub eases) and why the header-state fields are
   intentionally not cleared.

## B's findings

1. **`#lastLandWasPipelineCommit` field docstring undercounted clear sites
   (comment, FIXED).** The docstring said "Cleared in four places" but R84 added
   a fifth clear in `#beginGesture` (the candidate-2 fix). Updated to "five
   places" with `#beginGesture` enumerated (a new gesture invalidates the
   in-flight dispatch's markers).

2. **`#lastDispatchWasDeepToDeep` field docstring undercounted clear sites
   (comment, FIXED).** Sibling of B1: same root cause (R84's `#beginGesture`
   clear), same fix. The field docstring, the cross-reference inside it, and the
   inline comment at the non-tab-root non-deep-to-deep branch all updated from
   "four" to "five". Verified clear sites post-fix: five (`unmount`,
   `#beginGesture`, `#landAtRest`, the supersede branch, the non-tab-root
   non-deep-to-deep early-return) plus the single SET in the deep-to-deep
   intercept.

## Gate outputs (post-fix, 2026-07-18, orchestrator-run)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores src/lib/actions    400 pass / 0 fail
$ bun run test:e2e                    205 passed + 1 flaky (exit 0)
```

The single flaky is `e2e/fab.spec.ts:436` (the pre-existing CDP-touch flake).

R86 audits this state.
