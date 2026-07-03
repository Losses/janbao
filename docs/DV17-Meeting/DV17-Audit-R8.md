# DV17 - Plan Audit Round 08

5 role-less open-ended auditors examined `docs/DV17-Plan.md` (Round 8) with the identical open prompt. Result: **2/5 PASS, 3/5 CHANGES_REQUESTED** (all high confidence). First PASSes - the Round-7 architecture and the Round-8 fixes (NB15 discriminator, NB16 Effect E guard, NB17 synchronous setTapMorph, NB18 short-circuit, NB19 latch) are endorsed. Three blocking issues survive; the two PASS auditors flagged the same stale-leak issue as non-blocking. Full detail below.

## Tally

| Auditor | Verdict           | Blocking | Organic        | Confidence |
| ------- | ----------------- | -------- | -------------- | ---------- |
| 1       | PASS              | 0        | clean (caveat) | high       |
| 2       | changes_requested | 2        | not clean\*    | high       |
| 3       | changes_requested | 1        | clean          | high       |
| 4       | changes_requested | 1        | clean          | high       |
| 5       | PASS              | 0        | clean (caveat) | high       |

(\*Auditor 2's "not clean" is the §4.6 vs §4.4 literal-token documentation inconsistency, not a real new coupling - see Non-blocking.)

## Blocking issues (deduplicated)

**NB20 (auditor 2, 4 blocking; auditor 1, 5 non-blocking) - the clear-watch latch leaks `tapMorph` when the user redirects mid-ENTER to a `hasTabs=true` route.** §4.4 item 2 (NB19) clears only when `currentHasTabs === scrubTarget && tapMorph === scrubTerminal`. On ENTER (`scrubTarget=false`), if the user navigates mid-rAF to `/discussion/*` (or `/activity`, `/messages/inbox`, `/messages/<id>` - all `currentHasTabs=true`), the rAF reaches terminal `0` but `currentHasTabs(true) !== scrubTarget(false)`, so the watch never fires. `tapMorph` sticks at `0`; `morph` returns `0` from the tapMorph arm; `rootLayerStyle` (`Header.svelte:575-581`) computes `translateY(-100%)`, hiding the MobileTabBar until the next `/search` nav. Master's `startSearchScrub` self-clears `searchScrubbing` at rAF terminal unconditionally (no route dependency), so this is a regression. Fix: clear when `tapMorph === scrubTerminal && !(scrubTerminal === 1 && currentHasTabs === false)` - i.e. clear at terminal on ENTER always (terminal 0, jump-free because `/search` rest = 0; redirects to `hasTabs=true` routes recover because clearing drops to the correct rest), and on EXIT only after nav-land (`currentHasTabs === true`, the pre-nav hold preserved).

**NB21 (auditor 3) - ENTER lacks the synchronous `setTapMorph` the plan mandates for EXIT (NB17).** §4.4 item 2 specifies a synchronous `setTapMorph(0)` for EXIT so the CSS-suppression gate is true in the same flush, but for ENTER only says "starts the rAF". Effect E is `$effect.pre` in the post-nav flush; if it only schedules the rAF, the first post-nav frame has `tapMorph=null` → `morph` rest = 0 → `searchProgress=1` → the CSS `duration-200` transition starts → the rAF's first tick suppresses it and yanks the track back: the ENTER desync DV17 exists to fix. Fix: Effect E calls `setTapMorph(scrubFrom)` synchronously before scheduling the rAF (mirroring master `startSearchScrub`'s synchronous `searchScrubbing=true` at `Header.svelte:442-443`).

**NB22 (auditor 2) - NB18's `tapMorph !== null` short-circuit blocks a legitimate EXIT-during-ENTER.** If the user taps back to `/` while an ENTER rAF is in flight, the EXIT `beforeNavigate` sees `tapMorph !== null` and short-circuits, so the EXIT publisher does not arm; the ENTER rAF keeps driving `tapMorph` toward 0 (wrong direction) until it clears. Fix: short-circuit on `navStore.navInFlight` (set only by `executePendingNav`'s programmatic redispatch, `navigation.svelte.ts:195`), not on `tapMorph !== null` - a fresh user navigation has `navInFlight=false` and arms; the redispatch has `navInFlight=true` and skips.

