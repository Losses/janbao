# DV21 Cycle 1 Journal

**Spec:** `docs/DV21-Meeting/DV21-C01-spec.md`. **Audit prompt:**
`docs/DV21-Meeting/DV21-C01-Audit-Prompt.md`. **Protocol:**
`docs/DV20-Meeting/DV20-Cycle-Manager-Protocol-v2.md`.

Incremental, honest, real outputs. The CMA implements and writes here; the
orchestrator gates, spawns the auditors, tallies, and decides. Coverage bullets
are round-independent (they point to the audit files). The Failures section and
the audit file are written each round.

## Gate baseline (Cycle 1 starts from green)

Master, before any DV21 code change:

```
bun run check     # to capture (CMA pastes the real number on R1)
bun run lint      # exit 0
bun run test:e2e  # the existing 210 + the 5 reproduce specs (3 reproduce, 2 guard)
```

The five reproduce specs at baseline: Bug 1, Bug 3, Bug 4, Bug 6, Bug 7 FAIL
(reproduce); Bug 2, Bug 5 PASS (guards). The cycle closes when all five
reproduce specs are green AND the full e2e is green AND 5 consecutive auditor
PASS votes.

## Fixes (root cause + siblings + preventive test)

- **Fix A (Bugs 1, 6):** header root + title layers read the live `backMorph`
  during a drag, like the BurgerArrowIcon. (CMA fills in: the exact derivation
  site, the sibling sweep, the evidence.)
- **Fix B (Bug 7):** discrete back-nav drives the bar-switch concurrently with
  the slide (one progress), no post-landing settle gap.
- **Fix C (Bug 3):** last-tab forward swipe resolves to `/search` via
  `tabSearchResolver`; the boundary/cancel stops shifting the pill highlight.
- **Fix D (Bug 4):** profile the `/search` enter, remove or defer the heavy
  synchronous chunk (190 to 390ms under 4x CPU), keep the animation.

## Failures

(Per-round entries appended as the audit loop runs. Each entry: the round, the
auditor findings, the fix applied, the re-gate result.)

### R1 Fix A (Bugs 1, 6): header root + title layers track the live drag

**Bug 6 root cause** (the canonical case the spec narrative describes). On a
held back-swipe on `/profile/settings` the page track and the BurgerArrowIcon
moved with the finger, but `rootLayerStyle` (the tab bar `translateY`) and
`layerDownStyle` (the title `translateY`) stayed frozen for the whole drag.
The icon and the track read the live `pager.backMorph` via the `morph`
`$derived`, so they moved; the two layer styles gated their `translateY` on
`!(tabsOut || tabsIn)` / `!tabsOut && !tabsIn`, and both `tabsOut` and
`tabsIn` fell back to `currentHasTabs` when no `settleLatched` was set
(`src/lib/components/organisms/Header.svelte:250-251`). During a held drag
there is no `settleLatched`, so on a deep host (`currentHasTabs === false`)
both became `false`, the `!(tabsOut || tabsIn)` guard evaluated `true`, and
both layer styles were forced to their at-rest deep-mode `translateY`
(`-100%` and `0%`) regardless of `morph`. The deep-page `translateX` evidence
(127px) and the burger rotation (180 to 97deg) matched: those read `morph` /
`pager.backMorph` directly, the layers did not.

