# DV17 - Plan Audit Round 09

5 open-ended auditors examined `docs/DV17-Plan.md` (Round 9). Auditor 2 hit a 429 rate limit (no result; excluded). Of the 4 valid: **1/5 PASS (auditor 1), 3/5 CHANGES_REQUESTED** (all high confidence). The Round-9 fixes (NB20 clear condition, NB21 ENTER synchronous set, NB22 navInFlight short-circuit) are endorsed - auditor 1's PASS verified the recovery, the first-frame defeat, and the short-circuit. But the open audit uncovered a deeper, shared defect: the EXIT MobileTabBar "Tab descent" descent and the `/search → non-/ tab` morph scrub are both eliminated by DV17, because `rootLayerStyle` (descent, post-nav morph scrub) and `searchProgress`/`tabProgress` (track/tab, pre-nav tapMorph sync) both read `morph` but need opposite timing. Full detail below.

## Tally

| Auditor | Verdict           | Blocking | Organic | Confidence |
| ------- | ----------------- | -------- | ------- | ---------- |
| 1       | PASS              | 0        | clean   | high       |
| 2       | (429 - excluded)  | -        | -       | -          |
| 3       | changes_requested | 1        | clean   | high       |
| 4       | changes_requested | 1        | clean   | high       |
| 5       | changes_requested | 2        | clean   | high       |

## Blocking issues (deduplicated)

**NB23 (auditor 4, 5) - clear condition leaves `tapMorph` stuck on an EXIT-mid-scrub redirect to a deep route.** Round-9's clear `tapMorph === scrubTerminal && !(scrubTerminal === 1 && currentHasTabs === false)` holds the EXIT terminal whenever `currentHasTabs === false`. That is correct for the pre-nav window (`/search`, `currentHasTabs=false`, hold) but WRONG for a redirect to a deep route (`/discussion/*`, `/bookmarks`, `/profile/*`, `/admin` - all `currentHasTabs=false`, but nav has LANDED). The rAF (on the persistent Header) runs to terminal `1`; at nav-land `currentHasTabs` stays `false` (deep route); the watch sees `terminal===1 && currentHasTabs===false` → holds; `tapMorph` sticks at `1`; `morph=1` → `rootLayerStyle translateY(0%)` (MobileTabBar shown on a deep page where it must be hidden) and `iconProgress` shows hamburger where a back-arrow is required. Persists until a drag (NB13) or a `/search` nav. Fix: the clear must also fire when the navigation has landed on a non-target path - e.g. clear when `tapMorph === scrubTerminal && (currentHasTabs === scrubTarget || currentPath !== scrubSource)`, or cancel the rAF in a Header `afterNavigate` when the landed path is not the scrub target.

**NB24 (auditor 3, 5 - architectural) - DV17 eliminates the EXIT MobileTabBar "Tab descent" descent.** Master's Effect E runs a post-nav morph scrub that drives `rootLayerStyle` (`Header.svelte:575-586`) `translateY(-(1-morph)*100%)`, animating MobileTabBar from `-100%` (clipped) down to `0%` over 200ms after nav-land - the deliberate "Tab descent" descent (comment `:195-204`). DV17 moves the morph signal to a PRE-nav `tapMorph` rAF. But pre-nav `isSearch === true` makes `rootLayerStyle = 'transform: none'` (`:576-578`, frozen in search mode), so pre-nav `tapMorph` variation has ZERO visual effect on MobileTabBar. At nav-land the rAF is already complete (`tapMorph=1`), the clear watch sets `tapMorph=null`, `morph=1` (rest), and `rootLayerStyle='translateY(0%)'` - MobileTabBar appears in place with no descent. This is a regression vs master on every `/search → /` exit.

**NB25 (auditor 5) - DV17 eliminates the morph scrub on `/search → non-/ tab` exits.** Master's Effect E fires on every root↔search flip (its checks pass for `/search → /activity`, `/messages/inbox`, etc.), scrubbing morph post-nav and driving the same Tab descent. DV17's Effect E `if (!curIsSearch) return;` (NB16) makes it enter-only, and the EXIT `beforeNavigate` discriminator is `=== '/'` only, so `/search → /activity` etc. get NEITHER a pre-nav rAF NOR a post-nav scrub - silent elimination of master's Tab descent on those flows. (The plan's rationale that `/activity` etc. would "false-arm" inverts the situation: they are legitimate search-exits that master animates.)

