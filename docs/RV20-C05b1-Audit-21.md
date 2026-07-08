# RV20-C05b1 - Audit Round 21 (architect-run, 2 independent auditors, with e2e gate)

Result: **0/2 PASS**. Five concerns (four from auditor A, one from
auditor B) + one nitpick (B). The architect independently re-verified
every concern against the code; all five concerns are real. Consecutive
pass votes reset to **0**.

The prior defect family (R14-R20: the `startProgress` / interrupt-
continuity geometry) is **resolved**. Neither auditor flagged the
interrupt handoff or the track geometry this round; the absolute-position
helper (`#startProgressFromCurrentVisual` via `trackTranslateX` /
`progressAtTranslateX`) replaced the three per-callsite `1 - progress`
computations and their flags (`wasEnter`, `wasEnterAnimation`,
`hadInFlightTransition`). The five concerns below are a DIFFERENT set.

## Architect gate outputs (real, pasted verbatim)

```
$ bun run check
1783485435093 COMPLETED 1457 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ bun run lint
EXIT=0   (prettier clean; 0 type duplicates)

$ bun test src/lib/utils src/lib/stores
 428 pass
 0 fail
 1370 expect() calls
Ran 428 tests across 20 files. [105.00ms]
(includes 5 new track-geometry-helper tests: inverse property,
enter<->backSwipe mapping, clamp, zero-distance guard)

$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview \
                    fab reproduce-user-bugs enter-animation backtarget tab-history
  76 passed (2.7m)
messages-back-swipe diagnostics: reversals: 0, firstM41: -375,
  fabScaleDelta: 0.999997 (9/9 gesture cases pass, incl. all interrupt cases)
```

## Auditor verdicts

- **A: FAIL** (4 concerns). Traced every wiring file, ran check/unit,
  read every docstring against the code, traced the three transition-
  start paths and every interrupt combination.
- **B: PASS-WITH-CONCERNS** (1 concern + 1 nitpick). Verified UNIFY,
  all-rAF, no DOM read-back, SvelteKit interop, the velocity-matched
  solver, the release gate, the R5/R8/R10/R18 fixes all hold.

## Concerns (all confirmed by the architect)

### C1 (correctness + missing coverage): a gesture starting during an in-flight tab-click commit dispatches the TAB-CLICK's target

`src/lib/stores/nav-pipeline-orchestrator.svelte.ts`. The two pending-
transition slots (`#pendingGesture`, `#pendingTabExit`) are not mutually
exclusive. `onSvelteKitBeforeNavigate` clears `#pendingGesture` when it
sets `#pendingTabExit` (line 859), but `#beginGesture` (line 610) sets
`#pendingGesture` WITHOUT clearing `#pendingTabExit`. So a back-swipe
gesture that starts during a tab-click's 200ms commit leaves BOTH slots
set. On the gesture's commit-settle, `#onExecutorSettle` (line 741)
reads `pendingTabExit?.target ?? pendingGesture?.to` and dispatches the
STALE tab-click target (`goto('/')`) instead of the gesture's
`/messages/inbox`. The `publication.toPathname` and the dispatched nav
disagree. No e2e covers "gesture during tab-click commit" (the existing
test covers the reverse: "tab-click during gesture commit").

### C2 (dead code + comment accuracy): `onPointerCancel` is never called; the top docstring claims the action calls it

`src/lib/stores/nav-pipeline-orchestrator.svelte.ts:480` defines
`onPointerCancel(x, y)`; no caller exists. `detectSwipe` routes
`pointercancel` through its `onUp` listener -> `finish` -> `params.onEnd`
-> the bridge's `onPointerUp`, so the orchestrator's `onPointerCancel`
is dead. The file's top docstring (lines 10-12) lists `onPointerCancel`
among the pointer-entry methods "called from the navPipelinePointer
action." grep confirms only the definition + the docstring reference.

### C3 (dead code + comment accuracy): `NavExecutor.onInterrupt` is never called; the shell docstring describes a two-step pattern production does not follow

`src/lib/stores/nav-executor.svelte.ts:242` (`onInterrupt`) + the pure
`interrupt()` in `nav-executor-logic.ts:309` + the state-machine wrapper
`nav-state-machine.svelte.ts:156` are all uncalled. The orchestrator's
`#beginGesture` handles a mid-commit interrupt by calling
`executor.onDragStart(...)` directly (which stops the rAF and resets the
state inline) after reading the current position via the absolute-
position helper. The shell docstring (lines 22-25, 237-241) describes
"onInterrupt then onDragStart" as the production pattern; production
uses onDragStart alone.

### C4 (comment accuracy): `#startProgressFromCurrentVisual` docstring claims "called from every transition-start path"; `playEnterAnimation` does not call it

