# DV17 - Plan Journal

Append-only log of the 5-agent open-ended audit loop for the search tap-enter Page/track desync fix. Each round: 5 independent auditors (no roles, no steering, read-only, no git mutation of the shared worktree) examine `docs/DV17-Plan.md` against the real codebase and the working-tree diff; loop until 5/5 unconditional PASS (DV04 / DV09 / DV16 pattern). The defect this plan corrects was analyzed statically and traced to its structural cause before drafting; the desync is reproducible from the code paths cited in §2.

## Round 0 - initial draft

The plan was drafted after a static trace of the root↔search morph data flow on both the drag path and the tap path, and a side-by-side comparison of the two.

What is fixed and why:

- **Defect.** On a tap enter `/` → `/search`, the Header search-track `translateX` (`Header.svelte:636`) reaches rest in ~83ms while the GesturePageLayout Page-panel `translateX` (`GesturePageLayout.svelte:469`) slides over 200ms. The two slides run on independent clocks (Header `startSearchScrub` rAF easing `morph 1→0` over `TITLE_CROSSFADE_MS`; Page `snapIndex 0→ACTIVE` eased by CSS `duration-200`) and the Header track occupies only `morph [0.2,1]` - the first 83ms under the `(1-t)^3` easing - while the Page slide runs the full range.
- **Underlying cause.** On a drag, the Page slide reads `visualDragOffset` (`GesturePageLayout.svelte:446-454`), which subtracts `W * HEADER_MORPH_THRESHOLD` headroom, so the Page slide and the Header track slide both occupy `morph [0.2,1]` and move together; the first 20% is the Tab collapse with both slides idle. The tap path has no equivalent headroom on the Page slide - it is a full-range `snapIndex` jump eased by CSS - so the Page slide does not share the Header track's segment or clock. The tap and drag are not isomorphic at the Page slide.
- **Structural fix.** Publish the tap enter/exit morph from GesturePageLayout (the gesture signal source, matching the drag) into `pager.backMorph`, and give the Page slide the `HEADER_MORPH_THRESHOLD` headroom on the tap path so it occupies `morph [0.2,1]` exactly as `visualDragOffset` does on a drag. The Header `morph` already reads `pager.backMorph`; `startSearchScrub`, its state, and Effect E are removed. The tap and drag then use the same store signal and the same headroom; the Page slide and the Header track slide share one clock and one segment.
- **Preventive test.** `e2e/search-enter-exit-asymmetry.spec.ts` gains an ENTER assertion sampling the Page panel translate and the Header track translate in the same frames and asserting their normalized progress curves stay within a tight band, plus a CALIBRATION variant documenting the desync on master. This guards the cause pattern (a slide that does not share the morph segment) and is tautology-resistant because each sample keys resolved `getComputedStyle` matrices to the live pathname.

Why the defect survived prior work:

- DV08 delivered the `/search` redesign and the `startSearchScrub` rAF precisely so the tap enter would mimic the drag's continuous morph (slide-then-expand). The scrub unified the Header track and the Tab, but it did not unify the Header and the Page - the Page slide kept its independent CSS clock. The desync between the Header track and the Page panel was therefore present from DV08 and never observed.
- `search-enter-exit-asymmetry.spec.ts` asserts slide-before-expand (ordering), not slide-equal-duration (sync). A desynced-but-ordered enter passes. No spec samples the Page panel translate alongside the Header track translate.

Owner-locked decisions carried in from the analysis (not relitigated by the audit):

- The fix is the tap/gesture isomorphism at the Page slide: the tap publishes `backMorph` from GPL and the Page slide gains headroom. Extending the duration, splitting Tab out of `morph`, or speeding the Page slide are rejected (§4.5).
- `startSearchScrub` and Effect E are deleted, not retained alongside the GPL publisher. The tap morph comes from GPL, the gesture signal source, mirroring the drag.
- `HEADER_MORPH_THRESHOLD` and `TITLE_CROSSFADE_MS` are unchanged.

Open questions for Round 1 (the §9 UNVERIFIED items): `backMorph` single-writer discipline under a GPL tap rAF; CSS `duration-200` suppression and re-enable on the tap Page slide; the composition of `enterRaf` (`snapIndex` flip) with the new tap morph rAF; SSR (`backMorph` null pre-hydration); the blast radius of removing Effect E and the `searchScrubbing` gates; and whether the `morph` derived needs a non-dragging tap arm now that the scrub branch is gone (the `dragging` flag is false on a tap, so `morph` would otherwise fall to settle/rest).

