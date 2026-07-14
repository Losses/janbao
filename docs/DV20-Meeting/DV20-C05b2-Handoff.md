# DV20 Cycle 5b2 - Handoff Document

**Date:** 2026-07-14. **For:** the next agent continuing the DV20 5b2 audit loop.
**Status:** R1-R23 complete + all fixes applied. Counter: 0/5 (no clean round
yet). R24 auditors were launched but hit the 5-hour API rate limit; re-launch
them after 2026-07-14 19:03.

## 1. The user's design vision (READ THIS FIRST)

The user described their animation architecture vision early in the session:

> Global animation manager computes the plan, dispatches progress (0..1) to each
> component, each component computes its own visual values from the progress.
> Interruption: rollback = reverse-play; new target = finish the current then
> play the new (or accelerate the remainder).

This is the architecture. It is NOW implemented:

- The orchestrator (a global persistent singleton) owns a single set of rAF
  channels (executor gesture slide, family-swap, settle, tap-scrub). Each owns
  one motion channel.
- It publishes progress signals (via the pager store + the state machine's
  reactive getters) to the FAB layer, the Header, the MobileTabBar, the
  SearchTabBar, the BurgerArrowIcon - all reactive readers that compute their own
  visual from the signals.
- Interruption: gesture re-grab tracks 1:1 from the current visual (no jump);
  discrete nav (tab-click) interrupting an in-flight animation accelerates the
  current to completion, then plays the new (the "finish-then-new" policy via
  #accelerateInFlight + #queuedDiscreteNav).

The user explicitly REJECTED the "driver-writes" model (the manager writing DOM
directly, components as pure renderers). Their design has components computing
from progress. Do NOT pursue driver-writes.

## 2. What the user demands (non-negotiable)

- **Architecture excellence is the SOLE criterion.** No shortcuts. Any behavior
  violating it must be corrected.
- **No CSS transitions. No setTimeout in the animation layer.** Anywhere. In ANY
  component. The user explicitly overrode the spec's §9 "nested sub-pager
  exception" for SearchScopePager - its CSS transition was eliminated and replaced
  with an rAF-driven scope-switch.
- **No "partially resolved" or "honest-unresolved" as an excuse to skip work.**
  Either solve it or report the genuine blocker to the user directly. Do NOT
  silently mark items as unresolved.
- **No bridges.** If two mechanisms exist for the same concern, UNIFY them (delete
  one), do NOT bridge with a third.
- **No stopping before 5/5.** The user authorized autonomous rolling: fix -> gate
  -> audit without interruption. Only interrupt for an architect-level decision
  (a macro-plan deviation needing sign-off).
- **Long context is NOT an excuse to stop.** Delegate to sub-agents (fresh
  context). The orchestrator independently verifies (re-run check + lint + e2e;
  never trust the sub-agent's report).
- **Communication: written technical Chinese (规范书面汉语), not spoken.** No
  calques (根因, 墙钟), no coined two-character tokens (改码, 写盘), no casual
  verbs (弄, 搞, 收紧), no em-dashes (U+2014), no figurative metaphors. Complete
  sentences. Run pre-send noun + structural scans.

## 3. Current state of the code

### Gate (green, last verified 2026-07-14)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    411 pass / 0 fail
$ bun run test:e2e                    201 passed + 1 flaky (fab.spec.ts:442,
                                     passes on retry) = 202 total
```

### What exists

- **Global singleton orchestrator** (`getGlobalNavPipelineOrchestrator`), eagerly
  constructed at module load. `configure`/`releaseInputs` lifecycle (hosts rebind
  inputs; executor/driver/rAF persist). `unmount` for mobile->desktop flip only.
- **Four orchestrator-owned rAF channels:** executor gesture slide (velocity-
  matched commit/cancel), family-swap ease, settle ease (velocity-matched for
  gesture releases), tap-scrub ease. Each with a `prefers-reduced-motion` gate.
- **State machine (§13.5) sole authority:** macro phase + plan + FROM/TO +
  direction + settle/tap-scrub micro state all live on `NavStateMachine`. The
  orchestrator's `#publication` is a `$derived` read-through.
- **Reactive readers:** FAB layer (`FloatingActionButtonLayer`), Header
  organism, MobileTabBar, SearchTabBar, BurgerArrowIcon. Zero CSS transitions in
  any of them. All compute their visual from the orchestrator's published signals.
- **SearchScopePager** has its own rAF (scope-switch animation, rAF-driven, no
  CSS transition). Macro §9 sanctions this as a nested motion channel; the 5b2
  spec acknowledges it.
- **Finish-then-new interruption:** `#accelerateInFlight` shortens the in-flight
  commit; `#queuedDiscreteNav` replays on `#landAtRest`.
- **§6 backward gesture:** `#backwardTabTarget` always targets
  `previousEntryPathname()` (temporal-previous). `backSwipeShouldPopHistory`
  deleted.
- **§13.3 commit duration:** velocity-matched solver (`solveCommitDuration`).
  `TAB_CLICK_COMMIT_MS` deleted. Tab-click/forward-enter use the solver's default
  (`COMMIT_T_DEFAULT_MS`). Cancel settle ALSO uses the velocity-matched duration
  (fixed in R23).
- **Forward deep-to-deep slide:** intercepted by `onSvelteKitBeforeNavigate`.
  Uses a workaround axis override (`right` instead of `left`) because the 2-panel
  host has no right panel. Documented as Known #5.
- **Deep-snapshot overlay:** NavPipelineTabHost renders the deep target's preview
  panel (or DeepPreviewSkeleton) in the revealed space during a backward-to-deep
  slide. activeIndex=0 uses suppress-slide (no panel to reveal).

### What was deleted

- `MobileTabPager.svelte` (dead, zero imports). Deleted in R23.
- `GesturePageLayout.svelte` (dead, zero imports). Deleted in R23.
- `nav-coordinator.ts` (Layer 4 stub, never wired). Deleted earlier.
- `backSwipeShouldPopHistory` function. Deleted (macro §6 divergence resolved).
- `TAB_CLICK_COMMIT_MS` constant. Deleted (§13.3 divergence resolved).
- `readRenderedFabScale` function. Deleted (DOM read-back eliminated).
- `discreteNavInFlight` + `.fab-transition` CSS class. Deleted.
- `pager.committed` field. Deleted (dead, zero readers).

### Known conditions (current, all in spec)

1. `isPipelineSwipeDisabledRoute` mis-classification (5b3-deletion, dissolves
   with DualColumnLayout).
2. DualColumnLayout mobile routes `/discussions/pN` (5b3-deletion).
3. `pointercancel` treated as regular release (5b3-deletion, fix coupled to
   detectSwipe rework).
4. Forward deep-to-deep slide axis override (2-panel geometry limitation; 3-panel
   fix or coordinator preload is future work).
5. `backParent` consumer dissolution timeline (spec-code drift; dissolves in 5b3).

SearchScopePager's rAF is documented in the spec's §5 status section as a §9-
sanctioned nested motion channel (not a Known condition).

### Audit trail

- Audit files: `docs/RV20-C05b2-Audit-{13..23}.md` (all written).
- Journal: `docs/DV20-C05b2-Journal.md` (Sessions 1-25).
- Spec: `docs/DV20-Meeting/DV20-C05b2-spec.md` (Known conditions + Global
  animation manager section + step rollout).
- Plan: `docs/DV20-Plan.md` (§4, §5, §6, §9, §13).

## 4. What the next agent must do

### Immediate: re-launch R24

R24 auditors hit the rate limit. Re-launch 2 independent auditors with the
MINIMAL prompt (below). The convergence bar is **5 consecutive PASS votes** (2 per
round). If R24 returns 2x PASS, counter goes to 2/5. Then R25 (4/5), R26 (5/5
convergence).

### The MINIMAL auditor prompt

```
You are an independent code auditor for the Janbao forum's mobile navigation/gesture
architecture (project "DV20", Cycle 5b2). Find ANY defect empirically in the current
state of the code.

Read `docs/DV20-Meeting/DV20-C05b2-spec.md` (the cycle spec, including its "Known 5b2
conditions" section) and `docs/DV20-Plan.md` (the macro architecture).

FORBIDDEN: Do NOT read any `docs/DV*-C*-Journal.md` or `docs/RV*-C*-Audit-*.md`. Do NOT
mutate any file. Do NOT run the e2e suite.

Read the code. Form your own judgment. Find ANY defect empirically.

VERDICT: PASS (zero concerns) | PASS-WITH-CONCERNS | FAIL.
FINDINGS: each with severity, file:line, summary, failure scenario, classification.

Be honest.
```

### If R24 returns PWC: fix ALL findings, re-gate, launch R25

Do NOT carry findings across rounds. Fix everything. Re-run the full e2e gate
(`bun run test:e2e`, all specs). Launch the next round.

### If a finding needs the user's decision: report directly

Only for genuine architect-level decisions (a macro-plan deviation needing
sign-off, e.g., deleting an architectural Layer, or a scope call the spec doesn't
resolve). Everything else: handle autonomously.

## 5. Key files

- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts` (~3000 lines) - the
  universal orchestrator. All rAF channels, the interruption policy, the
  SvelteKit nav hooks, the pager-store publication.
- `src/lib/stores/nav-state-machine.svelte.ts` + `nav-state-machine-logic.ts` -
  the state machine (§13.5 sole authority).
- `src/lib/stores/nav-executor.svelte.ts` + `nav-executor-logic.ts` - the
  executor (velocity-matched commit/cancel solver).
- `src/lib/stores/mobile-pager.svelte.ts` - the pager store (the signal
  dispatch bridge).
- `src/lib/components/templates/NavPipelineHost.svelte` - the deep-page/thread/
  compose host.
- `src/lib/components/templates/NavPipelineTabHost.svelte` - the 3-tab host.
- `src/lib/components/organisms/Header.svelte` - the Header (reactive reader of
  the orchestrator's settle/tap-scrub/getters + pager.backMorph/tapMorph).
- `src/lib/components/templates/FloatingActionButtonLayer.svelte` - the FAB
  layer (reactive reader of pager signals; the family-swap gate).
- `src/lib/components/templates/SearchScopePager.svelte` - the search scope
  sub-pager (own rAF, no CSS transition).
- `src/lib/utils/history-nav.ts` - `previousEntryPathname`, `hopForHref`,
  `isTabRootPath`.
- `src/lib/utils/gesture-constants.ts` - constants (no TAB_CLICK_COMMIT_MS).

## 6. Key lessons from this session

1. **The user's design is: manager dispatches progress, components compute.**
   Not driver-writes. Do NOT pursue driver-writes.
2. **The user does NOT accept "nested sub-pager exception" for CSS transitions.**
   SearchScopePager's CSS was eliminated. Any remaining CSS transition anywhere
   must be eliminated.
3. **No "honest-unresolved" as a skip.** The user caught the sub-agent marking
   items unresolved without solving or reporting. Either solve or report to the
   user directly.
4. **The convergence loop is autonomous.** No stop-checks. Use sub-agents for
   context limits; independently verify their work.
5. **Comment accuracy is ALWAYS a concern.** No references to superseded
   implementations (GesturePageLayout, MobileTabPager, LoadingChip, pendingNav,
   the sampler, TAB_CLICK_COMMIT_MS, backSwipeShouldPopHistory).
6. **No em-dashes (U+2014).** In ANY file.
7. **The step-1a hang proved the orchestrator's steps are interdependent.** The
   shared singleton + configure/releaseInputs lifecycle (not mount/unmount) is
   the correct design. The executor/driver/rAF persist across route swaps.
8. **The flaky `fab.spec.ts:442` test** ("Family B back: thread -> list") is a
   pre-existing CDP touch-dispatch timing flake. It passes on retry. It is NOT a
   regression. Do NOT chase it.

## 7. Documents to read FIRST (in order)

1. This handoff.
2. `docs/DV20-Meeting/DV20-C05b2-spec.md` (the spec, esp. "Global animation
   manager" + "Known 5b2 conditions").
3. `docs/DV20-Plan.md` (§4, §5, §6, §9, §13).
4. `docs/RV20-C05b2-Audit-{22,23}.md` (the 2 most recent rounds).
5. Project memory: `audit-loop-autonomous-rolling`, `communication-style-
objective-respectful`, `dv20-global-animation-manager-refactor`.

## 8. The convergence path

If R24 returns clean (2/2), the counter goes to 2/5. Then R25 (4/5), R26 (5/5
convergence). At 5/5, Cycle 5b2 is done. Cycle 5b3 (delete DualColumnLayout +
backParent + swipe.ts) follows.