`src/lib/stores/nav-pipeline-orchestrator.svelte.ts:578-588` (this
cycle's new helper). The docstring says it is "called from every
transition-start path." Only `#beginGesture` (line 641) and
`onSvelteKitBeforeNavigate` (line 883) call it; `playEnterAnimation`
(line 402) hardcodes `executor.onDragStart(plan, 0, 0)`. (The enter's
progress-0 is correct because the enter starts at rest; the helper's
universality claim is what is inaccurate. This is a code comment in the
file this cycle authored.)

### C5 (behavior-preservation gap + architecture + missing coverage): the chip-exit path skips preload; the overlay differs from GPL

`src/lib/stores/nav-pipeline-orchestrator.svelte.ts` (the
`onSvelteKitBeforeNavigate` chip-exit branch) + `NavPipelineHost.svelte`
(chip overlay markup). The orchestrator cancels the SvelteKit nav,
starts the 200ms slide, and dispatches `goto(target)` on settle. There
is NO `preloadData(target)` call (grep: zero references in the
orchestrator or host); the coordinator computes `preloadPathname`
(`nav-coordinator.ts:109`) but the orchestrator never consumes it. GPL's
chip-exit calls `preloadData(target)` BEFORE the slide so the target is
instant on land; the pilot loads it sequentially after the slide. The
overlay also differs (GPL: a partial-width column that grows and fades;
pilot: a static full-viewport opaque rectangle). Spec §1 requires the
behavior be "indistinguishable" from GPL; the journal Design section
(DV20-C05b1-Journal.md:253-263) describes the chip-exit WITH preload,
but the code omits it and the journal does not flag this as a deviation.
`e2e/tab-exit-preview.spec.ts` does not assert the preload->slide
sequence.

## Nitpick (does not block)

- **B**: `docs/DV20-C05b1-Journal.md` Design section (lines 113-116,
  235-244) still says `restingTranslate = -viewportWidth/2`,
  `distance = viewportWidth/2`. The implementation uses `-W` / `W`
  (Session 2 corrected the code but not the Design section). `.md` text
  accuracy -> nitpick.

## Fixes landed (post-R21)

All five concerns fixed; gates re-run green.

- **C1** (mutual exclusion): `#beginGesture` now clears `#pendingTabExit`
  when it claims a gesture, so `#onExecutorSettle` dispatches the
  gesture's target. New e2e: "gesture during tab-click commit dispatches
  the gesture target, not the tab target" (taps `/activity`, then
  swipesBack mid-commit; asserts the URL lands on `/messages/inbox`).
- **C2**: removed the dead `onPointerCancel` method; the top docstring
  now notes a `pointercancel` reaches the orchestrator as `onPointerUp`
  via `detectSwipe`'s onUp listener.
- **C3**: removed `NavExecutor.onInterrupt` (shell) + the pure
  `interrupt()` + its 3 unit tests; fixed the executor docstrings to
  describe the actual onDragStart-based handoff. The state-machine
  `interrupt` reducer case (nav-state-machine-logic.ts) + its tests are
  RETAINED: they are the state machine's tested §6 modeling of the
  interruption phase, a separate Cycle-3 layer; the orchestrator signals
  the interrupt via the executor's `onDragStart` + the absolute-position
  handoff rather than by dispatching a state-machine interrupt event.
- **C4**: `playEnterAnimation` now starts at
  `#startProgressFromCurrentVisual(plan)` (0 at rest; the in-flight
  position if it interrupts another transition), so the helper's
  "called from every transition-start path" docstring is accurate.
- **C5** (complete alignment with GPL's chip-exit, per owner decision):
  the orchestrator fires `void preloadData(to).catch(() => {})` in the
  chip-exit branch (parallel, fire-and-forget - verbatim GPL mirror).
  `NavPipelineHost` drives the `LoadingChip`'s `scale` / `maxWidth` /
  `textMaxWidth` from `publication.progress` during the chip-exit, so
  the chip grows + reveals across the 200ms slide (the click-triggered
  analog of GPL's drag-driven `currentRevealWidth` morph). New e2e:
  "chip-exit LoadingChip grows across the slide" (samples the chip's
  inline `transform: scale(...)`; asserts a non-zero range).

Gate outputs (real, post-fix):

```
$ bun run check
1783488495923 COMPLETED 1457 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ bun run lint
EXIT=0   (prettier clean; 0 type duplicates)

$ bun test src/lib/utils src/lib/stores
 425 pass
 0 fail
 1362 expect() calls
Ran 425 tests across 20 files. [95.00ms]
(3 fewer than R21: the removed interrupt() tests; +5 track-geometry-helper
tests net against the prior baseline)

$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview
                    fab reproduce-user-bugs enter-animation backtarget tab-history
  78 passed (2.7m)   (+2: gesture-during-tab-click, chip-grow)
```

Consecutive pass votes: **0** (R21 carried concerns; R22 audits the
post-fix state).