## Round 1 - 0/5 PASS, 5/5 changes_requested → revised

Five independent open-ended auditors examined the Round-0 plan against the codebase at the current working tree. Result: **0/5 PASS, 5/5 changes_requested** (all high confidence). All five accepted the §1-§3 diagnosis (the drag synchronizes Page and Header track via shared `morph [0.2,1]`; the tap does not, because the Page slide has no headroom). All five rejected the §4 design as not implementable as written. Full detail: `docs/DV17-Meeting/DV17-Audit-R1.md`.

Convergent blockers (deduplicated across the five):

- **B1 (5/5).** `morph` reads `pager.backMorph` only in its `dragging` arm. On a tap `dragging === false`; deleting the scrub branch makes `morph` fall to rest and jump, regressing ENTER/MIRROR. The plan's §4.4 item 3 ("morph flows through existing arms reading backMorph") is contradicted by its own §9 item 6.
- **B2 (4/5).** The GPL pager `$effect` (`GesturePageLayout.svelte:344-443`) publishes `pager.set` (all fields, atomically) on every dep change; it clobbers whatever a tap rAF writes to `backMorph`.
- **B3 (4/5).** The Header consumer gates (`slideT`/`trackStyle`/`tabBarStyle`/`searchButtonStyle`) lose their CSS-transition suppression when `searchScrubbing` is deleted; on a tap the CSS transition and the rAF fight.
- **B4 (3/5).** `iconProgress` (`Header.svelte:194`) references `searchScrubbing`; §5 omits it, the deletion is a compile error, and without a replacement freeze the icon visibly morphs during the tap.
- **B5 (3/5).** The tap rAF arming points are under-specified. The `/search → /` back-tap routes through the same-panel exit branch (`:797-822`), a third arming point the plan never names; and the `/search` GPL unmounts at route land while `/`'s `MobileTabPager` forces `backMorph: null`.
- **B6 (3/5).** GPL cannot cleanly identify `/search`. `currentHasTabs` alone misfires on 22+ deep routes; `isSearch` requires `resolveHeaderMode` (a `/search` token) or a `route-config` change with blast radius. The §4.6 organic-clean claim is unverifiable.
- **B7 (1/5, promoted).** The headroom makes the Page slide occupy `morph [0.2,1]` = 83ms under the `(1-t)^3` easing, contradicting §4.5's rejection of an 83ms Page slide.

Revision decisions (applied to `docs/DV17-Plan.md` as Round 1):