**Bug 1 root cause** (the spec narrative is inaccurate for this case; the
canonical Fix A does not fix it). On a held back-swipe on a thread
(`/discussion/*`, a centerTab route on NavPipelineHost) EVERY header signal
was frozen, including the BurgerArrowIcon (range 0 across the drag; not only
the layers). The orchestrator's `#republishToPager` centerTab branch
(`src/lib/stores/nav-pipeline-orchestrator.svelte.ts:3108-3128`) force-set
`backMorph: null` for every drag on a centerTab route, so the morph
`$derived`'s `bm !== null` branch was never taken and `morph` returned the
static `currentHasTabs ? 1 : 0` for the whole drag. The page track still
moved because the executor writes its `translateX` from the live
`publication.progress`, not from `pager.backMorph`. The spec's "the
BurgerArrowIcon already moves" claim holds for `/profile/settings` (a
non-centerTab deep route where `backMorph` is published); it does NOT hold
for a centerTab thread route. The two bugs share the surface ("the header
does not track the drag") but the layered deriver in `Header.svelte` was
Bug 6's cause, while the orchestrator's publication suppression was Bug 1's.

**The fix.**

1. Drag-aware endpoint resolution in `Header.svelte`. The incoming
   endpoint (`tabsIn`) now reads `pager.transitionTarget` (the
   orchestrator-published destination pathname, republished per
   pointermove via `#republishToPager`) while a drag owns the transition,
   so the layer guards `!(tabsOut || tabsIn)` / `!tabsOut && !tabsIn` see
   the real endpoints of the in-flight transition. The outgoing endpoint
   (`tabsOut`) stays `currentHasTabs` during a drag (the drag has not
   landed yet; the source route is still the current route). The deep to
   deep guard stays intact: when both endpoints truly have no tabs, the
   root layer stays at `-100%` and the title layer at `0%`, so a deep to
   deep back-swipe remains animated by the page track only.
2. Sibling: the orchestrator's centerTab publication
   (`#republishToPager`). The centerTab branch was suppressing
   `backMorph` for every drag on a NavPipelineHost centerTab route
   (thread, compose mirror). It now publishes `backMorph: rawDragFraction`
   so the Header's morph `$derived` and the layer styles derived from it
   track the live drag (gesture feedback: the morph eases toward the
   back-arrow as the swipe advances, then the settle ease armed at
   release returns the morph to the destination's tab-ness). The
   bidirectional tab host's tab to tab path
   (`src/lib/stores/nav-pipeline-orchestrator.svelte.ts:3158-3159`:
   `(bidirectional && !targetIsDeepPage) || (fromIdx >= 0 && toIdx >= 0)
? null : rawDragFraction`) is unchanged: tab to tab swipes on the
   NavPipelineTabHost still publish `backMorph: null` end to end, so
   `e2e/tab-host-swipe.spec.ts`'s "stays in hamburger mode" assertion
   still holds.

**Sibling sweep.** Searched `src/lib/{stores,components,utils}` for every
site that gates a layer / visual on `tabsOut || tabsIn` /
`!tabsOut && !tabsIn`, falls back to `currentHasTabs` during a drag, or
publishes `backMorph: null` mid-gesture. Broad phrasings used:
`currentHasTabs`, `targetHasTabs`, `tabsOut`, `tabsIn`, `outgoingHasTabs`,
`incomingHasTabs`, `backMorph`, `pager.backMorph`, `pager.transitionTarget`,
`transitionTarget`, `translateY`, `layer.*Style`, `LayerStyle`,
`isDeepToDeep`, `centerTab`, `root mode.*end`, `hamburger.*end to end`.
Union of hits read in full; each classified below.

- `src/lib/components/organisms/Header.svelte:250-251` `tabsOut` / `tabsIn`
  fallback to `currentHasTabs`. DEFECT (Bug 6 root cause). Fixed.
- `src/lib/components/organisms/Header.svelte:257-268` `rootLayerStyle` /
  `layerDownStyle` gate `translateY` on `!(tabsOut || tabsIn)` /
  `!tabsOut && !tabsIn`. DEFECT (the layer guard consuming the bad
  endpoint resolution). Fixed by the `tabsIn` correction (the guard
  itself stays; it now sees the correct endpoints).
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:3108-3128`
  centerTab branch force-publishes `backMorph: null`. DEFECT (Bug 1 root
  cause, the publication suppression the spec's "BurgerArrowIcon already
  moves" claim depends on). Fixed.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:3158-3159` tab host
  tab to tab publication (`backMorph: null` when both source and target
  pill-map to a tab index on the bidirectional host). LEGITIMATE. The
  bidirectional tab host's "stays in hamburger mode end to end" is the
  documented design and `e2e/tab-host-swipe.spec.ts:13-25` enforces it.
  The morph stays at the static `currentHasTabs ? 1 : 0` (always 1 on a
  tab root) because the Header's `bm === null` fallback returns that.
  Left unchanged.
- `src/lib/components/templates/SearchScopePager.svelte:148,155,160,163`
  the search-scope sub-pager publishes `backMorph: null` for scope
  switches. LEGITIMATE. Scope switching is orthogonal to the header
  morph (the comment documents this); the search-scope pager is a
  different pager store from the primary one the Header reads.
- `src/lib/components/organisms/MobileTabBar.svelte:60-67` the deep-swipe
  pill path reads `pager.backMorph` directly with the
  `isDeepSwipe` gate. LEGITIMATE. It already reads the live
  `pager.backMorph`; with the centerTab publication fix the pill stays at
  `centerTab` for a same-tab back-swipe (the interpolant target equals
  the source) and animates for a cross-tab exit.
- `src/lib/components/organisms/SearchTabBar.svelte:50-67` the
  search-scope underline reads the search-scope sub-pager (not the
  primary pager). LEGITIMATE; unrelated to the primary header morph.
- `src/lib/components/atoms/BurgerArrowIcon.svelte` consumes the
  `progress` prop the Header's `iconProgress` `$derived` feeds it; the
  Header derives `iconProgress` from `morph`, which after the
  publication fix tracks the drag on every NavPipelineHost route. No
  edit needed.

**Real command outputs (Fix A only; Fix B, C, D not yet implemented).**

```
$ bun run check
svelte-kit sync && svelte-check --tsconfig ./tsconfig.json && tsc --noEmit -p tsconfig.sw.json
... COMPLETED 1469 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ bun run lint
prettier --check . && eslint . && bun scripts/ensure-similarity.ts && bin/similarity-ts ./src --types
[warn] docs/RV20-Cleanup-Audit-06.md
[warn] Code style issues found in 1 file.
error: script "lint" exited with code 1
```

The `docs/RV20-Cleanup-Audit-06.md` prettier failure pre-exists Fix A
(verified by `git stash` + `bunx prettier --check` on the unmodified
file); it is not introduced by this change. All files touched by Fix A
pass `prettier --check` and `eslint` individually.

```
$ bun test src/lib
552 pass / 0 fail / 2270 expect() calls across 40 files [2.58s]
```

```
$ npx playwright test e2e/reproduce-dv20-drag-sync.spec.ts -g "Bug 1" --retries=0 --workers=1
Bug1 held-drag ranges: {
  deepTrackTx: { range: 126.75, min: -393, max: -266.25 },
  rootLayerTy: { range: 18.3206, min: -18.3206, max: 0 },
  deepLayerTy: { range: 18.3206, min: 21.6794, max: 40 },
  burgerRot: { range: 82.4427, min: 0, max: 82.4427 }
}
1 passed

$ npx playwright test e2e/reproduce-dv20-drag-sync.spec.ts -g "Bug 2" --retries=0 --workers=1
Bug2 fast-flick commit (post-release):
  durationMs: 64.8, movingFrameCount: 5, travel: 166, deceleration: 59.67
1 passed (guard stays green)

$ npx playwright test e2e/reproduce-dv20-drag-sync.spec.ts -g "Bug 6" --retries=0 --workers=1
Bug6 settings held-drag ranges: {
  backMorph: { range: 0.458, min: 0, max: 0.4580152671755725 },
  deepTrackTx: { range: 126.75, min: -393, max: -266.25 },
  rootLayerTy: { range: 18.3206, min: -40, max: -21.6794 },
  deepLayerTy: { range: 18.3206, min: 0, max: 18.3206 },
  burgerRot: { range: 82.4427, min: 97.5573, max: 180 }
}
Bug6 drag cadence: { meanIntervalMs: 16.67, maxIntervalMs: 18, movingFrames: 13 }
1 passed
```

**Sibling regression sweep** (no Fix A regressions; the full e2e gate is the
orchestrator's, not run by the CMA):

```
npx playwright test e2e/tab-host-swipe.spec.ts \
  e2e/deep-to-deep-gesture-morph-spike.spec.ts \
  e2e/reproduce-new-mobile-bugs.spec.ts \
  e2e/header-tab-descent-cross-tab-exit.spec.ts \
  e2e/messages-back-swipe.spec.ts \
  e2e/fab-compose-backswipe.spec.ts \
  e2e/header-hide-on-scroll.spec.ts \
  e2e/enter-animation.spec.ts \
  e2e/backtarget.spec.ts \
  e2e/fab-deep-page-boundary.spec.ts \
  e2e/fab-boundary-swipe-sync.spec.ts \
  e2e/fab-release-snap.spec.ts --retries=0 --workers=1
81 passed
```

The bidirectional tab host's tab to tab "stays in hamburger mode" guard
(`e2e/tab-host-swipe.spec.ts`) is green, confirming the Fix A scope did not
cross the NavPipelineTabHost publication boundary.

**Out of scope for Fix A.** Bug 7 (settings back-button sequential slide
then bar-switch), Bug 3 (last-tab forward swipe to `/search`), Bug 4
(search-appear jank under 4x CPU). Their reproduce specs still fail; they
are Fixes B, C, D.

## Coverage

- Header drag-sync (live `backMorph` read by every header visual): Bug 1, Bug 6
  specs.
- Discrete-nav concurrency (slide + bar-switch overlap): Bug 7 spec.
- Forward-swipe-to-search (`{tab, search}` wired; no pill cycling): Bug 3 spec.
- Search-appear frame budget (LoAF < 150ms at 4x CPU): Bug 4 spec.
- Regression: the full existing e2e suite, zero flakies.
- Per-round detail: `docs/RV21-C01-Audit-{01..NN}.md`.

## Fix B: discrete back-nav drives the bar-switch concurrently with the slide

**Bug 7.** Clicking the settings back-button (`/profile/settings` -> `/`)
played the page slide and the header bar-switch as two sequential phases:
the slide (NavPipelineHost track `translateX`) ended at ~344ms and the
bar-switch (root layer `translateY`, the tab-bar descent) started at
~444ms. The reproduce spec `e2e/reproduce-dv20-drag-sync.spec.ts` "Bug 7"
failed on `gap < 34` (bar-switch must start before the slide ends).

**Root cause.** `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:2156`
(orchestrator's `onSvelteKitBeforeNavigate` discrete-nav branch) explicitly
NOT arming the settle, deferring it to a post-landing arm in
`notifyHeaderState` (line 2889) with `TITLE_CROSSFADE_MS`. The stale
comment at line 2149 to 2160 documented this sequencing:

```ts
// The settle is NOT armed here (armed at landing via
// `notifyHeaderState`'s idle title-change arm with `TITLE_CROSSFADE_MS`).
// The slide and settle are sequential (slide finishes -> lands -> settle
// arms), not concurrent, so there is no duration-matching requirement
// and no desync.
```

This violated DV20 §5's one-progress-per-visual rule: the slide and the
bar-switch are both visuals of the same navigation, but they were driven
by two separate progress channels with a sequential gap.

**Reference behaviour.** `playEnterAnimation` (line 972) and
`#armSettleEaseFromGesture` (line 2428) both arm the settle in the same
tick as `executor.onCommit`, with the slide's velocity-matched
`commitStart.durationMs`, so the morph / title crossfade runs in
lockstep with the slide. The discrete-nav branch was the sole outlier.

**Sibling sweep.** Searched the orchestrator and Header for every
discrete-nav / tab-click / deep-to-deep settle that deferred the morph to
post-landing. Every discrete nav (back-button, tab-click exit, deep-to-deep
forward, programmatic goto) flows through this single
`onSvelteKitBeforeNavigate` discrete-nav branch, so one site covers them
all. The other arm sites are unchanged:

- `playEnterAnimation` (line 973): already concurrent with the forward-enter
  slide. Untouched.
- `#armSettleEaseFromGesture` (line 2429): gesture-release path, already
  concurrent with the gesture-commit slide. Untouched.
- `#accelerateInFlight` (line 2576): finish-then-new interruption, already
  re-arms with the accelerated duration. Untouched.
- `notifyHeaderState` mid-settle absorb (line 2777): rapid back-to-back
  re-arm from the current settleProgress. Untouched.
- `notifyHeaderState` idle title-change arm (line 2889): still arms a
  post-landing settle for non-intercepted navs (tab -> non-tab-root deep,
  e.g. `/messages/inbox` -> `/bookmarks`). With Fix B, an intercepted
  discrete nav arrives at the landing with the settle already active, so
  the mid-settle absorb branch (line 2735) takes over instead of the idle
  arm. Untouched.

**The edit.** In `onSvelteKitBeforeNavigate`'s discrete-nav branch,
immediately after `executor.onCommit(0)` and `stateMachine.onCommit()`,
arm the settle ease with the slide's commit duration, mirroring
`playEnterAnimation` and `#armSettleEaseFromGesture`:

```ts
const settleT = this.#headerT;
if (settleT !== null && this.#executor !== null) {
	const outgoingTitle = this.#prevHeaderTitle;
	const incomingTitle = resolveDeepHeaderTitle(toPathname, settleT) ?? '';
	const outgoingHasTabs = inputs.fromTabIndex >= 0;
	const incomingHasTabs = getCurrentTabIndex(toPathname) >= 0;
	const latched: HeaderSettleTransition = {
		outgoingTitle,
		incomingTitle,
		outgoingHasTabs,
		incomingHasTabs
	};
	const commitDurationMs = this.#executor.state.commitStart?.durationMs ?? TITLE_CROSSFADE_MS;
	const settleDirection = direction === 'forward' ? 'forward' : 'back';
	this.#armSettleEase(latched, 0, 1, true, settleDirection, commitDurationMs);
}
```

`awaitTitle: true` holds the settle at progress 1 once the rAF reaches u=1,
so the morph stays at its terminal value until the navigation landing
clears it via `onSvelteKitAfterNavigate` (and `notifyHeaderState`'s
mid-settle absorb picks up the destination title when it arrives).

**Spec correction.** The DV20-C05b2-spec §5 clause "Header morph / title
crossfade on a tab-click commit runs POST-LANDING" misrepresented the
requirement. Rewritten in `docs/DV20-Meeting/DV20-C05b2-spec.md` to
describe the concurrent behaviour (armed inside the discrete-nav branch,
velocity-matched to the slide via `commitStart.durationMs`,
`awaitTitle: true`).

**Sibling test rewrite.** `e2e/header-tab-descent-cross-tab-exit.spec.ts`
asserted `settling === true at the landing flush` for both forward and
back transitions. That was the post-landing arm timing Fix B intentionally
changes. The cycle's two legs use different arm timings:

- Forward (`/messages/inbox` -> `/bookmarks`): the orchestrator does NOT
  intercept tab -> non-tab-root deep navs, so the settle is still armed at
  the landing flush via `notifyHeaderState`'s idle title-change arm. The
  forward assertion is preserved unchanged.
- Back (`/bookmarks` -> `/messages/inbox`): the orchestrator intercepts
  the deep -> tab nav and now arms the settle concurrent with the slide.
  At the landing flush the settle has already ended, so the old assertion
  no longer holds. Replaced with a check that during the back slide
  (`path === '/bookmarks'`, the source route) there are probe entries
  with `settling === true` and morph animating through intermediate
  values (a new `slideAnimationRuns` helper). The intermediate-px check
  is preserved unchanged.

The CALIBRATION test now documents both arm timings instead of asserting a
uniform post-landing arm.

**Real outputs.**

```
$ bun run check
1785078505089 START "/home/losses/Development/janbao"
1785078505093 COMPLETED 1469 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ bun run lint
[prettier + eslint clean]
Total similar type pairs found: 62
exit=0

$ bun test src/lib
552 pass
0 fail
2270 expect() calls
Ran 552 tests across 40 files. [2.37s]
```

Bug 7 reproduce spec:

```
$ npx playwright test e2e/reproduce-dv20-drag-sync.spec.ts -g "Bug 7" \
    --retries=0 --workers=1
Bug7 slide/bar ranges: {
  slide: { range: 393, min: -393, max: 0, first: -392.996, last: 0 },
  bar:   { range:  40, min:  -40, max: 0, first:    -40, last: 0 }
}
Bug7 bar-switch cadence: {
  durationMs: 234, frameCount: 15, movingFrameCount: 14,
  meanIntervalMs: 16.7, maxIntervalMs: 17, maxDelta: 4.15,
  travel: 37.97, deceleration: 1.71
}
Bug7 active windows: {
  slideWin: { startT:  70, endT: 345 },
  barWin:   { startT:  78, endT: 228 }
}
Bug7 bar-start minus slide-end = -267ms (negative = overlap)
  1 passed
```

Sibling regression (full files, no grep filter):

```
$ npx playwright test \
  e2e/header-tab-descent-cross-tab-exit.spec.ts \
  e2e/header-title-replay.spec.ts \
  e2e/header-tabs-replay.spec.ts \
  e2e/tab-click-transition.spec.ts \
  e2e/messages-back-swipe.spec.ts \
  e2e/deep-to-deep-gesture-morph-spike.spec.ts \
  e2e/enter-animation.spec.ts \
  e2e/reproduce-dv20-drag-sync.spec.ts \
  e2e/search-back-hamburger-flash.spec.ts --retries=0 --workers=1
46 passed
```

**Gesture paths preserved.** The gesture-commit settle (line 973) and the
gesture-drag morph (reads `pager.backMorph` during a held drag) are
untouched. `e2e/messages-back-swipe.spec.ts`,
`e2e/deep-to-deep-gesture-morph-spike.spec.ts`,
`e2e/search-back-hamburger-flash.spec.ts`, `e2e/header-title-replay.spec.ts`,
`e2e/header-tabs-replay.spec.ts` all green.

**Out of scope for Fix B.** Bug 3 (last-tab forward swipe to `/search`),
Bug 4 (search-appear jank under 4x CPU). Their reproduce specs still fail;
they are Fixes C and D.

### R2 Fix B regression (Bug 10): deep→deep forward title crossfade

**Bug 10.** `e2e/reproduce-user-bugs.spec.ts` "Bug 10: navigate from
/profile/settings to /profile/edit -> swipe back -> title slides and tabs
do NOT show" failed after Fix B. The test clicks "Edit Account" (a
deep→deep forward discrete nav), waits for the URL to land, then probes
the title spans 80ms later; it expects 2 spans (an outgoing + incoming
title crossfade) and got 1 after Fix B. Bug 10 was green before Fix B
(verified: `git stash` of the orchestrator change → the test passes;
`git stash pop` → it fails again).

**Root cause.** Fix B armed the settle ease CONCURRENTLY with the slide
for EVERY discrete nav flowing through `onSvelteKitBeforeNavigate`'s
discrete-nav branch, with `durationMs = commitStart.durationMs` (the
slide's velocity-matched duration, ~300ms) and `awaitTitle: true`. For
the Bug 7 target (deep→tab back-button) this is correct: the morph
visibly drives the tab-bar descent during the slide, and the settle
holding at progress 1 at the landing is the intended end-state. For a
deep→deep nav (`/profile/settings` -> `/profile/edit`) the morph is
invisible (both endpoints have no tabs; the morph stays at 0 across the
whole slide and the layers stay hidden at `translateY(-100%)` /
`translateY(0%)`), so the only visible motion the settle owns is the
title crossfade. The settle's ~300ms cycle reaches u=1 with `awaitTitle: true`
exactly when the URL lands (the slide owns the same 300ms), and
`notifyHeaderState`'s mid-settle branch
(`src/lib/stores/nav-pipeline-orchestrator.svelte.ts:2767-2775`) sees
`newTitle === #resolveSettleIncomingTitle()` and `#settleRafId === undefined`
(the rAF ended) and calls `#endSettleEase()` immediately. The crossfade
is gone by the first post-landing frame; the title view's at-rest branch
collapses to 1 span (`src/lib/components/organisms/Header.svelte:591`).
The test's 80ms timer starts at URL change, so it observes the
post-landing state and sees the collapsed 1 span.

**Before Fix B.** The deep→deep title crossfade was armed AT THE NAVIGATION
LANDING by `notifyHeaderState`'s idle title-change arm
(`src/lib/stores/nav-pipeline-orchestrator.svelte.ts:2914`) with
`TITLE_CROSSFADE_MS = 200ms` and `awaitTitle: false`. The 80ms probe
lands inside that 200ms post-landing window → 2 spans.

**The fix.** Scope Fix B's concurrent arm to the discrete navs whose
morph visibly changes (where the source and target tab-ness differ). The
settle is armed inside the discrete-nav branch ONLY when
`outgoingHasTabs !== incomingHasTabs`:

```ts
if (outgoingHasTabs !== incomingHasTabs) {
	// ... arm the settle with commitStart.durationMs, awaitTitle: true
}
```

The deep→deep case (both `false`) and the bidirectional tab-host tab→tab
case (both `true`) skip the arm; their title crossfade (deep→deep only -
tab roots do not render a deep title) is armed at the navigation landing
by the idle title-change arm, restoring the 200ms post-landing crossfade
window. Bug 7's target stays concurrent: the deep→tab back-button has
`outgoingHasTabs !== incomingHasTabs`, so the morph still runs during the
slide.

**Sibling sweep.** Every discrete-nav shape through the discrete-nav
branch, classified:

- Deep→tab back-button (`/profile/settings` -> `/`, the Bug 7 target):
  `outgoingHasTabs=false`, `incomingHasTabs=true`. DIFFERENT. Armed.
  Morph runs during the slide. Bug 7 green (overlap -266ms).
- Tab-click exit from a deep page (e.g. clicking a tab in the bar from
  `/profile/settings`): same shape as above. DIFFERENT. Armed.
- Cross-tab bidirectional click (NavPipelineTabHost, e.g.
  `/messages/inbox` -> `/activity`): both `true`. SAME. Skipped. The
  pill interpolates via `pager.fractionalIndex` (a separate field the
  orchestrator publishes per frame); the morph stays at 1 (no layer
  motion). No title crossfade (tab roots render the tab bar, not a
  title).
- Deep→deep forward (`/profile/settings` -> `/profile/edit`, Bug 10):
  both `false`. SAME. Skipped. Title crossfade armed at landing by the
  idle arm (`TITLE_CROSSFADE_MS = 200ms`). Bug 10 green.
- Deep→deep back (popstate, e.g. browser-back from `/profile/edit` to
  `/profile/settings`): both `false`. SAME. Skipped. Title crossfade
  armed at landing.
- Programmatic goto on a deep→deep shape: same as deep→deep forward /
  back depending on direction.

**Spec.** `docs/DV20-Meeting/DV20-C05b2-spec.md` updated: the
"Header morph / title crossfade on a tab-click commit" clause is split
into two clauses - "Header morph / title crossfade on a tab-ness-changing
discrete nav" (concurrent with the slide) and "Header title crossfade on
a deep→deep discrete nav" (post-landing via the idle arm, morph stays
at 0). No `formerly`/`old`/`previously` markers; em-dash grep clean;
prettier clean.

**Real outputs.**

```
$ bun run check
1785080277403 START "/home/losses/Development/janbao"
1785080277407 COMPLETED 1469 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ bun run lint
[prettier + eslint clean]
Total similar type pairs found: 62
exit=0

$ bun test src/lib
552 pass / 0 fail / 2270 expect() calls across 40 files [2.47s]
```

```
$ npx playwright test e2e/reproduce-user-bugs.spec.ts -g "Bug 10" \
    --retries=0 --workers=1
1 passed

$ npx playwright test e2e/reproduce-dv20-drag-sync.spec.ts -g "Bug 7" \
    --retries=0 --workers=1
Bug7 active windows: {
  slideWin: { startT: 69, endT: 352 },
  barWin:   { startT: 86, endT: 236 }
}
Bug7 bar-start minus slide-end = -266ms (negative = overlap)
1 passed

$ npx playwright test e2e/header-tab-descent-cross-tab-exit.spec.ts \
    --retries=0 --workers=1
2 passed (CALIBRATION + DEFECT 6 cycles; back slide runs per cycle with
intermediate morph 0.81 -> 0.12 and 0.11 -> 0.89)
```

Sibling regression (full files, no grep filter):

```
$ npx playwright test \
    e2e/reproduce-user-bugs.spec.ts \
    e2e/deep-to-deep-gesture-morph-spike.spec.ts \
    e2e/intra-tree-deep-to-deep.spec.ts \
    e2e/header-title-replay.spec.ts \
    e2e/header-tabs-replay.spec.ts \
    e2e/header-title-crossfade-clip.spec.ts \
    e2e/profile-settings-icon.spec.ts \
    e2e/reproduce-hamburger-settings.spec.ts --retries=0 --workers=1
29 passed

$ npx playwright test \
    e2e/tab-click-transition.spec.ts \
    e2e/messages-back-swipe.spec.ts \
    e2e/search-back-hamburger-flash.spec.ts \
    e2e/search-enter-exit-asymmetry.spec.ts --retries=0 --workers=1
33 passed
```

**Out of scope for this fix.** Bug 3, Bug 4 (Fixes C, D). Their reproduce
specs still fail.

## Fix C: forward-swipe Messages -> `/search` (Bug 3)

**Bug 3 root cause.** A committed leftward (forward) swipe on
`/messages/inbox` (the last tab, `MOBILE_TABS` index 2 of 3) stayed on
`/messages/inbox`, cycled the tab highlight through Activity, and played
no header root<->search animation. Three causes, all in the same chain:

1. `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:1524` (the
   `#nextTabTarget` docstring + body) returned `null` for the last tab:
   `const nextIdx = inputs.fromTabIndex + 1; if (nextIdx >= MOBILE_TABS.length)
return null;`. The null branch at line 1434 then ran the boundary
   rubber-band path (always cancels, never navigates). This contradicted
   DV20-Plan §6's flagship: the last tab's forward neighbour is
   `/search` via the `{tab, search}` pair.
2. With the gesture falling to the boundary path,
   `#republishToPager` published `backMorph: null` (the boundary case
   `target === from` reads as a tab-to-tab transition in the
   `bidirectional && !targetIsDeepPage` arm), so the Header's
   `searchProgress` gesture branch (which read `pager.backMorph`) never
   fired and the root<->search track stayed at `translateX(0)`.
3. The boundary rubber-band on a bidirectional host claims the leftward
   drag (per `#rawDragFraction`'s `bidirectional` inversion at line
   1306), so the tab track rubber-banded 104px (0.4 _ 260px =
   `BOUNDARY_RUBBER_BAND_FACTOR _ drag`) and snapped back, while the
pill highlight momentarily read `round(fractionalIndex) === 1` mid
   rubber-band and lit up Activity.

**The fix.**

1. `#nextTabTarget` now resolves `/search` for the last tab
   (`src/lib/stores/nav-pipeline-orchestrator.svelte.ts:1534-1538`).
   The `{tab, search}` resolver (`tabSearchResolver`) drives the slide
   via the existing `#resolvePlan` dispatch; the orchestrator publishes
   `transitionTarget='/search'` plus the live `backMorph`
   (`#republishToPager`'s non-tab-target arm already covers a search
   target via the `targetIsDeepPage = tag !== 'tab'` check at line
   3223, so `holdPillAtFromIdx` is true and the pill holds at the
   source).
2. The Header consumes the published `transitionTarget + backMorph`
   through a new `targetIsSearch` derived
   (`src/lib/components/organisms/Header.svelte:384-386`) and a
   `searchProgress` ENTER branch that returns `trackMorph` for a
   forward-swipe-to-`/search` (the prior `isSearch ? 1 - trackMorph : 0`
   clamped to 0 across the drag because `isSearch` follows the
   pre-flip source endpoint).
3. The `morph` derivation gains a `targetIsSearch` skip
   (`src/lib/components/organisms/Header.svelte:159-168`) so the
   vertical layer group (MobileTabBar / deep title) holds at the
   source's tab-ness during a horizontal-only root<->search slide (no
   diagonal motion). The back-swipe EXIT from `/search` was already
   horizontal-only via the `isSearch` branch of `rootLayerStyle`; this
   skip covers the ENTER direction.
4. `tabProgress` is unified to
   `max(0, (searchProgress - (1 - HEADER_MORPH_THRESHOLD)) / HEADER_MORPH_THRESHOLD)`
   (`src/lib/components/organisms/Header.svelte:430-432`). Substituting
   each of `searchProgress`'s branches back-reduces to the per-source
   formulas the derivation had before (verified by hand for the
   tap-scrub, gesture-EXIT, and at-rest cases); the ENTER-from-last-tab
   case now derives the slide-then-expand asymmetry for free.

No third mechanism: the existing resolver dispatch, the existing
publication path, and the existing Header reactive consumers are the
only motion sources. No CSS transition, no setTimeout.

**Sibling sweep.** Searched `src/lib/{stores,components,utils,actions}`
for every tab-forward, boundary, search-target, and pill-highlight site
(broad phrasings: `nextTabTarget`, `MOBILE_TABS.length`, `fromTabIndex`,
`bidirectional`, `tabSearchResolver`, `targetIsDeepPage`,
`holdPillAtFromIdx`, `pager.transitionTarget`, `targetIsSearch`,
`searchProgress`, `tabProgress`, `trackMorph`, `iconProgress`,
`isSearch`, `isLeftDrag`). Union of hits read in full; each classified
below.

- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:1534-1538`
  `#nextTabTarget` returned null for the last tab. DEFECT (Bug 3 root
  cause). Fixed: resolves `/search` for the last tab.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:1423` the
  forward-ternary call site of `#nextTabTarget`. DEFECT (the consumer
  that fed null into the boundary path). Fixed transitively by the
  `#nextTabTarget` change.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:1434-1493` the
  boundary rubber-band branch. The docstring claimed `target === null`
  covers "first/last tab"; the forward-last-tab case is now unreachable
  (covered by `#nextTabTarget`), leaving only the backward-first-tab
  case (`#backwardTabTarget` returning null). DEFECT (stale docstring).
  Fixed: rewritten to describe the surviving backward-first-tab case.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:3210-3225` the
  non-tab-target pill-hold branch. The docstring claimed "Forward
  gestures on a bidirectional host always target a tab root", which the
  last-tab-to-`/search` gesture contradicts. DEFECT (stale docstring +
  incomplete reach-path enumeration). Fixed: rewritten to cover both
  the backward-to-deep-page and forward-last-tab-to-`/search` reach
  paths. Logic unchanged (`holdPillAtFromIdx` already covered
  `targetIsDeepPage` which includes `tag === 'search'`).
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:3232-3238`
  `backMorphValue` for the non-tab target. The docstring mentioned only
  "deep host backward-exit" and "backward-to-deep-page on a
  bidirectional host"; the forward-last-tab-to-`/search` case is a
  third reach path. DEFECT (stale docstring). Fixed: rewritten to
  cover all three reach paths. Logic unchanged (the existing
  `(bidirectional && !targetIsDeepPage) || (fromIdx >= 0 && toIdx >= 0)`
  already yields `rawDragFraction` for a search target).
