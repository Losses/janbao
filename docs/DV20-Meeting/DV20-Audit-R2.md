# DV20 - Plan Audit Round 2

5 independent role-less auditors examined the R1-revised `docs/DV20-Plan.md` (the pre-navigate + GPL track-slide handoff design, which added a raw `pointermove` listener, a forward `visualDragOffset` branch, `detectSwipe.claim`, and a `pointerReleased` fallback) against the live codebase under an open-ended, architecture-level standard. Result: **0/5 PASS, 5/5 FAIL, unanimous, all high confidence, all organic=has-special-cases.** The convergent geometry defect is arithmetic (traced end to end against the live `trackTranslateX`), not speculative.

Workflow: a single consolidated review of the converged verdicts, distilled from the five independent reviewers' notes. The convergent blockers are tallied by how many of the five independently traced each; the secondary findings are brief.

## Tally

| Auditor | Verdict | Confidence | Organic           |
| ------- | ------- | ---------- | ----------------- |
| 1       | FAIL    | high       | has-special-cases |
| 2       | FAIL    | high       | has-special-cases |
| 3       | FAIL    | high       | has-special-cases |
| 4       | FAIL    | high       | has-special-cases |
| 5       | FAIL    | high       | has-special-cases |

Result line: **0/5 PASS → revised.**

## Convergent blockers

### R2-B1 (5/5, critical); the forward `visualDragOffset` geometry is wrong by one full panel width

The plan §2.3 B2 claims: at `dragOffset = 0`, Messages is visible (track at 0%); at `dragOffset = -W`, `/search` is visible (track at -STEP_PERCENT%).

The live `trackTranslateX` (`GesturePageLayout.svelte:466-482`) uses the base `calc(-${ACTIVE * STEP_PERCENT}% + ${visualDragOffset}px)` whenever `visualDragOffset !== null`. On `/search` reached from Messages: `panelCount = 2`, `ACTIVE = 1`, `STEP_PERCENT = 50`, so the base is `-50%` (= `-W` px on a `2W` track), **independent of `snapIndex`**. The plan's proposed forward formula `visualDragOffset = min(0, dragOffset + W*HEADER_MORPH_THRESHOLD) / (1 - HEADER_MORPH_THRESHOLD)` yields values in `[-W, 0]` for `dragOffset` in `[-W, 0]`. Plugging in:

- `dragOffset = 0` → `visualDragOffset = 0` → track at `-W` → panel 1 (`/search`) fills the viewport. The plan claims Messages is visible.
- `dragOffset = -W` → `visualDragOffset = -W` → track at `-2W` → both panels off-screen left; the viewport is blank. The plan claims `/search` is visible.

The base `-ACTIVE*STEP_PERCENT%` is the **/search rest position** (snapIndex = ACTIVE = 1), which is correct for the back-swipe (rest is /search, drag right reveals Messages). The forward-enter drag starts from `snapIndex = 0` (Messages, the `isEntering` init at `:261`), whose rest base is `-0%`. The two are inconsistent by exactly `-STEP_PERCENT%`. The plan never proposes changing the `trackTranslateX` base; §2.6 enumerates only a forward `visualDragOffset` branch, an `onSwipeMove` guard relaxation, and a `pointerReleased` fallback. The defect is unaddressed.

Failure scenario: user drags past `SWIPE_COMMIT`; `goto('/search')` fires; `/search`'s GPL mounts; the handoff seeds `dragOffset` to a non-null value. The first paint jumps from `snapIndex = 0` (Messages) to track `-W` (`/search` fully visible). As the finger keeps moving leftward, `/search` slides **off-screen left** and the viewport goes blank. The destination panel recedes as the user drags toward it. The feature is unusable as specified.

### R2-B2 (5/5, critical); `detectSwipe.claim` does not seed `maxX`/`minX`/`samples`, so every release is classified `reversed` and the forward swipe never commits

`detectSwipe.onDown` (`swipe.ts:353-391`) initialises `startX`, `maxX = clientX`, `minX = clientX`, `samples = []`, `startY`, `startTime`, `target`. The plan's `claim` (§2.3) "sets `phase = 'swipe'`, `primaryPointerId`, `startX`, and calls `setPointerCapture`" and asserts this "is the same thing `onDown` does after the deciding phase, just entered directly". It is not: `claim` omits `maxX`/`minX`/`samples` (and `startY`/`startTime`/`target`). These are closure `let`s initialised to `0` / `[]` (`swipe.ts:319-320`) or stale from a prior gesture.