**Root cause of NB24/NB25 (shared):** `rootLayerStyle` (Tab descent, needs post-nav morph scrub) and `searchProgress`/`tabProgress` (track/tab sync, needs pre-nav tapMorph) BOTH read `morph`. A single `morph` value cannot be pre-nav-complete (for track/tab sync) AND post-nav-scrubbing (for Tab descent) at the same time. DV17's `tapMorph`-replaces-`morph`-scrub choice picks track/tab sync and loses the descent.

## Notable concerns (non-blocking)

- **`/search → /activity` (no mid-scrub) is a behavioral change vs master** (no scrub → no Tab descent). Acknowledged under NB25.
- **§6 case 4/6 stale text** (mode `'root'` vs pathname `/`; rapid-tap "restart" vs short-circuit). §9 defers reconciliation.
- **`:817` citation** is `snapIndex = targetSnapIndex`, not literal `0`.
- **`W` IS reactive** (`:180`); rAF captures once, claim holds, note wrong.
- **`isMobile` gate on `beforeNavigate`** unspecified; desktop arms invisibly.
- **Drag-cancel watcher site unspecified** (item 2 says cancel on `dragging` flip; item 4 doesn't locate it).
- **ENTER `snapIndex` race**: if `enterRaf` hasn't flipped snapIndex when the clear fires, a one-frame snap to panel 0. Probably fine (160ms rAF >> first tick); worth an e2e.
- **Rapid EXIT-during-ENTER** restarts from start value (visible reverse jump); master-compatible.

## Organic-clean

Clean (4/4). GPL no `/search` token, no `resolveHeaderMode`; Header reuses `isSearch`; `mobile-pager` adds general `tapMorph`.

## Revision decisions (applied to `docs/DV17-Plan.md` as Round 10)

The Round-9 design conflated two consumers of `morph` with opposite timing needs. Round 10 DECOUPLES them:

1. **`rootLayerStyle` keeps reading `morph` (master's post-nav scrub retained for Tab descent).** Effect E is NOT made enter-only for the morph scrub; instead the master Effect E morph scrub is RETAINED to drive `rootLayerStyle`/`layerDownStyle` (the Tab descent) on EVERY root↔search flip (enter and exit, including `/search → /activity`). This preserves master's descent everywhere.
2. **`searchProgress`/`tabProgress` read `tapMorph` (the new pre-nav sync), NOT `morph`.** The track and Tab-bar consumers switch their source from `morph` to `pager.tapMorph` (falling back to the `morph`-derived value when `tapMorph === null`, i.e. at rest and during the drag). This gives track/tab the pre-nav sync (DV17's goal) without disturbing `rootLayerStyle`'s post-nav descent (master's behavior).
3. **Two signals, two lives.** `tapMorph` (pre-nav for exit, post-nav for enter) drives track/tab sync and clears per NB20+NB23. `morph` (master's Effect E scrub, retained) drives `rootLayerStyle`/`layerDownStyle` and the icon, unchanged from master. The `if (pager.tapMorph !== null) return pager.tapMorph` arm is REMOVED from `morph` (morph stays master-shaped); `searchProgress`/`tabProgress` get a `pager.tapMorph !== null ? f(tapMorph) : f(morph)` form.
4. **NB23 clear fix.** Clear when `tapMorph === scrubTerminal && (currentHasTabs === scrubTarget || currentPath !== scrubSource)` - fires on the legitimate nav-land AND on a redirect to a deep route (recovery); still holds the EXIT terminal pre-nav (`currentPath === scrubSource` and `currentHasTabs === false`).

Open for Round 10: confirm `searchProgress`/`tabProgress` reading `tapMorph` (with `morph` fallback) preserves the slide-before-expand / collapse-before-slide ordering and the drag path (where `tapMorph === null` and they read `morph = backMorph`); confirm the retained Effect E morph scrub drives `rootLayerStyle`'s Tab descent unchanged on enter, exit, and `/search → /activity`; confirm the NB23 clear condition recovers from a deep-route redirect.