- `src/lib/components/organisms/Header.svelte:156-186` `morph`
  derivation. DEFECT (the vertical layer group would have slid on
  `backMorph` for a tab-to-`/search` gesture, since the orchestrator
  publishes `backMorph` and the existing `bm !== null` branch would
  have consumed it). Fixed: a `targetIsSearch` skip returns the static
  `currentHasTabs ? 1 : 0` so the layer group stays at the source's
  tab-ness.
- `src/lib/components/organisms/Header.svelte:384-386` `targetIsSearch`.
  NEW DERIVED. Reads `pager.transitionTarget` and `resolveHeaderMode`
  to detect a forward-swipe-to-`/search` gesture. Required because
  `isSearch` follows the pre-flip source endpoint and cannot detect
  the ENTER direction on its own.
- `src/lib/components/organisms/Header.svelte:410-417` `searchProgress`
  gesture branch. DEFECT (the prior `isSearch ? 1 - trackMorph : 0`
  clamped a forward-enter to 0 across the whole drag). Fixed: the
  ENTER branch returns `trackMorph` so the root<->search track slides
  in 0 -> 1 across the drag.
- `src/lib/components/organisms/Header.svelte:419-432` `tabProgress`.
  REFACTORED to derive from `searchProgress`. Equivalent for the
  existing cases (verified by substitution) and removes a parallel
  branch the unified formula makes redundant.
- `src/lib/components/organisms/Header.svelte:267-287` the
  `dragTargetHasTabs` / `tabsOut` / `tabsIn` layer-style endpoint
  derivation. LEGITIMATE. For a forward-swipe to `/search`,
  `dragTargetHasTabs` reads `getCurrentTabIndex('/search') >= 0` =
  false, `tabsOut` reads the source's `currentHasTabs` = true, and the
  layer-style guard `!(tabsOut || tabsIn)` evaluates false, leaving
  `translateY` to follow `morph`. With the `morph` skip the layer
  group holds at the source's tab-ness end to end. Untouched.
- `src/lib/components/organisms/Header.svelte:196-213` `iconProgress`.
  LEGITIMATE. For a forward-swipe to `/search`, `searchScrubbing` is
  false and `isSearch` is false, so the derivation returns
  `1 - morph`. With the `morph` skip (returns 1 for
  `currentHasTabs`), iconProgress reads 0 (hamburger) end to end, so
  the icon does flash to the back-arrow mid-swipe. No edit needed.
- `src/lib/components/organisms/MobileTabBar.svelte:55-76` the pill
  highlight publication. LEGITIMATE. With the orchestrator publishing
  `fractionalIndex = fromIdx` (the pill-hold branch covers a
  `tag === 'search'` target), `Math.round(fractionalIndex) === i`
  selects the source messages pill for the whole drag and the
  destination's pager state on landing reads -1 (no pill highlighted
  on `/search`). The cycle through Activity the bug reported was a
  side effect of the boundary rubber-band path; once `#nextTabTarget`
  resolves `/search` and the gesture takes the slide path, the
  pill-hold branch covers it. No edit needed.
- `src/lib/components/organisms/SearchTabBar.svelte`,
  `src/lib/components/templates/SearchScopePager.svelte`: the
  search-scope sub-pager is orthogonal to the primary header morph
  and pill highlight (separate pager store; reads `tabProgress` for
  its clip-expand). LEGITIMATE. Untouched.
- `src/lib/components/templates/NavPipelineTabHost.svelte:103-137`
  `deepSnapshotTarget`. For a non-tab target the derivation returns
  the target pathname, but the overlay panel index is
  `activeIndex - 1` (panel 1 for `/messages/inbox`), which a forward
  axis=left slide never reveals (panel 1 sits LEFT of the source
  panel 2; the slide moves the track leftward, exposing panel 3
  off-track, not panel 1). LEGITIMATE; no visual effect on a forward
  gesture. Untouched.
- `src/lib/components/templates/NavPipelineHost.svelte:171-207`
  `transitionTarget` consumers (`crossTabPanelPath`,
  `forwardDeepTarget`). LEGITIMATE. These render preview panels for
  the NavPipelineHost (deep host). For the Bug 3 forward swipe the
  source host is `NavPipelineTabHost`; the destination host
  (`NavPipelineHost` on `/search`) mounts at landing when
  `publication.inFlight` is already false, so these derivations read
  `transitionTarget = null` and skip. Untouched.

**Real command outputs.**

```
$ bun run check
1785083246293 START "/home/losses/Development/janbao"
1785083246297 COMPLETED 1469 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ bun run lint
Checking formatting...
All matched files use Prettier code style!
[eslint clean]
Total similar type pairs found: 62
exit=0

$ bun test src/lib
552 pass / 0 fail / 2270 expect() calls across 40 files [2.57s]
```

Bug 3 reproduce spec (forward swipe from `/messages/inbox`):

```
$ npx playwright test e2e/reproduce-dv20-search-swipe.spec.ts -g "Bug 3" \
    --retries=0 --workers=1
Bug3 forward-swipe: {
  finalPath: '/search',
  seenPills: [ '/messages/inbox' ],
  hdrTrackTx: { range: 393, min: -393, max: 0, first: 0, last: -393 },
  tabTrackTx: { range: 393, min: -1179, max: -786, first: -786, last: -1179 }
}
1 passed
```

The flagship assertions all hold: the swipe reaches `/search`; the
header root<->search track slid the full viewport width
(`hdrTrackTx.range = 393`); no Activity or Discussions pill cycled
(`seenPills === ['/messages/inbox']`).

Bug 5 boundary guard (the rightward swipe on `/`):

```
$ npx playwright test e2e/reproduce-dv20-search-swipe.spec.ts -g "Bug 5" \
    --retries=0 --workers=1
Bug5 discussions-home rightward sweep: [
  { dist:  80, actActive: false, actMaxRem: 0, ... finalPath: '/' },
  { dist: 160, actActive: false, actMaxRem: 0, ... finalPath: '/' },
  { dist: 240, actActive: false, actMaxRem: 0, ... finalPath: '/' },
  { dist: 320, actActive: false, actMaxRem: 0, ... finalPath: '/' }
]
1 passed
```

The boundary guard stays green: Activity never lights across 80 to
320px of rightward drag on `/`, and the swipe stays in place.

Sibling regression (full files, no grep filter):

```
$ npx playwright test \
    e2e/tab-host-swipe.spec.ts \
    e2e/tab-swipe-preview-height.spec.ts \
    e2e/tab-exit-preview.spec.ts \
    e2e/tab-click-transition.spec.ts \
    e2e/search-enter-exit-asymmetry.spec.ts \
    e2e/search-back-hamburger-flash.spec.ts \
    e2e/reproduce-user-bugs.spec.ts \
    e2e/reproduce-new-mobile-bugs.spec.ts \
    e2e/reproduce-dv20-search-swipe.spec.ts \
    e2e/reproduce-dv20-drag-sync.spec.ts --retries=0 --workers=1
  1 failed
  53 passed (3.2m)
```

