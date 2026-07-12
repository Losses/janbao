# RV20-C05b2 - Audit Round 3 (architect-run, 2 independent auditors)

Result: **A FAIL (1 HIGH + 2 MED + 1 CONCERN + 2 LOW); B PASS-WITH-CONCERNS
(2 MED + 5 CONCERN + 2 LOW + 2 comment CONCERN).** Counter stays 0/5.

Both auditors were run with a clean, role-less, non-leading prompt that
**explicitly forbade reading the Journal and all `RV20-C05b2-Audit-*.md`
files**. Findings were triaged for validity (empirical repro + code trace)
before any fix; only confirmed-real items were fixed.

## Consensus findings (both auditors)

- **FAB Family A sampler reads `getComputedStyle(trackEl).transform.m41` every
  frame (§5 DOM read-back).** Real. Kept as a documented Known condition this
  round (see Known 5b2 conditions #1): the published `fractionalIndex` is the
  threshold-absorbed PILL position and `coverProgress` is the raw drag fraction;
  neither is the 1:1 track position the Family A FAB follows across a drag, a
  re-grab, and the first/last-tab rubber-band. Eliminating the sampler requires
  the orchestrator to publish the track's 1:1 fractional position (computed from
  `trackTranslateX(plan, executor.progress)`); that refactor is the first item
  of the next fix round.
- **NavStateMachine `sub` never advances past `'dragging'`; the
  `commit`/`cancel`/`drag-move`/`interrupt` handlers were dead code (§13.5).**
  Real. Fixed: the orchestrator now dispatches `onDragMove` (live drag),
  `onCommit` (release past threshold), `onCancel` (release below threshold) at
  every executor call site, and `onInterrupt` at `#beginGesture` start when a
  transition is in flight (a re-grab). The interrupt is required because the
  resolved handler preserves a `'committing'` sub when re-resolved mid-commit;
  the interrupt clears it so the new drag re-enters `'dragging'`.
- **Stale pilot-only / GesturePageLayout / MobileTabPager comments.** Real. All
  rewritten to current behavior.

## A-only findings

- **HIGH - direction-reversing re-grab mid-commit on the tab host jumps the
  track (§5 "No jump").** Real, confirmed by an empirical pure-function repro:
  a forward commit toward tab N interrupted by a backward re-grab builds a new
  plan whose track span does not contain the in-flight visual, so
  `progressAtTranslateX` clamped to 0 and `onDragStart` published the plan's
  endpoint (a half-panel jump). FIX: `progressAtTranslateX` extrapolates instead
  of clamping (the out-of-range progress is safe: `trackTranslateX` is linear,
  the commit solver scales by `|target - progress|`, and the raw `coverProgress`
  the FAB/Header read is clamped at its own publish site); the boundary
  rubber-band drag formula now anchors at `startProgress` so a mid-commit
  boundary re-grab does not jump on the first drag frame. Added three preventive
  unit tests (extrapolation, reverse handoff, boundary handoff).
- **LOW - FAB/Header are not driven by the executor via the plan's consumer
  fns.** Documented as Known 5b2 condition #3 (the spec's end-state #2
  explicitly accommodates the separate FAB family-swap ease).
- **LOW - missing direction-reversing re-grab test.** Added with the HIGH fix.

## B-only findings

- **MED - cross-tab exit to `/messages/inbox` rendered an empty / wrong left
  panel.** Real: `NavPipelineHost` had `/activity` and `/` left-panel branches
  but not `/messages/inbox` (`MessagesPanel` was not imported). FIX: added the
  `/messages/inbox` branch (renders `MessagesPanel` from the eager-loaded
  `page.data.messages`) plus a new `MessagesSkeleton` defensive fallback
  mirroring `ActivitySkeleton`/`DiscussionsSkeleton`.
- **MED - NavPipelineTabHost did not reset the pager store on settle.** Real:
  `#landAtRest` and the tab host's at-rest `$effect` did not call
  `resetPagerStore`, so `coverProgress`/`transitionTarget` retained in-flight
  values at rest. FIX: the at-rest `$effect` now calls
  `orchestrator.resetPagerStore()` (bidirectional branch).
- **CONCERN - `readRenderedFabScale` reads the FAB atom transform from the DOM
  (§13.5).** Real. Kept as Known 5b2 condition #2 (the reactive `restingScale`
  loses the race on a SvelteKit-navigation flush; the DOM read anchors the
  visible scale). Elimination needs a post-DOM `$state` for the last-committed
  scale; next round.
- **CONCERN - `nav-coordinator.ts` (Layer 4) was dead code with a false
  docstring.** Real (zero source imports; `grep` confirmed only its own test
  referenced it). Its §9 chip-exit role is superseded by the 5b2 skeleton
  approach. FIX: deleted `nav-coordinator.ts` + `nav-coordinator.test.ts`.
- **CONCERN - stale comments** (gate, gesture-constants `TRACK_TRANSITION_MS`,
  route-config `isPagerRoute`, route-data `backParent` header, nav-state-machine,
  nav-executor, fab-scale, FAB layer sampler). Real. All rewritten.
- **LOW - `held = true` initialized before onMount acquired the lock.** Real.
  FIX: `held` initializes `false`; the acquire site sets it `true` (matching
  NavPipelineHost).
- **LOW - missing velocity-matched commit e2e (§12).** Real. Documented as Known
  5b2 condition #4 (TODO).

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    422 pass / 0 fail
```

The R2 audit file `docs/RV20-C05b2-Audit-02.md` had one residual em-dash that
blocked the lint gate (the S10 sed sweep missed it); fixed (`,` reword). The
`bun run lint` exit code was independently re-verified (the S10 journal's
`LINT_EXIT=0` captured `tail`'s exit, not lint's; the gate was actually red
until the em-dash fix).

E2e (`messages-back-swipe tab-click-transition tab-exit-preview fab
tab-host-swipe tab-swipe-preview-height`): a first post-fix run surfaced a
systemic regression from the new `/messages/inbox` left-panel branch: it
rendered `MessagesPanel` with `page.data.messages.conversations`, but on
`/messages/[id]` the `messages` key is shadowed by the route's message-row
array (`/messages/[id]/[[page=page]]/+page.server.ts:191`), so `conversations`
was undefined and `MessagesPanel`'s `conversations.length` check threw
(`Cannot read properties of undefined (reading 'length')`), failing every
spec that rendered NavPipelineHost on `/messages/<id>`. FIX: the branch now
guards on `!Array.isArray(page.data.messages)` (the inbox object vs the
shadowed array); on `/messages/[id]` it renders `MessagesSkeleton` (the inbox
loads on land), otherwise `MessagesPanel`. Post-fix full gate:

```
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab tab-host-swipe tab-swipe-preview-height    94 passed (3.7m)
```

Consecutive pass votes: **0/5** (A FAIL + B PWC; the HIGH + MEDs + comment
concerns fixed, the sampler / readRenderedFabScale / velocity-e2e documented
as Known 5b2 conditions; R4 audits the post-fix state).