1. **Independent `tapMorph` field (B1, B2, FAB coverProgress).** `mobile-pager.svelte.ts` gains `tapMorph: number | null`; the GPL tap rAF is its sole writer; the drag `$effect` never writes it. `morph` gains an arm `if (pager.tapMorph !== null) return pager.tapMorph` between the drag and settle arms. No `dragging: true`, no scrub branch. `set` preserves `tapMorph` when omitted by the drag `$effect`.
2. **Linear easing on the tap path (B7).** The rAF interpolates `tapMorph` linearly (matching the drag's linear-in-finger `backMorph`). The Page slide and Header track then occupy `morph [0.2,1]` = ~160ms synchronized; the residual gap to 200ms is the cost of keeping slide-then-expand, acknowledged.
3. **Replace `searchScrubbing` gates with `tapMorph !== null` (B3, B4).** All four consumer gates plus `iconProgress` freeze on the tap signal.
4. **Name all three arming points (B5).** Enter at `/search` `onMount`; exit at the `/search` same-panel `beforeNavigate` (`:797-822`) over its ~200ms slide window; cross-tab chip-exit does not arm. `MobileTabPager`'s `backMorph: null` does not touch `tapMorph`.
5. **GPL detects `/search` via `resolveHeaderMode` (B6).** No literal `/search` token in GPL; §4.6 is rewritten to document the GPL → `header-mode` dependency as a relocated coupling (net-neutral to cleaner, since Header's Effect E is deleted).
6. **Page-slide headroom via `tapVisualOffset` mirroring `visualDragOffset` (with the `Math.max(0,…)` clamp); CSS suppression on `tapMorph !== null`.**
7. **SSR / isMobile.** The `tapMorph` arm falls through to rest when null; the rAF arms only on an actual navigation and only on mobile.
8. **Full Effect E deletion list**, separating the Effect-E-only state (`prevHadTabs`/`prevSearchTitle`/`prevIsSearch`) from the Effect-C-shared state (`prevPath`/`lastPath`/`prevHasTabs`, kept).
9. **Strengthen the e2e sync assertion** to rAF-driven 1:1 (tighter tolerance, single-frame), with a CALIBRATION failing on master.

The Round-0 owner-locked decision "the tap publishes `backMorph` from GPL" is superseded: the tap publishes a dedicated `tapMorph`, because B1 showed `morph` cannot read `backMorph` without `dragging: true` (cascading side effects) and B2 showed the drag `$effect` clobbers a shared `backMorph`. The tap/gesture isomorphism invariant is retained (both paths publish a continuous morph-shaped signal consumed by the same source-agnostic `searchProgress`/`tabProgress`); only the store field is split so the two writers never collide.

Open for Round 2: the `tapMorph` arm's interaction with Effect A (`lastGestureMorph`) and Effect C (settle) - a tap must not arm a phantom settle; the exit rAF timing inside the `beforeNavigate` window vs `onTrackTransitionEnd`; whether 160ms is acceptable or the segmentation threshold must be revisited; and the `resolveHeaderMode` import's organic-clean standing.

## Round 2 - 0/4 PASS (1 incomplete), 4/4 changes_requested → revised

Five independent open-ended auditors re-examined the Round-1 revision. Auditor 4 returned a connection error mid-response (excluded). Of the 4 valid: **0/4 PASS, 4/4 changes_requested** (all high confidence). The Round-1 `tapMorph` design resolved the seven Round-0 blockers (B1/B2/B4/B6/B7 fully; B3/B5 partial). Five new, narrower specification issues survived - all concrete and fixable, none threatening the `tapMorph` approach. Full detail: `docs/DV17-Meeting/DV17-Audit-R2.md`.

New convergent blockers:

- **NB1 (4/4).** The plan unified all four Header gates under `dragging || tapMorph !== null || navInFlight`, but `slideT` (`Header.svelte:205-207`) deliberately EXCLUDES `navInFlight` (comment `:195-204`): gating it suppresses the deep→root "Tab descent" descent on every GPL route. `slideT` must keep `dragging || tapMorph !== null` only; the other three gates keep `navInFlight`.
- **NB2 (2/4).** The tap rAF has no clean write path. `set` writes all fields atomically; the `?? currentTapMorph` preservation rule cannot clear (cannot distinguish omitted from explicit null), and routing the per-frame rAF through `set` hand-pumps the other six fields (race, `coverProgress` clobber).
- **NB3 (2/4).** The deleted Effect E was `$effect.pre` (same-render as the `currentHasTabs` flip); arming the rAF in `onMount` is one frame late, so the first post-nav render rests `morph=0` → `searchProgress=1` (search visible) before the rAF hides it: a flash.
- **NB4 (auditor 5).** The EXIT `isSearchFlip` reads `activeStack[len-2]`, but the root layout's `beforeNavigate` (`+layout.svelte:74` → `navigation-logic.ts:137-163`) pops/pushes the stack before GPL's `beforeNavigate` runs: `undefined` on popstate (crash) or equals `/search` on a same-tab link (misfire). Must compare current path vs `navigation.to.url.pathname`.
- **NB5 (auditor 3).** `tapVisualOffset` formula is unspecified (unitless `tapMorph` → pixels). The sync invariant rests on it.

Revision decisions (applied to `docs/DV17-Plan.md` as Round 2):

1. **`slideT` gate distinguished (NB1).** `slideT` = `dragging || pager.tapMorph !== null`; `trackStyle`/`searchButtonStyle`/`tabBarStyle` keep `navInFlight`.
2. **`setTapMorph` field-level setter (NB2).** `PagerStore.setTapMorph(value)`; rAF is sole caller; `set` preserves via `!== undefined ? : current`.
3. **Arm in `$effect.pre` (NB3).** Enter rAF in a `$effect.pre` (mirrors deleted Effect E timing), setting `tapMorph` synchronously before the first post-nav render.
4. **EXIT check current-vs-target (NB4).** `isSearchFlip(resolveHeaderMode(page.url.pathname), resolveHeaderMode(navigation.to.url.pathname))`.
5. **`tapVisualOffset` formula stated (NB5).** `sign · W · max(0, (tapMorph − 0.2)/0.8)`, combined with the `−ACTIVE·STEP_PERCENT%` base.
6. **§5** adds Effect E `onDestroy` cleanup (`:516-519`); **§7** adds a tap-EXIT e2e; §4.4 item 2 states the rAF clears `tapMorph` to null at natural completion.

The Round-1 design (independent `tapMorph`, new `morph` arm, GPL rAF sole writer, `resolveHeaderMode` detection, linear 160ms easing) is retained; Round 2 narrows to specification precision (gate split, setter API, arming timing, exit source, offset formula). Open for Round 3: the `$effect.pre` arming flash-free guarantee; the exit rAF completion inside the same-panel window vs `onTrackTransitionEnd`; the `setTapMorph` + preservation race; and the `slideT`/gate split leaving the deep→root descent intact.

## Round 3 - 0/5 PASS, 5/5 changes_requested → revised

Five independent open-ended auditors re-examined the Round-2 revision. Result: **0/5 PASS, 5/5 changes_requested** (all high confidence). Round-2 blockers NB1-NB4 are all RESOLVED; NB5 is PARTIAL. Two new, narrow blocking issues survive, both concrete and geometrically/code verifiable. The `tapMorph` architecture is fully endorsed; only a sign convention and an arming-condition guard need revision. Full detail: `docs/DV17-Meeting/DV17-Audit-R3.md`.

New convergent blockers:

- **NB6 (5/5).** `tapVisualOffset` enter sign is inverted. The plan's `sign = -1` on enter yields `translateX = -2W` (both panels off-screen) at `tapMorph = 1`, a blank viewport for ~160ms; the Header track slides correctly, so the desync is replaced by a worse blank-screen flash. The morph sweep direction already encodes enter vs exit; the spatial sign must be `+1` on both directions. Drop the `sign` parameter.
- **NB7 (auditor 2).** The enter `$effect.pre` misfires on a same-route `/search → /search?scope=` navigation (SearchScopePager.switchTo). `activeStack[len-2]='/'` so `isSearchFlip` reads true and the rAF arms, flashing the search panel off then re-slide-in on every scope tap. The deleted Effect E suppressed this via `curTabs === prevTabs` and `prevIsSearch`. Fix: track a `prevPathname` and require a strict root→search transition.

Revision decisions (applied to `docs/DV17-Plan.md` as Round 3):

1. **Drop the `tapVisualOffset` sign parameter (NB6).** `tapVisualOffset = W · max(0, (tapMorph − 0.2)/0.8)` for both directions.
2. **Strict root↔search arming with a tracked `prevPathname` (NB7).** Enter arms only when `prevPathname !== currentPathname && mode(prevPathname)==='root' && mode(currentPathname)==='search'`; exit is the symmetric `mode(page.url.pathname)==='search' && mode(navigation.to.url.pathname)==='root'`. The `$effect.pre` short-circuits when `tapMorph !== null` (no re-arm mid-sweep). This excludes same-route scope switches and `/search ↔ deep`.
3. **Pin non-blocking items.** `iconProgress` keeps the `&& currentHasTabs` scope; rapid-tap restart resets to the start value; the exit dispatch is poll-only during a tap scrub (tap rAF armed before `startPendingNavPoll`); the tap-EXIT e2e uses `page.goBack()`; the search scope pager's `tapMorph` stays null (noted).

Open for Round 4: confirm the sign correction yields frame-for-frame Page/track sync (§7 assertion guards it); confirm the `prevPathname` arming excludes scope switches and fires exactly once per legitimate root↔search tap; and the empirical first-frame sample for NB3.

## Round 4 - method correction, then 1/5 PASS, 4/5 changes_requested → revised

A first R4 pass used prompts that pre-announced the Round-3 revisions and framed the round as "target: FINAL / 5/5", asking each auditor to confirm each prior blocker "RESOLVED". This is the "verify fix X" frame the `audit-prompts-open-ended-not-fix-verification` memory forbids. That pass (2 PASS / 3 CR) is discarded as contaminated. The re-run used 5 auditors with the SAME open-ended prompt (no roles, no pre-announcement, no target, no confirm-RESOLVED). Result: **1/5 PASS, 4/5 changes_requested** (all high confidence). The Round-3 sign fix (NB6) holds; the open audit uncovered two deeper architectural defects the prior framing suppressed. Full detail: `docs/DV17-Meeting/DV17-Audit-R4.md`.

New convergent blockers:

- **NB8 (4/5).** The enter detection is on the wrong component. `/` renders `MobileTabPager`, `/search` renders a fresh `GesturePageLayout`; the `/search` GPL mounts per-navigation and cannot observe the route it did not exist for. The `prevPathname` condition has no valid first-mount value (the rAF never arms on the primary `/` → `/search` tap), §4.4 (local state) contradicts §4.6 (`activeStack[len-2]`, which false-arms on a deep-link), and thread routes resolve to mode `'root'` so `/discussion → /search` false-arms. The deleted Effect E worked because `Header.svelte` is AppShell-level and persistent.
- **NB9 (auditor 4, 5).** Exit `setTapMorph(null)` at rAF completion fires while `page.url` is still `/search` (`morph` rest = 0), so the Header track snaps back to `-50%` then re-animates after nav lands - a double-slide. The same clear clobbers the transform `startPendingNavPoll` polls, stalling the exit dispatch to the 800ms cap.
- **NB10 (auditor 5).** §4.4 item 2 says `onTrackTransitionEnd` dispatches the exit nav, but CSS is suppressed while `tapMorph !== null`, so no `transitionend` fires; dispatch is poll-only. Documentation contradicts implementation.

Revision decisions (applied to `docs/DV17-Plan.md` as Round 5):

1. **Publisher in Header, consumer in GPL (NB8).** Header keeps the Effect E detection shape (`prevHadTabs`/`prevIsSearch`/title-unchanged guards) but, instead of `startSearchScrub` writing a local `searchScrubbing`, the rAF writes `pager.setTapMorph`. `morph` reads `pager.tapMorph`. The `/search` GPL only consumes `tapMorph` for the Page-slide headroom (`tapVisualOffset`) and CSS suppression; it no longer detects or publishes. Header is persistent, so first-mount detection, deep-link exclusion, and thread-route exclusion all inherit Effect E's proven behavior.
2. **Exit clear timing (NB9).** The rAF runs in the persistent Header and holds its terminal value until nav lands (`currentHasTabs` flips, `morph` rest equals the terminal), then clears `tapMorph` jump-free. No completion-clear; no Header flash; no poll clobber.
3. **Exit dispatch wording (NB10).** §4.4 item 2 corrected: poll-only during a tap scrub.
4. **SearchScopePager same-route.** Header's persistent detection does not re-fire on a query-only scope switch; no GPL `prevPathname` needed.

The Round-1..3 design placed the publisher in GPL; Round 5 moves it to Header (the persistent component), which is where the deleted Effect E already was. GPL's role narrows to consuming `tapMorph` for the Page-slide headroom - a cleaner split (Header owns the morph signal as it always has; GPL reads it for the Page slide as it reads `backMorph` for the drag). Open for Round 5: confirm the Header-side publisher resolves NB8 across enter/exit/deep-link/thread-route/scope-switch; confirm the exit clear-timing removes the NB9 flash and poll stall; confirm GPL consuming (not publishing) keeps the Page-slide headroom correct.

## Round 5 - 0/5 PASS, 5/5 changes_requested; architectural finding on EXIT

Five independent open-ended auditors (identical open prompt) examined the Round-5 plan. Result: **0/5 PASS, 5/5 changes_requested** (all high confidence). The publisher relocation to the persistent Header RESOLVES NB8 (no auditor revived it). But the open audit uncovered a topological defect on the EXIT direction and three enter-side timing defects. Full detail: `docs/DV17-Meeting/DV17-Audit-R5.md`.

New convergent blockers:

- **NB11 (5/5, architectural).** EXIT synchronization is topologically unreachable. On `/search → /`, the `/search` GPL `beforeNavigate` intercepts PRE-nav and plays the CSS slide before `page.url` updates; Header Effect E can fire only POST-nav. So the rAF publishes `tapMorph` after the `/search` GPL (the sole Page-side consumer) has unmounted, and `searchProgress = isSearch ? ... : 0` hard-cuts to 0 at the nav-land flush. ENTER does not have this problem (no pre-nav intercept; both slides run in parallel post-nav). Auditors 3 and 5 confirm the ENTER design is structurally correct.
- **NB12 (4/5).** The nav-land clear watch fires on the same flush as Effect E (tap navs never set `navInFlight`), killing the ENTER scrub as a no-op.
- **NB13 (auditor 1, 4).** Drag-cancel does not clear `tapMorph`; the morph arm order then returns a stale value post-settle.
- **NB14 (auditor 1).** EXIT terminal `tapMorph = 1` leaks stale into a later `/bookmarks` navigation.

Architectural conclusion: the DV17 §1 goal (synchronized motion on BOTH tap enter and tap exit) is only half-achievable in the current architecture. ENTER is achievable (Round-5 design correct modulo NB12-14). EXIT is topologically blocked under any publisher-in-Header design; closing it requires a pre-nav publisher (Header `beforeNavigate`) plus a `searchProgress` rewrite that does not hard-cut on the `isSearch` flip - a materially larger change.

This is a scope decision the owner must make (it is not resolvable by another audit round). Options: (A) reduce DV17 to ENTER-only (EXIT keeps pre-existing master behavior), revise the plan to fix NB12-14 on the ENTER side, proceed to 5/5 and implementation; (B) attempt the EXIT pre-nav publisher redesign, accepting a larger surface and more audit rounds; (C) pause DV17 and re-evaluate whether the ENTER-only sync is worth the change. The plan is held pending the owner's decision; no Round-6 revision is drafted until the scope is set.

## Round 6 - owner rejected ENTER-only scope as a band-aid; Round 7 restores full enter+exit sync

The owner rejected option A (ENTER-only) as a band-aid (violating fix-thoroughly and spec-substitution: the EXIT desync is the same cause as the ENTER desync, and the original DV17 goal is enter+exit sync). The correct path (option B) is the EXIT pre-nav publisher. Round 7 rewrites the plan to publish the ENTER signal post-nav (retained Effect E) and the EXIT signal PRE-nav (a new Header `beforeNavigate`), so the `/search` GPL - still mounted in the pre-nav window - consumes `tapMorph` for the Page-slide headroom on BOTH directions. A clear watch (`currentHasTabs === target && tapMorph === terminal`, latched) clears jump-free at nav-land on both directions.

## Round 7 - 0/5 PASS, 5/5 changes_requested; architecture endorsed

Five independent open-ended auditors examined the Round-7 plan. Result: **0/5 PASS, 5/5 changes_requested** (all high confidence). All five endorsed the architecture (Header `beforeNavigate` pre-nav publisher is feasible; SvelteKit registration order puts Header before the `/search` GPL; the GPL consumes `tapMorph` pre-nav; `searchProgress`'s `isSearch` hard-cut is jump-free at the rAF terminal). Five specification defects survive. Full detail: `docs/DV17-Meeting/DV17-Audit-R7.md`.

New convergent blockers:

- **NB15 (5/5).** The EXIT discriminator `resolveHeaderMode(to)==='root'` is too broad - `/activity`, `/messages/inbox`, `/discussion/*`, `/messages/<id>` all resolve to `'root'`, so `/search → /discussion/*` (tapping a search result, a primary flow) false-arms and the new `/discussion` GPL slides the wrong way. Fix: narrow to `navigation.to.url.pathname === '/'`.
- **NB16 (3/5).** Effect E fires on EXIT nav-land too (its guards do not distinguish direction); §3.5's "Effect E can only publish the ENTER signal" is false. Fix: add `if (!curIsSearch) return;`.
- **NB17 (2/5).** CSS-transition race: the GPL `beforeNavigate` starts the CSS slide synchronously, the Header rAF suppresses it ~16ms later, yanking the transform. Fix: `setTapMorph(start)` synchronously in `beforeNavigate` before the rAF.
- **NB18 (auditor 1).** `executePendingNav`'s programmatic redispatch re-fires `beforeNavigate` and re-arms the rAF. Fix: short-circuit when `tapMorph !== null`.
- **NB19 (auditor 5).** The clear-watch's `scrubTarget`/`scrubTerminal` latch is unspecified; a naive watch clears at the exit rAF's first tick. Fix: latch at arming.

Revision decisions (applied to `docs/DV17-Plan.md` as Round 8): narrow the EXIT discriminator to `to.url.pathname === '/'`; add the Effect E `if (!curIsSearch) return;` direction guard; call `setTapMorph(start)` synchronously in `beforeNavigate`; short-circuit re-arm when `tapMorph !== null`; latch `scrubTarget`/`scrubTerminal` at arming for the clear watch. Open for Round 8: confirm the narrowed discriminator excludes every non-`/` target reachable from `/search`; confirm the synchronous `setTapMorph` defeats the CSS race; confirm the latched clear watch holds the EXIT terminal across the pre-nav window and clears jump-free at nav-land.

## Round 8 - 2/5 PASS, 3/5 changes_requested → revised (first PASSes)

Five independent open-ended auditors examined the Round-8 plan. Result: **2/5 PASS (auditors 1, 5), 3/5 changes_requested** (all high confidence). The Round-7 architecture and the Round-8 fixes are endorsed; first PASSes. Three blocking issues survive (the two PASS auditors flagged the same stale-leak as non-blocking). Full detail: `docs/DV17-Meeting/DV17-Audit-R8.md`.

New convergent blockers:

- **NB20 (2 blocking + 2 non-blocking).** The clear-watch latch leaks `tapMorph` when the user redirects mid-ENTER to a `hasTabs=true` route (`/discussion/*`, `/activity`, etc.): `currentHasTabs(true) !== scrubTarget(false)`, the watch never fires, `tapMorph` sticks at 0, `morph=0`, the MobileTabBar hides until the next `/search` nav. Master's `searchScrubbing` self-clears unconditionally. Fix: clear when `tapMorph === scrubTerminal && !(scrubTerminal === 1 && currentHasTabs === false)` (ENTER terminal 0 clears always and recovers on redirect; EXIT terminal 1 holds pre-nav and clears at nav-land).
- **NB21 (auditor 3).** §4.4 item 2 specifies a synchronous `setTapMorph` for EXIT but not ENTER; Effect E scheduling-only the rAF leaves a first-frame CSS yank. Fix: Effect E calls `setTapMorph(scrubFrom)` synchronously.
- **NB22 (auditor 2).** NB18's `tapMorph !== null` short-circuit blocks a legitimate EXIT-during-ENTER. Fix: short-circuit on `navInFlight` (the `executePendingNav` redispatch), not `tapMorph`.

Revision decisions (applied to `docs/DV17-Plan.md` as Round 9): clear on `tapMorph === scrubTerminal && !(scrubTerminal === 1 && currentHasTabs === false)` (drop the `scrubTarget` latch); ENTER Effect E synchronous `setTapMorph(scrubFrom)`; EXIT short-circuit on `navInFlight`; documentation (§4.6 use `isSearch`, §6 case 4/6, `W` note). Open for Round 9: confirm the clear condition recovers from the redirect case; confirm ENTER synchronous set defeats the yank; confirm `navInFlight` short-circuit arms a fresh EXIT-during-ENTER.

## Round 9 - 1/5 PASS (1 excluded), 3/5 changes_requested; architectural decouple required

Five open-ended auditors examined the Round-9 plan (auditor 2 excluded, 429). Of 4 valid: **1/5 PASS (auditor 1), 3/5 changes_requested**. The Round-9 fixes (NB20/21/22) are endorsed (auditor 1 verified recovery, first-frame defeat, short-circuit). The open audit uncovered a deeper shared defect. Full detail: `docs/DV17-Meeting/DV17-Audit-R9.md`.

New convergent blockers:

- **NB23 (auditor 4, 5).** The clear condition holds the EXIT terminal on a redirect to a deep route (`/discussion/*`, currentHasTabs=false): `tapMorph` sticks at 1, MobileTabBar shown / hamburger on a deep page. Fix: clear also when the nav has landed off-target.
- **NB24 (auditor 3, 5 - architectural).** DV17 eliminates the EXIT MobileTabBar "Tab descent" descent: pre-nav `tapMorph` is invisible to `rootLayerStyle` (frozen in search mode), and at nav-land `morph=1` with no scrub. Master's post-nav Effect E morph scrub drove that descent.
- **NB25 (auditor 5).** `/search → /activity` etc. lose master's morph scrub too (Effect E enter-only + beforeNavigate `/`-only).
- **Root cause (NB24/25):** `rootLayerStyle` (descent, post-nav morph scrub) and `searchProgress`/`tabProgress` (track/tab, pre-nav tapMorph) both read `morph` but need opposite timing; one `morph` cannot serve both.

Revision decisions (applied to `docs/DV17-Plan.md` as Round 10 - DECOUPLE the two consumers):

1. **`rootLayerStyle`/`layerDownStyle`/`iconProgress` keep reading `morph`; master's Effect E morph scrub is RETAINED on every root↔search flip (enter, exit, `/search → /activity`) - the Tab descent descent is preserved everywhere. The NB16 `if (!curIsSearch) return` enter-only guard is REMOVED (Effect E stays master-shaped).**
2. **`searchProgress`/`tabProgress` switch their source to `pager.tapMorph` (fallback to the `morph`-derived value when `tapMorph === null`, i.e. at rest and during the drag).** This gives track/tab the pre-nav sync (DV17's goal) without disturbing `rootLayerStyle`'s post-nav descent.
3. **`morph` stays master-shaped (no `tapMorph` arm).** `tapMorph` is a separate field consumed only by `searchProgress`/`tabProgress` and the GPL Page-slide headroom.
4. **NB23 clear fix:** clear when `tapMorph === scrubTerminal && (currentHasTabs === scrubTarget || currentPath !== scrubSource)`.

Open for Round 10: confirm `searchProgress`/`tabProgress` reading `tapMorph` (with `morph` fallback) preserves slide-before-expand / collapse-before-slide and the drag path (`tapMorph === null` → reads `morph = backMorph`); confirm the retained Effect E morph scrub drives `rootLayerStyle`'s Tab descent unchanged on enter/exit/`/search→/activity`; confirm the NB23 clear recovers from a deep-route redirect.

## Round 10 - 3/5 PASS, 2/5 changes_requested (first majority PASS) → revised

Five open-ended auditors examined the Round-10 plan. Result: **3/5 PASS (auditors 1, 3, 5), 2/5 changes_requested** (all high confidence). The decouple (track/Tab on `tapMorph`, layer on master `morph`) resolves NB24/25 (Tab descent preserved); the sync math, drag fallback, discriminator, organic-clean all verify. Two blocking issues survive. Full detail: `docs/DV17-Meeting/DV17-Audit-R10.md`.

New blockers:

- **NB26 (auditor 2).** The clear condition `tapMorph === scrubTerminal && (...)` requires the rAF to reach terminal, so a mid-scrub redirect to a deep route never clears; the orphan rAF keeps writing and the deep GPL reads a stale `tapMorph`. Fix: regroup to `((tapMorph === scrubTerminal && currentHasTabs === scrubTarget) || currentPath !== scrubSource)` and cancel the orphan rAF on clear.
- **NB27 (auditor 4, likely misread).** Claimed MobileTabBar appears twice on EXIT. MobileTabBar is in the Header `rootLayer` (covered by the search layer pre-nav), not the GPL page panel; the GPL track slide cannot affect it. Settle empirically with a MobileTabBar `translateY` e2e matching master.

Revision decisions (Round 11): regroup the clear + orphan cancel (NB26); add a MobileTabBar `translateY` e2e + document the rootLayer-vs-panel distinction (NB27); pin Effect E enter-only, §6 case 6, §1 scope, `isMobile`. Open for Round 11: confirm the regrouped clear recovers the mid-scrub deep-route redirect; confirm the MobileTabBar e2e matches master.

## Round 11 - 5/5 PASS (FINAL, unconditional). Loop exit.

Five open-ended auditors examined the Round-11 plan. Auditors 3/4/5 initially hit a 429 quota and were re-run after the reset. Result: **5/5 PASS** (all high confidence, zero blocking). Full detail: `docs/DV17-Meeting/DV17-Audit-R11.md`.

All five verified the NB26 regrouped clear + orphan cancel (mid-scrub deep-route redirect recovery, pre-nav hold, jump-free nav-land), the NB27 MobileTabBar trajectory (Header `rootLayer`, not the GPL panel; single post-nav descent matching master), the R10 decouple (track/Tab on `tapMorph`+`morph` fallback; layer group on master `morph`; Tab descent preserved), the sync math (exact by construction), the drag path (`tapMorph === null` → `morph = backMorph`), and the organic-clean gate (GPL no `/search` token, no `resolveHeaderMode`; Header reuses `isSearch`).

Carried-to-implementation notes (non-blocking): Effect E enter-only tapMorph rAF discriminator (`curIsSearch` around the rAF portion only, not the morph scrub); `scrubSource`/`scrubTarget`/`scrubTerminal` latched synchronously in each arming handler; `isMobile` gate on the new rAFs; narrative polish (§3.7/§3.5/`W`/`:817`).

Loop-exit condition met (R0-R8 various, R9 1/5, R10 3/5, R11 5/5 FINAL). Plan approved for implementation. Implementation proceeds under `docs/DV17-C00-Journal.md` + `docs/RV17-C00-Audit-NN.md`.
