# DV20 Cycle 5b2 - Handoff Document

> **CONVERGED 2026-07-24 (R135, 5/5) + post-convergence dead-code cleanup.** This
> cycle is COMPLETE. The spec-scoped audit loop ran R99 to R135 (37 rounds) to five
> consecutive PASS votes; the full gate is green (check 0/0 1467 files, lint exit 0,
> full e2e 210 / 0 flaky). After convergence, four production-dead items were
> removed and gated: the `app.css` `.mobile-tab-pager-viewport` vestigial selector
> (referenced the deleted MobileTabPager), the `isPagerRoute` dead export, and the
> `RouteData.snapshotCapture` dead field (the spec's "three fields" became "two
> fields" = `tag`, `fab`), and the `LiveNavDomDriver` FAB / Header write extensibility hook (the driver is now
> page-track-only; the `FabWrite` / `HeaderWrite` / `FabPlanFn` / `HeaderPlanFn`
> types + the write branches + the plan fields + the `buildVisual` calls + the tests
> are all removed, matching the spec's "FAB and Header are reactive readers"
> architecture). No remaining dead-code items in the C05b2 scope. See
> `docs/RV20-C05b2-Audit-135.md` (closing round + cycle summary) and
> `docs/DV20-Meeting/DV20-C06-Readiness.md` (the next development cycle, Cycle 6
> Offline unification). The text below is the R95 point-in-time handoff (superseded
> by the audit trail R96 to R135); keep it as history.

**Date:** 2026-07-19 (updated through R95). **For:** the next agent continuing the
DV20 5b2 audit loop.

**Status:** R82-R95 complete (prior stretch R82-R91, then a continuation stretch
R92-R95; the per-round details are in section 4). All fixes applied; the full gate
is green with ZERO flakies (210 e2e passed). Counter: **0/5** (every round R91-R95
found at least one concern; no clean round yet). The audit prompt has been
**OPEN-SCOPED** since R91.

**BINDING (user directive 2026-07-19).** Every auditor AND every fixer MUST perform
an EXHAUSTIVE horizontal check for the SAME bug class in sibling paths before
reporting or claiming done, using BROAD grep patterns that cover the bug CLASS
(not one variable name). One defect almost always has siblings. The id-0 class
leaked a sibling in R93, R94, AND R95 because the early sweeps grepped only
`id > 0` and missed `n > 0`, `lastReplyAuthorId > 0`, the recipient display-name
projection, and the `/drafts/clear` endpoint sibling. A round is NOT done until
the class is exhausted. Full protocol in section 6.

This handoff supersedes the 2026-07-15 (R37) version. The architecture and the
user's demands in sections 1 to 3 are still accurate; sections 4 to 8 reflect the
current (post-R95) state.

## 1. The user's design vision (READ THIS FIRST)

> Global animation manager computes the plan, dispatches progress (0..1) to each
> component, each component computes its own visual values from the progress.
> Interruption: rollback = reverse-play; new target = finish the current then
> play the new (or accelerate the remainder).

This IS the implemented architecture:

- The orchestrator (a global persistent singleton, `getGlobalNavPipelineOrchestrator`,
  eagerly constructed) owns one rAF per motion channel: the executor gesture slide,
  the settle ease, the tap-scrub ease.