`finish()` (`swipe.ts:335-346`) computes `rebound = deltaX >= 0 ? maxX - event.clientX : event.clientX - minX`. With `minX = 0` (un-seeded) and a leftward drag, `rebound = event.clientX - 0 ≈ clientX` (typically 100 to 300). `reversedAtRelease` (`swipe.ts:175-181`) returns true whenever `rebound >= REBOUND_CANCEL_PX (25)`. So `reversed = true` on every release that did not get an intervening `pointermove` to correct `minX`. Every commit branch in `onSwipeEnd` gates on `!reversed` (`GesturePageLayout.svelte:700-720`); with `reversed` stuck true, the gesture always cancels. The forward swipe never commits regardless of drag distance. Additionally `releaseVelocity` reads the un-seeded `samples` and returns 0, disabling fling detection.

Failure scenario: user forward-swipes past the commit threshold and lifts. `onSwipeEnd` receives `reversed = true`; the commit branch is skipped; the cancel branch runs. The user is bounced back to Messages every time. The signature `claim(pointerId, startX)` is insufficient; it must seed the full `onDown` state for the claimed pointer, requiring `claim(pointerId, startX, currentX)` at minimum.

### R2-B3 (4/5); visual discontinuity at the MobileTabPager to GPL swap

MobileTabPager's `follow()` rubber-bands the last-tab leftward drag at `0.4x` (`MobileTabPager.svelte:193-198`). At `deltaX = -60` (= `SWIPE_COMMIT`), the displayed `dragOffset` is `-24` and the track is at `calc(-66.67% + -24px)` (Messages shifted 24 px leftward). The plan §2.3 B4 explicitly chooses absolute 1:1 coordinates for the handoff ("NOT MobileTabPager's 0.4x rubber-banded value"), seeding the GPL's `dragOffset = -60`. The GPL's first frame therefore jumps from "Messages, -24 px nudge" to whatever the GPL paints at `dragOffset = -60` (per R2-B1, `/search` fully visible). That is a single-frame teleport of roughly half the viewport. B4 reconciles the coordinate **scale** (0.4x to 1:1) but not the **base position** (MobileTabPager's Messages-centered `-2W` rest vs the GPL's `/search`-centered `-W` rest). No plan revision can make the swap seamless without aligning the rest positions.

### R2-B4 (4/5); `enterRaf` fires unconditionally on mount and races the handoff drag

