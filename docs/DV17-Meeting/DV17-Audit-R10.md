# DV17 - Plan Audit Round 10

5 open-ended auditors examined `docs/DV17-Plan.md` (Round 10: decouple - track/Tab group on `tapMorph`, layer group on master `morph`). Result: **3/5 PASS (auditors 1, 3, 5), 2/5 changes_requested** (all high confidence). First majority PASS. The decouple resolves NB24/25 (Tab descent preserved); the sync math, the drag fallback, the discriminator, and the organic-clean gate all verify. Two blocking issues survive (one a real clear-condition hole, one a likely misread to be settled empirically). Full detail below.

## Tally

| Auditor | Verdict           | Blocking | Organic | Confidence |
| ------- | ----------------- | -------- | ------- | ---------- |
| 1       | PASS              | 0        | clean   | high       |
| 2       | changes_requested | 1        | clean   | high       |
| 3       | PASS              | 0        | clean   | high       |
| 4       | changes_requested | 1        | clean   | high       |
| 5       | PASS              | 0        | clean   | high       |

## Endorsement (3/5)

Auditors 1, 3, 5 verified end-to-end: the decouple (track/Tab group on `tapMorph` with `morph` fallback; layer group on master `morph`) preserves the Tab descent (Effect E morph scrub retained, drives `rootLayerStyle` post-nav on exit); `searchProgress`/`tabProgress` reading `tapMorph` (fallback `morph=backMorph` when `tapMorph===null`) preserves the drag path and the slide-before-expand / collapse-before-slide ordering; the EXIT pre-nav publisher (pathname discriminator, synchronous setTapMorph, navInFlight short-circuit) and the enter post-nav publisher (Effect E) are correct; the sync math is exact (`|trackNorm − pageNorm| = 0` by construction over `[0.2,1]`); organic-clean holds (GPL no `/search` token, no `resolveHeaderMode`; Header reuses `isSearch`).

## Blocking issues

**NB26 (auditor 2) - clear condition cannot recover a mid-scrub redirect because it requires `tapMorph === scrubTerminal`.** §4.4 item 2 Clear: `tapMorph === scrubTerminal && (currentHasTabs === scrubTarget || currentPath !== scrubSource)`. JS precedence makes `tapMorph === scrubTerminal` required for BOTH disjuncts. On a mid-scrub redirect to a deep route, `tapMorph` is NOT at terminal; the clear never fires; the orphan rAF (on the never-unmounting Header) keeps writing for ~150-200ms; the freshly-mounted deep GPL reads the stale non-null `tapMorph`, computes a bogus `tapVisualOffset`, and shows panel 0 for the remainder. Fix: regroup to `((tapMorph === scrubTerminal && currentHasTabs === scrubTarget) || currentPath !== scrubSource)` and CANCEL the orphan rAF on clear - any navigation away from `scrubSource` clears immediately, without waiting for terminal.

**NB27 (auditor 4) - claimed MobileTabBar "appears twice" on EXIT (pre-nav slide-in + nav-land jump + post-nav descent).** The trace assumes panel 0 (the GPL track slide) contains MobileTabBar. But MobileTabBar lives in the Header `rootLayer` (not the GPL); on EXIT pre-nav `isSearch === true` so the search layer covers it (invisible), and at nav-land the retained master morph scrub drives the single descent. This matches master. The claim is very likely a misread (conflating the GPL page panel with the Header root layer), but it must be settled empirically - the §7 e2e must assert MobileTabBar's `translateY` trajectory matches master across the pre-nav / nav-land / post-nav window (a single descent, no pre-nav appearance, no double-appear).

## Notable concerns (non-blocking)

- **Effect E enter-vs-both-directions wording** (§4.4 item 2). The bullet says "starts the enter tapMorph rAF" but the body says "on a root↔search tap ... starts a tapMorph rAF". Pin "enter-only" (exit is the `beforeNavigate`).
- **§6 case 6 (`/search → /activity`)** - if the user entered `/search` FROM `/activity`, the GPL same-panel exit DOES slide the Page; the "no Page slide" wording is loose. Behavior preserved either way.
- **§1 scope vs EXIT `/`-only publisher** - `/search ↔ /activity` keeps master desync; surface this in §1.
- **`scrubSource`/`scrubTarget`/`scrubTerminal` as state vars** unnamed; the `set` preservation contract is correct.
- **Drag-cancel race window** - one flush where `dragOffset !== null` but `tapMorph` still non-null; imperceptible, empirical check.
- **Linear vs ease-out Page-slide easing** - deliberate tradeoff; flag.
- **`isMobile` gate** on the new rAFs implicit (harmless on desktop); pin.
- **`:817` citation / `W` reactivity note** - cosmetic.

## Organic-clean

Clean (5/5). GPL no `/search` token, no `resolveHeaderMode`; Header reuses `isSearch` + a `'/'` literal (pre-existing vocabulary); `mobile-pager` adds general `tapMorph`; `startSearchScrub` retained.

## Revision decisions (applied to `docs/DV17-Plan.md` as Round 11)

1. **NB26 clear regroup + orphan cancel.** Clear when `((tapMorph === scrubTerminal && currentHasTabs === scrubTarget) || currentPath !== scrubSource)`, and the clear cancels the orphan rAF. A navigation away from `scrubSource` now clears immediately (no terminal wait); the in-flight scrub on the persistent Header is torn down; the deep GPL never reads a stale `tapMorph`.
2. **NB27 empirical guard.** §7 adds an e2e asserting MobileTabBar `translateY` across the EXIT window matches master (single post-nav descent `-100%→0%`; no pre-nav appearance; no double-appear). The plan documents that MobileTabBar is in the Header `rootLayer` (covered by the search layer pre-nav), not the GPL page panel, so the GPL track slide cannot affect it.
3. **Pins.** Effect E "enter-only" tapMorph rAF; §6 case 6 wording; §1 scope note; `isMobile` gate.

Open for Round 11: confirm the regrouped clear recovers the mid-scrub deep-route redirect (orphan rAF cancelled, deep GPL reads `tapMorph === null`); confirm the MobileTabBar e2e matches master (settles NB27).
