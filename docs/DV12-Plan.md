# DV12 - Header Tab-Descent Fix (cross-tab exit boundary)

**Status:** 5/5 PASS (FINAL, unconditional). Round 3. Approved for implementation. The fix removes the `(navStore.navInFlight && !settling)` term from `slideT` (`Header.svelte:193-196`) - single Header-local expression, branch-agnostic - and updates the CALIBRATION test in `e2e/header-tab-descent-cross-tab-exit.spec.ts` to document the post-fix symmetry. R1 audit: `docs/DV12-Meeting/DV12-Audit-R1.md`. R2 audit: `docs/DV12-Meeting/DV12-Audit-R2.md`. R3 audit: `docs/DV12-Meeting/DV12-Audit-R3.md`.
**Scope:** Mobile only (`max-width: 767px`). Desktop has no GesturePageLayout track animation and no Header layer morph; unaffected.
**Defect evidence:** `e2e/header-tab-descent-cross-tab-exit.spec.ts` CALIBRATION (pass) + DEFECT (fail 6/6), and the dev-only per-flush probe `window.__headerLog` (`src/lib/utils/header-probe.ts` + `Header.svelte` `$effect`).
**R1 audit:** `docs/DV12-Meeting/DV12-Audit-R1.md` (0/5 unconditional; 2 FAIL on a verified same-panel-branch premise; 3 PASS mis-traced the branch).
**Subsystem memory:** `header-tab-descent-cross-tab-exit-defect.md`. Sibling defects: `search-enter-exit-morph-asymmetry`, `header-title-crossfade-clip-defect`, `mobile-tab-pager-swipe-preview-height`. Audit method: `dv04-audit-loop`, `audit-prompts-open-ended-not-fix-verification`, `parallel-agents-shared-worktree-no-git-mutation`, `no-either-or-fix-proposals-without-audit`, `markdown-table-pipe-gotcha`, `svelte-effect-pre-same-flush-rerun`.

## 1. Goal

The mobile Header tabs layer (`MobileTabBar` inside `Header.svelte`) sits at `translateY(-100%)` on a deep page and descends to `translateY(0%)` when the route returns to a tab route. This is the "Tab 下沉" animation, a CSS `transform 200ms ease-out` transition on the layer whose target is the derived `morph`.

The BACK direction from a `GesturePageLayout` deep page to a tab route (the back arrow; also any click/tab-tap back that routes through a GPL `beforeNavigate` exit) does not animate: the descent is suppressed at the navigation landing flush and the layer jumps `-100%` to `0%` in one commit (headless), or plays partially then snaps on slower devices (the reported intermittent "播放到一半卡住再跳到结尾"). The forward direction (tab route to deep page) animates smoothly.

The goal is a symmetric, continuous tab-descent on the back direction, with no regression to the gesture back-swipe settle, the same-panel slide, the deep-to-deep title crossfade, the root-search scrub, the forward direction, SSR, or HMR.

## 2. Confirmed cause (owner-locked, measured; R1-corrected)

The probe captured the back landing as three per-flush snapshots (paint-independent, so the commit flush blocked between paints is still recorded):

```
t=14651  /bookmarks   morph=0.00  slideT=NONE   navInFlight=true   settling=false
t=14689  /messages    morph=1.00  slideT=NONE   navInFlight=true   settling=false
t=14699  /messages    morph=1.00  slideT=200ms  navInFlight=false  settling=false
```

At the landing flush `currentHasTabs` flips `false` to `true`, the `morph` derived (`Header.svelte:140`) takes its rest branch and jumps `0` to `1`, so `rootLayerStyle` (`Header.svelte:527`) commits `translateY(-100%)` to `translateY(0%)`. In that same flush `slideT` (`Header.svelte:193`) evaluates its `(navStore.navInFlight && !settling)` term to `true` (the GPL exit set `navInFlight` before landing, and no settle runs on a back-to-tab title change), so the layer transition is `none` and the transform jumps with no animation. `afterNavigate` then clears `navInFlight`, `slideT` returns to `200ms`, but `morph` is already at `1` so nothing is left to animate.

