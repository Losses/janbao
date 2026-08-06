<script lang="ts">
	/**
	 * Header Organism - the global sticky App Bar (rendered once in AppShell).
	 *
	 * Desktop: logo + navigation links (Activity / Messages / Search).
	 *
	 * Mobile: a 2-panel horizontal track (root panel + search panel, mirrors the
	 * NavPipelineTabHost pattern). The search button is a SINGLE
	 * absolutely-positioned `<a>` whose `left` is a reactive `style` binding
	 * (no CSS transition): one icon, no duplicate. Entering search slides the
	 * track left (root content exits left, search content pushes in from the
	 * right) while the search button independently travels right-to-left,
	 * stopping at the hamburger's position.
	 *
	 * The root↔deep vertical morph (BurgerArrowIcon + title) lives INSIDE panel 0
	 * but is FROZEN during a search transition (the tabs must exit horizontally
	 * with the track, never float up vertically).
	 *
	 * The SearchTabBar row clip-expands (max-height 0 → 3rem) rather than jumping.
	 *
	 * RENDER-ONLY (DV20 step 3): the Header is a reader of the pipeline
	 * orchestrator's reactive class fields. The orchestrator owns the
	 * settle ease (the morph + title crossfade during a gesture release,
	 * a discrete nav, or an idle title change at landing), the root↔search / deep↔search
	 * tap-scrub ease, and the `searchScrubbing` flag; this component reads
	 * `orchestrator.settleProgress` (titleView spans),
	 * `orchestrator.settleMorphFraction` (morph derivation),
	 * `orchestrator.settleLatched`, `orchestrator.settleActive`,
	 * `orchestrator.settleDirection`, `orchestrator.searchScrubbing`,
	 * `pager.tapMorph`, `pager.backMorph`, `pager.dragging`,
	 * `pager.scrubIconEndpoint`, and `pager.transitionTarget`, and derives
	 * every visual from them and the `dragMorphAnchor` / `searchAnchor` /
	 * `dragSearchAnchor` getters (consumed by the morph / searchProgress
	 * derivations below).
	 * No Header-owned rAF, no Header-owned animation state, no CSS transitions
	 * in this layer. §5: the orchestrator (publication record + pager-store morph
	 * fields it writes via #republishToPager; synchronous per
	 * pointermove during a drag, via the rAF channels during a commit/settle/scrub)
	 * drives every motion; the
	 * hide-on-scroll `translateY` is a reactive read of the scroll-chrome
	 * store (its own rAF-throttled scroll listener publishes each frame).
	 */
	import { untrack } from 'svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import Logo from '$lib/components/atoms/Logo.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import BurgerArrowIcon from '$lib/components/atoms/BurgerArrowIcon.svelte';
	import MobileTabBar from '$lib/components/organisms/MobileTabBar.svelte';
	import SearchTabBar from '$lib/components/organisms/SearchTabBar.svelte';
	import SearchSortSheet from '$lib/components/molecules/SearchSortSheet.svelte';
	import { isNavActive } from '$lib/utils/nav-active';
	import { resolveDeepHeaderTitle } from '$lib/utils/deep-header-config';
	import { resolveHeaderMode } from '$lib/utils/header-mode';
	import { getCurrentTabIndex } from '$lib/utils/route-config';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';
	import { getNavigationStore } from '$lib/stores/navigation.svelte';
	import { getGlobalNavPipelineOrchestrator } from '$lib/stores/nav-pipeline-orchestrator.svelte';
	import { hopForHref } from '$lib/utils/history-nav';
	import { HEADER_MORPH_THRESHOLD } from '$lib/utils/gesture-constants';
	import { mdiMagnify, mdiFilterVariant } from '@mdi/js';
	import type { SearchSort, SearchScope } from '$lib/types/search';
	import type { VoidHandler } from '$lib/types/handlers';
	import type { TranslationDict } from '$lib/types/translation';
	import type { HeaderStateSnapshot } from '$lib/utils/header-probe';

	interface HeaderProps {
		t: TranslationDict;
		onToggleDrawer: VoidHandler;
	}

	let { t, onToggleDrawer }: HeaderProps = $props();

	const scrollChrome = getScrollChromeStore();
	const pager = getMobilePagerStore();
	const navStore = getNavigationStore();
	const orchestrator = getGlobalNavPipelineOrchestrator();
	const tNav = $derived(t.nav);
	const currentPath = $derived(page.url.pathname);
	const translateY = $derived(scrollChrome.translateY);

	// Reset the orchestrator's cached header-state fields on mount. The
	// Header persists across pipeline route swaps (SvelteKit keeps the same
	// instance, only its `page.data` inputs change), so onMount fires only
	// on a FRESH Header instance: initial app load and the AppShell remount
	// after a `/entry/*` detour (login / logout). Without this reset the
	// orchestrator's `#headerStateInitialized` stays `true` across the
	// unmount, and the first `notifyHeaderState` on the remounted Header
	// arms a settle against the prev values captured before the detour
	// (visible as a brief stale-title + back-arrow glitch on the home tab
	// root after login). onMount is client-only, so no `browser` guard is
	// needed.
	onMount(() => {
		orchestrator.resetHeaderState();
	});

	const currentHasTabs = $derived(getCurrentTabIndex(currentPath) >= 0);
	const targetHasTabs = $derived(
		navStore.backTarget ? getCurrentTabIndex(navStore.backTarget) >= 0 : false
	);
	const isDeepToDeep = $derived(!currentHasTabs && !targetHasTabs);

	const mode = $derived(resolveHeaderMode(currentPath));
	const isSearch = $derived(mode === 'search');
	const isDeep = $derived(mode === 'deep');
	const dragging = $derived(pager.dragging);
	const title = $derived(page.data.headerTitle ?? resolveDeepHeaderTitle(currentPath, t) ?? '');

	type TitleDirection = 'forward' | 'back';

	// Settle / tap-scrub state comes straight from the orchestrator's
	// reactive class getters. The orchestrator owns the settle ease
	// (the morph + title crossfade during a gesture release, a discrete
	// nav, or an idle title change at landing), the tap-scrub ease, and
	// the `searchScrubbing` flag; the underlying `$state` fields live on
	// the `NavStateMachine` singleton (the §13.5 authority), exposed by
	// the orchestrator via `$derived` pass-throughs in its `#publication`
	// and read by the Header through the public getters.
	// `orchestrator.settleLatched` carries the endpoint identity frozen
	// at settle-arm; `orchestrator.settleDirection` selects the title-span
	// slide axis.
	const settleActive = $derived(orchestrator.settleActive);
	const settleProgress = $derived(orchestrator.settleProgress);
	const settleMorphFraction = $derived(orchestrator.settleMorphFraction);
	const settleLatched = $derived(orchestrator.settleLatched);
	const settleDirection = $derived(orchestrator.settleDirection);
	const searchScrubbing = $derived(orchestrator.searchScrubbing);

	// Header-state notification to the orchestrator. The Header is in a
	// component scope so SvelteKit's `$app/state` `page` reactivity reaches
	// it on every navigation; the orchestrator singleton module's
	// `$effect.root` scope does not see those changes. The Header's
	// `$effect.pre` runs before the render in the same flush, reads the
	// live `currentPath` / `title` / `currentHasTabs` / `isSearch`, and
	// hands them to `orchestrator.notifyHeaderState`. The orchestrator
	// owns the detection logic: it arms the settle ease on a title change
	// and the tap-scrub ease on an isSearch flip. The drag /
	// drag-cancel / in-flight-settle guards live in the orchestrator. No
	// Header-owned animation state; this Effect is a thin sensor channel.
	$effect.pre(() => {
		// Reactive reads (track page.url.pathname + page.data.* + the
		// local derived tab-ness / search-mode).
		const newPath = currentPath;
		const newTitle = title;
		const tabs = currentHasTabs;
		const search = isSearch;
		const tt = t;
		orchestrator.notifyHeaderState(newPath, newTitle, tabs, search, tt);
	});

	// Morph derivation. Reads `pager.backMorph` while a drag owns the track,
	// the orchestrator's settle publication while a settle owns the crossfade,
	// and the static tab-ness at rest. The tap scrub does not
	// touch `morph` (the vertical layer group stays out of the horizontal
	// scrub): tapMorph drives the horizontal track via `trackMorph` below.
	const morph = $derived.by(() => {
		if (dragging) {
			if (isDeepToDeep) return 0;
			// A forward swipe from a tab root to `/search` is horizontal-only
			// DURING THE DRAG PHASE: the search panel slides via
			// `searchProgress` (driven by `pager.backMorph`), and the
			// vertical layer group (MobileTabBar / deep title) holds at the
			// source's tab-ness so the bar slides off-screen with panel 0
			// (no diagonal motion). The settle that takes over at release
			// EASEs the morph from the captured `startMorph` toward
			// `destMorph = atRestMorph(outgoingHasTabs)` (= 1 for a tab-root
			// source) across `settleMorphFraction`: the pre-landing `morph`
			// drives `rootLayerStyle`'s `translateY`, so holding at 1 keeps
			// the bar at 0% across the settle and the landing's flip to
			// `transform: none` (search mode) is continuous (R8-A F1: a
			// re-grab whose `anchor.morph` differs from the source's at-rest
			// must ease toward the source's at-rest, or the landing snaps).
			// The back-swipe EXIT from `/search` is horizontal-only via the
			// `isSearch` branch of `rootLayerStyle`; this branch covers the
			// ENTER direction's drag phase. When a re-grab takes over a
			// non-targetIsSearch settle whose morph was in flight (e.g. a
			// back-swipe whose new gesture flips to a forward-swipe-to-
			// `/search`), the at-rest value would snap from the settle's
			// in-flight morph to the source's at-rest morph in one rAF frame
			// (R8-A F1: a 26px rootLayerTy / 119deg burgerRot snap at the
			// re-grab, probe-verified at t=498ms). Honor the drag morph
			// anchor: it carries the morph the settle was rendering at the
			// takeover instant, so returning `anchor.morph` keeps the morph
			// continuous with the prior settle across the direction
			// reversal. The anchor is null for a from-rest drag (no prior
			// settle in flight at `#beginGesture`), so the at-rest value
			// collapses to the existing `currentHasTabs ? 1 : 0` and the
			// source's tab-ness holds across the drag (the from-rest
			// behaviour: the vertical layer group stays out of the
			// horizontal scrub end to end).
			if (targetIsSearch) {
				const morphAnchor = orchestrator.dragMorphAnchor;
				if (morphAnchor !== null) return morphAnchor.morph;
				return currentHasTabs ? 1 : 0;
			}
			// morph semantics: 1 = tab/root (hamburger), 0 = deep (back-arrow).
			// A backward swipe on a tab host toward a deep page must run 1 -> 0,
			// but `pager.backMorph` is the slide progress 0 -> 1 (the reverse
			// direction), so invert it on a tab host (currentHasTabs): morph =
			// 1 - backMorph. On a deep host (no tabs) morph follows backMorph
			// directly (0 -> 1 = deep -> back-target, correct direction). The
			// orchestrator publishes `backMorph` for every claimed drag on a
			// NavPipelineHost route (deep page, compose, and centerTab threads
			// alike) and on every non-tab-to-tab NavPipelineTabHost drag
			// (backward-to-deep, forward-last-tab-to-`/search`); the only null
			// publication is a tab-to-tab swipe on a non-centerTab host type
			// (NavPipelineTabHost tab swipes and NavPipelineHost offline LIST
			// routes like `/offline`, `/offline/activity` whose `leftHref`
			// resolves to a tab root - the source pill-maps and the target
			// is a strict tab root AND `centerTab` is undefined, so
			// `#republishToPager`'s non-centerTab branch's
			// `(fromIdx >= 0 && toIdx >= 0)` clause nulls `backMorph` end to
			// end), where the morph stays at the static
			// `currentHasTabs ? 1 : 0`. A centerTab route -> tab-root swipe
			// (e.g. `/messages/<id>` -> `/messages/inbox`) pill-maps both
			// endpoints to Messages but takes the centerTab branch of
			// `#republishToPager`, which publishes `rawDragFraction` end to
			// end as gesture feedback, so the morph tracks the live drag and
			// the settle at release interpolates from the captured
			// `startMorph` toward the destination's at-rest morph.
			const bm = pager.backMorph;
			if (bm !== null) {
				// When a drag takes over an in-flight settle (re-grab
				// mid-commit, gesture-during-forward-enter), the orchestrator
				// publishes `dragMorphAnchor` carrying the morph value the
				// settle was rendering at the takeover instant plus the raw at
				// that moment. The natural drag-morph curve
				// (`currentHasTabs ? 1 - bm : bm`) would recompute from `bm`
				// and snap (180deg icon + 40px layer snap on a centerTab ->
				// tab-root re-grab; ~103deg icon snap on a gesture-during-
				// forward-enter): it agrees with the settle at the release
				// instant but diverges mid-flight because the settle
				// interpolates toward `destMorph = atRestMorph(incoming)`
				// (1 for a tab-root destination) while the drag formula
				// `1 - bm` travels toward 0. Shift the natural curve so it
				// passes through the anchor instead: shifted(bm) =
				// anchor.morph + natural(bm) - natural(anchor.raw). The
				// shift is constant in bm (the natural slope is preserved),
				// so the formula stays a pure function of `bm` (DV21 §5).
				// Clamped to [0, 1] for the cancel overshoot (a tab-host
				// re-grab whose user drags back to bm = 0 lands at
				// `anchor.morph + anchor.raw`, clamped to 1 = the source's
				// at-rest morph). The orchestrator clears the anchor when
				// the drag ends (settle arm / landAtRest / unmount).
				const anchor = orchestrator.dragMorphAnchor;
				if (anchor !== null) {
					const naturalAtBm = currentHasTabs ? 1 - bm : bm;
					const naturalAtAnchor = currentHasTabs ? 1 - anchor.raw : anchor.raw;
					return Math.max(0, Math.min(1, anchor.morph + naturalAtBm - naturalAtAnchor));
				}
				return currentHasTabs ? 1 - bm : bm;
			}
			// `bm === null` in a drag means the orchestrator's publication
			// rule for this shape nulls `backMorph` end to end (a tab-to-tab
			// swipe on a non-centerTab host). When a re-grab takes over a
			// non-tab-to-tab settle whose morph was in flight (e.g. a
			// deep->tab settle interrupted by a tab-to-tab re-grab), the
			// at-rest value would snap from the prior settle's morph to the
			// source's at-rest morph in one rAF frame (R8-A F2: same shape
			// as F1, reachable when the re-grab flips the publication rule
			// to tab-to-tab while the prior settle's morph was mid-flight).
			// Honor the anchor for the same reason as the `targetIsSearch`
			// short-circuit above; collapse to the at-rest value when no
			// anchor is in flight (the from-rest case the fallback serves).
			const nullBmAnchor = orchestrator.dragMorphAnchor;
			if (nullBmAnchor !== null) return nullBmAnchor.morph;
			return currentHasTabs ? 1 : 0;
		}
		if (settleActive && settleLatched) {
			// Interpolate from the latched `startMorph` (captured at the
			// settle-arm instant: the drag's terminal for a gesture release,
			// the interrupt-instant value for a gesture-interrupted discrete nav, the source's at-rest
			// for a from-rest discrete nav, an enter, or an idle arm, or
			// the in-flight morph for a re-arm) to `destMorph` across
			// `settleMorphFraction` (the normalized 0..1 fraction of the
			// eased settle curve traversed so far). For most shapes
			// `destMorph = atRestMorph(incomingHasTabs)` on a commit or
			// `atRestMorph(outgoingHasTabs)` on a cancel; the `targetIsSearch`
			// shape eases toward `atRestMorph(outgoingHasTabs)` (= 1 for a
			// tab-root source) so the pre-landing `morph` keeps the bar at
			// 0% and the landing's flip to `transform: none` is continuous
			// (R8-A F1 - see `#armSettleEaseFromGesture`). For the no-anchor
			// from-rest case the lerp is a constant hold when
			// `startMorph === destMorph`; otherwise it eases the
			// morph. For a re-grab whose `anchor.morph` differs,
			// the ease bridges the gap. Reading `settleProgress` directly
			// here would start the lerp partway (at settleStartProgress,
			// not 0) and snap the icon plus layer translateY in one rAF
			// frame at the release handoff (DV21 §5: every
			// visual is a pure function of the one published progress, no
			// discontinuity at the handoff). The orchestrator owns the
			// capture (the startMorph / destMorph fields on
			// `HeaderSettleTransition`), so this branch is a pure lerp on
			// the latched pair and `settleMorphFraction`.
			return (
				settleLatched.startMorph +
				(settleLatched.destMorph - settleLatched.startMorph) * settleMorphFraction
			);
		}
		return currentHasTabs ? 1 : 0;
	});

	// The icon morph (hamburger <-> back-arrow) during a tap scrub.
	// `iconProgress` is 0 (hamburger) at the search endpoint of the scrub;
	// at the non-search endpoint it is `scrubIconEndpoint` (0 for a tab
	// root, 1 for a deep page). `pager.tapMorph` eases 1 -> 0 across the
	// scrub (1 = non-search side, 0 = search side), so lerping by tapMorph
	// (`tapMorph * scrubIconEndpoint`) keeps the morph continuous with the
	// horizontal track scrub: a tab<->search scrub holds the hamburger
	// (scrubIconEndpoint = 0), a deep<->search scrub eases the back-arrow
	// into the hamburger (scrubIconEndpoint = 1). Outside a scrub the
	// morph is `0` when `isSearch` (hamburger on /search), else
	// `1 - morph` (the root<->deep vertical morph at rest / during a
	// drag / settle).
	const iconProgress = $derived.by(() => {
		if (searchScrubbing && pager.tapMorph !== null) {
			const endpoint = pager.scrubIconEndpoint ?? 0;
			return pager.tapMorph * endpoint;
		}
		return isSearch ? 0 : 1 - morph;
	});

	// Title view model. The drag branch hardcodes direction 'back' (a
	// back-swipe always slides the current title down and brings the back
	// target in from above). The title spans read `progress` directly: during
	// a settle it is the orchestrator-published `settleProgress`, animated
	// frame-by-frame by the orchestrator's settle rAF; during a drag it is
	// `pager.backMorph` (a pager-store field the orchestrator writes synchronously
	// per pointermove; the executor's rAF is stopped during a drag); at
	// rest it is 1. No CSS transition is involved on the title spans.
	interface TitleView {
		outgoing: string;
		incoming: string;
		progress: number;
		direction: TitleDirection;
	}

	const currentTitle = $derived(title);
	const backTitle = $derived(
		navStore.backTarget ? (resolveDeepHeaderTitle(navStore.backTarget, t) ?? '') : ''
	);
	const titleView = $derived<TitleView>(
		dragging && backTitle && currentTitle
			? {
					outgoing: currentTitle,
					incoming: backTitle,
					progress: pager.backMorph ?? 0,
					direction: 'back'
				}
			: settleActive
				? {
						outgoing: settleLatched?.outgoingTitle ?? '',
						incoming: settleLatched?.incomingTitle ?? '',
						progress: settleProgress,
						direction: settleDirection
					}
				: {
						outgoing: title,
						incoming: title,
						progress: 1,
						direction: settleDirection
					}
	);

	// Hoisted endpoint-identity source for the layer styles AND the probe: the
	// latched record during a settle (frozen), live at rest. Consuming the SAME
	// derived here means a revert to live in either layer style is observable
	// via effectiveTabsOut/In in the probe (the §7 source-attribution guard).
	// At rest (no settle, no drag) both endpoints fall back to the CURRENT
	// route's tab-ness (currentHasTabs): the tab bar's visibility and
	// interactivity follow the route the user is on, not the back-target. The
	// back-target's tab-ness is irrelevant at rest (only its title drives the
	// back-arrow label); reading it here would disable the bar on a tab root
	// whenever the back-target is a deep page. During a drag the INCOMING
	// endpoint reads `pager.transitionTarget` (the orchestrator-published
	// destination pathname, republished per pointermove) so the layer guards
	// `!(tabsOut || tabsIn)` and `!tabsOut && !tabsIn` see the real endpoints
	// of the in-flight transition, not the current route twice. Without this,
	// a deep-host back-swipe toward a tab root (e.g. `/profile/settings` ->
	// `/`) sees `tabsOut === tabsIn === false` and force-freezes the root
	// layer at -100% and the title layer at 0%, so `morph` advancing on
	// `pager.backMorph` never reaches either style. The outgoing endpoint
	// during a drag is still the current route (the drag has not landed
	// yet); only the incoming endpoint is drag-aware.
	const dragTargetHasTabs = $derived(
		pager.transitionTarget !== null
			? getCurrentTabIndex(pager.transitionTarget) >= 0
			: currentHasTabs
	);
	const tabsOut = $derived(settleLatched ? settleLatched.outgoingHasTabs : currentHasTabs);
	const tabsIn = $derived(
		settleLatched
			? settleLatched.incomingHasTabs
			: dragging && pager.transitionTarget !== null
				? dragTargetHasTabs
				: currentHasTabs
	);
	// Root↔deep vertical morph: FROZEN in search mode so the tabs exit
	// horizontally with the track, never float up. The transform follows
	// `morph` directly (no `transition:` inline): during a settle `morph`
	// reads the orchestrator-published `settleMorphFraction` and lerps
	// between the latched `startMorph` / `destMorph`; during a drag it
	// reads `pager.backMorph`; at rest it is the static tab-ness value.
	const rootLayerStyle = $derived(
		isSearch
			? 'transform: none; opacity: 1;'
			: `transform: translateY(${
					!(tabsOut || tabsIn) ? -100 : -(1 - morph) * 100
				}%); pointer-events: ${morph > 0.5 && tabsIn ? 'auto' : 'none'}`
	);
	const layerDownStyle = $derived(
		`transform: translateY(${(!tabsOut && !tabsIn ? 0 : morph) * 100}%); pointer-events: ${
			morph < 0.5 ? 'auto' : 'none'
		}`
	);

	// DEV-ONLY probe. Reads every morph-state dep so Svelte re-runs it on each
	// flush they change, pushing a snapshot to window.__headerMorphProbe
	// regardless of whether a paint fires between flushes. The settle fields
	// (settleActive / settleProgress / settleLatched / settleDirection /
	// settleAwaitTitle) come from the orchestrator singleton's reactive
	// getters (NavStateMachine pass-throughs exposed via `#publication`);
	// the tap-scrub fields (tapMorph / scrubIconEndpoint) come from the
	// primary pager store.
	// `lastGestureMorph`, `isSettleMode`, and `prevHasTabs` are kept in the
	// snapshot shape (the e2e tests mirror the shape) and carry stable
	// values: `settleActive` is the single settle-mode signal (aliased into
	// `isSettleMode`); the morph value at the settle-arm instant that
	// drives the §5 continuity lives on the latched record
	// (`settleLatched.startMorph`,
	// captured at arm time by the orchestrator), so the snapshot's
	// `lastGestureMorph` slot stays 0 (no separate probe-only field);
	// the Header does not track a previous path (`prevHasTabs` mirrors
	// `currentHasTabs`).
	$effect(() => {
		if (!import.meta.env.DEV || !browser) return;
		if (!window.__headerMorphProbe) window.__headerMorphProbe = [];
		const log = window.__headerMorphProbe;
		const snap: HeaderStateSnapshot = {
			t: performance.now(),
			path: currentPath,
			morph,
			rootLayerStyle,
			layerDownStyle,
			settling: settleActive,
			isSettleMode: settleActive,
			settleProgress,
			settleAwaitTitle: orchestrator.settleAwaitTitle,
			lastGestureMorph: 0,
			currentHasTabs,
			targetHasTabs,
			prevHasTabs: currentHasTabs,
			latchedSettle: settleLatched,
			effectiveTabsOut: tabsOut,
			effectiveTabsIn: tabsIn,
			dragging,
			backMorph: pager.backMorph
		};
		log.push(snap);
		if (log.length > 8000) log.shift();
	});

	// Root↔search horizontal track.
	// During an orchestrator-in-flight transition the track reads
	// `pager.backMorph` (a pager-store field the orchestrator writes via
	// #republishToPager: raw per pointermove during a drag, eased via the
	// executor's rAF during a commit/cancel slide) so it stays frame-synced with the
	// NavPipelineHost Page panel (the executor writes that panel's transform
	// via `LiveNavDomDriver` from the same per-pointermove progress).
	// The ENTER and EXIT branches invert because backMorph is the slide
	// progress 0→1 in both directions, while the morph signal (tab-ness) runs
	// 1→0 on a forward-enter (transitionTarget === currentPath, arriving at
	// /search) and 0→1 on a backward-exit (transitionTarget !== currentPath,
	// leaving /search). Outside an orchestrator transition the track falls
	// back to pager.tapMorph (a pager-store field the orchestrator's tap-scrub rAF writes),
	// then to morph (rest / gesture-settle).
	const trackMorph = $derived(
		pager.transitionTarget !== null && pager.backMorph !== null
			? pager.transitionTarget === currentPath
				? 1 - pager.backMorph
				: pager.backMorph
			: pager.tapMorph !== null
				? pager.tapMorph
				: morph
	);
	// `transitionTarget` resolves to a search-mode route (the `/search`
	// pathname). Drives the forward-swipe-from-last-tab branch in
	// `searchProgress` and the `morph`-skip in the morph derivation: the
	// orchestrator's gesture path publishes `transitionTarget='/search'` +
	// the live `backMorph` while the source tab root is still mounted, so
	// the search panel slides in via `searchProgress = trackMorph` (the
	// `isSearch`-gated fallback would otherwise clamp it to 0 across the
	// whole drag, since `isSearch` follows the pre-flip source endpoint).
	const targetIsSearch = $derived(
		pager.transitionTarget !== null && resolveHeaderMode(pager.transitionTarget) === 'search'
	);
	// searchProgress is the search-layout position the Header renders: 1 when
	// the search panel fills the track, 0 when the root panel fills it. The
	// orchestrator owns the motion; the consumers (track / search button) are
	// pure functions of this value. The scope-tab bar uses `tabProgress`, not
	// searchProgress. Five sources by precedence:
	//   1. A tap-scrub in flight (pager.tapMorph !== null): tapMorph is
	//      `isSearch`-inverted (1 = not search, 0 = search), so searchProgress
	//      = 1 - tapMorph. Drives the root↔search AND the deep↔search
	//      trajectories (the orchestrator arms the scrub on any isSearch
	//      flip). Reading tapMorph directly (not via trackMorph + isSearch)
	//      is required for the deep↔search EXIT: once the URL lands on a
	//      deep page isSearch is false and the gated fallback below would
	//      clamp to 0; tapMorph drives the slide back to 0 over the scrub.
	//   2. A settle in flight with a search anchor
	//      (`orchestrator.searchAnchor !== null`). The orchestrator seeds the
	//      anchor at five boundary handoffs where the natural switch below
	//      would snap (R23-B + R24-A + R91): the `playEnterAnimation`
	//      commit-to-enter handoff (R23-B F2: a forward-swipe-to-`/search`
	//      commit ends at raw=1 with the panel slid fully in, the enter
	//      slide's natural `1 - trackMorph = bm` resets 1 -> 0 -> 1 across
	//      the host swap, snapping fully out then back in; the seed holds
	//      `start = dest = 1` so the panel stays slid in across the settle);
	//      the discrete-nav arm drag interrupt (R23-B F1: a non-search
	//      `goto` / tab-click / popstate interrupts a forward-swipe-to-
	//      `/search` drag with the panel `bm` of the way in, the dest is
	//      non-search, the natural switch collapses `bm` -> 0 in one frame;
	//      the seed lerps from the captured live `bm` to 0 across the
	//      discrete-nav settle); the `#accelerateInFlight` enter interrupt
	//      (R24-A: a non-search `goto` interrupts an in-flight enter settle
	//      on `/search`, the accelerate's `#armSettleEase` clears the anchor
	//      that the enter seeded at hold-1; the re-seed carries the held-at-1
	//      panel position across the accelerated re-arm); the
	//      `notifyHeaderState` mid-settle absorb (R24-A: a dynamic-title
	//      route resolves a new title mid-enter on a `/search` commit, the
	//      re-arm clears the anchor mid-flight; the re-seed carries the
	//      in-flight search-axis position across the re-arm); and the
	//      `#armSettleEaseFromGesture` gesture-release re-seed (R91: a
	//      re-grab whose `#dragSearchAnchor` shifted the gesture formula;
	//      the re-seed carries the drag's terminal search-axis value
	//      across the settle-arm clear). The lerp eases
	//      `start` (the captured pre-boundary value) to `dest` (the dest's
	//      at-rest searchProgress) across `settleMorphFraction`. At settle
	//      end (`settleMorphFraction = 1`) the lerp equals `dest`, which
	//      agrees with the at-rest switch (`isSearch ? 1 : 0`) at the
	//      post-settle `isSearch`, so the anchor is cleared without a snap.
	//      Mirrors the morph axis's `settleLatched.startMorph` -> `destMorph`
	//      lerp and the FAB axis's `#enterFabAnchor` lerp.
	//   3. A drag in flight with a drag search anchor
	//      (`orchestrator.dragSearchAnchor !== null`). When a re-grab takes
	//      over an in-flight search settle (`#beginGesture` with
	//      `settleActive && #searchAnchor !== null`), the settle is cancelled
	//      and the `settleActive` flag flip makes branch 2 short-circuit, handing the search
	//      axis to the natural gesture formula below, whose `bm` value at
	//      the takeover disagrees with the held settle lerp (R26-A:
	//      ~238px snap on a 393px viewport). The orchestrator captures
	//      the search-axis position via `#searchProgressAtSettleInstant`
	//      BEFORE the cancel and exposes it via `dragSearchAnchor`; this
	//      branch shifts the natural gesture formula so it passes through
	//      `(anchor.raw, anchor.search)`:
	//      `shifted(bm) = anchor.search + natural(bm) - natural(anchor.raw)`,
	//      where `natural(t)` is the gesture formula in branch 4 evaluated
	//      at `bm = t`. The shift is constant in bm (the natural slope is
	//      preserved), so the formula stays a pure function of `bm` (DV21
	//      §5). Clamped to [0, 1] for the cancel overshoot. Mirrors the
	//      morph axis's `dragMorphAnchor` shift and the FAB axis's
	//      `dragFabAnchor` shift.
	//   4. A gesture in flight (transitionTarget + backMorph). The publication
	//      runs while the source route is still mounted, so isSearch matches
	//      the pre-flip endpoint:
	//      - EXIT (isSearch, source is /search): the search panel leaves,
	//        1 → 0, so searchProgress = 1 - trackMorph.
	//      - ENTER (targetIsSearch, target is /search from a forward
	//        last-tab swipe): the search panel enters, 0 → 1, so
	//        searchProgress = trackMorph.
	//   5. At rest: isSearch ? 1 : 0.
	const searchProgress = $derived.by(() => {
		if (pager.tapMorph !== null) {
			return 1 - pager.tapMorph;
		}
		const searchAnchor = orchestrator.searchAnchor;
		if (settleActive && searchAnchor !== null) {
			return searchAnchor.start + (searchAnchor.dest - searchAnchor.start) * settleMorphFraction;
		}
		const dragSearchAnchor = orchestrator.dragSearchAnchor;
		if (dragSearchAnchor !== null) {
			// Shift the natural gesture formula so the curve passes through
			// the takeover visual `(anchor.raw, anchor.search)` (R26-A). The
			// natural formula is the gesture branch below evaluated at a bm
			// value; trackMorph is `transitionTarget === currentPath ?
			// 1 - bm : bm`, so the anchor's trackMorph-equivalent at
			// `anchor.raw` is computed on the same path-equality relation.
			// When `backMorph === null` (a tab-to-tab re-grab on a non-
			// centerTab host) the gesture branch below is skipped because
			// no live morph is published for that shape; hold at
			// `anchor.search` for the drag's duration so the search axis
			// stays continuous with the prior settle (R26-A design,
			// mirrors the morph axis's `nullBmAnchor` hold branch). For
			// a `/search`-commit settle re-grabbed into a tab-to-tab
			// swipe `anchor.search = 1` (the panel was fully slid in);
			// the hold keeps it visible for the drag's duration and the
			// release settle eases it back out (the alternative --
			// snapping to at-rest -- would introduce a discontinuity at
			// both the re-grab and the release boundaries).
			if (pager.transitionTarget !== null && pager.backMorph !== null) {
				const anchorTrackMorph =
					pager.transitionTarget === currentPath ? 1 - dragSearchAnchor.raw : dragSearchAnchor.raw;
				const naturalAtBm = isSearch ? 1 - trackMorph : targetIsSearch ? trackMorph : 0;
				const naturalAtAnchor = isSearch
					? 1 - anchorTrackMorph
					: targetIsSearch
						? anchorTrackMorph
						: 0;
				return Math.max(0, Math.min(1, dragSearchAnchor.search + naturalAtBm - naturalAtAnchor));
			}
			return dragSearchAnchor.search;
		}
		if (pager.transitionTarget !== null && pager.backMorph !== null) {
			return isSearch ? 1 - trackMorph : targetIsSearch ? trackMorph : 0;
		}
		return isSearch ? 1 : 0;
	});
	// Scope-tab bar expansion. Pure function of `searchProgress` (one
	// derivation, one consumer): the bar expands once the search panel is
	// past the `1 - HEADER_MORPH_THRESHOLD` threshold of the way in, so a
	// forward-enter slides the track BEFORE the scope-tab bar expands and a
	// backward-exit collapses the scope-tab bar BEFORE the track slides out
	// (the slide-then-expand / collapse-then-slide asymmetry the
	// `search-enter-exit-asymmetry` spec enforces). The tap-scrub, the
	// backward-exit, and the forward-last-tab ENTER all derive from the
	// single relation `max(0, (searchProgress - (1 - HMT)) / HMT)`, since
	// each of searchProgress's branches substitutes back to the bar's
	// intended expansion curve for that source.
	const tabProgress = $derived(
		Math.max(0, (searchProgress - (1 - HEADER_MORPH_THRESHOLD)) / HEADER_MORPH_THRESHOLD)
	);

	// Pure functions of searchProgress / tabProgress. No CSS transition: the
	// orchestrator writes the pager-store fields these derive from, every frame
	// (synchronous per pointermove during a drag, via the rAF channels during a
	// commit/settle/scrub);
	// the styles re-render via Svelte's reactive `style=` binding. §5: no
	// CSS transitions in this layer.
	const trackStyle = $derived(`transform: translateX(${-(searchProgress * 50).toFixed(2)}%);`);

	// The SINGLE search button: absolute, slides from right to left. Driven by
	// the SAME searchProgress as the track so it stays in sync with it
	// (searchProgress reads the pager-store fields the orchestrator writes).
	// `left` is a linear interp from calc(100% - 3rem) at progress 0 to
	// 0.5rem at progress 1.
	const searchButtonLeft = $derived(
		`calc(${((1 - searchProgress) * 100).toFixed(2)}% - ${((1 - searchProgress) * 3).toFixed(2)}rem + ${(searchProgress * 0.5).toFixed(2)}rem)`
	);
	const searchButtonStyle = $derived(`left: ${searchButtonLeft};`);

	// SearchTabBar row: clip-expand (max-height) driven by tabProgress so it
	// syncs with the track and the search button.
	const tabBarStyle = $derived(`max-height: ${(tabProgress * 3).toFixed(2)}rem;`);

	// Search query input (bind:value + composition gating + debounce + keepFocus).
	const urlQ = $derived(page.url.searchParams.get('q') ?? '');
	let inputValue = $state(untrack(() => urlQ));
	let lastUrlQ = untrack(() => urlQ);
	let composing = $state(false);
	let debounceId: ReturnType<typeof setTimeout> | 0 = 0;
	$effect(() => {
		if (composing) return;
		if (urlQ !== lastUrlQ && urlQ !== inputValue) {
			lastUrlQ = urlQ;
			inputValue = urlQ;
		}
	});
	function commitQuery(q: string): void {
		if (composing) return;
		const params = new SvelteURLSearchParams();
		if (q) params.set('q', q);
		params.set('scope', page.url.searchParams.get('scope') ?? 'discussions');
		params.set('sort', page.url.searchParams.get('sort') ?? 'newest');
		params.set('page', '1');
		void goto(`/search?${params.toString()}`, {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}
	function scheduleCommit(): void {
		if (composing) return;
		if (debounceId) clearTimeout(debounceId);
		// Search-input debounce (coalesce rapid keystrokes), not an
		// animation-alignment timer; the §5 "no setTimeout in the
		// animation layer" bar targets the Header's morph / title
		// animation (publication-driven, not setTimeout), not input
		// handling.
		debounceId = setTimeout(() => commitQuery(inputValue), 400);
	}
	function onInput(): void {
		scheduleCommit();
	}
	function onCompositionStart(): void {
		composing = true;
	}
	function onCompositionEnd(event: CompositionEvent): void {
		composing = false;
		inputValue = (event.currentTarget as HTMLInputElement).value;
		scheduleCommit();
	}
	function onInputKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && !composing) {
			if (debounceId) clearTimeout(debounceId);
			commitQuery(inputValue);
		}
	}

	let filterOpen = $state(false);
	const activeScope = $derived(
		(page.url.searchParams.get('scope') ?? 'discussions') as SearchScope
	);
	const activeSort = $derived((page.url.searchParams.get('sort') ?? 'newest') as SearchSort);
	function onSelectSort(sort: SearchSort): void {
		const params = new SvelteURLSearchParams();
		if (page.url.searchParams.get('q')) params.set('q', page.url.searchParams.get('q') as string);
		params.set('scope', activeScope);
		params.set('sort', sort);
		params.set('page', '1');
		void goto(`/search?${params.toString()}`, { replaceState: true, noScroll: true });
	}

	let headerEl: HTMLElement | null = $state(null);
	$effect(() => {
		if (!headerEl) return;
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
				scrollChrome.setHeaderHeight(height);
				document.documentElement.style.setProperty('--header-height', `${height}px`);
			}
		});
		observer.observe(headerEl);
		return () => observer.disconnect();
	});

	function onBack(): void {
		const target = navStore.backTarget;
		if (navStore.activeStack.length > 1) {
			if (hopForHref(target) === 'back') {
				history.back();
			} else {
				pager.setReplaceStateIntent(true);
				void goto(target, { replaceState: true });
			}
		} else {
			pager.setReplaceStateIntent(true);
			void goto('/', { replaceState: true });
		}
	}
	function onLeftButton(): void {
		if (isDeep) onBack();
		else onToggleDrawer();
	}

	let inputEl: HTMLInputElement | null = $state(null);
	$effect(() => {
		if (browser && isSearch && inputEl) inputEl.focus();
	});