- It publishes progress signals (via the pager store + the state machine's reactive
  getters + the orchestrator's `$derived` `#publication`) to the FAB layer, the
  Header, the MobileTabBar, the SearchTabBar, the BurgerArrowIcon. All are reactive
  readers that compute their own visual from the signals.
- Interruption: a gesture re-grab tracks from the current visual (no jump); a
  discrete nav interrupting an in-flight animation accelerates the current to
  completion, then replays the new (the finish-then-new policy via
  `#accelerateInFlight` + `#queuedDiscreteNav`).
- The FAB scale is driven by the SAME single transition progress as the page-track
  slide, gated on FROM/TO "has FAB" booleans (`RouteData.fab`). The FAB exits in
  the first half (0 to 50%) if FROM has a FAB and enters in the second half (50%
  to 100%) if TO has a FAB. No family-swap rAF, no `familySwapScale`, no
  `#lastRenderedScale`.

The user explicitly REJECTED the "driver-writes" model (the manager writing DOM
directly, components as pure renderers). Their design has components computing
from progress. Do NOT pursue driver-writes.

## 2. What the user demands (non-negotiable)

- **Architecture excellence is the SOLE criterion.** No shortcuts. Any behavior
  violating it must be corrected.
- **No CSS transitions. No setTimeout in the animation layer.** Anywhere.
- **No "partially resolved" or "honest-unresolved" as an excuse to skip work.**
  This explicitly includes a "pre-existing flaky" test: a flaky test is a defect
  to fix (investigate root cause, make it deterministic), NEVER an inherited
  permanent exception. The `fab.spec.ts:436` flaky was investigated this stretch
  and turned out to be a real production defect (now fixed), not a CDP artifact.
- **No bridges.** If two mechanisms exist for the same concern, UNIFY them (delete
  one), do NOT bridge with a third.
- **No stopping before 5/5.** The user authorized autonomous rolling: fix -> gate
  -> audit without interruption.
- **Long context is NOT an excuse to stop.** Delegate the FIX work to fresh-context
  sub-agents; the orchestrator independently re-verifies the gate (re-run check /
  lint / unit / FULL e2e; never trust a sub-agent's gate number) and writes the
  Audit-XX + journal session.
- **Communication: written technical Chinese, not spoken.** No calques
  (`根因`/`墙钟`/`钳位`/`死端`), no em dashes (U+2014, forbidden by the repo's
  `local/no-emdash` lint rule in code, comments, AND docs).
- **Every round must write an Audit-XX report.** Do not skip the audit log.
- **A fix is gate-green ONLY when the FULL e2e passes**, not when a targeted spec
  does. A fixer that breaks existing tests has the wrong fix; do not weaken
  existing tests to make the gate green.
- **After EVERY doc (`.md`) or code-comment edit, immediately** `grep -nP
'\x{2014}' <file>` and `bunx prettier --check <file>` on that file. Do not wait
  for the next gate run (em dashes and prettier-wrap in audit reports / journal
  sessions were a recurring slip this stretch).

## 3. The architecture (current, post-R87)

Global singleton orchestrator (`getGlobalNavPipelineOrchestrator`), eagerly
constructed. `configure`/`releaseInputs` lifecycle (hosts call `configure` in
`onMount`, `releaseInputs` in `onDestroy`); `unmount` is the full teardown for the
mobile to desktop flip. Three orchestrator-owned rAF channels (executor gesture
slide, settle ease, tap-scrub ease). The `NavStateMachine` is the sole macro
authority (§13.5); the orchestrator's `#publication` is a `$derived.by` reading
the state machine + the per-frame `#progress`, with a central clamp in `#publish`
bounding `publication.progress` / `pager.backMorph` to [0,1].

FAB scale: `fabScale(progress, fromHasFab, toHasFab)` in `fab-scale.ts`. The FAB
layer reads `publication.progress` + `getRouteData(from).fab` /
`getRouteData(to).fab`. Boundary void-swipe uses the proportional
`1 - progress * BOUNDARY_RUBBER_BAND_FACTOR` reaction (a sanctioned divergence
from the half-mapping).

## 4. What was fixed (R82 to R95)

- **R82:** `replaceState` intent was lost through the finish-then-new queue replay
  (and mis-applied to the commit's own dispatch). Fixed with a capture-clear-rearm
  flow: the finish-then-new branch captures the intent into `#queuedDiscreteNav`
  and clears the store; `#landAtRest` re-arms the store from the queue before the
  replay goto. Plus `shouldCancelOnRelease` pointercancel preventive unit tests.
  Also: the orchestrator's independent pre-R82 gate re-run caught a unit
  regression (`/discussions/pN` fab) that had been red since A75 and reported green
  by R76-R81 (gate numbers had been copied forward without re-running).
- **R83:** `#lastDispatchWasDeepToDeep` had a fourth lifecycle gap (a non-deep-to-deep
  pipeline nav interrupting a deep-to-deep commit in the pre-dispatch window).
  Fixed by clearing it in the `(!isTabRootPath(to) && !isDeepToDeep)` early-return.
  (R83 B's "/search -> tab-root morph snap" was adjudicated a FALSE POSITIVE and
  reverted: the morph endpoints rest at the same `translateY(0)` and the icon is
  frozen by `isSearch`.)
- **R84:** a gesture begun in the gap between `#dispatchNav`'s goto and the
  destination's `afterNavigate` had its `#pendingGesture` wiped by `#landAtRest`.
  Fixed: `#beginGesture` clears the in-flight dispatch markers
  (`#navDispatchInFlight`, `#dispatchTarget`, `#lastLandWasPipelineCommit`,
  `#lastDispatchWasDeepToDeep`), mirroring the existing `#isEnterAnimation` clear.
- **R85:** `unmount()` had been clearing the cached header-state fields, which are
  only re-populated by `notifyHeaderState` (Header `$effect.pre`); on a mobile to
  desktop to mobile flip-without-navigation the Header persists and `$effect.pre`
  does not re-fire, so a back-swipe read empty latched titles. Fixed: `unmount()`
  no longer clears those fields (they stay current via `notifyHeaderState`'s
  `!#mounted` branch; a real Header re-mount resets them via `resetHeaderState`).
- **Flaky root cause (the "pre-existing" `fab.spec.ts:436`):** NOT a CDP artifact.
  `#beginGesture` captured `rawStart = this.#progress` (the OLD direction's frame)
  before the reset; on an opposite-direction re-grab the FROM/TO swap desyncs the
  FAB (publication, seeded from old `#progress`) from the track (executor, seeded
  from the visual-derived `startProgress`). Fixed: `rawStart: startProgress` in
  both `#beginGesture` branches (unify: one handoff value for both channels). The
  horizontal check found a sibling in `onSvelteKitBeforeNavigate`'s
  `#commitStartRaw = this.#progress` (same desync on an opposite-direction
  discrete-nav interrupt of a live drag); fixed the same way. Added the central
  `[0,1]` clamp in `#publish` so an extrapolated `startProgress` cannot push the
  publication out of range. Added a mid-enter-re-grab preventive e2e. The
  `fab.spec.ts:436` test is now deterministic.
- **R86:** deleted the dead orphan module `src/lib/stores/active-gesture-track.svelte.ts`
  (zero importers).
- **R87:** removed the dead `pendingNav` / `navInFlight` state from
  `NavigationStore` plus its downstream cascade (`determineDirection`,
  `getNavigationParams`, their interfaces, the now-write-only `#lastHistoryIndex`
  field + writes) and rewrote stale `pendingNav` mechanism docstrings in two e2e
  specs to the current mechanism. Deleted two zero-caller test-only exports
  (`__resetNavPipelineOrchestrator`, `__setNavStateMachine`). (R87 A1, a claimed
  FAB 1-frame jump at a re-grab instant, was empirically disproven and is a
  non-issue: `#beginGesture` and `#publish` run in the same synchronous tick.)
- **R88:** the MobileTabBar was non-interactive at rest on a tab root whenever
  `navStore.backTarget` was a deep page. `Header.svelte` derived `tabsIn` fell
  back to `targetHasTabs` at rest (asymmetric with `tabsOut`'s `currentHasTabs`),
  so `rootLayerStyle`'s pointer-events was `none`. Fixed: `tabsIn` at-rest
  fallback is `currentHasTabs`. Preventive e2e `tab-bar-interactive-with-deep-backtarget.spec.ts`.
- **R89:** the first clean round (A+B PASS), counter reached 2/5.
- **R90:** DV20's (tabs) layout change (NavPipelineTabHost on mobile instead of
  children) dropped the child routes' `runPassthrough` (DV07 offline passthrough
  IDB write) on mobile. Fixed: `NavPipelineTabHost` calls `runPassthrough`
  (onMount + afterNavigate, gated activeIndex===0, reading home.discussions),
  wrapped in `requestIdleCallback`. Preventive e2e `mobile-passthrough.spec.ts`.
  The passthrough concern reset the counter 2/5 -> 0/5. Also stabilized a
  ~17%-flaky `fab-deep-real-interaction` CASE A (rAF-sampling fragility, not a
  production defect; time-based rampMs + wide-band assertions).
- **R91 (first OPEN-SCOPED round):** the prior scoped prompt had excluded bug
  spaces outside the orchestrator; R91's open prompt found SIX in one round. A1:
  `<title>` missing on mobile for the four tab routes (same layout-skip class as
  the passthrough); fixed by `NavPipelineTabHost` publishing `activeTitle` via
  `<svelte:head>`. B: dead `target` in notifications; dead `inbox` field + wasted
  `getConversations` query on every message-thread load; dead `totalRepliesCount`
  return; five stale `ThreadPager` comments; `/messages/add/` missing from
  `TAB_BAR_CONFIG` (pill flash). All fixed. (A horizontal sweep confirmed every
  (tabs) child side-effect is now restored or acknowledged desktop-only.)

Lessons (also recorded in auto-memory): the horizontal check is BINDING (when you
fix one defect, grep sibling paths and fix them in the same change); the
audit/fix prompt must require empirical verification of any "visible behavior"
claim (false positives R83-B and R87-A1 were plausible-sounding but wrong); a
sub-agent's targeted-spec pass does not prove the full suite is green; the audit
prompt must ORIENT not SCOPE (a file/trajectory/defect-type/invariant list
excludes other bug spaces, as R91's open prompt proved by finding 6 defects the
scoped prompt had missed).

### R92-R95 (the continuation stretch)

- **R92:** deleted the dead `thread-nav.svelte.ts` module (write-only state, zero
  reader callers) + its dead write block in `+layout.svelte`; deleted dead
  `NavigationStore` members (`activeTab`, `getTabFromPath`, `getStack`,
  `navigateBackward`); deleted the dead `BackHandlerDispatcher` (register had
  zero callers; dispatch always returned false); replaced hardcoded "Janbao" with
  `getSiteName` / `formatTitle` in the offline page titles, the `app.html`
  apple-mobile-web-app-title (`hooks.server.ts injectSiteName`), and the
  service-worker push fallback (`$env/static/public`).
- **R93:** fixed the manual Save Draft silent data loss (`contextId: 'new'`
  string into an INTEGER-affinity column; call site to `0` + a boundary coercion
  in `/api/drafts/save`); migrated 13 id-0 filter sites to `isRealUserId`
  (messages, the activities wall-post incl. storage + DELETE auth, 3 profile
  Message buttons, addParticipant, the offline cache, ActivityRow); removed 18
  i18n English fallbacks; root-caused the `fab-release-snap` flaky (the
  band-count check was fragile to rAF under-sampling; replaced with a time-based
  - leap guard; 60/60 deterministic).
- **R94:** caught three id-0 / coercion SIBLINGS the R93 horizontal sweep missed
  (`passthrough.ts` `lastReplyAuthorId > 0`, `api/sync/content` `n > 0`,
  `/api/drafts/clear` missing the contextId coercion); extracted a shared
  `normalizeDraftContextId` helper (+ 7 unit tests) used by `/save` and `/clear`.
  Process fix: the fixer prompt now BINDS an independent broad-grep class-wide
  enumeration; the orchestrator cross-checks it.
- **R95:** fixed the id-0 recipient display-name projection (`a.recipientId ?` ->
  `isRealUserId`) that R93's ActivityRow change had exposed (a wall-post to the
  admin rendered "Unknown user"); fixed the offline manifest depth mismatch
  (pass `requestDepth`, not `depth`); corrected an overstated `manifest-recompute`
  docstring; normalized vanilla id 0 in the import script (`normalizeVanillaUserId`
  - the inviter sibling); wrapped three FTS-write paths in transactions; fixed a
    stale-activeIndex `runPassthrough` gate; misc very-low cleanup. The id-0
    recipient class is now FULLY CLOSED after this round's exhaustive sweep.

The id-0 class is the cautionary tale of this stretch: it produced sibling
findings in R93, R94, AND R95 because each round's horizontal sweep was narrower
than the class. The fixer prompt and the orchestrator's close-out now require an
exhaustive broad-pattern sweep before a round closes (see section 6).

## 5. Current state of the code

### Gate (green, last verified 2026-07-19, zero flakies)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores src/lib/actions src/lib/server/utils   407 pass / 0 fail
$ bunx tsc -p scripts/tsconfig.json   EXIT=0
$ bun run test:e2e                    210 passed / 0 flaky (exit 0)
$ fab-release-snap --repeat-each=20    60 passed / 0 flaky (determinism, R93)
```

Working tree: the R94 + R95 changes are applied and gated but NOT yet committed
(continued in git history only through A94, which the user committed as a
checkpoint of R92+R93). Commit cadence for the continuation rounds is pending the
user's instruction.

### What exists (post-R91)

- Global singleton orchestrator, eagerly constructed. `configure`/`releaseInputs`
  lifecycle; `unmount` for mobile to desktop.
- Three orchestrator-owned rAF channels (executor slide, settle, tap-scrub).
- FAB scale: `fabScale(progress, fromHasFab, toHasFab)`, reactive reader.
- `shouldEnter`: `$derived.by`, gated on `resolvedLeftHref` +
  `publication.lastDispatchWasDeepToDeep`.
- `#queuedDiscreteNav`: carries `replaceState`; cleared on non-pipeline commit
  targets, on external navs after the dispatch-reentry check, and consumed by
  `#landAtRest` on pipeline landings (capture-clear-rearm).
- `#beginGesture` (both branches): clears `#isEnterAnimation`,
  `#navDispatchInFlight`, `#dispatchTarget`, `#lastLandWasPipelineCommit`,
  `#lastDispatchWasDeepToDeep`; seeds `rawStart = startProgress`.
- `#commitStartRaw = startProgress` at all seed sites (`#beginGesture`,
  `playEnterAnimation`, the discrete-nav path, `#accelerateInFlight` uses the
  same-commit `#progress`).
- Central `[0,1]` clamp in `#publish`.
- `#lastDispatchWasDeepToDeep` and `#lastLandWasPipelineCommit`: five clear sites
  each (documented in their field docstrings).
- `isMobile`: seeds from `page.data.isMobile`; onMount flips to matchMedia.

### What was deleted (cumulative, this stretch)

- `active-gesture-track.svelte.ts` (R86).
- `NavigationStore` pending-nav state: `#navInFlight`, `#pendingNav`, the
  getter/setter, `setPendingNav`/`clearPendingNav`/`executePendingNav`,
  `determineDirection`, `getNavigationParams`, `DirectionResult`,
  `NavigationParamsResult`, `#lastHistoryIndex` (R87).
- `__resetNavPipelineOrchestrator`, `__setNavStateMachine` test exports (R87).
- (Earlier in the cycle: `MobileTabPager`, `GesturePageLayout`, `nav-coordinator`,
  `backSwipeShouldPopHistory`, `TAB_CLICK_COMMIT_MS`, `discreteNavInFlight`,
  `.fab-transition`, `ActivitySkeleton`, `DiscussionsSkeleton`, `backParent`,
  `isPipelineSwipeDisabledRoute`, `FabFamily`, `familySwapScale`,
  `#lastRenderedScale`, the family-swap rAF, `isGesturePageLayoutRoute`,
  `GESTURE_MORPH_EPSILON`, the `snippet` cache field, `LoadingChip` dead props,
  `.scroll-chrome-scrolling`, `runSettleDriver`/`startTapScrub`/settle setTimeout
  in the Header, the R18 sub-component CSS transitions.)

### Audit trail

- Audit files: `docs/RV20-C05b2-Audit-{24..95}.md` (R92-R95 written this
  continuation; the Audit Log IS these report files).
- Journal: `docs/DV20-C05b2-Journal.md` (sessions through 98 = R94; R95 session
  99 not yet appended).
- Spec: `docs/DV20-Meeting/DV20-C05b2-spec.md`.
- Reusable audit prompt: `docs/DV20-Meeting/DV20-C05b2-Audit-Prompt.md`
  (OPEN-SCOPED since R91: orients with architecture + spec location, then "find
  ANY defect ANYWHERE, explore freely"; no file/trajectory/defect-type/invariant
  list. Binding horizontal-check requirement.)

## 6. The convergence model and the process (binding)

- **Two auditors per round** (DV20 two-vote model), role-less and hint-less, given
  ONLY the open-scoped audit-prompt file (architecture + spec location for
  ORIENTATION, then "find ANY defect ANYWHERE, explore the whole codebase freely";
  NO file/trajectory/defect-type/invariant list, which would exclude other bug
  spaces). Pass votes accumulate ACROSS rounds; the Cycle closes at 5 consecutive
  PASS votes. Any concern resets the counter to 0. PASS-with-concerns is not PASS.
  (R89 was the first clean round at 2/5; R90's passthrough concern reset to 0/5;
  the open-scoped R91 then found 6 defects the prior scoped prompt had missed.)
- **BINDING horizontal check (user directive 2026-07-19).** Every auditor AND
  every fixer must grep the WHOLE codebase for the same bug class in sibling
  paths before reporting or claiming done, using BROAD patterns that cover the
  bug CLASS (not one variable name), enumerate every hit classified as
  defect-vs-legitimate, and fix ALL siblings in the same change. The id-0 class
  leaked a sibling in R93, R94, AND R95 because the early sweeps grepped only
  `id > 0` and missed `n > 0`, `lastReplyAuthorId > 0`, the recipient
  display-name projection, and the `/drafts/clear` sibling. A narrow sweep that
  fixes only the cited site is an INCOMPLETE fix; the round is not done until the
  class is exhausted. The orchestrator independently re-runs the sweep and
  cross-checks the agent's enumeration.
- **The orchestrator runs the audit** (spawns both auditors itself), independently
  re-traces every finding, adjudicates real vs false positive (empirically verify
  any visible-behavior claim; two false positives this stretch were caught this
  way), fixes with a fresh-context sub-agent, independently re-runs the FULL gate,
  writes Audit-XX + the journal session, counts votes, launches the next round.
- **Autonomous rolling**: do not stop for session length or context pressure.
  Delegate fix work to fresh-context sub-agents; keep launching the next round.
  Only surface the user for a genuine architect-level decision.

## 7. What the next agent must do

### Immediate: R82-R95 are done; continue from R96

Launch two independent open-scoped auditors with the `DV20-C05b2-Audit-Prompt.md`
brief. If they hit the 5-hour API rate limit (HTTP 429), re-run them (R94's
auditors hit a 429 on first launch and were re-run successfully). Triage each
finding (re-trace, adjudicate real vs false positive). For every confirmed
concern, the fixer MUST do the binding exhaustive horizontal sweep (section 6).

### For each round

1. Spawn 2 independent auditors (the prompt file).
2. Triage: independently re-trace each finding; classify concern vs false
   positive (empirically verify visible-behavior claims; verify dead-code claims
   by grep).
3. Fix every real concern with a fresh-context sub-agent: structural cause +
   horizontal check (all siblings) + preventive test; require the sub-agent to
   run the FULL e2e (real exit code, not piped through `tail`).
4. Independently re-run check / lint / unit / FULL e2e. Zero flakies.
5. Write `docs/RV20-C05b2-Audit-XX.md` + append a journal session. Immediately
   `grep -P '\x{2014}'` + `prettier --check` each doc you wrote.
6. Count votes; launch the next round. Repeat to 5 consecutive PASS.

### If a finding needs the user's decision

Only for a genuine architect-level decision (a macro-plan deviation needing
sign-off). Everything else is handled autonomously.

## 8. Key files

- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts` (~3100 lines) - the
  universal orchestrator.
- `src/lib/stores/nav-state-machine.svelte.ts` + `nav-state-machine-logic.ts`.
- `src/lib/stores/nav-executor.svelte.ts` + `nav-executor-logic.ts`.
- `src/lib/stores/mobile-pager.svelte.ts` - the pager store.
- `src/lib/stores/navigation.svelte.ts` - the tab/stack nav store (post-R87
  cleanup).
- `src/lib/utils/fab-scale.ts` - `fabScale(progress, fromHasFab, toHasFab)`.
- `src/lib/components/templates/FloatingActionButtonLayer.svelte` - the FAB layer.
- `src/lib/components/templates/NavPipelineHost.svelte` - `shouldEnter` uses
  `resolvedLeftHref` + `lastDispatchWasDeepToDeep`.
- `src/lib/components/templates/NavPipelineTabHost.svelte`.
- `src/lib/utils/route-data.ts` - `RouteData.fab` boolean.
- `src/lib/utils/route-config.ts` - `FAB_ROUTE_ATTRIBUTES`.
- `src/lib/utils/gesture-constants.ts` - constants.
