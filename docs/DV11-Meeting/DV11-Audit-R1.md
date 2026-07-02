# DV11 - Audit Round 1

5 independent role-less auditors examined `docs/DV11-Plan.md` (v1) against the codebase at `6a35937`, under an open-ended mandate (find ANY defect; do NOT limit scrutiny to the plan's self-identified concerns). Result: **not 5/5 PASS**. 5 of 5 returned FAIL, all high confidence, organic clean (one borderline has-special-cases). Three convergent blockers drive the Round-1 revision.

> Note on process: an earlier Round-1 pass was run with a leading prompt that handed auditors the plan's own §8 audit points plus pinpoint line citations. That narrowed their vision and was voided as a process violation (open-ended-audit principle). This document records the re-run open-ended audit. The verified-TRUE facts below are code observations that hold regardless of prompt.

## Tally

| Auditor | Verdict | Blocking | Major | Minor | Organic |
| ------- | ------- | -------- | ----- | ----- | ------- |
| 1       | FAIL    | 3        | 3     | 3     | clean   |
| 2       | FAIL    | 3        | 2     | 3     | clean   |
| 3       | FAIL    | 3        | 2     | 3     | clean   |
| 4       | FAIL    | 2        | 3     | 4     | clean   |
| 5       | FAIL    | 2        | 3     | 3     | clean   |

Result line: **not 5/5 PASS → revised.**

## Convergent blockers

### B1 - The screen-height freeze makes the regression e2e FAIL, not pass (BLOCKING, 5/5)

The plan §4.2 sets the freeze viewport to `freezeHeight = innerHeight - headerHeight` (~795 px) and §6.1 claims the existing `e2e/tab-swipe-preview-height.spec.ts` assertions flip green "unchanged" because "`vpHeight == freezeHeight` on both source-locked and dest-landed states." Verified false. The e2e asserts `duringForward.vpHeight === landedMessages.vpHeight` (`:177-185`) where `vpHeight = vp.clientHeight` (`:49`) and `landed*` is measured **at rest, after the freeze releases** (`:146/159`). At rest `viewportHeight = panelHeights[activeIndex]` (`MobileTabPager.svelte:302`) - the panel's content height (646 for messages, 2563 for activity), not screen height. Two auditors ran the e2e and confirmed `landedMessages.vpHeight=646`, `landedActivity.vpHeight=2563`. Under the freeze `duringForward.vpHeight ≈ 795`, so `795 === 646` fails; back is worse. The plan's own rest-release (§4.4) guarantees the landed measurement is content-height, contradicting §6.1.

### B2 - No release hook exists; `pendingCancel` is fabricated for the pager (BLOCKING, 5/5)

§4.4/§5/§7 wire freeze release to "the existing `afterNavigate`-equivalent settle, or the `onTrackTransitionEnd` settle used by the pager" and the cancel path to "`swipeEnd` else-branch / `pendingCancel`." Verified by grep: MobileTabPager has NO `afterNavigate`, NO `onTrackTransitionEnd`, NO `transitionend` listener. `pendingCancel` exists ONLY in `GesturePageLayout.svelte:271`. The pager's commit is `swipeEnd → switchTo/switchBackward → navStore.navigateForward/Backward` (`:190/211`); URL re-sync is the `$effect` at `:132-143`; the cancel branch is `:244-248` (nulls `dragOffset`/`showDeepPreview`/`backChipReveal` only). The release machinery the plan depends on does not exist in the target file.

### B3 - The freeze corrupts `panelHeights` via the `measureTab` ResizeObserver (BLOCKING, 2/5 blocking + convergent major)

`measureTab` (`MobileTabPager.svelte:314-322`) attaches a ResizeObserver to each `<section>` and writes `panelHeights[index] = node.offsetHeight`. The freeze sets each section's inline `height: ${freezeHeight}px` (§4.2/§5), so every section's `offsetHeight` becomes `freezeHeight`, the observers fire, and `panelHeights[0..2]` all become `freezeHeight`. On release, rest-mode `viewportHeight = panelHeights[activeIndex]` (`:302`) is now screen height, so a tall panel (activity, 2563) is pinned to screen height at rest and its lower content becomes unreachable. The plan §4.5 asserts "`measureTab`/`panelHeights`: unchanged … the freeze ignores them" - the causal direction is backwards: the observer observes the freeze. (This is the sharpest finding the voided leading-prompt round under-weighted; the open-ended round surfaced it as blocking.)

## Convergent majors (non-blocking, addressed in revision)

- **M1 - Freeze entry is not atomic; no rAF re-apply (5/5).** §4.3 claims the height/overflow/scrollTop swap and `window.scrollTo(0,0)` land "in the same frame via `$effect` flush." But `window.scrollTo`/imperative writes inside the `swipeMove` DOM handler run synchronously, BEFORE the `$derived` style reflow (microtask-scheduled); writing `scrollTop` on a section not yet `overflow-y:auto` is a no-op. The cited precedent `GesturePageLayout.svelte:286-320` uses a `requestAnimationFrame` re-apply for exactly this; the plan drops it. (Sibling failure mode to memory `svelte-effect-pre-same-flush-rerun`.)
- **M2 - destScroll uses the wrong store (auditor 1, sharp).** §6.2 resolves dest scroll via `pageScrollStore`. Verified: `pageScrollStore` is written ONLY by `+layout.svelte:65` (beforeNavigate, from-path) and GPL panel `onscroll` (`:963/1007`). The `(tabs)` layout restores tab-scroll via SvelteKit `snapshot` (`(tabs)/+layout.svelte:48-67`, capture `window.scrollY`, restore through a `$state`+`$effect` before paint) and `getListScrollStore` (`:28/105-108`, discussions-list-only) - NOT `pageScrollStore`. Tab roots carry no hash (`landAtAnchor` runs only on `/discussion/*`), so the hash tier is dead for the tab-slide branch. The "three-tier chain reuse" framing is wrong for this scope.
- **M3 - The paint/padding rationale cites CSS that never applies (4/5).** §3.5/§6.3 invoke `.scroll-pane`/`.gpl-card` (`app.css:325-341`) as the dest's paint source. Those rules are scoped to `html.fixed-viewport`, added ONLY by `GesturePageLayout.svelte:866`, never on `(tabs)` routes. The pager sections are `class="w-1/3 shrink-0 p-3"` with `data-tab-panel` (`:376/391/408`) - NOT `.scroll-pane`/`data-preview-tab`, no `.gpl-card`. Paint comes from the section's `p-3` + the ancestor `.dual-column-layout-columns` card.
- **M4 - Conflicting `window.scrollTo` + header-hidden-at-start + neighborOffset re-sync + mid-freeze dest scroll (multiple).** `switchTo`/`switchBackward` already call `window.scrollTo(0,0)` (`:193/213`); the plan adds `scrollTo(0, destScroll)` on commit - race. `freezeHeight` is captured before `swipeMove`'s trailing `scrollChrome.show()` (`:188`), so a swipe started while the header is hidden under-sizes the freeze viewport by `headerHeight`. `neighborOffset` (`:332`) updates one rAF after the release `scrollTo` → a one-frame jump. If the user scrolls the dest section mid-freeze, the release `destScroll` is stale.
- **M5 - `setScrollContainer` vs `setOverride` conflation (auditor 2/3).** §5 misdescribes the scroll-chrome API: `setScrollContainer` (`:164`) is the container swap; `setOverride` (`:182`) is the nested-scroller override (used by `SearchScopePager.svelte:135`); GPL reads `override ?? centerEl` (`:331`). Behaviorally safe (pager/GPL not co-mounted), but the rationale is wrong.

## Convergent revision suggestion → v2 direction

Multiple auditors independently concluded the e2e's `vpHeight`-equality assertions cannot hold under ANY screen-height freeze, because the landed viewport is content-height. The only mechanism that satisfies the e2e AND does not corrupt `panelHeights` is to size the swipe-time viewport to the **dest panel's measured height** (`panelHeights[destIndex]`), not screen height: the sections stay at their natural height (so `measureTab` is unaffected - B3 dissolves), the viewport `height` derivation swaps `activeIndex`→`destIndex` during the swipe (so swipe-time `vpHeight` exactly equals landed `vpHeight` - B1 dissolves), and the derivation reverts automatically when the swipe ends (`activeIndex` becomes `destIndex` at commit, so no release hook is needed - B2 dissolves). The source panel, if taller, clips below the dest height as it exits; that compromise falls on the exiting panel, which the e2e does not assert against and which matches the user's reported concern (the dest preview).

**Revision decision (v2):** replace the screen-height freeze with a **track-dest viewport** model:

- `viewportHeight = panelHeights[destIndex]` while a tab-slide swipe is in progress, else `panelHeights[activeIndex]` (a derivation, not a state machine).
- Source scroll-capture: at swipe entry capture `sourceScrollY = max(0, window.scrollY)`, lock `window.scrollY` to 0, and translate the source section by `-sourceScrollY` (rAF re-applied) so its visible region stays put when the viewport height changes.
- Entry guard: `dragOffset === null && !showDeepPreview && backChipReveal === null` (the tab-slide branch only).
- destScroll: deferred to the `(tabs)` layout's existing mechanism (SvelteKit `snapshot` + `getListScrollStore`); the freeze-time preview shows the dest at top, matching a fresh landing. State this limitation honestly; drop the pageScrollStore/hash-tier framing.
- No `fixed-viewport`, no per-panel internal-scroll, no `scrollChrome.setScrollContainer` swap (the window stays the scroller; the source translates).
- Release is implicit (derivation reverts; `activeIndex===destIndex` at commit makes the viewport continuous). The cancel path resets `window.scrollY` to `sourceScrollY` and clears the source translate in `swipeEnd`'s else-branch (`:244-248`).
- Paint rationale corrected: the frame adds nothing; dest paint = section `p-3` + ancestor card, identical at swipe-time and landing (same element).
- Address M4 explicitly: reconcile the commit `scrollTo`, capture `freezeHeight`/`sourceScrollY` after `scrollChrome.show()`, re-sync `neighborOffset`, handle resize.

## Verified-TRUE facts carried forward

- `MobileTabPager.svelte:302` `viewportHeight = panelHeights[activeIndex]`; `:311-313` `viewportStyle = flex: 1 0 auto[; height: ${viewportHeight}px]`; `:364/365` viewport `overflow-hidden`. `activeIndex` changes only in `switchTo:190/switchBackward:211`. Defect diagnosis (source-pinned viewport) is correct (two auditors re-ran the e2e: `forward preview=2563 landedMessages=646`, `back preview=646 landedActivity=2563`, `clip=1917px`).
- `measureTab` (`:314-322`) observes each `<section>` offsetHeight into `panelHeights`; the three sections (`:376/391/408`) are `w-1/3 shrink-0 p-3` with `data-tab-panel`, NO `bind:this` (only `use:measureTab={n}`), NO `.scroll-pane`/`.gpl-card`/`data-preview-tab`.
- MobileTabPager has NO `afterNavigate`, NO `onTrackTransitionEnd`, NO `transitionend` listener; `pendingCancel` is GPL-only (`GesturePageLayout.svelte:271`). Commit = `switchTo/switchBackward → navStore.navigateForward/Backward`; URL re-sync = `$effect :132-143`; cancel = `:244-248`.
- `html.fixed-viewport` added ONLY by `GesturePageLayout.svelte:866`; `(tabs)/+layout.svelte:118-130` mounts MobileTabPager without it. `app.css:325-341` (`.scroll-pane`/`.gpl-card`/`data-preview-tab`) all gated on `fixed-viewport` - do not apply to the pager.
- `(tabs)/+layout.svelte:48-67` restores tab scroll via SvelteKit `snapshot` (capture `window.scrollY`, restore through `restoredScrollY` `$state` + `$effect` before paint) + `getListScrollStore` (`:28/105-108`, discussions-list). NOT `pageScrollStore`.
- `GesturePageLayout.svelte:286-320` scroll-restore precedent uses `$effect` + `requestAnimationFrame` re-apply - the rAF discipline v1 dropped.
- `swipeMove:174-177` - the `deepPageSnapshot.hasSnapshot` sub-branch sets `showDeepPreview=true` AND `dragOffset=follow(deltaX)`; the tab-slide is the `else` at `:186`.
- `switchTo:193`/`switchBackward:213` already call `window.scrollTo(0,0)`; `swipeMove:188` calls `scrollChrome.show()` at end (after any `freezeHeight` capture).
- `scroll-chrome.svelte.ts`: `setScrollContainer` (`:164`) ≠ `setOverride` (`:182`); GPL reads `override ?? centerEl` (`:331`); `SearchScopePager.svelte:135` is a second override-setter.
- The §2 shared-clip-rectangle diagnosis and the independent-geometry direction are unanimously endorsed; the failure is the v1 mechanism (screen height + GPL CSS substrate), not the diagnosis.
