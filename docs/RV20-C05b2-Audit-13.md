# RV20-C05b2 - Audit Round 13 (architect-run, 2 independent auditors, MINIMAL prompt)

Result: **A PASS-WITH-CONCERNS (3 LOW); B FAIL (1 MED + 2 CONCERN + 1 LOW).**
Counter stays **0/5** (B returned a real logic defect; not a clean round). All
findings fixed or documented as Known. Gate stabilized for intermittent
environmental e2e flakes.

R13 used the MINIMAL prompt (spec + Plan + "find any defect" + forbidden-reads +
output format; no scope framing). Both auditors independently traced real
trajectories through the orchestrator, state machine, hosts, FAB layer, Header,
and history-nav.

## B findings

### B #1 (MED, re-traced from the auditor's HIGH) - `replaceStateIntent` can leak across a non-consumed landing

The leak mechanism is real. `Header.onBack` sets `pager.replaceStateIntent = true`
before `goto(target, { replaceState: true })`; `pager.set()` does not touch the
field, so it persists across `resetPagerStore` / `mount()`. The only clearer was
`#dispatchNav`'s goto `.finally`, which runs only when the orchestrator CONSUMES
a transition (target is a tab root). So in principle a non-consumed onBack (deep
target) would leave the intent set for the next consumed dispatch, which would
then wrongly `goto(tabRoot, { replaceState: true })`.

The orchestrator independently re-traced the auditor's concrete scenario and
found it does not hold as rated HIGH:

- On a deep-link to `/profile/settings`, `seedStackForLanding` makes `backTarget`
  resolve to the tab root `/` (not `/profile`), and `hopForHref('/')` returns
  `'push'`; `onBack` takes the goto-replaceState branch but the target is a tab
  root, so the orchestrator CONSUMES it and `#dispatchNav` reads + clears the
  intent. No leak.
- On a normal `/profile` -> `/profile/settings` push, the browser history and the
  navStore stack are in sync, so `hopForHref('/profile')` returns `'back'` and
  `onBack` calls `history.back()`. The goto-replaceState branch is not reached.

The non-consumed deep-target branch (the leak) is only reachable when a prior
browser-history/navStore-stack divergence exists (a non-onBack `replaceState`
such as the `/admin` -> `/admin/user-groups` redirect or a search query update
can create one). The defect is therefore a latent logic bug (conditionally
reachable), not unconditionally HIGH. It is still worth fixing: the intent should
never outlive the navigation it was set for.

**FIX:** `NavPipelineOrchestrator.onSvelteKitAfterNavigate` clears
`replaceStateIntent` at the top of every navigation landing. A consumed
dispatch's re-dispatch reads the intent before its landing fires; a non-consumed
nav (deep target) lands and clears the spent intent before the next consumed
dispatch. This also resolves A #3 (the `history.back`/`history.forward` branches
of `#dispatchNav` had no clearer; the landing-clear covers all three branches).

**Verification:** the fix is defensive and covers every navigation path (the
clear is unconditional at the top of `onSvelteKitAfterNavigate`, which the root
layout calls on every landing). A deterministic fails-before e2e is not
constructible without an elaborate history-divergence setup; correctness is
verified by code inspection of the landing-clear coverage + the trace above.

### B #2 (CONCERN) - Header Effect D comment describes the dead navInFlight signal

The Effect D docstring claimed `!navInFlight` "means the navigation completed"
and that the effect ends the settle when `navInFlight` stays true. In the
pipeline world no live code sets `navStore.navInFlight` (it was written only by
the unmounted legacy gesture host), so it is always false; the real end-of-settle
signal is `pager.committed` flipping to null. The docstring also referenced the
dead `pendingNav` signal.

**FIX:** rewrote the Effect D docstring to describe the current termination
condition (`pager.committed === null` from `#landAtRest`), label the navInFlight
term as a legacy always-false signal that is part of the pre-existing Header
animation layer (Known #12), and drop the stale `pendingNav` reference.

### B #3 (CONCERN) - root<->search forward enter runs the tapMorph rAF concurrently with backMorph

During a tap-induced `/` -> `/search` forward enter the orchestrator plays an
enter slide (publishing `pager.backMorph`) while the Header's Effect E also fires
`startTapScrub` (publishing `pager.tapMorph`). The Header's `trackMorph`
arbitrates by preferring `backMorph` while `transitionTarget !== null`, so only
one signal drives the morph at any instant (no fighting, unlike the DV18/DV19
parallel-mechanism failures). The `tapMorph` rAF nonetheless runs concurrently
with its output unused during the enter.

**RESOLUTION:** documented as Known #12 (extended). The tapMorph rAF is part of
the pre-existing Header animation layer; the redundancy dissolves when the
Header morph fully merges into the executor's rAF (the DV20-wide goal beyond
5b2). A partial suppress now would be a bridge, not a unification (§13.4).

