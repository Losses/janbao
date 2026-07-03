# DV17 - Plan Audit Round 07

5 role-less open-ended auditors examined `docs/DV17-Plan.md` (Round 7: complete enter+exit sync, EXIT via Header `beforeNavigate` pre-nav publisher) with the identical open prompt. Result: **0/5 PASS, 5/5 CHANGES_REQUESTED** (all high confidence). The Round-7 architecture is endorsed by all five - the EXIT pre-nav publisher on the persistent Header is feasible, the `/search` GPL consuming `tapMorph` pre-nav is feasible, SvelteKit `beforeNavigate` registration order puts Header's callback before the GPL's, and the `searchProgress` `isSearch` hard-cut is jump-free at the rAF terminal. Five specification defects survive, all concrete and fixable. Full detail below.

## Tally

| Auditor | Verdict           | Blocking | Organic | Confidence |
| ------- | ----------------- | -------- | ------- | ---------- |
| 1       | changes_requested | 1        | clean   | high       |
| 2       | changes_requested | 3        | clean   | high       |
| 3       | changes_requested | 2        | clean   | high       |
| 4       | changes_requested | 3        | clean   | high       |
| 5       | changes_requested | 3        | clean   | high       |

## Architecture endorsement (5/5)

All five verified the Round-7 architecture is sound: Header is AppShell-level and persistent; a Header `beforeNavigate` fires pre-nav before the `/search` GPL unmounts; SvelteKit runs `beforeNavigate` callbacks in registration order (root `+layout.svelte:74` first, then Header, then the `/search` GPL on mount); the `/search` GPL consumes `pager.tapMorph` for the Page-slide headroom in the pre-nav window; the `searchProgress` `isSearch` hard-cut equals the rAF terminal at nav-land (jump-free). The ENTER side (Effect E post-nav) remains correct. The defects below are specification precision, not architecture.

## Blocking issues (deduplicated)

**NB15 (5/5) - the EXIT discriminator `resolveHeaderMode(to) === 'root'` false-arms on primary user flows.** `header-mode.ts:20-24` returns `'root'` for any path with `getCurrentTabIndex !== -1`. Verified empirically: `/activity`, `/messages/inbox`, `/discussion/<id>`, `/messages/<id>`, `/discussions/pN` all resolve to `'root'`. So `/search → /discussion/<id>` (tapping a search result - a primary flow) matches the check, the rAF false-arms, the `/search` GPL returns early from its own `beforeNavigate` (no same-panel exit), nav lands, the new `/discussion` GPL mounts and reads the stale non-null `tapMorph`, computing a wrong `tapVisualOffset` and sliding the thread off-screen. `/search → /activity` (cross-tab chip-exit) also false-arms: the Header track slides while the GPL plays the LoadingChip (no panel slide) - a desync. §6 case 6's claim that `/discussion/*` is `'deep'` is factually wrong. Fix: narrow the discriminator to `navigation.to.url.pathname === '/'` (the GPL's own same-panel-exit condition for `/search` is exactly `to === resolvedLeftHref === '/'`).

**NB16 (auditor 2, 3, 5) - Effect E fires on EXIT nav-land too; §3.5's "Effect E can only publish the ENTER signal" is false.** Effect E's guards (`Header.svelte:408-432`) do not distinguish enter from exit; on `/search → /` nav-land every guard passes and it re-arms the rAF post-nav (redundant with the pre-nav publisher). The post-nav rAF is largely inert (`isSearch=false` gates `searchProgress`), but it wastes 200ms and re-arms the clear watch, and the plan's description is wrong. Fix: add a direction guard to Effect E (`if (!curIsSearch) return;` - the EXIT direction is owned by the `beforeNavigate` publisher), or explicitly document the redundant post-nav rAF as master-preserved.

