# DV17 - Plan Audit Round 04

**Note on method.** A first R4 pass used prompts that pre-announced the Round-3 revisions (NB6 sign, NB7 guard) and framed the round as "target: FINAL / 5/5", asking each auditor to confirm each prior blocker "RESOLVED". That is the "verify fix X" frame the `audit-prompts-open-ended-not-fix-verification` memory forbids: it biases toward confirmation and hides new problems. That pass returned 2 PASS / 3 CHANGES_REQUESTED and is **discarded as contaminated**. This document records the re-run: 5 auditors with the SAME open-ended prompt (no roles, no pre-announcement of any prior-round fix, no "target", no "confirm RESOLVED" - only "independently find ANY defect; do not trust the plan; verify empirically").

5 role-less open-ended auditors re-examined `docs/DV17-Plan.md` (Round 3) with the open prompt. Result: **1/5 PASS, 4/5 CHANGES_REQUESTED** (all high confidence). The Round-3 sign fix (NB6) holds, but the open audit uncovered two deeper architectural defects the prior framing had suppressed. Round-5 input is the revision in "Revision decisions".

## Tally

| Auditor | Verdict           | Blocking | Organic | Confidence |
| ------- | ----------------- | -------- | ------- | ---------- |
| 1       | changes_requested | 3        | clean   | high       |
| 2       | changes_requested | 3        | clean   | high       |
| 3       | PASS              | 0        | clean   | high       |
| 4       | changes_requested | 3        | clean   | high       |
| 5       | changes_requested | 4        | clean   | high       |

## Blocking issues (deduplicated)

**NB8 (4/5) - the enter detection mechanism is on the wrong component (ephemeral vs persistent).** `/` renders `MobileTabPager` (`(tabs)/+layout.svelte:101`); `/search` renders a fresh `GesturePageLayout` (`search/+page.svelte:47`). They are different components under different route groups, so the `/search` GPL mounts fresh on every `/` → `/search` tap - it cannot observe the route it did not exist for. The Round-3 enter condition (`resolveHeaderMode(prevPathname) === 'root' && resolveHeaderMode(currentPath) === 'search'`, with `prevPathname` maintained by a `$effect.pre` on the `/search` GPL) therefore has no valid first-mount value: `''` → `resolveHeaderMode('') === 'deep'` → condition fails → the rAF never arms on the primary use case (the whole point of DV17); `null`/`undefined` → `resolveHeaderMode` throws. §4.4 (component-local `prevPathname`) also contradicts §4.6 (`navStore.activeStack[len-2].pathname`), and the stack source false-arms on a `/search` deep-link (`initNav`/`seedStackForLanding` seeds `[/, /search]`). Separately, thread routes `/discussion/<id>` and `/messages/<id>` resolve to mode `'root'` via `getCurrentTabIndex`, so `/discussion → /search` would false-arm under any mode-based check. The deleted Effect E worked precisely because `Header.svelte` is AppShell-level and persists across every route; its `prevHadTabs`/`prevIsSearch`/title-unchanged guards capture the cross-route transition.

**NB9 (auditor 4, auditor 5) - the exit rAF's `setTapMorph(null)` at completion causes a Header-track flash and stalls the dispatch poll.** On exit (`/search` → `/`), the rAF runs pre-nav in the `/search` GPL. At completion it calls `setTapMorph(1)` then `setTapMorph(null)` in the same tick (Svelte batches them; the derived `morph` sees only `null`). At that moment `page.url.pathname` is still `/search` → `currentHasTabs === false` → `morph` rest = 0 → `searchProgress = 1` → `trackStyle translateX = -50%`. The Header track snaps from the rAF terminal (`0%`, panel 0) back to `-50%` (panel 1, `/search`) in one flush, then animates `-50% → 0%` again after nav lands - a visible double-slide on the Header track while the Page panel does not snap (its `trackTranslateX` is identical at rAF end and after clear). The asymmetry vs enter (where `currentPath` is already at the destination by rAF end) is the root cause. Compounding: the same `setTapMorph(null)` clobbers the transform that `startPendingNavPoll` (`:572-619`) polls, so the poll never reaches its epsilon and falls through to the 800ms wall-clock cap - the exit slide takes ~800ms instead of ~200ms.

**NB10 (auditor 5) - the exit dispatch description contradicts the implementation.** §4.4 item 2 says the same-panel `beforeNavigate` "owns the ~200ms slide window before `onTrackTransitionEnd` dispatches". But §4.4 item 3 suppresses CSS `transition-transform duration-200` while `tapMorph !== null`, so no `transitionend` fires and `onTrackTransitionEnd` (`:717`) cannot run. The dispatch is poll-only (`startPendingNavPoll`); the plan documents this only in §9 UNVERIFIED, while §4.4 item 2 states the opposite.