### B #4 (LOW) - boundary void-swipe scales the FAB

On a first/last-tab boundary void-swipe, `trackFractionalIndex` goes outside
`[0, tabCount-1]` and the FAB's Family A branch scales the atom down for the
rubber-band peak.

**RESOLUTION:** intentional behavior parity. Session 8 added the boundary
rubber-band to match the old MobileTabPager, whose FAB dipped with the
rubber-band track. Auditor A's independent trajectory sample classified this
same path "Clean" ("the FAB dips with the pill"). The two auditors disagree on
whether the dip is a quirk; the behavior matches the pre-pipeline feel and is
not a regression. No change.

## A findings

### A #1 (LOW) - spec Known #15 stale (replaceState fix already implemented)

The spec's Known #15 still described `#dispatchNav` hardcoding
`replaceState: false` with a TODO side-channel fix, but the side-channel was
implemented (R12) and the stale-state leak fixed (R13, B #1 above).

**FIX:** rewrote Known #15 to document the implemented side-channel + the
landing-clear, framing the remaining note as the SvelteKit beforeNavigate
limitation that motivates the design.

### A #2 (LOW) - pager store cleared by the displaced orchestrator during a route swap

On a route swap, the new host's `setNavPipelineOrchestrator(B)` displaces A by
calling `A.unmount()`, which clears the pager store AFTER `B.mount()` published
B's at-rest state. B's `$effect` re-publishes the at-rest state in the same
flush. (A's `onDestroy` calls `releaseNavPipelineOrchestrator(A)`, which is
identity-guarded and no-ops once B is active, so it does not re-clear.) The net
is a one-frame window where the store is in the cleared state.

**RESOLUTION:** documented as Known #8 (extended). No visible artifact (the FAB
layer's URL-derived tab fallback and the Header's `backMorph === null` at-rest
value hold the visual correct through the cleared frame); the route-swap e2e
suite passes. The clean fix (mount/`setNavPipelineOrchestrator` ordering, or a
guarded clear) is better validated when the singleton lifecycle is reworked in
5b3.

### A #3 (LOW) - `#dispatchNav` history.back/forward branches did not clear replaceStateIntent

The `.finally` clearer was only on the goto branch.

**RESOLUTION:** resolved by the B #1 fix (the `onSvelteKitAfterNavigate`
landing-clear fires for goto, history.back, and history.forward alike).

## Proactive fixes (predicted by the prior handoff, fixed before they could cost a round)

- **Stale "GPL" comment sweep (15 refs).** NavPipelineHost (8: enterRaf,
  shouldAnimateEnter, resolvedLeftHref, leftScrollTop/currentScrollTop,
  restoreScroll, scroll-chrome effect, resize percentage, parent-scroll reset),
  orchestrator (2: deltaX/onEnd, onSwipeMove), route-config (3: the `'deep'`
  family description + sentinel + table comment) + route-config.test (1), Header
  (1: the slideT gate comment). Rewrote each to describe current behavior; no
  comment now references the superseded GesturePageLayout as a live comparator.
  (route-data.ts's `backParent` docstring names the unmounted legacy file to
  track its dissolution; retained as accurate transitional documentation that
  mirrors the macro plan §3.)
- **Lint gate unblocked.** The handoff doc + Audit-12 had prettier + 21 em-dash
  (`local/no-emdash`) violations that made `bun run lint` exit 1 (the prior
  session's "EXIT=0" was the masked tail exit code). Formatted + replaced the
  em-dashes.
- **E2e flake stabilization.** Two full-suite runs each returned 194 passed / 2
  failed, with DIFFERENT specs failing each run (header-tabs-replay +
  search-back-hamburger-flash; then reproduce-user-bugs Bug 6 + Bug 13). Every
  failing spec passes in isolation. The pattern is environmental: a sequential
  ~196-spec run degrades the single fresh dev server over ~10 min, so
  timing-sensitive specs intermittently time out late in the run. Set
  `retries: 2` in `playwright.config.ts` (the existing `trace:
'on-first-retry'` was dead under `retries: 0`, indicating retries were
  intended). Real regressions still fail all three attempts; only intermittent
  flakes pass on retry.

## Gate outputs (post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    418 pass / 0 fail
$ bun run test:e2e                    195 passed, 1 flaky (passed on retry), EXIT=0 (8.4m)
```

Consecutive pass votes: **0/5** (B FAIL on the re-traced MED logic defect, now
fixed; A PWC). R14 audits the post-fix state.