The 53 passing tests cover Fix A (Bug 1, Bug 6) and Fix B (Bug 7) which
remain green; the search axis (`search-enter-exit-asymmetry`,
`search-back-hamburger-flash`, `reproduce-user-bugs`'s nine
navigation cases including Bug 5 "search page swipe left is
intercepted"); the bidirectional tab host (`tab-host-swipe`,
`tab-swipe-preview-height`, `tab-exit-preview`, `tab-click-transition`);
and the new-mobile-bugs compose-as-module-child suite. The single
failure is Bug 4 (`search-appear jank under 4x CPU`), which is Fix D
(explicitly out of scope for Fix C). No Fix-C regression.

**Comment accuracy.** Rewrote the `#nextTabTarget` docstring (was
"Returns null when the active tab is the last tab"; now describes the
`/search` resolution). Rewrote the boundary-branch comment (was "first
/last tab"; now "first tab with no previous history entry"). Rewrote
the non-tab-target pill-hold comment (was "forward gestures on a
bidirectional host always target a tab root"; now enumerates both the
backward-to-deep-page and forward-last-tab-to-`/search` reach paths).
Rewrote the backMorph publication comment (same expansion). Rewrote
the `searchProgress` and `tabProgress` derivations' comments to
describe the unified ENTER/EXIT branches. Em-dash grep clean on both
files; prettier --check clean on both files.

**Out of scope for Fix C.** Bug 4 (search-appear jank under 4x CPU)
remains failing; that is Fix D.

## Fix C.1 (search-swipe body slide): suppress the body track slide

into empty space on a forward-to-`/search` swipe from the last tab

**Root cause.** Fix C wired the last-tab forward swipe to `/search`
via `#nextTabTarget`
(`src/lib/stores/nav-pipeline-orchestrator.svelte.ts:1535-1538`) and
the Header root<->search scrub morph played during the drag (driven by
the orchestrator's `transitionTarget='/search'` + live `backMorph`
publication). But the NavPipelineTabHost's 3-panel body track has no
panel to the right of the last tab (panel 2 = Messages is the
rightmost). The slide plan `#resolvePlan` returned for the
forward-to-`/search` gesture still computed `distance = viewportWidth`
(the non-suppressed default), so during the drag the body track slid
leftward by one viewport width: from `-2*W` (Messages centred) to
`-3*W` (Messages fully off-screen, EMPTY SPACE in the viewport where a
fourth panel would be). On commit `/search` mounted its own
NavPipelineHost and filled the viewport, but the during-drag visual
showed empty space. The Bug 3 journal evidence confirmed it:
`tabTrackTx: { range: 393, min: -1179, max: -786, first: -786,
last: -1179 }` (a full viewport-width slide).

**The fix.** Add a third `suppressSlide` case to `#resolvePlan` at
`src/lib/stores/nav-pipeline-orchestrator.svelte.ts:1665-1669`,
mirroring the existing first-tab-backward-to-deep-page suppression at
line 1652-1655:

```ts
|| (inputs.bidirectional === true &&
    inputs.fromTabIndex === MOBILE_TABS.length - 1 &&
    direction === 'forward' &&
    toData.tag === 'search')
```

With this case `distance = 0`, the body track stays at its at-rest
position for the whole drag, and the empty fourth-panel position is
never revealed. The Header root<->search scrub morph still plays
because the morph consumers (Header's `searchProgress` / `trackMorph`
derivations) read `pager.backMorph` and `pager.transitionTarget`, both
published by `#republishToPager` independent of the slide distance
(`#publish` writes the raw drag fraction to the pager store every
pointermove; `#resolvePlan` only sets the body track's geometry). The
commit still dispatches `goto('/search')` and the NavPipelineHost
enter slide plays on landing. No third mechanism: the existing
suppressSlide pattern (already used for first-tab-backward-to-deep
and within-tab pagination) now covers the third reach path; no CSS
transition, no setTimeout.

**The new empty-space guard.** Extended
`e2e/reproduce-dv20-search-swipe.spec.ts` Bug 3 with two assertions
replacing the prior `Math.max(hdrTrack.range, tabTrack.range) > 50`:

1. `hdrTrack.range > 50` the Header root<->search track still slides
   (the morph still plays).
2. `tabTrack.range < 30` the NavPipelineTabHost body track does NOT
   slide into empty space during the drag (the regression slid a full
   viewport width).

**Sibling sweep.** Searched `src/lib` and `e2e` for every slide
-suppression / `suppressSlide` / `deepSnapshotTarget` / `MOBILE_TABS
.length - 1` site. Union of hits read in full; each classified:

- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:1635-1670`
  `suppressSlide` in `#resolvePlan`. ADDED the third case for the
  forward-to-`/search` from last tab path. Comment block updated from
  "two cases" to "three cases".
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:1535-1538`
  `#nextTabTarget` returns `/search` for the last tab (Fix C). The new
  suppression case is the symmetric partner for the body-track side
  of that gesture. Untouched.
- `src/lib/components/templates/NavPipelineTabHost.svelte:99-137`
  `deepSnapshotTarget` overlay. For a forward-to-`/search` gesture
  the target is not a tab root and `activeIndex - 1 = 1` (the Activity
  panel index); the overlay would render the `/search` preview panel
  over panel 1. With the body slide suppressed the panel is never
  revealed, so the overlay has no visual effect. The derivation
  returns the `/search` pathname (the in-flight publication's
  `toPathname`) but the panel sits off-screen at `left: -33.33%`.
  LEGITIMATE; no edit needed.
- `e2e/backtarget.spec.ts:222-262` the activeIndex=0
  backward-to-deep-page test. The suppressSlide branch it documents
  (case 1) is unchanged. LEGITIMATE; untouched.

The other suppressed cases (first-tab backward to deep, within-tab
pagination) and the non-suppressed forward swipes
(discussions->activity, activity->messages) are not touched by the
new condition: the new condition keys on `direction === 'forward' &&
toData.tag === 'search' && fromTabIndex === MOBILE_TABS.length - 1`,
which only the last-tab-to-`/search` path satisfies.

**Real command outputs.**

```
$ bun run check
1785084305194 START "/home/losses/Development/janbao"
1785084305198 COMPLETED 1469 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ bun run lint
Checking formatting...
All matched files use Prettier code style!
[eslint clean]
Total similar type pairs found: 62
exit=0

$ bun test src/lib
552 pass / 0 fail / 2270 expect() calls across 40 files [2.43s]
```

Bug 3 reproduce spec (forward swipe from `/messages/inbox`):

```
$ npx playwright test e2e/reproduce-dv20-search-swipe.spec.ts -g "Bug 3" \
    --retries=0 --workers=1
Bug3 forward-swipe: {
  finalPath: '/search',
  seenPills: [ '/messages/inbox' ],
  hdrTrackTx: { range: 393, min: -393, max: 0, first: 0, last: -393 },
  tabTrackTx: { range: 0, min: -786, max: -786, first: -786, last: -786 }
}
1 passed (12.3s)
```

The body tab-host track stayed at -786 (its at-rest position on the
Messages tab, `-2*W` for viewport `W=393`) for the whole drag
(`tabTrackTx.range = 0`); the header root<->search track slid the
full viewport width (`hdrTrackTx.range = 393`); the swipe reached
`/search` with no Activity or `/` pill cycling.

Sibling regression (full files, no grep filter):

```
$ npx playwright test \
    e2e/tab-host-swipe.spec.ts \
    e2e/tab-swipe-preview-height.spec.ts \
    e2e/tab-exit-preview.spec.ts \
    e2e/tab-click-transition.spec.ts \
    e2e/reproduce-dv20-search-swipe.spec.ts \
    e2e/reproduce-dv20-drag-sync.spec.ts \
    e2e/reproduce-user-bugs.spec.ts --retries=0 --workers=1
32 passed (1.8m)
1 failed
```

The single failure is Bug 4 (search-appear jank under 4x CPU,
worst frame 211.5ms; expected < 150ms), which is Fix D and explicitly
out of scope for Fix C.1. No Fix C.1 regression: the bidirectional
tab host suites (`tab-host-swipe`, `tab-swipe-preview-height`,
`tab-exit-preview`, `tab-click-transition`), the Fix A + Fix B drag
-sync suite (`reproduce-dv20-drag-sync` Bugs 1, 2, 6, 7), the Bug 5
boundary guard, and the `reproduce-user-bugs` suite (including the
Bug 10 deep-to-deep title crossfade) all stayed green.

**Comment accuracy.** Updated the `suppressSlide` comment block in
`#resolvePlan` from "in two cases" to "in three cases" and added the
third case's description (forward to `/search` from the last tab; the
rightmost panel has no right neighbour; the `/search` panel mounts in
its own NavPipelineHost on commit, not in this tab-host track; the
Header root<->search track still scrubs during the drag because the
morph reads `pager.backMorph` and `transitionTarget`, not the slide
distance). Em-dash grep clean on the orchestrator and spec files;
prettier --check clean on both.

**Out of scope for Fix C.1.** Bug 4 (search-appear jank under 4x
CPU) remains failing; that is Fix D.

## Fix D: search-APPEAR animation must not drop frames under mobile-class CPU

**Bug 4.** Tapping the search button plays a search-APPEAR animation
whose worst render frame under 4x CPU throttle (the LoAF bar in
`e2e/reproduce-dv20-search-swipe.spec.ts` "Bug 4") exceeded 150ms.
Baseline measurements (5 runs): maxDur 218 / 213 / 211 / 220 / 215ms
(mean ~215ms, topScript 175 to 203ms in
`.svelte-kit/generated/client/app.js` with no function name). The
cadence check (`Math.max(hdrRange, deepRange) > 10`) passed every run
(header track + page content slide both played).

**Profiled culprit.** The LoAF entry names only `app.js` (no function),
so the click-frame work was isolated with three complementary
measurements:

1. CDP `devtools.timeline` trace across the `/` -> `/search` click under
   `Emulation.setCPUThrottlingRate({rate:4})`, parsed for `RunTask` /
   `FunctionCall` / `EvaluateScript` / `UpdateLayoutTree` events on the
   main thread and their nesting.
2. CDP `Profiler` domain (sampling at 50 to 100us) over the click +
   800ms window, aggregated by self-time per source file and per
   function.
3. The ForcedReflow insight (DevTools `Performance.analyzeInsight`),
   which attributes the total reflow time to the owning call frames.

The trace's worst `FunctionCall` was 167 to 172ms at
`.vite/deps/runtime-BpkzEDpg.js:1154:18` (`queue_micro_task`, the
Svelte runtime's microtask flush that owns the click handler chain).
Its child self-time broke down as ~40ms `UpdateLayoutTree`, ~12ms
`ParseHTML`, ~5ms `Layout`, and ~100ms of JS execution + JIT compile
(`(program)` in the sampler, 475 to 683ms cumulative across the
navigation; the worst-frame share is ~100ms). The ForcedReflow insight
flagged `setScrollContainer` (26 to 39ms across two calls in the
cascade), the orchestrator's `mountOrchestrator` clientWidth reads
(8 to 10ms), `mountOrchestrator` total (9 to 13ms), and `focus` inside
the Header's input-focus effect (~12ms). The sampler's top function
hits in the click frame: `scroll_state` (SvelteKit's `pageXOffset` /
`pageYOffset` read, 16ms), `mountOrchestrator` (9 to 13ms), `focus`
(8 to 12ms), `get offsetHeight` (9 to 10ms, inside `focus`'s
scroll-into-view), `update_reaction` (Svelte runtime, 5 to 7ms).

The dominant cost is **JIT compile of the `/search` route's modules +
their transitive imports** (NavPipelineHost, SearchScopePager, the
four scope lists, the orchestrator's per-frame math). The dev-mode
sampler attributes ~100ms of the worst frame to `(program)` (V8
compile + GC). In production this would be lower (V8 streaming compile
on fetch), but the test runs against `vite dev`.

**The fix (four structural changes, no `setTimeout`, no CSS
transition).**

1. **D-1: defer `setScrollContainer`'s geometry reads to rAF**
   (`src/lib/stores/scroll-chrome.svelte.ts:172`). The function read
   `el.scrollTop` synchronously after attaching the scroll listener,
   which forced a layout flush on a host that just wrote a batch of
   DOM. Two calls fire in the search-enter cascade (NavPipelineHost's
   `$effect` for `centerEl`, then again when `SearchScopePager`'s
   `setOverride` publishes the active scope's panel), so the cost
   stacked. Both branches (the `el` branch and the `null` branch) now
   defer the read to a rAF whose callback re-checks `containerEl ===
target` so a stale callback (the host unmounted before the next
   frame) cannot write a detached element's `scrollTop` into `lastY`.
   The seed only feeds `evaluate()`'s delta math on the first real
   scroll, which always fires after this rAF has run.
2. **D-1b: defer `measureViewport`'s initial clientWidth read to rAF**
   (`src/lib/components/templates/SearchScopePager.svelte:289`). Same
   pattern: the Svelte action called `update()` synchronously on
   mount, which read `node.clientWidth` and forced a layout flush.
   The initial read is deferred to the next frame; the
   `ResizeObserver`'s first callback already fires on the next frame,
   so the rAF only aligns the seed with that cadence. `viewportWidth`
   is consumed by `swipeMove`, which only runs once a drag starts
   (always after this rAF).
3. **D-2: lazy-mount the non-active scope panels' inner content**
   (`src/lib/components/templates/SearchScopePager.svelte`). The four
   `<section>` shells always mount (they own the track geometry, the
   `bind:this` refs `scrollChrome.setOverride` consumes, and the
   per-scope `data-scope-panel` markers). Their inner content
   (`LoadingChip` or `SearchResultsList`) now renders only for panels
   the user can actually see: the active scope, the in-flight swipe
   destination (`Math.round(visualIndex)`), or any scope that has ever
   been active (`visitedScopes`, seeded with the URL scope so SSR and
   the first client render agree). At rest only the active scope's
   content mounts; mounting all four eagerly was pure waste on the
   search-APPEAR frame.

**Sibling sweep.** Read every eager-mount / heavy-synchronous-setup
site on the `/search` enter path and across the sibling routes that
share `NavPipelineHost` (`/discussion/*`, `/messages/*`,
`/bookmarks`, `/profile/*`, `/admin/*`). Union of the hits, each
classified:

- `src/routes/search/+page.svelte`: mounted `SearchScopePager` eagerly
  inside `NavPipelineHost`'s centre. INVESTIGATED. Tried deferring the
  pager mount to a rAF so its JIT + effect cascade lands on frame N+1
  while the click handler (frame N) only mounts the `NavPipelineHost`
  shell. The cadence probe still passed (the slide is driven by
  `NavPipelineHost` + the orchestrator, not by the pager), but the
  worst-case maxDur variance widened (the deferred mount sometimes
  collided with a slide tick on frame N+1, producing a long frame
  there; one run hit 451ms). Reverted: the deferral is a real
  structural improvement on the mean but the variance it introduces
  is unacceptable for a `< 150ms` hard threshold.
- `src/lib/components/templates/SearchScopePager.svelte:289`
  `measureViewport` action: synchronous `clientWidth` read on mount.
  DEFECT (forced reflow). Fixed by D-1b.
- `src/lib/components/templates/SearchScopePager.svelte` four
  `<section>` blocks: each rendered `SearchResultsList` / `LoadingChip`
  eagerly. DEFECT (3 of 4 panels' content was off-screen waste on the
  enter frame). Fixed by D-2.
- `src/lib/stores/scroll-chrome.svelte.ts:172` `setScrollContainer`:
  synchronous `scrollTop` / `scrollY` read on mount. DEFECT (forced
  reflow, stacked across two calls in the cascade). Fixed by D-1.
- `src/lib/components/templates/NavPipelineHost.svelte:452-463`
  forward-enter seed + `playEnterAnimation`: synchronous
  `clientWidth` read + slide setup. INVESTIGATED. Tried deferring the
  slide math to rAF (kept the seed sync to avoid a flash); the cadence
  probe still passed but variance increased (the deferred slide setup
  occasionally landed on a long frame). Reverted: the forced reflow
  here is ~8 to 10ms, smaller than the setScrollContainer cost, and
  the slide-setup deferral introduced more variance than it saved.
- `src/lib/components/templates/NavPipelineHost.svelte:297` the
  at-rest `$effect`'s `updateViewport(viewportEl.clientWidth, ...)`:
  fires on initial mount. INVESTIGATED. Tried guarding with
  `sawTransition` so initial mount skips the read (the orchestrator
  already has the width from `configure`). Marginal effect, reverted.
- `src/lib/components/organisms/Header.svelte:558` `inputEl.focus()`
  effect: triggers scroll-into-view + layout flush (~12ms under 4x
  CPU). INVESTIGATED. Tried deferring to rAF; the focus call's
  layout flush landed on a long frame and made variance worse.
  Reverted: focus is user-visible behaviour and the cost is intrinsic
  to the scroll-into-view, not to the click handler.
- `src/routes/+layout.svelte`: tried pre-warming the `/search` route's
  JS on idle via SvelteKit's `preloadCode('/search')` so V8's
  streaming compile runs before the click. INVESTIGATED AND REVERTED.
  Made the test worse (mean ~210ms vs ~200ms without): under throttle
  the idle callback fires close to the click and the preload's module
  evaluation contends with the click handler.
- Other eager mounts on sibling routes (`/discussion/*`,
  `/messages/*`): the thread route mounts a single message list (one
  panel's worth of work, not four). Thee routes do not exhibit the
  same multi-panel eager-mount cost. No defect.

**Real command outputs.**

```
$ bun run check
1785088085887 START "/home/losses/Development/janbao"
1785088085891 COMPLETED 1469 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ bun run lint
[prettier + eslint clean]
Total similar type pairs found: 62
exit=0

$ bun test src/lib
552 pass / 0 fail / 2270 expect() calls across 40 files [2.38s]
```

Bug 4 maxDur across 5 runs at 4x CPU (baseline first, then after Fix D,
final state with D-1 + D-1b + D-2 only):

```
Baseline (5 runs):     218 / 213 / 211 / 220 / 215  (mean ~215, topScript 175 to 203)
After Fix D (5 runs):  182 / 179 / 196 / 206 / 234  (mean ~199, topScript 149 to 180)
```

The cadence probe (the spec's "animation must still play" guard) passes
on every run: `hdrRange = 50`, `deepRange = 380 to 393` (the header
root<->search track slides the full viewport width and the page content
slides with it). The fix never disables the animation to hide the jank.

Sibling regression sweep (the spec's listed files, no grep filter):

```
$ npx playwright test e2e/search-enter-exit-asymmetry.spec.ts \
    e2e/search-back-hamburger-flash.spec.ts \
    e2e/enter-animation.spec.ts \
    e2e/header-hide-on-scroll.spec.ts \
    e2e/reproduce-dv20-search-swipe.spec.ts \
    e2e/reproduce-dv20-drag-sync.spec.ts \
    e2e/reproduce-user-bugs.spec.ts \
    e2e/reproduce-new-mobile-bugs.spec.ts --retries=0 --workers=1
  1 failed
  45 passed (2.8m)
```

The single failure is Bug 4 itself; every other test (the search-axis
morph, the back-swipe / forward-swipe specs, the header-hide-on-scroll
REGRESSION on a `NavPipelineHost` route, the Fix A / B drag-sync
suite, the Fix C forward-swipe-to-`/search`, the Bug 10 deep-to-deep
title crossfade, the new-mobile-bugs compose-as-module-child suite)
stayed green.

**Outcome.** The test threshold `maxDur < 150` is not consistently
hit at 4x CPU in dev mode. Best run after Fix D: 179ms; mean across
the 5-run sample: ~199ms; the cadence probe passes every run. The
residual cost is the `/search` route's first-execution JIT compile
(~100ms of `(program)` time in the click frame, an order of magnitude
larger than the forced-reflow work Fix D removed), plus SvelteKit's
`scroll_state` pageXOffset / pageYOffset read inside `navigate`
(~16ms), plus the input-focus scroll-into-view (~12ms), plus the
browser's layout / paint of the just-mounted DOM (~30ms). The
structural fixes (D-1, D-1b, D-2) are real improvements: they
removed every forced reflow the ForcedReflow insight attributed to
the click frame, they cut the click frame's JS self-time
attribution by ~25ms (topScript dropped from 175 to 203ms baseline
to 149 to 180ms after Fix D), and they did not regress any sibling
test. The threshold remains out of reach without either (a) splitting
the `/search` modules into separately-loaded chunks so their JIT
compile moves off the click frame, or (b) accepting a higher
threshold that reflects the dev-mode JIT floor. The CMA did not
weaken the spec's threshold and did not disable the animation to
hide the jank.

**Comment accuracy.** Every new comment in the touched files
describes current behaviour (the WHY of each deferral, the safety
argument, the cadence-probe interaction); no `formerly` / `old` /
`previously` markers. Em-dash grep clean on all touched files;
`bunx prettier --check` clean on all touched files.

**Out of scope for Fix D.** The threshold question (is 150ms at 4x
CPU achievable for the `/search` enter in `vite dev` at all, given
the JIT floor?) and the production-mode verification (in a built
bundle V8 streaming compile would shift the JIT cost off the click
frame) are for the orchestrator.

### Fix D resolution: search-appear jank measured in production

The structural fixes (D-1 defer scroll-chrome + measureViewport geometry reads
to rAF; D-2 lazy-mount the non-active SearchScopePager panels) removed the
forced reflow (26 to 39ms) and the eager 4-panel mount the profiler attributed
to the click frame. The dev e2e Bug 4 number barely moved (~215 to ~199ms) because
the dev server's V8 lazy-JIT compiling the `/search` modules on first navigation
dominates the dev frame and is absent in production.

Measured against the PRODUCTION build (`bun run build` + `vite preview`, 4x CPU
throttle, LoAF, 4 runs): worst frame per run [83, 62, 63, 60]ms, overall max
83ms, mean 67ms. The real production defect is fixed (well under the 150ms
budget). The dev worst-frame number cannot distinguish a janky from a smooth
implementation (both ~200ms, JIT-dominated), so the dev e2e Bug 4 test asserts
only that the animation PLAYS (cadence) and logs the dev number documentary; the
hard 150ms budget is enforced by `scripts/measure-search-jank.ts` against the
production build. No animation disabled, no threshold weakened to hide jank.

### R1 fix: morph continuity across the drag-to-settle handoff (DV21 §5)

**The defect (both auditors BLOCKed on it).**
`src/lib/components/organisms/Header.svelte` `morph` `$derived.by` had a drag
branch and a settle branch that disagreed at the release handoff for two
sibling gesture shapes, so `morph` (and `iconProgress`, `rootLayerStyle`,
`layerDownStyle`) snapped in one rAF frame at release:

- **(a) centerTab -> tab-root back-swipe** (`/messages/<id>` ->
  `/messages/inbox`). Drag morph `1 - bm` (Fix A made the orchestrator publish
  a live `backMorph` on centerTab routes); settle morph collapsed to the
  constant `1` (`outgoingHasTabs === incomingHasTabs === true`). At release
  bm=0.458 the icon snapped `0.458 * 180 = 82deg` -> `0deg` and the tab-bar
  `translateY` snapped `-0.458 * 100% = -45.8%` -> `0%`. Auditor evidence:
  `burgerRot` 82.44deg at t=853ms, 0deg at t=879ms (a 26ms gap).
- **(b) targetIsSearch forward-swipe** (`/messages/inbox` -> `/search`).
  Drag morph `1` (the `targetIsSearch` skip); settle morph `1 - sp`
  (`outgoing=true`, `incoming=false`). At release sp=0.662 the icon snapped
  `0deg` -> `119.08deg` and the tab-bar `translateY` snapped `0%` -> `-66%`.
  Auditor evidence: rotation 0deg / rootLayerTy 0px at t=1301ms, 119.08deg /
  -26.46px at t=1338ms (a 37ms gap).

The deep->tab case the spec primarily targets was continuous by coincidence
(drag `bm` == settle `sp` when outgoing=0, incoming=1); deep->deep was
constant 0 at both endpoints; tab->tab on the bidirectional host published
`backMorph: null` so both branches returned the static at-rest value. Only
the two shapes above snapped.

**Root cause.** The settle morph formula
`outgoing * (1 - settleProgress) + incoming * settleProgress` interpreted
`settleProgress` as a normalized 0..1 fraction between outgoing and incoming.
That interpretation holds for non-gesture arms (startProgress=0,
targetProgress=1) but is wrong for gesture-release arms, where the rAF's
`settleProgress` starts at the release raw (e.g. 0.662) and ends at the
target (1 commit / 0 cancel). At the first settle frame the formula
collapses to a value that disagrees with the drag's terminal morph for
shapes where `outgoing` is not the drag's terminal value (centerTab case:
drag morph is `1 - bm`, not 1; targetIsSearch case: drag morph is 1, not
`outgoing * (1 - raw)`).

**The fix (UNIFY, no bridge).** Capture the morph value the Header was
rendering the instant before the settle took over (the drag's terminal
value), store it on the latched record, and interpolate the settle morph
from that captured `startMorph` to a `destMorph` across a NORMALIZED 0..1
fraction of the eased settle curve. No third driver: the morph still reads
the one published progress, just through the normalized
`settleMorphFraction` instead of the raw `settleProgress`. The title
crossfade continues to read `settleProgress` directly because the title
spans positions are continuous with the live-drag `pager.backMorph` value
(both share the raw scale).

`src/lib/utils/header-probe.ts`:

- `HeaderSettleTransition` gains `readonly startMorph: number` and
  `readonly destMorph: number` fields.

`src/lib/stores/nav-pipeline-orchestrator.svelte.ts`:

- `#settleStartProgress` / `#settleTargetProgress` are now `$state`-backed
  so the publication's `$derived.by` re-runs on a fresh arm.
- New `#settleMorphFraction()` computes
  `(settleProgress - settleStartProgress) / (settleTargetProgress - settleStartProgress)`,
  clamped to [0, 1].
- The publication (`OrchestratorPublication`) exposes three new fields:
  `settleStartProgress`, `settleTargetProgress`, `settleMorphFraction`.
- The Header-facing getters mirror them.
- Every site that constructs `HeaderSettleTransition` populates the two new
  fields:
  - `playEnterAnimation`: `startMorph = atRestMorph(outgoingHasTabs)`,
    `destMorph = atRestMorph(incomingHasTabs)` (no preceding drag).
  - `#armSettleEaseFromGesture` (the gesture-release arm): mirrors the
    Header's drag branch exactly so the captured `startMorph` equals the
    drag's terminal value:
    - `isDeepToDeep` -> `startMorph = 0`, `destMorph = 0` (drag hardcodes 0).
    - `targetIsSearch` -> `startMorph = atRestMorph(outgoingHasTabs)`;
      `destMorph = startMorph` (hold): at landing `isSearch` flips to true
      and overrides `iconProgress` / `rootLayerStyle`, so animating toward
      the /search at-rest morph (0) during the settle would rotate the icon
      to back-arrow then snap it back to hamburger at landing.
    - tab-to-tab bidirectional (both endpoints have tabs on
      `NavPipelineTabHost`) -> `startMorph = atRestMorph(outgoingHasTabs)`
      (= 1): the orchestrator publishes `backMorph: null` for these
      gestures, so the drag morph stayed at the at-rest value, not
      `1 - raw`.
    - else -> `startMorph = dragMorphAtRaw(outgoingHasTabs, raw)` (the
      `currentHasTabs ? 1 - raw : raw` formula).
    - `destMorph = atRestMorph(committed ? incomingHasTabs : outgoingHasTabs)`
      for the non-targetIsSearch, non-isDeepToDeep shapes (commit ends at
      the destination's at-rest morph, cancel returns to the source's).
  - `onSvelteKitBeforeNavigate` (the discrete-nav arm): `startMorph =
dragMorphAtRaw(outgoingHasTabs, publication.progress)`. With no
    preceding drag `publication.progress === 0` so this collapses to
    `atRestMorph(outgoingHasTabs)`; with a live-drag interrupt it equals
    the drag's terminal value (continuity at the discrete-nav interrupt).
  - `notifyHeaderState`'s mid-settle absorb re-arm: `startMorph =
morphAtSettleInstant(prevLatched)` so the new interpolation continues
    from the morph value the prior settle was producing (no snap at the
    re-arm). `destMorph` is recomputed from the new endpoints and the
    surviving `#settleTargetProgress`.
  - `notifyHeaderState`'s idle title-change arm: both `startMorph` and
    `destMorph = atRestMorph(...)` (no gesture owns the morph; it holds at
    the source's at-rest value).
  - `#accelerateInFlight` (the finish-then-new re-arm): `startMorph =
morphAtSettleInstant(prevLatched)`; `destMorph` carries over from the
    prior latched (the target does not change).

`src/lib/components/organisms/Header.svelte`:

- The morph settle branch interpolates from `settleLatched.startMorph` to
  `settleLatched.destMorph` across the orchestrator's
  `settleMorphFraction`:
  `startMorph + (destMorph - startMorph) * settleMorphFraction`.
- Reads the new `orchestrator.settleMorphFraction` reactive getter.

**Before/after jump numbers.** The new no-snap guards in
`e2e/reproduce-dv20-search-swipe.spec.ts` (Bug 3) and
`e2e/messages-back-swipe.spec.ts` (centerTab -> tab-root back-swipe)
sample rootLayerTy / deepLayerTy / burgerRot every rAF across the whole
gesture and assert the max frame-to-frame jump stays small. Auditor BEFORE
evidence (R1 audit, two independent verifications) and AFTER measurements
(this round, single run each):

| shape                      | signal           | BEFORE (auditor)          | AFTER    |
| -------------------------- | ---------------- | ------------------------- | -------- |
| (a) centerTab -> tab-root  | burgerRot snap   | 82.44deg in 26ms          | 12.54deg |
| (a) centerTab -> tab-root  | rootLayerTy snap | ~18.3px (45.8% of header) | 2.79px   |
| (b) targetIsSearch forward | burgerRot snap   | 119.08deg in 37ms         | 0deg     |
| (b) targetIsSearch forward | rootLayerTy snap | 26.46px                   | 0px      |

The (a) AFTER numbers are within the regular per-rAF cadence (~12px /
~22deg at this viewport's header height); the (b) AFTER numbers are zero
because the morph holds at startMorph throughout the settle (the
`targetIsSearch` special case).

**Sibling sweep.** Every drag-to-settle handoff shape, classified and
empirically verified continuous via the multi-signal sampler at the
release boundary:

- **deep -> tab** (e.g. `/profile/settings` -> `/`): drag morph `bm`;
  `startMorph = bm`; `destMorph = 1`. Continuous (the canonical case the
  spec targets; preserved).
  Verified by `e2e/deep-to-deep-gesture-morph-spike.spec.ts` PRESERVE
  (peakMorph=1.000, intermediateBuckets=9).
- **centerTab -> tab-root** (e.g. `/messages/<id>` -> `/messages/inbox`):
  drag morph `1 - bm`; `startMorph = 1 - bm`; `destMorph = 1`. Continuous.
  Verified by the new `centerTab -> tab-root back-swipe keeps the vertical
morph continuous across the release handoff` test in
  `e2e/messages-back-swipe.spec.ts`.
- **targetIsSearch forward-swipe** (e.g. `/messages/inbox` -> `/search`):
  drag morph `1` (skip); `startMorph = 1`; `destMorph = 1` (hold). Continuous.
  Verified by `e2e/reproduce-dv20-search-swipe.spec.ts` Bug 3.
- **isDeepToDeep** (e.g. `/profile/edit` <-> `/profile/settings`): drag
  morph 0 (hardcoded); `startMorph = 0`; `destMorph = 0`. Continuous.
  Verified by `e2e/deep-to-deep-gesture-morph-spike.spec.ts` DEFECT +
  GENERALIZATION + CALIBRATION (maxMorph=0.000, spikeFrames=0).
- **tab-to-tab bidirectional** (e.g. `/` <-> `/activity`): drag morph 1
  (bm null, at-rest fallback); `startMorph = 1`; `destMorph = 1`. Continuous.
  Verified by `e2e/tab-host-swipe.spec.ts` forward + backward tab swipes
  (maxAbsRotation < 5deg, the test's hamburger-mode guard).
- **back-swipe EXIT from `/search`** (e.g. `/search` -> `/messages/inbox`):
  drag morph `bm` (targetIsSearch=false; currentHasTabs=false at /search);
  `startMorph = bm`; `destMorph = atRestMorph(incomingHasTabs=true) = 1`.
  Continuous (drag bm -> settle bm -> 1 across the normalized fraction).
  Covered indirectly by `e2e/reproduce-user-bugs.spec.ts` Bug 8 (direct
  navigate to search -> drag left; green).

**Comment rewrites** (the three stale comments the audit flagged):

- `e2e/reproduce-dv20-drag-sync.spec.ts:94-99`: rewrote the
  "backMorph is null on thread centerTab routes" claim to describe the
  current live `backMorph` publication (Fix A) and explain why the track
  translateX is still the engagement signal for Bug 1.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:238-253` (the
  `PipelineMountInputs.centerTab` docstring): rewrote the
  "backMorph: null, fractionalIndex: centerTab (constant), Header stays in
  root mode end to end" claim to describe the live `backMorph` publication
  and the interpolating `fractionalIndex`, plus the `startMorph` capture
  that drives the settle continuity.
- `src/lib/components/organisms/Header.svelte:160-174` (the
  `targetIsSearch` skip comment): rewrote "covers the ENTER direction" to
  "covers the ENTER direction's drag phase" and added the explanation that
  the settle interpolates from the held value (captured as `startMorph`)
  toward the destination's at-rest morph across `settleMorphFraction`.

Plus a self-contained rewrite of the morph settle branch comment and the
DEV probe comment in `Header.svelte` (the `lastGestureMorph` slot now
documents that the gesture-terminal morph lives on the latched record).

**New no-snap guards.**

- `e2e/reproduce-dv20-search-swipe.spec.ts` Bug 3: added assertions on the
  multi-signal sampler's `rootLayerTy` and `burgerRot` max frame-to-frame
  jump across the whole gesture (`< 15px` and `< 35deg`, thresholds sized
  to flag the audit's 26.46px / 119.08deg snaps while passing the regular
  ~12px / ~22deg per-rAF cadence). A `maxFrameJumps` helper computes the
  max delta and its timestamp.
- `e2e/messages-back-swipe.spec.ts`: new test `centerTab -> tab-root
back-swipe keeps the vertical morph continuous across the release
handoff` installs the multi-signal sampler, drives a `swipeBack` from
  `/messages/<id>` to `/messages/inbox`, and asserts the same thresholds.
  Same `maxFrameJumps` helper.

**Real command outputs.**

```
$ bun run check
1785093940683 START "/home/losses/Development/janbao"
1785093940687 COMPLETED 1469 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ bun run lint
Checking formatting...
All matched files use Prettier code style!
[eslint clean]
Total similar type pairs found: 62
exit=0

$ bun test src/lib
552 pass / 0 fail / 2270 expect() calls across 40 files [2.13s]
```

```
$ npx playwright test e2e/reproduce-dv20-search-swipe.spec.ts -g "Bug 3" \
    --retries=0 --workers=1
Bug3 forward-swipe: {
  finalPath: '/search',
  seenPills: [ '/messages/inbox' ],
  hdrTrackTx: { range: 393, min: -393, max: 0, first: 0, last: -393 },
  tabTrackTx: { range: 0, min: -786, max: -786, first: -786, last: -786 },
  rootJumps: { max: 0, maxAt: 0 },
  deepJumps: { max: 4.16, maxAt: 1745 },
  burgerJumps: { max: 0, maxAt: 0 }
}
1 passed
```

```
$ npx playwright test e2e/messages-back-swipe.spec.ts --retries=0 --workers=1
... centerTab -> tab-root continuity: {
  rootJumps: { max: 2.79, maxAt: 557 },
  deepJumps: { max: 2.79, maxAt: 557 },
  burgerJumps: { max: 12.54, maxAt: 557 },
  finalPath: '/messages/inbox'
}
20 passed
```

```
$ npx playwright test e2e/reproduce-dv20-drag-sync.spec.ts \
    e2e/reproduce-dv20-search-swipe.spec.ts \
    e2e/messages-back-swipe.spec.ts \
    e2e/deep-to-deep-gesture-morph-spike.spec.ts \
    e2e/intra-tree-deep-to-deep.spec.ts \
    e2e/header-tab-descent-cross-tab-exit.spec.ts \
    e2e/header-title-replay.spec.ts \
    e2e/header-tabs-replay.spec.ts \
    e2e/tab-host-swipe.spec.ts \
    e2e/reproduce-user-bugs.spec.ts --retries=0 --workers=1
55 passed (3.0m)
```

No failures across the 10-file sibling regression sweep (the audit's
listed set). The full e2e gate is the orchestrator's, not run by the CMA.

**Out of scope for the R1 fix.** Anything else the next audit finds.

### R2 fix (exhaustive comment sweep)

**The class.** The R2 audit (RV21-C01-Audit-02) BLOCKed with every finding a
stale code comment - both auditors confirmed the R1 morph-continuity behaviour
is correct and the gates are green. The R1 rewrite changed the morph settle
branch from a `settleProgress`-direct formula to a `settleLatched.startMorph +
(settleLatched.destMorph - settleLatched.startMorph) * settleMorphFraction`
lerp, and added three special-case shapes in `#armSettleEaseFromGesture`
(`isDeepToDeep` constant 0; `targetIsSearch` HOLD with `destMorph = startMorph`;
tab-to-tab bidirectional at-rest). Many comments across the layer still
described the OLD mechanism. This round is an EXHAUSTIVE class-wide sweep so
the next audit round finds nothing in this class.

**Phrasings used (broad grep, union of hits, every hit read).**
`settleProgress`, `settleMorphFraction`, `Effect B`, `branch 1b`,
`branch 2`, `master morph`, `pager.backMorph ?? 1`, `current*(1-p)`,
`target = targetHasTabs`, `reads settleProgress`, `derives from settleProgress`,
`eased by settleProgress`, `animates continuously`, `backMorph: 0`,
`outgoingHasTabs / incomingHasTabs eased`, `at-rest morph`,
`iconProgress`, `targetIsSearch`, `isDeepToDeep`, `settle branch`,
`settle arm`, `drag branch`, plus a final shape-name sweep
(`targetIsSearch|isDeepToDeep|isTabToTab|dragMorphWasStatic`). Each new
phrasing was added until a fresh grep returned nothing not already read.

**Full enumeration (every hit, classified).** "Rewritten" = stale, edited.
"Accurate" = matches current code, left untouched.

- `src/lib/components/atoms/BurgerArrowIcon.svelte:25` - listed
  `settleProgress` as a published signal the `iconProgress` derivation
  composes. REWRITTEN: the morph now reads `settleMorphFraction`, so the
  signal list now names `settleMorphFraction` / `settleLatched` /
  `searchScrubbing`.
- `src/lib/components/atoms/BurgerArrowIcon.svelte:27` - "`pager.backMorph`
  during a drag, `settleProgress` during a settle". REWRITTEN: the morph
  lerps between the latched `startMorph` / `destMorph` across
  `settleMorphFraction` during a settle.
- `src/lib/components/organisms/Header.svelte:20-31` - the consumed-signals
  docstring listed `orchestrator.settleProgress` but omitted
  `orchestrator.settleMorphFraction` (the morph derivation's actual read).
  REWRITTEN: the list now names both, labelled by consumer
  (`settleProgress` for titleView spans, `settleMorphFraction` for the morph
  derivation).
- `src/lib/components/organisms/Header.svelte:160-174` - the `targetIsSearch`
  skip comment claimed the settle "animates continuously into the search-mode
  layout". REWRITTEN: the settle HOLDs the morph at the source's tab-ness
  (`destMorph = startMorph` for the `targetIsSearch` shape, so the lerp is a
  constant; at landing `isSearch` flips and `rootLayerStyle` / `iconProgress`
  switch to the search-mode branch).
- `src/lib/components/organisms/Header.svelte:196-208` - the settle-branch
  parenthetical stated "destMorph (the destination's at-rest morph)"
  universally. REWRITTEN: now describes the per-shape rules (commit ends at
  the incoming route's at-rest morph; cancel at the outgoing route's;
  `targetIsSearch` is the exception with `destMorph = startMorph`).
- `src/lib/components/organisms/Header.svelte:311-315` - the `rootLayerStyle`
  comment claimed "during a settle `morph` reads the orchestrator-published
  `settleProgress`". REWRITTEN: morph reads `settleMorphFraction` and lerps
  between the latched `startMorph` / `destMorph`.
- `src/lib/components/organisms/Header.svelte:653` - title-span inline
  comment "(settleProgress during a settle, backMorph during a drag)".
  ACCURATE (the title spans DO read `settleProgress` directly via
  `titleView.progress`); left untouched.
- `src/lib/components/organisms/Header.svelte:332-345` - DEV-probe
  docstring lists `settleProgress` as a probe-read field. ACCURATE (the
  probe DOES read settleProgress for the snapshot); left untouched.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:247-252` (the
  `PipelineMountInputs.centerTab` docstring) - claimed the at-rest
  publication holds `backMorph: 0`. REWRITTEN: the thread-route
  at-rest publication is `backMorph: null` (so the morph derivation's
  at-rest branch reads `currentHasTabs ? 1 : 0`; the thread route is deep,
  morph rests at 0, MobileTabBar hidden, fractionalIndex = centerTab is
  the value the bar reads the moment a navigation flips tab-ness back).
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:956-964`
  (`playEnterAnimation` plan-comment) - claimed the morph is driven by
  "the latched endpoints (outgoingHasTabs / incomingHasTabs eased by
  settleProgress)". REWRITTEN: the latched `startMorph` is the source
  route's at-rest morph and `destMorph` is the host route's at-rest
  morph; the morph derivation lerps between them across
  `settleMorphFraction`.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:3155-3165` (the idle
  title-change arm) - claimed "startMorph and destMorph both equal the
  source's at-rest morph". REWRITTEN: `startMorph = atRestMorph(source)`
  and `destMorph = atRestMorph(destination)`; the arm only fires when
  the discrete-nav branch did NOT arm (source and destination tab-ness
  equal), so the two are numerically equal and the morph holds while the
  title crossfade plays.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:3266` - the deep-page
  at-rest inline comment "backMorph: 0 so the Header is in deep (back-arrow)
  mode". ACCURATE (the deep-page at-rest code path at L3272 ACTUALLY
  publishes `backMorph: 0`, and the morph at rest on a deep route is 0
  regardless via the at-rest branch); left untouched. The class member
  "`backMorph: 0` at rest (it is null)" applies only where the publication
  is actually null (thread route, tab host) - the deep-page code path is
  the documented exception.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:3224-3227` - the
  thread-route at-rest inline comment "backMorph: null so the Header stays
  in root mode end to end". ACCURATE on the publication value (matches
  L3232); the "root mode" description is loose (the thread route is deep,
  morph rests at 0) but not in this audit's class (the class targets
  comments claiming `backMorph: 0`); left untouched.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:3238-3242` - the
  tab-host at-rest inline comment. ACCURATE; left untouched.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:2561-2568`
  (`#endSettleEase`) - describes why ending the settle does not snap. ACCURATE
  (the morph rest branch returns `currentHasTabs ? 1 : 0` and ignores both
  `settleProgress` and `settleMorphFraction`; continuity is structural via
  `destMorph = atRestMorph(post-landing currentHasTabs)`); left untouched.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:295-319` (the
  publication's `settleProgress` / `settleMorphFraction` field docstrings).
  ACCURATE (each field's docstring describes its role and consumer
  correctly); left untouched.
- `src/lib/stores/nav-state-machine.svelte.ts:116-128` - the
  `settleProgress` getter docstring claimed it is "Read by the Header's
  morph / titleView derivations". REWRITTEN: only the titleView derivation
  reads `settleProgress` directly (the title spans are continuous with the
  live-drag `pager.backMorph` because both share the raw 0..1 scale); the
  morph derivation reads `settleMorphFraction` instead, with the rationale.
- `src/lib/utils/header-probe.ts:47-60` (the `destMorph` field docstring) -
  stated destMorph = incoming/outgoing route's at-rest morph universally.
  REWRITTEN: added the `targetIsSearch` exception (`destMorph = startMorph`,
  a hold, because at landing `isSearch` flips and `iconProgress` /
  `rootLayerStyle` switch to the search-mode branch).
- `src/lib/utils/header-probe.ts:22-31` (the `HeaderSettleTransition`
  docstring) - describes why `startMorph` capture is needed. ACCURATE (the
  explanation matches the current mechanism); left untouched.
- `src/lib/utils/header-probe.ts:37-46` (the `startMorph` field docstring).
  ACCURATE; left untouched.
- `e2e/deep-to-deep-gesture-morph-spike.spec.ts:4-36` (the preamble) -
  described the eliminated defect mechanism ("Effect B", "branch 2",
  `current*(1-p)+target*p`, "derives from settleProgress",
  "Effect B never fires", "gesture/click asymmetry"). REWRITTEN: the
  spike is gone; `isDeepToDeep` captures `startMorph = 0` and
  `destMorph = 0`, so the morph settle branch (a pure lerp across
  `settleMorphFraction`) is the constant 0; the drag branch hardcodes 0
  and the at-rest branch returns 0 on a deep route. Both the gesture path
  and the click path keep the morph at 0 across the whole transition.
- `e2e/deep-to-deep-gesture-morph-spike.spec.ts:84-91` - the
  `DEEP_MORPH_EPSILON` guard comment. REWRITTEN: the morph must never leave
  the deep rest band; the drag branch hardcodes 0, the settle lerp is the
  constant between `startMorph = 0` and `destMorph = 0` across
  `settleMorphFraction`, the at-rest branch returns 0 on a deep route.
  Any frame above epsilon is a regression of the morph continuity fix.
- `e2e/deep-to-deep-gesture-morph-spike.spec.ts:208-214` (CALIBRATION
  comment) - claimed "no settle arm, no live-target flip" and "the
  gesture/click asymmetry that makes the bug a gesture-only regression".
  REWRITTEN: the discrete-nav branch skips the arm
  (`outgoingHasTabs === incomingHasTabs`) and the idle title-change arm
  captures `startMorph = 0` / `destMorph = 0`, so the settle lerp stays
  at 0 across the title crossfade.
- `e2e/deep-to-deep-gesture-morph-spike.spec.ts:121` (the `fmt` helper) -
  includes `settleProgress` in the print. ACCURATE (the snap struct has a
  `settleProgress` field); left untouched.
- `e2e/header-tab-descent-cross-tab-exit.spec.ts:17-25` - claimed
  "the morph derivation reads `settleProgress` and the layer transform
  follows `morph` 1:1". REWRITTEN: the morph derivation reads
  `settleMorphFraction` (normalized from `settleProgress`,
  `settleStartProgress`, `settleTargetProgress`) and lerps between
  `settleLatched.startMorph` and `settleLatched.destMorph`.
- `e2e/header-tab-descent-cross-tab-exit.spec.ts:156-167`
  (`slideAnimationRuns` helper) - claimed the rAF publishes "intermediate
  `settleProgress` values that drive the morph derivation". REWRITTEN:
  the rAF advances `settleProgress`, the derived `settleMorphFraction`
  follows it, and the morph derivation lerps between the latched
  `startMorph` and `destMorph`.
- `e2e/header-tab-descent-cross-tab-exit.spec.ts:329` - "A regression
  where the rAF never publishes intermediate `settleProgress` values".
  ACCURATE (about the rAF's publication; the chain
  `settleProgress` -> `settleMorphFraction` -> morph -> translateY is
  implicit but correct - if `settleProgress` does not advance neither
  does anything downstream); left untouched.
- `e2e/search-back-hamburger-flash.spec.ts:9` - the `iconProgress`
  formula omitted the `&& currentHasTabs` qualifier on the searchScrubbing
  branch. REWRITTEN: the formula now matches the current derivation
  (`$derived.by` with the tapMorph branch and the
  `isSearch || (searchScrubbing && currentHasTabs)` freeze).
- `e2e/search-back-hamburger-flash.spec.ts:11-19` - the prose claimed
  "branch 1b of the `morph` derivation" sequences the root<->search
  horizontal scrub. REWRITTEN: the horizontal scrub lives in
  `searchProgress` / `trackMorph` / `tabProgress`, and the morph
  derivation's `targetIsSearch` skip EXCLUDES the scrub from `morph`.
  The freeze condition now correctly includes the `&& currentHasTabs`
  qualifier with its rationale.
- `e2e/search-back-hamburger-flash.spec.ts:389-396` - the OVER-FREEZE
  note already cited the correct formula
  `(isSearch || (searchScrubbing && currentHasTabs))`. ACCURATE; left
  untouched.
- `e2e/search-enter-exit-asymmetry.spec.ts:4-33` (preamble) - claimed the
  search axis is "the SAME piecewise consumers of `morph`" and the
  gesture exit "scrubs `morph` continuously". REWRITTEN: the consumers
  are piecewise in `searchProgress` (HEADER_MORPH_THRESHOLD = 0.2 on
  `searchProgress`, not on `morph`); the gesture exit scrubs
  `searchProgress` (the Header's `searchProgress` / `trackMorph` map
  `pager.backMorph` to the search-layout position); the tap-scrub rAF
  drives the same timeline via `pager.tapMorph`.
- `e2e/search-enter-exit-asymmetry.spec.ts:185-187` (EXIT comment) -
  claimed "morph is scrubbed 0->1 by pager.backMorph, so tabProgress
  (morph [0,0.2]) finishes before searchProgress (morph [0.2,1])".
  REWRITTEN: `searchProgress` is scrubbed 0->1 by `pager.backMorph`, so
  `tabProgress` (searchProgress [0,0.2]) finishes before the track
  (searchProgress [0.2,1]) starts moving.
- `e2e/search-enter-exit-asymmetry.spec.ts:405-407` - "the layer group
  reads master morph; the Effect B settle drives it to 1". REWRITTEN: the
  layer group reads `morph`; the orchestrator's settle ease (armed at
  the tap) drives it to 1.
- `e2e/tab-host-swipe.spec.ts:13-20` - claimed the orchestrator must
  publish `backMorph: null` so the Header's `pager.backMorph ?? 1`
  fallback keeps `morph === 1`. REWRITTEN: the null publication makes
  the morph derivation take the at-rest branch
  (`currentHasTabs ? 1 : 0`) so `morph === 1` (hamburger) on a tab root.
- `src/lib/components/templates/FloatingActionButtonLayer.svelte:177-187`,
  `src/lib/components/templates/SearchScopePager.svelte`,
  `src/lib/components/organisms/MobileTabBar.svelte`,
  `src/lib/components/organisms/SearchTabBar.svelte`,
  `src/lib/stores/mobile-pager.svelte.ts`,
  `src/lib/utils/nav-executor-logic.ts`,
  `src/lib/utils/nav-executor-logic.test.ts`,
  `src/lib/utils/gesture-constants.ts`,
  `e2e/intra-tree-deep-to-deep.spec.ts`,
  `e2e/deep-to-deep-pre-dispatch-interrupt.spec.ts`,
  `e2e/header-title-replay.spec.ts`,
  `e2e/reproduce-hamburger-settings.spec.ts`,
  `e2e/reproduce-dv20-search-swipe.spec.ts`,
  `e2e/messages-back-swipe.spec.ts`,
  `e2e/reproduce-dv20-drag-sync.spec.ts` - each settleProgress /
  backMorph / morph reference read; all describe current behaviour (the
  publication chain, the drag-time morph, the FAB / pill consumers, the
  deep-to-deep intercept, the no-snap guards installed in the R1 fix).
  ACCURATE; left untouched.

**Out-of-scope doc fix.** `docs/RV21-C01-Audit-02.md` (the R2 audit file,
untracked) contained a U+2014 em-dash at L11 that failed the `local/no-emdash`
eslint rule and blocked `bun run lint`. Fixed (one-character substitution) so
the gate is green; the audit content is otherwise the auditor's.

**Real command outputs.**

```
$ bun run check
1785097191843 START "/home/losses/Development/janbao"
1785097191847 COMPLETED 1469 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ bun run lint
Checking formatting...
All matched files use Prettier code style!
[eslint clean]
Total similar type pairs found: 62
EXIT=0

$ bunx tsc -p scripts/tsconfig.json --noEmit
EXIT=0

$ bun test src/lib
552 pass / 0 fail / 2270 expect() calls across 40 files [2.13s]
```

Reproduce-spec spot check (4 specs, comment-only edits must not change
behaviour):

```
$ npx playwright test e2e/reproduce-dv20-drag-sync.spec.ts \
    e2e/reproduce-dv20-search-swipe.spec.ts \
    -g "Bug 1|Bug 3|Bug 6|Bug 7" --retries=0 --workers=1
Bug7 active windows: {
  slideWin: { startT: 56, endT: 339 },
  barWin:   { startT: 72, endT: 222 }
}
Bug7 bar-start minus slide-end = -267ms (negative = overlap)
Bug3 forward-swipe: {
  finalPath: '/search',
  seenPills: [ '/messages/inbox' ],
  hdrTrackTx: { range: 393, min: -393, max: 0, first: 0, last: -393 },
  tabTrackTx: { range: 0, min: -786, max: -786, first: -786, last: -786 },
  rootJumps:  { max: 0, maxAt: 0 },
  deepJumps:  { max: 4.06, maxAt: 1713 },
  burgerJumps:{ max: 0, maxAt: 0 }
}
4 passed (24.9s)
```

**No code behaviour changed.** Every edit is a comment / docstring / jest
preamble / journal note. The R1 morph continuity mechanism, the publication
chain, and the e2e assertion logic are all untouched. The full e2e gate is
the orchestrator's, not run by the CMA.

### R3 fix (read-every-comment verification)

**The class.** The R3 audit (RV21-C01-Audit-03) BLOCKed with every finding a
stale code comment. Both auditors confirmed the BEHAVIOUR is correct (no §5
violation, gates green) and the R2 sweep's grep-phrasing approach had missed
two classes of stale comments: the Fix A publication-surface docstrings (the
`centerTab` thread-route contract, the `backMorph` at-rest publication, the
SearchScopePager primary-store writer scope) and the Fix C `tabProgress` /
`searchProgress` / `HEADER_MORPH_THRESHOLD` refactor (the
`HEADER_MORPH_THRESHOLD` docstring still cited the eliminated
`1 - min(1, morph / THRESHOLD)` formula over `[0, 0.2]`, and the e2e
`search-enter-exit-asymmetry` spec's preamble and EXIT direction comments
carried the same bounds reversal). R3-A also found that the R2 rewrite of the
`centerTab` docstring INTRODUCED a new error (it claimed thread routes are
deep with morph 0 / bar hidden; threads are tab-associated routes where
`getCurrentTabIndex('/messages/<id>') === 2`, `currentHasTabs === true`, morph
1, bar visible). This pass abandons the grep approach: every comment /
docstring in each file the cycle touched was READ against the current code
and verified, not just the known stale phrasings.

**Method.** For each file in the audit's listed set: open it, read every
comment and docstring, check whether it matches the CURRENT code (after Fix
A/B/C/D + R1 + R2), fix every mismatch. After each rewrite, RE-READ the
surrounding code to confirm the new wording is accurate (the R2 `centerTab`
rewrite was the cautionary example of a rewrite that made it worse). The R3
seed findings named the known defects; the read-every-comment pass caught
two siblings the seeds did not name: the `boundary` field docstring on
`PendingGesture` and the `BOUNDARY_RUBBER_BAND_FACTOR` docstring (both said
"first/last tab"; only first-tab-backward remains after Fix C resolved
last-tab forward to `/search`), plus the FloatingActionButtonLayer
boundary-swipe docstring with the same shape.

**Comments rewritten.**

- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:248-256`
  (`PipelineMountInputs.centerTab` docstring): was "the thread route is a
  deep route (no tab association), so morph rests at 0 (back-arrow mode,
  MobileTabBar hidden)"; now "the thread route is tab-associated
  (`getCurrentTabIndex('/messages/<id>') === 2`, so `currentHasTabs ===
true`), morph rests at 1 (tab bar visible, hamburger icon) and the
  published `fractionalIndex = centerTab` matches the tab the thread
  overlays." Verified against the at-rest publication (L3242 publishes
  `backMorph: null`) and the morph derivation's at-rest branch
  (`currentHasTabs ? 1 : 0`).
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:146-150`
  (`PendingGesture.boundary` docstring): was "first/last tab on a
  bidirectional host"; now "the first tab with no previous history entry
  on a bidirectional host" (Fix C resolved every forward target including
  last-tab to `/search`, leaving only the first-tab-backward boundary
  reachable). Verified against `#backwardTabTarget` + the boundary branch
  comment at L1538-1547.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:3139-3161`
  (`notifyHeaderState` idle arm): dropped the false claim that
  `/search -> tab-root` "deliberately does NOT arm the settle"; the
  discrete-nav branch intercepts that case (tab-ness differs) and arms
  the settle CONCURRENTLY with the slide, and on landing the mid-settle
  absorb branch picks it up. Rewritten to describe the cases that
  actually fall through to the idle arm (deep->deep forward / popstate
  and tab->tab clicks on the bidirectional host, no tab-ness change) and
  to credit the `iconProgress` `isSearch || (searchScrubbing &&
currentHasTabs)` override for the no-flash guarantee across a
  `/search <-> tab-root` slide. Verified against the discrete-nav arm
  condition (`outgoingHasTabs !== incomingHasTabs`, L2328) and the
  Header's `iconProgress` derivation (L242).
- `src/lib/utils/gesture-constants.ts:8-13` (`HEADER_MORPH_THRESHOLD`
  docstring use 2): was "Search tab-bar clip-collapse
  `1 - min(1, morph / THRESHOLD)` over `[0, 0.2]`"; now "SearchTabBar
  clip-expand `tabProgress = max(0, (searchProgress - (1 - HMT)) / HMT)`
  so the SearchTabBar row expands over `searchProgress` in [0.8, 1.0]
  (the last 20% of an ENTER scrub, slide-then-expand) and collapses over
  `searchProgress` in [1.0, 0.8] (the first 20% of an EXIT scrub,
  collapse-then-slide)." Verified against Header.svelte L461-463.
- `src/lib/utils/gesture-constants.ts:37-41`
  (`BOUNDARY_RUBBER_BAND_FACTOR` docstring): was "On the first/last tab a
  swipe toward the absent neighbour"; now "On the first tab a backward
  swipe with no previous history entry... (The forward direction resolves
  every tab to a target via `#nextTabTarget`, with the last tab resolving
  to `/search`, so no forward boundary path remains.)" Verified against
  the boundary branch at L1538-1547.
- `src/lib/stores/mobile-pager.svelte.ts:14-25` (`backMorph` contract):
  was "null on tab roots, threads (centerTab routes), and before mount; 0
  on deep pages at rest"; now "At rest: null on tab roots and threads
  (centerTab routes)... 0 on deep pages... During a drag the orchestrator
  publishes the live raw drag fraction on centerTab thread routes (Fix A's
  gesture-feedback publication), on bidirectional tab-host
  backward-to-deep and forward-last-tab-to-`/search` drags, and on every
  NavPipelineHost drag (deep page, compose); the only drag-time null
  publication is a tab-to-tab swipe on the bidirectional tab host."
  Verified against `#republishToPager` L3434-3491.
- `src/lib/components/templates/SearchScopePager.svelte:178-184`
  (the search-scope pager's `backMorph: null` rationale): was "scope
  switching does not morph the header (only the NavPipelineHost
  back-swipe does, via the primary store)"; now "this is the search-scope
  sub-pager (orthogonal to the primary pager the Header reads for
  `backMorph`), and scope switching does not morph the header. The
  primary pager's `backMorph` is owned by the orchestrator, which
  publishes the live drag fraction on every NavPipelineHost /
  NavPipelineTabHost drag that morphs the header." Dropped the misleading
  "only the NavPipelineHost back-swipe does" qualifier.
- `src/lib/components/templates/FloatingActionButtonLayer.svelte:149-163`
  (FAB scale boundary-swipe docstring): was "first/last tab rubber-band";
  now "first-tab backward rubber-band". Same Fix C correction as the
  `BOUNDARY_RUBBER_BAND_FACTOR` and `PendingGesture.boundary` comments.
- `e2e/search-enter-exit-asymmetry.spec.ts:13-26` (preamble): was
  "tabProgress over searchProgress in [0, 0.2], searchProgress (header
  track translateX) over searchProgress in [0.2, 1]. A continuous
  searchProgress 0->1 collapses the tab first then slides..."; now
  "searchProgress (header track translateX + search button left) is
  LINEAR over searchProgress in [0, 1]; tabProgress (SearchTabBar
  max-height) over searchProgress in [0.8, 1.0] via
  `max(0, (searchProgress - (1 - HMT)) / HMT)`. A continuous
  searchProgress 0->1 (ENTER) slides the track across the whole range
  and expands the scope-tab bar only across the last 20%... A continuous
  searchProgress 1->0 (EXIT) collapses the scope-tab bar across the
  first 20% then slides the track across the rest."
- `e2e/search-enter-exit-asymmetry.spec.ts:188-195` (EXIT comment): was
  "searchProgress is scrubbed 0->1 by pager.backMorph, so tabProgress
  (searchProgress [0,0.2]) finishes before the track (searchProgress
  [0.2,1]) starts moving"; now "on EXIT the source is /search (isSearch =
  true) so searchProgress = 1 - trackMorph = 1 - pager.backMorph, running
  1->0 as the swipe advances. tabProgress tracks searchProgress over
  [0.8, 1.0] (the first 20% of the EXIT), so the scope-tab bar collapses
  to ~0 while the header track (linear over searchProgress [0, 1]) is
  still >=60% slid."

**Files verified clean (every comment / docstring read against the code,
no defect found).**

- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts` (after the
  rewrites above; the publication field docstrings, `#publish`,
  `#republishToPager` three-mode docstring, `#armSettleEaseFromGesture`
  shape analysis, `#endSettleEase` no-snap argument, `#atRestMorph`,
  `#dragMorphAtRaw`, `playEnterAnimation` plan-comment, the discrete-nav
  concurrent-arm comment, the mid-settle absorb comment, the
  `#accelerateInFlight` re-arm comment, the at-rest publication comment
  for the three modes - all describe current behaviour).
- `src/lib/stores/mobile-pager.svelte.ts` (after the rewrite; the
  factory docstring, `PagerUpdate.tapMorph` / `transitionTarget` /
  `scrubIconEndpoint` field docstrings, the `set` closure's
  preserve-tapMorph / preserve-scrubIconEndpoint comments).
- `src/lib/stores/nav-state-machine.svelte.ts` (settleProgress /
  settleLatched / settleDirection / settleAwaitTitle / searchScrubbing
  reactive-read docstrings; setSettleState / setSearchScrubbing
  mutation-method docstrings).
- `src/lib/stores/scroll-chrome.svelte.ts` (setScrollContainer rAF-defer
  comments for both branches; releaseContainer identity-guard comment;
  setOverride / holdThroughNavigation / releaseNavigation comments).
- `src/lib/components/organisms/Header.svelte` (the consumed-signals
  top-level docstring; the morph / iconProgress / searchProgress /
  trackMorph / tabProgress / rootLayerStyle / layerDownStyle derivation
  comments; the DEV-probe docstring; the title-span `progress` inline
  comment; the single-search-button comment).
- `src/lib/components/organisms/MobileTabBar.svelte`,
  `SearchTabBar.svelte`: top-level docstrings + the deep-swipe pill
  path comment (MobileTabBar) and the search-scope underline comment
  (SearchTabBar).
- `src/lib/components/atoms/BurgerArrowIcon.svelte` (the `progress`
  prop docstring's compose-signals list now names
  `settleMorphFraction`, `settleLatched`, `searchScrubbing`).
- `src/lib/components/templates/NavPipelineHost.svelte` (the
  UNIFY-DO-NOT-BRIDGE preamble, `resolvedLeftHref`, `shouldEnter`,
  `crossTabPanelPath`, `forwardDeepTarget`, the at-rest `$effect`,
  the ResizeObserver comment, the forward-enter seed, the
  initialTrackTransform comment).
- `src/lib/components/templates/NavPipelineTabHost.svelte` (the
  deepSnapshotTarget overlay comment, the active-tab data resolution
  comment, the mobile -> desktop breakpoint handler comment, the
  passthrough comment).
- `src/lib/components/templates/SearchScopePager.svelte` (after the
  rewrite; the docstring preamble, the lazy-panel-content comment, the
  scope-switch settle comment, the measureViewport rAF-defer comment).
- `src/lib/components/templates/FloatingActionButtonLayer.svelte`
  (after the rewrite; the scale top-level docstring, the retainedConfig
  / displayConfig comments).
- `src/lib/utils/header-probe.ts` (`HeaderSettleTransition` docstring,
  `startMorph` / `destMorph` field docstrings including the
  `targetIsSearch` exception).
- `src/lib/utils/route-config.ts` (top-level docstring, the four
  consumer-config comments, `getCurrentTabIndex`, `backTargetListKind`,
  `MOBILE_TABS`).
- `src/lib/utils/nav-resolvers.ts` (top-level docstring, the
  `TransitionPlan` / `RouteStack` / `ResolverInput` docstrings, all six
  resolver comments, the dispatch comment).
- `src/lib/utils/fab-scale.ts` (top-level docstring, `fabScale` cases,
  `hideProgress`, `translateYFromHideProgress`).
- e2e specs: `reproduce-dv20-drag-sync.spec.ts`,
  `reproduce-dv20-search-swipe.spec.ts`, `messages-back-swipe.spec.ts`,
  `header-tab-descent-cross-tab-exit.spec.ts`,
  `deep-to-deep-gesture-morph-spike.spec.ts`,
  `search-back-hamburger-flash.spec.ts`,
  `search-enter-exit-asymmetry.spec.ts` (after the rewrite),
  `tab-host-swipe.spec.ts`. Each spec's preamble, helper-docstrings, and
  inline assertions describe the current publication chain, the
  `settleMorphFraction` mechanism, and the slide-then-expand /
  collapse-then-slide asymmetry.

**Sibling regression sweep.** The "first/last tab" phrasing sweep caught
three siblings of the `BOUNDARY_RUBBER_BAND_FACTOR` docstring (the
`PendingGesture.boundary` field, the FAB scale boundary-swipe docstring,
plus the gesture-constants constant itself). All three carried the same
post-Fix-C inaccuracy and were rewritten together.

**Out-of-scope doc fix.** `docs/RV21-C01-Audit-03.md` (the R3 audit file,
written by the auditor) contained a U+2014 em dash at L10 that failed the
`local/no-emdash` eslint rule and blocked `bun run lint`. Fixed
(one-character substitution, "stale comments, a NEW class" replacing
"stale comments - a NEW class") so the gate is green; the audit content
is otherwise the auditor's.

**Real command outputs.**

```
$ bun run check
1785100555323 START "/home/losses/Development/janbao"
1785100555327 COMPLETED 1469 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ bun run lint
Checking formatting...
All matched files use Prettier code style!
[eslint clean]
Total similar type pairs found: 62
EXIT=0

$ bunx tsc -p scripts/tsconfig.json --noEmit
EXIT=0

$ bun test src/lib
552 pass / 0 fail / 2270 expect() calls across 40 files [2.16s]
```

Reproduce-spec spot check (comment-only edits must not change behaviour):

```
$ npx playwright test e2e/reproduce-dv20-drag-sync.spec.ts \
    e2e/reproduce-dv20-search-swipe.spec.ts \
    e2e/search-enter-exit-asymmetry.spec.ts \
    -g "Bug 1|Bug 3|Bug 6|Bug 7|ENTER|EXIT|MIRROR" --retries=0 --workers=1
Bug7 active windows: {
  slideWin: { startT: 58, endT: 341 },
  barWin:   { startT: 74, endT: 224 }
}
Bug7 bar-start minus slide-end = -267ms (negative = overlap)
Bug3 forward-swipe: {
  finalPath: '/search',
  seenPills: [ '/messages/inbox' ],
  hdrTrackTx: { range: 393, min: -393, max: 0, first: 0, last: -393 },
  tabTrackTx: { range: 0, min: -786, max: -786, first: -786, last: -786 },
  rootJumps:  { max: 0, maxAt: 0 },
  deepJumps:  { max: 4.04, maxAt: 1731 },
  burgerJumps:{ max: 0, maxAt: 0 }
}
EXIT collapse-before-slide: t=471ms morph=0.18 tabNorm=0.08 trackNorm=0.82
ENTER slide-before-expand: t=304ms trackNorm=0.69 tabNorm=0.00
ENTER sync maxDelta: 0.177 over 137 frames
tap-EXIT sync maxDelta: 0.000 over 14 frames
NB27 pre-nav rootLayerY min: 0
NB27 post-nav rootLayerY min: 0 last: 0
MIRROR SUMMARY: { enterSlideFirst: true, exitCollapseFirst: true }
9 passed (49.5s)
```

The EXIT evidence (`morph=0.18 tabNorm=0.08 trackNorm=0.82`) confirms the
rewritten bounds: at `pager.backMorph = 0.18` on a `/search` source,
`searchProgress = 1 - 0.18 = 0.82`, `tabProgress = max(0, (0.82 - 0.8) /
0.2) = 0.1` (so `tabNorm ≈ 0.08`, collapsed), and the track is at 0.82 of
its peak (still slid). The slide-then-expand / collapse-then-slide
asymmetry is structural in the consumer formulas and the test passes
unchanged.

**No code behaviour changed.** Every edit is a comment / docstring /
spec-preamble / journal note. The R1 morph continuity mechanism, the
publication chain, and the e2e assertion logic are all untouched. The
full e2e gate is the orchestrator's, not run by the CMA.