**NB17 (auditor 2, 3) - CSS-transition race on the EXIT first frame.** The GPL's own `beforeNavigate` runs synchronously and sets `snapIndex = 0` (`:817`), starting the CSS `duration-200` slide; ~16ms later the Header rAF's first tick sets `tapMorph`, the `tapMorph !== null` gate suppresses the CSS transition, and the tap branch yanks the transform back to its start - a visible stutter. Fix: the Header `beforeNavigate` must call `setTapMorph(start)` SYNCHRONOUSLY (before the rAF), so the `tapMorph !== null` gate is true in the same flush and the CSS transition never starts (mirroring `startSearchScrub`'s synchronous `searchScrubbing = true` at `Header.svelte:442-443`).

**NB18 (auditor 1) - `executePendingNav`'s second navigation re-arms the rAF.** The GPL poll calls `navStore.executePendingNav` (`navigation.svelte.ts:191`), which dispatches a new navigation; SvelteKit fires `beforeNavigate` again, and the Header publisher re-arms (cancel + restart from the start value). The rAF may never complete. Fix: the publisher must recognize an in-flight scrub (`tapMorph !== null`) and not re-arm, or the discriminator must distinguish the same-panel exit from the programmatic re-dispatch.

**NB19 (auditor 5) - the clear-watch's `scrubTarget`/`scrubTerminal` latch is unspecified.** A naive generic watch (`clear when tapMorph === (currentHasTabs ? 1 : 0)`) would clear at the EXIT rAF's first tick (`tapMorph = 0`, `currentHasTabs = false` on `/search` → `0 === 0`). The watch must carry direction state latched at rAF-arming time (scrubTarget = the destination's `currentHasTabs`, scrubTerminal = the rAF's target value). Fix: specify the latch explicitly; the watch is `$effect.pre` so its clear is visible to the same render.

## Notable concerns (non-blocking)

- **`searchProgress` jump-free relies on Effect E being `$effect.pre`.** If the implementer uses `$effect` or a microtask, there is a 1-frame flash (`isSearch=true, morph=0(rest), searchProgress=1`). State the dependency.
- **Header `beforeNavigate` lacks an `isMobile` gate.** On desktop the rAF arms invisibly (no mobile track, no GPL on `/search` desktop). Gate it or document.
- **Rapid enter→exit reversal jumps `tapMorph`** from mid-sweep to the start value. Edge case; acknowledge.
- **`executePendingNav` sets `navInFlight` on EXIT** (via the poll), so "tap navs never set `navInFlight`" is true only for ENTER. The clear-watch design (using `currentHasTabs`/`tapMorph`, not `navInFlight`) is unaffected; correct the plan's reasoning.
- **`W` IS reactive** (`:180` `$derived`), contradicting an earlier plan note; the rAF captures it once, so the practical claim holds but the reason is wrong.
- **DEV probe `HeaderStateSnapshot`** does not capture `tapMorph`; extend for debug.
- **Effect E rearming on EXIT post-nav** wastes rAF work even if guarded from visible effect; an explicit `if (!curIsSearch) return` is cleaner.

## Organic-clean

Clean (5/5). GPL imports no `resolveHeaderMode`, has no `/search` token; reads only `pager.tapMorph`. Header already imports `resolveHeaderMode`; the new `beforeNavigate` reuses it. `mobile-pager.svelte.ts` gains a general `tapMorph` field.

## Revision decisions (applied to `docs/DV17-Plan.md` as Round 8)

1. **Narrow the EXIT discriminator (NB15).** Header `beforeNavigate` arms only on `page.url.pathname === '/search' && navigation.to.url.pathname === '/'` - matching the GPL's own same-panel-exit condition for `/search` (`to === resolvedLeftHref === '/'`), excluding `/activity`, `/messages/inbox`, `/discussion/*`, `/messages/<id>`, and all deep routes.
2. **Effect E direction guard (NB16).** Effect E adds `if (!curIsSearch) return;` so it publishes only the ENTER signal; EXIT is owned by the `beforeNavigate` publisher. §3.5 corrected.
3. **Synchronous `setTapMorph(start)` in `beforeNavigate` (NB17).** The Header `beforeNavigate` calls `setTapMorph(startValue)` synchronously before scheduling the rAF, so the `tapMorph !== null` gate is true in the same flush and the GPL's CSS transition never starts.
4. **No re-arm on `executePendingNav` redispatch (NB18).** The publisher short-circuits when `pager.tapMorph !== null` (scrub already in flight).
5. **Clear-watch latches (NB19).** At rAF-arming, latch `scrubTarget` (the destination `currentHasTabs`) and `scrubTerminal` (the rAF target value). The watch (a `$effect.pre`) clears only when `currentHasTabs === scrubTarget && tapMorph === scrubTerminal`. Specified explicitly.
6. **Non-blocking pins.** State the `$effect.pre` dependency of the jump-free claim; add an `isMobile` gate to the `beforeNavigate`; acknowledge the rapid-reversal jump; correct the `navInFlight`-on-EXIT and `W`-reactivity reasoning.

Open for Round 8: confirm the narrowed discriminator excludes every non-`/` target (grep the route table for `'root'`-mode paths reachable from `/search`); confirm the synchronous `setTapMorph(start)` makes the CSS transition never start; confirm the clear-watch latches hold the EXIT terminal across the pre-nav window and clear jump-free at nav-land; confirm the Effect E direction guard does not regress the master ENTER behavior.