`GesturePageLayout.svelte:932-937` schedules `snapIndex = ACTIVE` on mount whenever `isEntering && isMobile`, with no handoff guard. `isEntering` is verified-true for `/search` reached by a forward goto (R2-verified-TRUE #1). During the drag this is visually inert (`visualDragOffset` shadows `snapIndex` while `dragOffset !== null`), but on pointerup the existing `onSwipeEnd` else-branch (`:721-723`) sets `snapIndex = ACTIVE` and clears `dragOffset`, so the track snaps to `/search` visible. On a **cancel** (release below `SWIPE_COMMIT`), the plan §6 case 2 says "history.back() to Messages", but the user instead watches the track snap to `/search` for a frame before `history.back()` swaps back. The plan §2.6 does not enumerate suppressing `enterRaf` (or special-casing the cancel branch) for the handoff path.

### R2-B5 (3/5); `onSwipeEnd` has no forward-commit branch and the plan's §3 does not list modifying it

The existing `onSwipeEnd` (`GesturePageLayout.svelte:696-727`) computes `committedRight = deltaX <= -SWIPE_COMMIT && !reversed && rightIdx >= 0 && resolvedRightHref`. On `/search`, `hasRight = false` so `rightIdx = -1` and `committedRight` is always false. The forward-enter pointerup therefore falls through to the else-branch (`snapIndex = ACTIVE`), never to a forward commit. The plan §2.6 point 4 specifies "on pointerup, clear the handoff; if past `SWIPE_COMMIT` the user is already on `/search`; else `history.back()`", which is a **new branch the existing `onSwipeEnd` does not implement**, and §3 (Files, Modified) does not list `onSwipeEnd` among the changes. An implementer following §3 would not modify `onSwipeEnd` and would get neither the commit-no-op nor the cancel-with-`history.back()` behaviour.

### R2-B6 (2/5); the plan's `swipeMove` guard references `reversed`, which `MoveHandler` cannot deliver

Plan §2.5 item 2 specifies the forward-commit guard inside `swipeMove` with a `!reversed` term. `MoveHandler` (`swipe.ts:24`) is `(deltaX: number) => void`; `reversed` is computed only in `finish()` (`swipe.ts:343`) and passed only to `EndHandler`. The guard is unimplementable as written. Dropping it would fire `goto` on every move past threshold (including mid-rebound); keeping the intent requires re-architecting the phase machine.

### R2-B7 (2/5); pointer events are lost during the DOM swap, stranding the gesture

`MobileTabPager`'s `detectSwipe.destroy()` (`swipe.ts:516-528`) releases all pointer capture and removes every pointer listener at unmount; the plan's raw `pointermove` listener is on the same viewport node and is removed by standard cleanup. Between MobileTabPager unmount and the GPL's mount + `claim`, no listener catches `pointermove`/`pointerup`. If `pointerup` lands in the gap, MobileTabPager's `swipeEnd` never runs (its listener is gone), so `pointerReleased` is never set; the GPL mounts with `active = true, pointerReleased = false`, calls `claim`, seeds `dragOffset`, and waits for events that already fired. The 5 s safety net clears `handoff.active` but not the GPL's local `dragOffset`, so the GPL stays in drag mode (track frozen) until remount.

### R2-B8 (5/5, architecture gate); the handoff is a 7-to-9-piece parallel gesture pipeline, not a thin bridge

Counted across the five reviewers: the `forward-gesture-handoff.svelte.ts` module-singleton store; the raw `pointermove` listener on MobileTabPager; `detectSwipe.claim` (a third entry point alongside `captureSwipe` and `detectSwipe`); the `swipeDirection = 'forward'` literal grafted onto a spatial-direction enum (`'left' | 'right' | null` at `GesturePageLayout.svelte:88`, which silently misroutes through the `=== 'left'` tests in `currentRevealWidth :188` and `targetTab :205`); the forward `visualDragOffset` branch (byte-identical to the existing else branch at `:453`, so a no-op); the `onSwipeMove` `!hasRight` guard relaxation; the `pointerReleased` fallback; the `onSwipeEnd` forward-commit branch (R2-B5); the 5 s safety-net `$effect` in the root layout. This is a parallel gesture-detection pipeline feeding the GPL track-slide. The project rules `architecture-consistency-single-transition-mechanism` and `two-mechanism-unification-not-bridge` mandate unification (delete one mechanism) over a bridge.

### R2-B9 (1/5 primary, but load-bearing for the R1 premise); the R1 retrospective's stated premise is false against the live code

The R1 revision was motivated by "the GPL's `visualDragOffset` is sign-asymmetric (back-swipe only)". The live `visualDragOffset` (`GesturePageLayout.svelte:446-454`) already has both branches: the `swipeDirection === 'right'` branch and the final `else` branch `Math.min(0, dragOffset + W*HEADER_MORPH_THRESHOLD) / (1 - HEADER_MORPH_THRESHOLD)`, which is byte-identical to the plan's proposed forward formula. R1 solved a non-defect (the "new forward branch" is a no-op) and left the real defect (R2-B1, the `trackTranslateX` base) unflagged.

## Non-blocking concerns (consensus)

- The `pointerReleased` fallback plays `enterRaf` (200 ms CSS slide), not a 1:1 drag. Acceptable as a fallback but it contradicts the §1 "1:1 symmetric" claim, and in the slow-goto case the plan delivers no UX improvement over the status quo at full complexity cost.
- The 5 s safety net is too long for orphan recovery (250 to 500 ms is the right order) and adds a third writer to the handoff store (MobileTabPager, GPL, root-layout effect), expanding lifecycle surface.
- `navStore.navInFlight` is not set by a direct `goto` (only `executePendingNav` sets it at `navigation.svelte.ts:195`); the plan's `navStore.navInFlight || gotoInFlight` check leans entirely on the local flag, and the plan never specifies when `gotoInFlight` clears.
- The handoff store has no destination-route guard; any GPL mounting while `active === true` (e.g. the user hits Back mid-goto onto a thread) would read the handoff and call `claim`.
- Multi-touch during the forward swipe corrupts the raw listener's `lastClientX`/`pointerId` (the raw listener is not filtered to the primary pointer).
- `forwardDeepNeighbour` is feature-shaped data (specific to Messages to `/search`), not a general spatial-neighbour concept; a general `rightNeighbour` graph would subsume the case without per-route data.
- `tapVisualOffset` / `pager.tapMorph` would silently override the handoff-driven `visualDragOffset` (line 477 to 480) if anything drives `tapMorph` during the handoff; no gate is proposed.

## Verified-TRUE items (carry forward, 5/5 agreement)

- `/search/+page.svelte:47-49` mounts `<GesturePageLayout fallbackRoute="/">` with only children; no `leftHref`, no `left`, no `centerTab`.
- `shouldAnimateEnter()` returns **true** for `/search` reached by a forward `goto` from `/messages/inbox`: `handleBeforeNavigateNav` sets `direction = 'forward'` (both routes resolve to tab 2 via `GLOBAL_PREFIXES`, so the same-tab push branch fires), `stacks[2] = [/messages/inbox, /search]`, `prevPath === resolvedLeftHref === '/messages/inbox'`. All five preconditions pass.
- `isEntering = shouldAnimateEnter()` (`:246`) is a plain const evaluated once at script init; it survives the `direction` to `'none'` reset in `handleAfterNavigateNav`.
- `snapIndex` inits to `0` when `isEntering && isMobile` (`:261`), so the Messages-preview frame is the rest position before `enterRaf` fires.
- `enterRaf` (`:932-937`) fires `snapIndex = ACTIVE` on mount whenever `isEntering && isMobile`, unconditionally.
- `resolvedLeftHref` on `/search` resolves to `/messages/inbox` through `navStore.backTarget` (`:118`).
- The back-swipe from `/search` (reached via this forward swipe) to Messages works through the existing `committedLeft` path: `setPendingNav('/messages/inbox', 'link')` and `hopForHref` returns `'back'`, so `executePendingNav` calls `history.back()`. Unchanged by the plan.
- The existing `visualDragOffset` else branch (`:453`) already covers the forward direction mathematically; no new branch is needed there (the broken piece is the `trackTranslateX` base, R2-B1).
- A direct `goto()` does NOT set `navStore.navInFlight`; only `executePendingNav` does (`:195`).
- The simpler unification exists and is partially present in the plan itself (the `pointerReleased` fallback): drop the handoff entirely; on commit threshold call `goto('/search')`; let the existing `shouldAnimateEnter` + `enterRaf` play the 200 ms CSS slide-in (`snapIndex 0 to ACTIVE`). This eliminates R2-B1 through R2-B8 at the cost of no 1:1 forward-drag preview (a cost the plan already accepts in its fallback, and which no other forward-enter on the site provides).

## Revision decision (pending owner direction)

All five reviewers independently converge on the same architectural recommendation: **drop the cross-route handoff.** On the commit threshold, MobileTabPager calls `goto('/search')`; `/search`'s GPL mounts with `shouldAnimateEnter = true` and the existing `enterRaf` plays the 200 ms CSS slide-in (`snapIndex 0 to ACTIVE`, Messages preview exits, `/search` enters). New code: one forward-commit branch in `MobileTabPager.swipeEnd` (gated on `activeIndex === last && forwardDeepNeighbour && deltaX <= -SWIPE_COMMIT && !reversed`) plus the `forwardDeepNeighbour` data field on `TabDef` (four-site). Zero new stores, zero overlays, zero resolvers, zero handoff, zero `claim`, zero forward `visualDragOffset`/`trackTranslateX` changes, zero root-layout safety net.

This is the architecturally minimal unification the project rules mandate, and it matches the owner's "least fragmentation" directive. The cost is that the forward direction has no 1:1 finger-tracking preview during the drag (Messages rubber-bands slightly, then `/search` slides in on release), which is the same transition the site already uses for every forward-enter to a GPL route (tap-search, tap-bookmark, tap-profile).

The one product question the audit cannot resolve: whether the 1:1 forward-drag preview is a hard requirement. If it is, the only architecturally clean 1:1 option is to host `/search` under the MobileTabPager as a real fourth tab (so both directions are ordinary intra-pager tab swipes, fully symmetric, one mechanism). That changes the product's navigation structure (the tab bar gains a Search entry; `/search` becomes a tab root rather than a deep route). The owner decides; Round 3 audits the chosen direction.