</script>

<header
	bind:this={headerEl}
	class="sticky top-0 z-40 mx-auto w-full max-w-[960px] px-0 md:mt-6 md:px-6"
	style:transform="translateY({translateY}px)"
>
	<div class="bg-neutral text-neutral-content shadow-md md:shadow-none">
		<!-- Desktop nav -->
		<nav class="hidden items-end gap-6 px-6 pt-3 pb-2.5 md:flex">
			<Logo {t} class="text-neutral-content" />
			<div class="flex items-end gap-4">
				<a
					href="/activity"
					class="text-sm font-medium text-neutral-content/70 hover:text-neutral-content hover:underline"
					class:text-accent={isNavActive(currentPath, '/activity')}
					aria-current={isNavActive(currentPath, '/activity') ? 'page' : undefined}
				>
					{tNav['activity']}
				</a>
				<a
					href="/messages/inbox"
					class="text-sm font-medium text-neutral-content/70 hover:text-neutral-content hover:underline"
					class:text-accent={isNavActive(currentPath, '/messages')}
					aria-current={isNavActive(currentPath, '/messages') ? 'page' : undefined}
				>
					{tNav['messages']}
				</a>
				<a
					href="/search"
					class="text-sm font-medium text-neutral-content/70 hover:text-neutral-content hover:underline"
					class:text-accent={isNavActive(currentPath, '/search')}
					aria-current={isNavActive(currentPath, '/search') ? 'page' : undefined}
				>
					{tNav['search']}
				</a>
			</div>
		</nav>

		<!-- Mobile nav: 2-panel track + single absolute search button. -->
		<div class="relative overflow-clip md:hidden">
			<div class="flex w-[200%]" style={trackStyle}>
				<!-- Panel 0: root/deep content (no search button here; the absolute
				     <a> below covers the right area in root mode). -->
				<div class="flex w-1/2 shrink-0 items-center overflow-hidden px-2 py-2">
					<button
						type="button"
						class="flex size-10 shrink-0 items-center justify-center text-neutral-content/80 hover:bg-neutral-content/10 hover:text-neutral-content"
						onclick={onLeftButton}
						aria-label={isDeep ? tNav['back'] : tNav['menu']}
					>
						<BurgerArrowIcon progress={iconProgress} />
					</button>
					<div class="relative h-10 flex-1">
						<div class="absolute inset-0 flex items-center justify-center" style={rootLayerStyle}>
							<MobileTabBar {t} />
						</div>
						<div
							class="absolute inset-0 flex items-center justify-center px-2"
							style={layerDownStyle}
						>
							{#if titleView.outgoing === titleView.incoming}
								<!-- Static title (at rest) -->
								<div class="absolute inset-0 flex items-center justify-center px-2">
									<span class="w-full truncate text-center font-medium text-neutral-content">
										{titleView.incoming}
									</span>
								</div>
							{:else}
								{@const fwd = titleView.direction === 'forward'}
								<!-- Outgoing title. Transform follows titleView.progress
								     (settleProgress during a settle, backMorph during a drag) frame
								     by frame; no CSS transition is involved. -->
								<div
									class="absolute inset-0 flex items-center justify-center px-2"
									style="transform: translateY({(fwd ? -titleView.progress : titleView.progress) *
										100}%);"
								>
									<span class="w-full truncate text-center font-medium text-neutral-content">
										{titleView.outgoing}
									</span>
								</div>

								<!-- Incoming title -->
								<div
									class="absolute inset-0 flex items-center justify-center px-2"
									style="transform: translateY({(fwd
										? 1 - titleView.progress
										: -(1 - titleView.progress)) * 100}%);"
								>
									<span class="w-full truncate text-center font-medium text-neutral-content">
										{titleView.incoming}
									</span>
								</div>
							{/if}
						</div>
					</div>
				</div>

				<!-- Panel 1: search content. pl-14 leaves room for the search button
				     (absolute, at left in search mode). -->
				<div class="flex w-1/2 shrink-0 items-center gap-2 py-2 pr-2 pl-14">
					<input
						bind:this={inputEl}
						bind:value={inputValue}
						type="text"
						oninput={onInput}
						oncompositionstart={onCompositionStart}
						oncompositionend={onCompositionEnd}
						onkeydown={onInputKeydown}
						placeholder={t.search.placeholder}
						class="input input-sm h-9 flex-1 border-0 bg-neutral-content/10 text-neutral-content placeholder:text-neutral-content/50 focus:outline-none"
						autocomplete="off"
					/>
					<button
						type="button"
						class="flex size-10 shrink-0 items-center justify-center text-neutral-content/80 hover:bg-neutral-content/10 hover:text-neutral-content"
						onclick={() => (filterOpen = true)}
						aria-label={t.search.sortBy}
					>
						<Icon path={mdiFilterVariant} size={22} />
					</button>
				</div>
			</div>

			<!-- Single search button: slides from right (root) to left (search =
			     hamburger position) via the reactive `searchButtonStyle` binding
			     (no CSS transition; the orchestrator writes the pager-store fields
			     `searchProgress` reads, synchronously per pointermove during a drag
			     and via the rAF channels during a commit/settle/scrub). Always rendered;
			     ONE icon. -->
			<a
				href="/search"
				class="absolute top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center text-neutral-content/80 hover:bg-neutral-content/10 hover:text-neutral-content"
				style={searchButtonStyle}
				aria-label={tNav['search']}
				aria-current={isNavActive(currentPath, '/search') ? 'page' : undefined}
			>
				<Icon path={mdiMagnify} size={22} />
			</a>
		</div>

		<!-- SearchTabBar row: clip-expand via max-height (no mount jump). -->
		<div class="overflow-hidden md:hidden" style={tabBarStyle}>
			<SearchTabBar {t} />
		</div>
	</div>
</header>

<SearchSortSheet
	open={filterOpen}
	{t}
	scope={activeScope}
	sort={activeSort}
	onSelect={onSelectSort}
	onClose={() => (filterOpen = false)}
/>