The `(navInFlight && !settling)` term in `slideT` is the cause. `git blame -L 194,194 -- src/lib/components/organisms/Header.svelte` attributes the term to commit `23d711b9` ("fix: Fab not following the gesture", 2026-06-30); the surrounding `slideT` `$derived` block is from `c2c7616` ("fix: Header animation issue", 2026-06-29), which carried the older `dragging || navInFlight` form. The `&& !settling` carve-out exempts the gesture-settle path. The `navInFlight` part is vestigial for the gesture path: `settling=true` through the in-flight window (Effect D at `Header.svelte:351-362` clears `settling` only when `!navInFlight`, so the two clear together and the term stays false on the gesture path). The term is true ONLY for click/tab-tap navigations, where it suppresses the landing transition and causes the jump. (The term's origin in a FAB-gesture-tracking commit is incidental to Header's own layer; the FAB reads `navInFlight` in `src/lib/components/templates/FloatingActionButtonLayer`, not via Header's `slideT`. The FAB specs are added to the no-regression gate in §7 as insurance.)

**R1 correction (branch-agnostic).** The R1 plan asserted the `/bookmarks → /messages/inbox` back-arrow path takes the GPL CROSS-TAB chip branch; the R1 audit (auditors 2 and 5, owner source-verified) proved it takes the SAME-PANEL branch. The proof: `resolvedLeftHref` (`GesturePageLayout.svelte:112-120`) = `lockedLeftHref ?? leftHref ?? navStore.backTarget`; `/bookmarks/+page.svelte:51` passes no `leftHref`; `backTargetFor` (`navigation-logic.ts:57-64`) returns `stack[stack.length-2]` = `/messages/inbox`; so `matchesPreRenderedPanel` (`GesturePageLayout.svelte:759`) = `to === /messages/inbox` = true → same-panel branch (`:789-814`). Crucially, BOTH the same-panel branch (`:813`) and the cross-tab chip branch (`:783`) call `setPendingNav` → `executePendingNav` → `navInFlight=true` → landing jump. The defect is therefore branch-agnostic, and the fix must be branch-agnostic too. (The R1 probe data showed only `navInFlight=true`, which both branches produce, so it did not distinguish them; the branch identity is moot for the R2 fix.)

The forward direction is unaffected because the tab route does not mount `GesturePageLayout`, no GPL `beforeNavigate` exit runs, `navInFlight` is never set, and the forward Effect-C settle (`Header.svelte:275`) drives `morph` with `slideT === '200ms'`.

## 3. Architecture context (verified inventory)

- `src/lib/components/organisms/Header.svelte:66,70` `currentHasTabs`, `isDeepToDeep` deriveds.
- `src/lib/components/organisms/Header.svelte:131` `isSettleMode` (true while `settling`, or in the gesture release window).
- `src/lib/components/organisms/Header.svelte:140-187` `morph` derived: drag branch (follows `pager.backMorph`), search-scrub branch, settle branch (settling, interpolates by `settleProgress`), rest branch (`currentHasTabs ? 1 : 0`).
- `src/lib/components/organisms/Header.svelte:193-196` `slideT`: `dragging || searchScrubbing || (navStore.navInFlight && !settling) ? 'none' : 'transform 200ms ease-out, opacity 200ms ease-out'`. **The R2 fix edits this one expression.**
- `src/lib/components/organisms/Header.svelte:421-445` `runSettleDriver`: `settleProgress = settleTarget` is set in a single `requestAnimationFrame` (`:429`); it does NOT interpolate frame-by-frame. The CSS transition (`slideT`) animates that single jump. This is why `slideT` must stay `'200ms'` during settle (the current behavior), and why removing the `(navInFlight && !settling)` term does not change settle behavior.
- `src/lib/components/organisms/Header.svelte:275-324` Effect C (title change). Idle branch (`:308-322`): a title that becomes empty on a tab route hits `else if (!newTitle && !isDeep)` and only resets `restTitle`; it starts NO settle. This is why the back-to-tab morph goes straight to the rest branch.
- `src/lib/components/organisms/Header.svelte:351-362` Effect D ends a commit settle only when `pendingNav === null && !navInFlight` (so `settling` and `navInFlight` clear together on the gesture path).
- `src/lib/components/organisms/Header.svelte:527-534` `rootLayerStyle` (tabs layer) and `:536-539` `layerDownStyle` (title layer): both read `morph` and `slideT`.
- `src/lib/components/organisms/Header.svelte:687-699` `onBack` (back-arrow handler): `backHandler.dispatch()`, else `history.back()` when `hopForHref(target) === 'back'`, else `goto(target, { replaceState: true })`.
- `src/lib/components/templates/GesturePageLayout.svelte:731-815` `beforeNavigate`: `!isMobile` early-return at `:736`; in-flight guard at `:741-748`; animates only when `isTabRootPath(to.url.pathname)` (`:751`).
- `src/lib/components/templates/GesturePageLayout.svelte:759` `matchesPreRenderedPanel` = `to.url.pathname === resolvedLeftHref || to.url.pathname === resolvedRightHref`.
- `src/lib/components/templates/GesturePageLayout.svelte:112-120` `resolvedLeftHref` = `pendingNav?.href ?? lockedLeftHref ?? leftHref ?? navStore.backTarget`.
- `src/lib/components/templates/GesturePageLayout.svelte:762-786` cross-tab chip branch and `:789-814` same-panel branch: BOTH call `navStore.setPendingNav(target, type)` (at `:783` and `:813` respectively) → `startPendingNavPoll()`.
- `src/lib/components/templates/GesturePageLayout.svelte:564-608` `startPendingNavPoll`: resolves the slide/completion and calls `navStore.executePendingNav()` (`:597,605`).
- `src/lib/stores/navigation.svelte.ts:191-219` `executePendingNav`: clears `#pendingNav` (`:194`), sets `#navInFlight = true` (`:195`) before dispatching. `handleAfterNavigate` (`:131-137`) clears `#navInFlight = false` (`:133`).
- `src/lib/stores/navigation-logic.ts:57-64` `backTargetFor` returns `stack[stack.length-2]`.
- `src/lib/utils/header-probe.ts` + the dev-only `$effect` in `Header.svelte`: the per-flush `window.__headerLog` probe. DEV + browser gated.

## 4. Design

### 4.1 Constraint (what the fix must satisfy)

1. At the navigation landing flush of a back-to-tab click/tab-tap (same-panel OR cross-tab chip exit), `slideT` MUST be `'transform 200ms ease-out, opacity 200ms ease-out'` (not `'none'`), so the tabs layer descent animates from `-100%` to `0%`. Branch-agnostic.
2. The gesture back-swipe settle behavior MUST be byte-identical to today: during settle `slideT === '200ms'` so the CSS transition animates the single `settleProgress` jump (the gesture release continues smoothly from the finger's release point to the rest position).
3. No regression to: gesture back-swipe (`header-tabs-replay.spec.ts`), same-panel slide exit (`tab-exit-preview.spec.ts`), deep-to-deep title crossfade (`header-title-crossfade-clip.spec.ts`), root-search morph (`search-enter-exit-asymmetry.spec.ts`), forward direction, SSR (the layer renders at the correct rest `translateY`), HMR.

### 4.2 Primary mechanism: remove the vestigial `navInFlight` suppression from `slideT`

`Header.svelte:193-196` becomes:

```
const slideT = $derived(
    dragging || searchScrubbing
        ? 'none'
        : 'transform 200ms ease-out, opacity 200ms ease-out'
);
```

The `(navStore.navInFlight && !settling)` term is removed entirely. The `navStore.navInFlight` read in this `$derived` becomes dead and is removed (a cleanup Auditor 5 noted). No other file changes.

Why this is correct and branch-agnostic:

- **Back-to-tab landing (the defect, both GPL branches).** At landing `navInFlight=true`, `settling=false`, `dragging=false`, `searchScrubbing=false`. Today the term suppresses (`'none'`); after removal `slideT='200ms'`, so when `currentHasTabs` flips and `morph` jumps `0→1`, the CSS transition animates the tabs layer (and the title layer) over 200ms. The `transform` transition runs on the compositor thread once started, so it is immune to the main-thread block at the commit; the headless three-frame handoff drop (caused by `'none'`, not by a dropped transition) disappears, fixing both the jump and the freeze-then-jump.
- **Gesture back-swipe settle (must not change).** During settle `settling=true`. Today `(navInFlight && !settling)` = `(true && false)` = false, so `slideT='200ms'`. After removal `slideT='200ms'`. Byte-identical. `runSettleDriver` (`:429`) sets `settleProgress` in one rAF; the CSS transition animates that single jump. The gesture release stays smooth.
- **Drag / search scrub.** Unchanged (`dragging` / `searchScrubbing` terms remain).
- **Forward direction (tab→deep).** GPL not mounted on the tab source; `navInFlight` never set; `slideT='200ms'`; Effect-C settle drives `morph`. Unchanged.

### 4.3 Why not the R1 `crossTabChip` latch (rejected)

The R1 primary added a `crossTabChip` flag to `PendingNavState`, latched as `lastExitChip` on the navigation store, read in `slideT`. R1 audit rejected it: it targeted the cross-tab branch only (wrong for the spec's same-panel scenario), it was not branch-agnostic, and it leaked a Header-layer concern into the shared `NavigationStore` + `GesturePageLayout`. It also needed latch cleanup in `clearPendingNav` and the orphan branch, which R1 §5 omitted. The R2 single-term removal supersedes it with a one-line, Header-local, branch-agnostic fix.

### 4.4 Why not Variant B (`dragging || searchScrubbing || settling`) (rejected, R1 auditor 5 proposal)

R1 Auditor 5 proposed keeping only `settling` (dropping `navInFlight`). That would make `slideT='none'` during settle, changing the current `'200ms'` behavior; since `settleProgress` jumps once and relies on the CSS transition to animate it, disabling the transition during settle would snap the gesture release (a likely `header-tabs-replay.spec.ts` regression). Variant B is based on the premise that `settleProgress` interpolates frame-by-frame; `runSettleDriver:429` shows it does not. The §4.3-vs-Variant-B question is decided empirically by the gesture-suite gate (§7): if removing the whole term keeps `header-tabs-replay.spec.ts` green (expected, since settle behavior is byte-identical), §4.2 stands.

### 4.5 Why not drive the back-to-tab morph through the settle branch (rejected, R1 §4.4)

Unnecessary. A `transform` CSS transition, once the new value is committed, runs on the compositor thread and is not blocked by main-thread jank. The headless three-frame handoff gap was caused by `slideT='none'` (no transition at all), not by a dropped transition. Enabling the transition (§4.2) fixes both the jump and the freeze-then-jump. Routing the back-to-tab morph through Effect C's settle would add interaction risk with the gesture Effect-B settle and the Effect-C re-arm logic (`Header.svelte:291-305`) for no benefit.

### 4.6 Lifecycle, SSR, HMR

- The change is a pure reduction of a `$derived` expression. No new state, no new effect, no new tracked dependency (the `navStore.navInFlight` read is removed, so `slideT` tracks strictly fewer deps). No same-flush re-run hazard can be introduced (memory `svelte-effect-pre-same-flush-rerun`); if anything the reactive graph is simpler.
- SSR: `dragging`, `searchScrubbing` are false on the server; `slideT='200ms'`; `currentHasTabs` is path-derived (SSR-safe); `rootLayerStyle` renders the path-derived rest `translateY`. No hydration mismatch.
- HMR: no module state added; `slideT` is a local `$derived`. No stranding.

## 5. Files

**Modified:**

- `src/lib/components/organisms/Header.svelte` - `slideT` (`:193-196`): remove the `(navStore.navInFlight && !settling)` term (and the now-dead `navStore.navInFlight` read in that `$derived`). One expression. No shared primitive is touched; the fix is Header-local.
- `e2e/header-tab-descent-cross-tab-exit.spec.ts` - the CALIBRATION test is updated WITH the fix (it documents behaviour, so it follows the fix). This is a coherent rewrite of the broken-behaviour story into the fixed symmetry story, touching three places: (a) the back-landing assertion `expect(backLanding.slideNone).toBe(true)` flips to `.toBe(false)` (the suppression is gone); (b) the test name string (`CALIBRATION: forward descent keeps its transition, back descent suppresses it (documents the asymmetry)` → a symmetry name, since both the mid-clause "back descent suppresses it" AND the trailing "(documents the asymmetry)" are rendered false by the fix); (c) the file-header doc-comment block (lines 19-43), which still narrates "takes the CROSS-TAB EXIT path" and the suppression mechanism, rewritten to the branch-agnostic symmetry story. The `backLanding.navInFlight === true` assertion STAYS (the fix does not change `navInFlight`; it is still set at landing - the CALIBRATION retains it as a witness that the fix stopped suppressing `slideT`, not that it stopped setting `navInFlight`). The forward-landing expectations and the DEFECT test are unchanged. (R2 audit B1 + R3 auditors 1/2/3/4 convergent N1: the plan cannot list this spec as Unchanged while requiring CALIBRATION to "keep passing", and the name/doc-comment rewrite is the whole name + comment, not just a parenthetical.)

**Unchanged (verification targets):** `navigation.svelte.ts`, `navigation-logic.ts`, `GesturePageLayout.svelte`, `MobileTabBar.svelte`, `MobileTabPager.svelte`, `swipe.ts`, `tab-config.ts`, `mobile-tabs.ts`, `scroll-chrome.svelte.ts`, `DualColumnLayout.svelte`, `(tabs)/+layout.svelte`, and the rest of `Header.svelte` (Effects A-E, `morph`, `isSettleMode`, `rootLayerStyle`, `layerDownStyle`, the dev-only `__headerLog` probe). No shared primitive is touched.

**Diagnostic (already present, retained):** `src/lib/utils/header-probe.ts`, the dev-only `$effect` in `Header.svelte`, and `e2e/header-tab-descent-cross-tab-exit.spec.ts`. The probe stays DEV-gated; the regression spec's DEFECT test flips from fail to pass once the fix lands.

## 6. Edge cases and risks

1. Gesture back-swipe commit (deep → tab): `settling=true` through the in-flight window; `slideT` was `'200ms'` before and after. The settle drives `morph`; the CSS transition animates the single `settleProgress` jump. Verify `e2e/header-tabs-replay.spec.ts` stays green (the §4.4 empirical gate).
2. Same-panel slide exit (the spec's actual scenario): `navInFlight=true` at landing, `settling=false`; today `slideT='none'` (jump); after the fix `slideT='200ms'` (animates). There is no double-animation with the GPL track because the Header layer's `translateY` (`rootLayerStyle`) and the GPL track's `translateX` are independent CSS transforms on different DOM elements; the two cannot animate each other regardless of timing (`startPendingNavPoll` may dispatch via its 800ms wall-clock cap or its `trackEl===null` branch before the slide visually finishes, and it still does not matter). Verify `e2e/tab-exit-preview.spec.ts` stays green and the descent DEFECT test passes.
3. Cross-tab chip exit: same as same-panel at landing (`navInFlight=true`, `settling=false`); fixed by the same term removal. Branch-agnostic.
4. Deep-to-deep (no tab on either side): `isDeepToDeep=true`, `morph` rest `0` both sides, `rootLayerStyle` stays `translateY(-100%)` regardless of `slideT`. `layerDownStyle` is `translateY(0)` (no `morph` dependence). No visible change. Verify `e2e/header-title-crossfade-clip.spec.ts` unaffected.
5. Root-search scrub: `searchScrubbing` keeps its own term; unaffected. Verify `e2e/search-enter-exit-asymmetry.spec.ts` stays green.
6. Forward direction (tab → deep): `navInFlight` never set; unchanged.
7. Click nav where `morph` rest is stable (e.g. deep→deep with no tab flip): `slideT='200ms'` but `morph` does not change → no animation, no flicker.
8. The title layer (`layerDownStyle`) animates together with the tabs layer on back-to-tab (both read `slideT`); desired, as they are the two halves of one morph.
9. `trackStyle`/`searchButtonStyle`/`tabBarStyle` (`Header.svelte:~587,599,606`) read `navInFlight` directly and remain suppressed during a chip exit. They are the horizontal search track, visible only in `isSearch` (false on `/bookmarks ↔ /messages/inbox`), so no visible regression. Documented inconsistency, not blocking.

## 7. Testing plan

- **Existing regression gate (must flip to green):** `e2e/header-tab-descent-cross-tab-exit.spec.ts` DEFECT asserts `slideT !== 'none'` at every back-to-tab landing flush (the `landings(snaps, 'in')` analysis on `window.__headerLog`). Currently fails 6/6; passes after the fix.
- **CALIBRATION (updated with the fix, see §5):** the CALIBRATION test's back-landing `slideNone` assertion flips `true → false` and its name changes asymmetry → symmetry, so it documents the post-fix forward-smooth / back-smooth symmetry. The `navInFlight === true` assertion stays (unchanged by the fix). Forward-landing expectations stay.
- **§4.4 empirical gate (the §4.3-vs-Variant-B decider):** run `e2e/header-tabs-replay.spec.ts` (gesture back-swipe release) with the term removed. It MUST stay green, proving the settle behavior is unchanged (slideT stays `'200ms'` during settle). If it regresses, Variant B is reconsidered.
- **No-regression suite (must stay green):** `header-tabs-replay.spec.ts`, `tab-exit-preview.spec.ts`, `header-title-crossfade-clip.spec.ts`, `search-enter-exit-asymmetry.spec.ts`, `swipe-back-pill-flicker.spec.ts`, `enter-animation.spec.ts`, `tab-click-transition.spec.ts`, plus the FAB specs `fab.spec.ts`, `fab-deep-real-interaction.spec.ts`, `fab-release-snap.spec.ts` (insurance: the removed term was added in a FAB-gesture-tracking commit `23d711b9`; the FAB reads `navInFlight` in `src/lib/components/templates/FloatingActionButtonLayer`, not via Header's `slideT`, so no interaction is expected, but the gate confirms it). Pre-existing red DEFECT tests in unrelated specs (`fab-deep-page-boundary.spec.ts`, `header-title-crossfade-clip.spec.ts`, `mobile-tab-pager-swipe-preview-height.spec.ts`, `search-back-hamburger-flash.spec.ts`) are recorded as pre-existing and not caused by this change.
- **Empirical trajectory probe (audit-time):** an auditor samples `getComputedStyle(rootLayer).transform` (or `window.__headerLog`) across a real back-to-tab nav and asserts the descent trajectory is monotonic with intermediate frames, not a single-step jump.
- **Audit gates:** `bun run check` 0 errors; `bun run lint` exit 0; `git diff -- Header.svelte` shows ONLY the `slideT` term removal (one expression, plus the dead `navStore.navInFlight` read cleanup); `git diff -- e2e/header-tab-descent-cross-tab-exit.spec.ts` shows ONLY the CALIBRATION back-landing `slideNone` assertion flip + test-name update (DEFECT and forward-landing assertions unchanged); `git diff -- navigation.svelte.ts` empty; `git diff -- navigation-logic.ts` empty; `git diff -- GesturePageLayout.svelte` empty; every other shared primitive empty.
- **Audit loop:** 5 agents, cycle until 5/5 unconditional PASS (DV04 pattern). `docs/DV12-Meeting/DV12-Audit-R[round].md` + `docs/DV12-Meeting/DV12-Plan-Journal.md` per round.

## 8. Out of scope

- Desktop Header (no morph, no GPL track).
- Redesigning the GPL exit branches (the same-panel slide and cross-tab chip overlay stay the primitives they are; only the Header layer transition is un-suppressed).
- The sibling open defects (`fab-deep-page-boundary`, `header-title-crossfade-clip`, `mobile-tab-pager-swipe-preview-height`, `search-back-hamburger-flash`); each has its own spec and is not touched here.
- Removing the dev-only `__headerLog` probe (retained for future diagnosis; DEV-gated, zero prod cost).
- Unifying the `trackStyle`/`searchButtonStyle`/`tabBarStyle` `navInFlight` reads with the new `slideT` behavior (documented inconsistency, no visible regression today).

## 9. UNVERIFIED items for the audit

- **Does removing the whole `(navInFlight && !settling)` term keep the gesture-settle behavior byte-identical?** Static trace says yes (`runSettleDriver:429` sets `settleProgress` once; `slideT` is `'200ms'` during settle today and after). Memory `svelte-effect-pre-same-flush-rerun` says static reasoning about Svelte 5 timing is unreliable. The §7 empirical gate (`header-tabs-replay.spec.ts` with the term removed) decides. The audit may run it.
- **Is there any click/tab-tap navigation where `morph`'s rest value changes during the formerly-suppressed window and we would NOT want it to animate?** The fix animates the layer whenever `morph` rest changes and `!dragging && !searchScrubbing`. The audit checks for a path where this is undesirable (none expected: if `morph` rest changes, the layer should animate; the only suppress-worthy cases are drag and scrub, both retained).
- **The compositor-thread immunity claim (§4.5).** The fix asserts a `transform` transition runs on the compositor once started, so the headless main-thread block does not cause a partial snap. The audit confirms this is the correct mental model for CSS `transform` transitions (well-established) and that the headless three-frame gap was caused by `slideT='none'`, not a dropped transition.
- **Citation accuracy.** All §3 file:line citations were corrected in R2 after R1 drift (`onBack` 687-699; Effect D 351-362; beforeNavigate guard 741-748; gesture `setPendingNav` callers 639/651/662/689/699). The audit re-verifies against current source.