**NB6 (Round 3) - RESOLVED (5/5).** The sign correction (`tapVisualOffset = W · max(0, (tapMorph − 0.2)/0.8)`, both directions) is geometrically correct. Verified at enter start (`tapMorph=1` → offset `+W` → `translateX = 0`, panel 0) and at `tapMorph ≤ 0.2` (offset 0 → `translateX = -W`, panel 1); exit is the reverse.

## Notable concerns (non-blocking)

- **Effect E safety guards dropped.** The deleted Effect E guarded on `dragging`, `settling`, `lastGestureMorph > epsilon`, and title-unchanged. The Round-3 enter condition checks only `tapMorph === null`, path inequality, and mode flip; a gesture just released then a tap is not analyzed.
- **`setTapMorph` "sole caller" wording.** §4.4 item 1 says the rAF is the sole caller, but §4.4 item 2 also calls `setTapMorph(null)` from drag-cancel/unmount/second-tap paths.
- **§6 case 2 "mirror" hides the enter/exit asymmetry** that causes NB9.
- **e2e sync assertion may be tautological post-fix** (both tracks consume the same `tapMorph`); it is a valid regression guard but overstates what it proves.
- **`iconProgress` `&& currentHasTabs` term is dead** during the rAF (`currentHasTabs === false` while `currentPath === '/search'`).
- **Citation drift:** §3.1 `:408-434` (drag publish is `:404-424`); §5 `:516-519` (cleanup spans `:516-520`); §3.4 "fifth branch" (count stays four: scrub deleted, tap added).
- **`W` is non-reactive** (`:180`, pre-existing); the plan repeats the inaccurate "read per-frame" claim.

## Organic-clean

Clean (5/5). The `resolveHeaderMode` import introduces no literal `/search` token in shared primitives; the `tapMorph` field is a general gesture-signal concept. Header loses ~50 lines of `/search` machinery. (Note: under Round-5 the publisher may move back to Header, which further reduces GPL's `/search` coupling.)

## Revision decisions (applied to `docs/DV17-Plan.md` as Round 4 → Round 5)

The Round-3 design placed the tap-morph publisher in the `/search` GPL. NB8 shows the `/search` GPL is the wrong site: it mounts fresh per navigation and cannot detect a cross-route transition. Round 5 relocates the publisher to the **persistent `Header.svelte`**, which is AppShell-level and survives every route - exactly the property the deleted Effect E relied on.

1. **Publisher in Header, consumer in GPL (NB8).** Header keeps a detection `$effect.pre` (the Effect E shape, with its `prevHadTabs`/`prevIsSearch`/title-unchanged guards intact) that fires on a root↔search tap. Instead of the deleted `startSearchScrub` writing a local `searchScrubbing` state, it writes `pager.setTapMorph(from → to)` and runs the interpolation rAF in Header. `morph`'s new arm reads `pager.tapMorph`. The `/search` GPL only CONSUMES `pager.tapMorph` for the Page-slide headroom (`tapVisualOffset`) and CSS suppression - it no longer detects or publishes. This resolves the first-mount gap (Header is persistent), the §4.4/§4.6 contradiction (one source: Header's tracked prev state), the deep-link exclusion (Header's `prevIsSearch` + title guard), and the thread-route false-arm (the title-unchanged guard excludes `/discussion → /search`).
2. **Exit `tapMorph` clear timing (NB9).** The rAF runs in the persistent Header, so it survives the exit navigation. It does NOT call `setTapMorph(null)` at completion; instead it holds the terminal value until nav lands (Effect D / `navInFlight` clear), at which point `currentHasTabs` has flipped and `morph`'s rest value equals the rAF terminal, so clearing `tapMorph` is jump-free. This removes the Header-track flash and stops clobbering the poll.
3. **Exit dispatch wording (NB10).** §4.4 item 2 is corrected: during a tap scrub CSS is suppressed, so dispatch is poll-only (`startPendingNavPoll`); `onTrackTransitionEnd` does not fire on this path.
4. **SearchScopePager same-route.** Header's persistent detection does not re-fire on a `/search → /search?scope=` query-only change (`page.url.pathname` is unchanged, and `prevIsSearch === curIsSearch`), so the rAF does not arm. No `prevPathname` machinery needed in GPL.

Open for Round 5: confirm Header-side publisher resolves NB8 across enter, exit, deep-link, thread-route, and scope-switch; confirm the exit clear-timing removes the NB9 flash and the poll stall; confirm GPL consuming `tapMorph` (no longer publishing) keeps the Page-slide headroom correct; and the empirical first-frame sample (the `$effect.pre` publisher is now on the persistent Header, so the flash-free precedent is direct).