## Notable concerns (non-blocking)

- **§4.6 vs §4.4 documentation inconsistency.** §4.6 claims the exit `beforeNavigate` "reuses `resolveHeaderMode`" with "no `/search` token anywhere new"; §4.4 item 2 (NB15) uses literal `page.url.pathname === '/search' && navigation.to.url.pathname === '/'`. The literal is correct (NB15); §4.6's narrative is stale. (Header already has `/search` tokens; the marginal coupling is nil, but the absolute claim is wrong.) Use Header's existing `isSearch` derived for the source side to keep §4.6 honest.
- **§6 case 4 vs NB18/NB22.** "A second tap cancels and restarts the rAF from the start value" conflicts with the short-circuit. Rewrite once NB22 changes the short-circuit signal.
- **§6 case 6 stale text.** Says the check "requires target mode `'root'`"; the actual NB15 discriminator is pathname-strict. Rewrite.
- **§3.6 `:817` citation** is `snapIndex = targetSnapIndex`, not the literal `0` (resolves to 0 for `/`). Cosmetic.
- **`W` IS reactive** (`:180` `$derived` over `window.innerWidth`); the rAF captures it once, so the practical claim holds, but the plan's "non-reactive" note is wrong.
- **DEV probe** does not capture `tapMorph`; extend for debug.
- **`isMobile` gate on `beforeNavigate`.** Desktop `/search` renders `DesktopSearch` (no GPL consumer); an armed `tapMorph` is harmless (cleared at nav-land). Gate or document.
- **Rapid cross-direction tap** within the scrub window: with NB22 fixed (navInFlight short-circuit), the EXIT arms and the ENTER rAF is cancelled+restarted (Effect E side has no short-circuit); minor visible reversal, sub-200ms, no worse than master.

## Organic-clean

Clean on the load-bearing claim: GPL adds no `/search` token, no `resolveHeaderMode` import; `mobile-pager.svelte.ts` adds a general `tapMorph` field. Header already couples to `/search`; the EXIT discriminator's source-side check should use the existing `isSearch` derived (not a new literal) to keep §4.6 honest.

## Revision decisions (applied to `docs/DV17-Plan.md` as Round 9)

1. **Clear condition (NB20).** Clear when `tapMorph === scrubTerminal && !(scrubTerminal === 1 && currentHasTabs === false)`. ENTER (terminal 0) clears at rAF completion unconditionally (jump-free on `/search` rest = 0; a redirect to a `hasTabs=true` route recovers because clearing drops `morph` to that route's correct rest). EXIT (terminal 1) holds across the pre-nav window (`currentHasTabs === false`) and clears at nav-land (`currentHasTabs === true`). The `scrubTarget` latch is removed (no longer needed).
2. **ENTER synchronous setTapMorph (NB21).** Effect E calls `setTapMorph(scrubFrom)` synchronously before scheduling the rAF, so the CSS-suppression gate is true in the post-nav flush.
3. **Short-circuit on navInFlight (NB22).** The EXIT `beforeNavigate` short-circuits on `navStore.navInFlight` (the `executePendingNav` redispatch), not on `tapMorph !== null`; a fresh user EXIT tap (`navInFlight=false`) arms.
4. **Documentation.** §4.6: use `isSearch` for the source side (no new literal). §6 case 4/6 rewritten. §3.6 `:817` wording. `W` note corrected. DEV probe + `isMobile` gate noted.

Open for Round 9: confirm the new clear condition recovers from the redirect-to-`hasTabs` case (clear → `morph` rest = 1 → MobileTabBar visible); confirm the ENTER synchronous set defeats the first-frame yank; confirm the `navInFlight` short-circuit lets a fresh EXIT-during-ENTER arm while still skipping the redispatch.
