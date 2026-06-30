<script lang="ts">
	/**
	 * FloatingActionButtonLayer - mobile-only layer rendered by AppShell as a
	 * sibling of <Header>. Survives every non-`/entry` route (it never unmounts
	 * during list <-> thread <-> compose nav), so the FAB's route-transition
	 * scale animation has a stable home across all three transition families.
	 *
	 * Two scale drivers compose as ONE transform on the atom:
	 *
	 *   - Route-transition scale (s): for tab swipe/tap (Family A) and
	 *     thread/conversation enter/exit (Family B), a rAF sampler reads the live
	 *     track transform (m41) every frame so the FAB scale follows the CSS-eased
	 *     track motion 1:1 (no second clock, no double-animation). Family B is
	 *     sampler-driven in BOTH drag and forward-enter: a thread route's
	 *     GesturePageLayout publishes `fractionalIndex = centerTab` (constant)
	 *     for the whole back-swipe drag because `rightTab === undefined`, so the
	 *     live `fractionalIndex` would pin scale at its resting value; the
	 *     sampler reads the actual track `m41` each frame and converts via
	 *     `pxToFraction` so the scale follows the finger 0 -> 1 (back-swipe,
	 *     second-half appear) and 1 -> 0 (forward-enter, first-half disappear).
	 *     For compose routes (Family C, no pager) the layer keeps the atom
	 *     mounted and swaps its foregroundFraction between 1 (source list at
	 *     rest) and 0 (compose page covers the list); the atom's CSS transition
	 *     eases the swap over 200ms because there is no sibling track to
	 *     synchronize with.
	 *   - Scroll translateY (y): derived from the shared scroll-chrome store
	 *     (`p = clamp(-translateY / headerHeight, 0, 1)`), so the FAB hides on
	 *     scroll-down and reappears on scroll-up in lockstep with the Header.
	 *
	 * Family B/C source-list model: a thread, conversation, or compose page is
	 * reached by forward nav FROM a list. The atom stays mounted across the swap
	 * showing the SOURCE LIST's FAB (discussions for `/discussion/*` and
	 * `/post/discussion`; messages for `/messages/<id>` and `/messages/new`) at
	 * foregroundFraction 0 at rest, so a deep-link SSRs at scale 0 with no flash
	 * of scale 1. During the forward enter the GPL track slides the thread in and
	 * the sampler drives foregroundFraction 1 -> 0 (scale-out across the first
	 * half); during the back-swipe the sampler drives it 0 -> 1 (scale-in across
	 * the last half).
	 *
	 * Nav-moment holdover: at the swap instant the destination GPL has not yet
	 * bound its track / started animating, so the resting default (0) would flash
	 * the FAB to scale 0 before the sampler takes over. While a forward nav is in
	 * flight (`navStore.direction === 'forward'` plus `pendingNav`/`navInFlight`)
	 * the layer holds the source-list fraction at 1 until the sampler publishes
	 * its first non-null sample, then lets the sampler drive it down. On a
	 * deep-link (no transition) there is no forward nav in flight, so the resting
	 * 0 applies with no flash.
	 *
	 * Cross-tab chip-exit contract: on a cross-tab tap FROM a list route, the
	 * MobileTabPager's z-30 LoadingChip overlay covers the pager and the FAB at
	 * z-35 must not render above it, so scale is forced to 0 directly. This
	 * fires only when `fabConfig.family === 'list'` AND the pending/in-flight
	 * nav targets a different tab (a forward nav); same-tab back-swpies and
	 * overlay/compose navs never trigger it (they have no chip overlay).
	 *
	 * The active track reaches this ancestor via the `active-gesture-track`
	 * module-singleton store (Svelte context flows parent -> child only, and
	 * AppShell is the ancestor of the track-owning descendants). The sampler
	 * arms when the store's track becomes non-null and disarms when it goes
	 * null; during the no-track gap across a route swap the scale holds its last
	 * value (the gesture had already settled before the swap).
	 */
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import FloatingActionButton from '$lib/components/atoms/FloatingActionButton.svelte';
	import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';
	import { getNavigationStore } from '$lib/stores/navigation.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { getActiveGestureTrack } from '$lib/stores/active-gesture-track.svelte';
	import { getRouteFabRule, FAB_KIND_CONFIGS } from '$lib/utils/route-config';
	import type { FabListKind } from '$lib/utils/route-config';
	import type { FabFamily } from '$lib/utils/fab-scale';
	import { getCurrentTabIndex } from '$lib/utils/mobile-tabs';
	import {
		scaleFromFraction,
		tabFraction,
		pxToFraction,
		listForegroundFromThreadCover,
		familyNeedsSamplerDuringDrag,
		familyRestsAtSampleOne,
		hideProgress,
		translateYFromHideProgress
	} from '$lib/utils/fab-scale';
	import type { TranslationDict } from '$lib/types/translation';

	interface FloatingActionButtonLayerProps {
		t: TranslationDict;
	}

	let { t }: FloatingActionButtonLayerProps = $props();

	const pager = getMobilePagerStore();
	const navStore = getNavigationStore();
	const scrollChrome = getScrollChromeStore();
	const activeGestureTrack = getActiveGestureTrack();

	// Family C (compose) eases its discrete foregroundFraction swap via the atom's
	// 200ms CSS transition. The transition must stay armed across the compose<->
	// list boundary in BOTH directions: a compose<->list back/forward nav lands on
	// a route whose family differs from the source's, so the class cannot be gated
	// on the destination family alone or the scale change would swap in one frame
	// with no easing. The `familyCInFlight` flag latches when a compose<->
	// list family swap is observed and holds for the transition window so the CSS
	// class keeps easing the scale change on BOTH routes and in BOTH directions.
	// It is cleared by a timer (slightly longer than the 200ms ease) or by the
	// next non-C family swap, whichever comes first.
	const FAMILY_C_TRANSITION_WINDOW_MS = 280;
	let familyCInFlight = $state(false);
	let familyCTimer: ReturnType<typeof setTimeout> | undefined;
	let previousFamily: FabFamily | null = null;

	// Fixed geometry (kept in sync with the atom). `size-14` = 56px FAB; the
	// resting bottom inset is 1rem + the device safe-area inset (env). The slide
	// distance = fabHeight + bottomClearance so a fully-hidden FAB clears the
	// viewport bottom edge entirely.
	const FAB_HEIGHT_PX = 56;
	const BOTTOM_CLEARANCE_PX = 16;

	// Wall-clock cap for the rAF sampler. Covers backgrounded-tab rAF
	// throttling and the transitionend-missed edge. Families A and B both arm
	// the sampler across the drag AND the snap (reading the track m41 every
	// frame so the scale follows the CSS-eased track motion continuously), so
	// the cap must span a full drag (~500ms) plus the snap (~300ms) plus margin
	// for a backgrounded tab; 2000ms accommodates all three.
	const SAMPLER_TIMEOUT_MS = 2000;
	const SAMPLER_TARGET_EPSILON_PX = 0.5;

	type FabKind = 'discussions' | 'messages' | null;

	interface FabConfig {
		readonly kind: FabKind;
		readonly href: string;
		readonly label: string;
		readonly icon: string;
		readonly tabIndex: number;
		readonly family: 'list' | 'overlay' | 'compose';
	}

	/** Resolve which FAB (if any) the current route shows and which family owns
	 *  its scale animation. Priority: overlay (Family B) -> compose (Family C) ->
	 *  list (Family A rest) -> none. The atom stays mounted on overlay/compose
	 *  routes so the scale-out/in runs across the route swap. */
	const fabConfig = $derived.by<FabConfig | null>(() => {
		const rule = getRouteFabRule(page.url.pathname);
		if (!rule || !rule.fab) return null;

		if (rule.fab.kind === 'dynamic') {
			if (pager.active && Math.abs(pager.fractionalIndex - 1) > 0.01) {
				const resolvedKind: FabListKind = pager.fractionalIndex < 1 ? 'discussions' : 'messages';
				const kindConfig = FAB_KIND_CONFIGS[resolvedKind];
				return {
					kind: resolvedKind,
					family: rule.fab.family,
					href: kindConfig.href,
					label: kindConfig.label(t),
					icon: kindConfig.icon,
					tabIndex: kindConfig.tabIndex
				};
			}
			return null;
		}

		if (rule.fab.kind === null) return null;

		const kindConfig = FAB_KIND_CONFIGS[rule.fab.kind];
		return {
			kind: rule.fab.kind,
			family: rule.fab.family,
			href: kindConfig.href,
			label: kindConfig.label(t),
			icon: kindConfig.icon,
			tabIndex: kindConfig.tabIndex
		};
	});

	const track = $derived(activeGestureTrack.track);

	// Latch `familyCInFlight` when the active family swaps across the compose<->
	// list boundary. Family C (compose) has no sibling track to sample, so its
	// scale change is eased by the atom's CSS transition; that transition must
	// stay armed on BOTH the source and the destination route for the full duration
	// of the swap. The latch observes the family derivation and arms whenever a
	// compose<->list transition (either direction) is detected, holding the class
	// for `FAMILY_C_TRANSITION_WINDOW_MS` so the 200ms ease completes. Any later
	// compose<->list swap re-arms the window; a swap to/from Family A/B (overlay,
	// which has its own sampler-driven motion) clears the latch so the CSS class
	// does not fight the per-frame sampler.
	$effect(() => {
		const current = fabConfig?.family ?? null;
		const prev = previousFamily;
		previousFamily = current;
		if (current === null) return;
		const isFamilyCSwap =
			(prev === 'compose' && current === 'list') || (prev === 'list' && current === 'compose');
		if (isFamilyCSwap) {
			familyCInFlight = true;
			if (familyCTimer !== undefined) clearTimeout(familyCTimer);
			familyCTimer = setTimeout(() => {
				familyCInFlight = false;
				familyCTimer = undefined;
			}, FAMILY_C_TRANSITION_WINDOW_MS);
			return;
		}
		// A swap that does not cross the compose<->list boundary ends any in-flight
		// Family C window: the CSS class must not ease a sampler-driven (Family A/B)
		// motion or a route that no longer hosts the FAB.
		if (prev !== null && prev !== current && familyCTimer !== undefined) {
			clearTimeout(familyCTimer);
			familyCTimer = undefined;
			familyCInFlight = false;
		}
	});

	// The sampled fractional index, written by the rAF callback (NOT inside a
	// $effect that reads pager.fractionalIndex) so the arm/disarm effect does
	// not loop (svelte-effect-fetch-loop memory). Holds its last value when no
	// sampler is running.
	let sampledFractionalIndex = $state<number | null>(null);
	let samplerActive = $state(false);
	let samplerHasPublished = $state(false);
	let samplerRafId: number | undefined;
	let samplerStart = 0;

	/** Read the live track m41 (px) and convert to the active family's sample
	 *  value:
	 *  - Family A (list route): the fractional tab index (the track is full
	 *    pager width per tab; m41 modulo panel width maps to the live tab).
	 *  - Family B (overlay route): threadCoverProgress (0 = list preview
	 *    visible, 1 = thread covers at rest), which on a 2-panel track equals
	 *    pxToFraction(m41, panelWidth) (the resting m41 is one panel width).
	 *  Returns null when there is no track or no panel width. */
	function sampleFraction(): number | null {
		const el = track;
		if (!el || !browser) return null;
		const panelWidth = window.innerWidth;
		if (panelWidth <= 0) return null;
		try {
			const m41 = new DOMMatrix(getComputedStyle(el).transform).m41;
			const cfg = fabConfig;
			if (cfg && cfg.family === 'list') {
				// Family A: range [0, 2] for the three tabs
				return Math.max(0, Math.min(2, -m41 / panelWidth));
			}
			return pxToFraction(m41, panelWidth);
		} catch {
			return null;
		}
	}

	/** Convert the sampled threadCoverProgress / fractional index to the active
	 *  FAB's foreground fraction.
	 *  - Family A (list route): tab coverage of `tabIndex` (tabFraction).
	 *  - Family B (overlay route): list foreground = 1 - threadCoverProgress
	 *    (the source list is fully visible at sample 0 and fully covered at 1). */
	function fractionFromSample(sample: number, cfg: FabConfig): number {
		if (cfg.family === 'overlay') {
			return listForegroundFromThreadCover(sample);
		}
		return tabFraction(sample, cfg.tabIndex);
	}

	function startSampler(): void {
		if (!browser) return;
		if (samplerRafId !== undefined) return;
		samplerActive = true;
		// Each fresh arm earns its own first sample. Resetting here covers the
		// route-swap case: the source track unbinds (track -> null, sampler
		// disarmed), the destination track binds (track -> non-null, sampler
		// re-armed), and the holdover re-applies until the new sampler publishes.
		samplerHasPublished = false;
		samplerStart = performance.now();
		const tick = (): void => {
			// Track unmounted (route swap took it): hold last value, disarm.
			if (activeGestureTrack.track === null) {
				stopSampler();
				return;
			}
			// A drag re-grabbed mid-snap. list and overlay are both sampler-driven
			// during the drag (familyNeedsSamplerDuringDrag is true for both), so
			// this guard never fires for them and the sampler keeps running to
			// follow the finger. The branch is defensive for a future family that
			// publishes a reliable live fractionalIndex through the snap.
			if (pager.dragging && fabConfig !== null && !familyNeedsSamplerDuringDrag(fabConfig.family)) {
				stopSampler();
				return;
			}
			// Wall-clock cap: stop sampling; the resting $derived takes over.
			if (performance.now() - samplerStart > SAMPLER_TIMEOUT_MS) {
				stopSampler();
				return;
			}
			const sample = sampleFraction();
			if (sample !== null) {
				sampledFractionalIndex = sample;
				samplerHasPublished = true;
				// Reached the resting target (sub-pixel epsilon): stop. The resting
				// $derived then drives scale from the route's known fraction. Gated on
				// `!pager.dragging` so a drag that starts on (or momentarily passes
				// through) an integer sample cannot false-disarm the sampler; the drag
				// keeps it running so it is live at release.
				//
				// The resting sample differs per family:
				//   - Family B (overlay): ONLY sample 1 (thread fully covers the list)
				//     is rest. Sample 0 (list fully visible) is the FORWARD-ENTER START,
				//     not rest; treating it as rest would strand the sampler at sample 0
				//     mid-forward-enter and flash the scale the next time it re-arms.
				//   - Family A (tab pager): any integer tab index (0, 1, 2) is rest.
				const isRestingTarget =
					fabConfig !== null &&
					!pager.dragging &&
					(familyRestsAtSampleOne(fabConfig.family)
						? Math.abs(sample - 1) <= SAMPLER_TARGET_EPSILON_PX / (window.innerWidth || 1)
						: Math.abs(sample - Math.round(sample)) <=
							SAMPLER_TARGET_EPSILON_PX / (window.innerWidth || 1));
				if (isRestingTarget) {
					stopSampler();
					return;
				}
			}
			samplerRafId = requestAnimationFrame(tick);
		};
		samplerRafId = requestAnimationFrame(tick);
	}

	function stopSampler(): void {
		samplerActive = false;
		if (samplerRafId !== undefined) {
			cancelAnimationFrame(samplerRafId);
			samplerRafId = undefined;
		}
	}

	// Arm/disarm the sampler. Plain $effect (NOT $effect.pre) per the
	// svelte-effect-pre-same-flush-rerun memory: a plain $effect reading
	// `pager.dragging` and `track` does not same-flush re-run when those deps
	// are stable. The effect does NOT write sampledFractionalIndex synchronously
	// (it only starts/stops the rAF), so it cannot loop (svelte-effect-fetch-loop).
	//
	// Arming rules per family:
	//   - Families A and B (list and overlay routes): arm whenever a track is
	//     bound AND no cross-tab chip-exit is active, INCLUDING during the drag
	//     and the snap. The sampler reads the actual track `m41` each frame, so
	//     the FAB scale follows the track's CSS-eased motion continuously. For
	//     Family B the thread-route GPL pins `fractionalIndex = centerTab` for
	//     the whole drag, so the live value cannot drive the scale at all; for
	//     Family A the live `fractionalIndex` is continuous during the drag but
	//     jumps to its integer endpoint on release while the track keeps easing,
	//     so reading it would pop the scale to the endpoint in one frame. Keeping
	//     the sampler armed across the drag for both families means it is already
	//     running at release and transitions seamlessly into the snap (no re-arm
	//     gap, no first-frame jump).
	//   - Family C (compose route): never armed (no sibling track exists).
	$effect(() => {
		const hasTrack = track !== null;
		const rule = getRouteFabRule(page.url.pathname);
		const hasCfg = rule !== null && rule.fab !== undefined && rule.fab.kind !== null;
		const family = rule?.fab?.family ?? null;
		if (!hasTrack || !hasCfg || family === null) {
			stopSampler();
			return;
		}
		// Disarm only for a genuine cross-tab chip-exit (the LoadingChip covers
		// the pager; the FAB's scale is forced to 0 by chipExitActive and no
		// track motion needs sampling). A same-tab back-swipe commit keeps the
		// sampler armed so the scale-in continues across the source-list snap.
		if (chipExitActive) {
			stopSampler();
			return;
		}
		// Family B keeps the sampler armed across the drag; Family A disarms
		// during the drag (the live fractionalIndex takes over) and arms for the
		// snap window; Family C never reaches here (no track).
		if (pager.dragging && !familyNeedsSamplerDuringDrag(family)) {
			stopSampler();
			return;
		}
		startSampler();
	});

	onDestroy(() => {
		// onDestroy runs in SSR; guard DOM-touching teardown (svelte-ondestroy-
		// runs-in-ssr memory). cancelAnimationFrame / clearTimeout are no-ops on
		// the server but the guard is defensive.
		if (!browser) return;
		stopSampler();
		if (familyCTimer !== undefined) {
			clearTimeout(familyCTimer);
			familyCTimer = undefined;
		}
	});

	// Cross-tab chip-exit / pendingNav: forces scale 0 directly, bypassing the
	// foregroundFraction derivation (the source list's fraction is still 1
	// during a chip exit and would otherwise keep the FAB visible above the
	// chip overlay).
	//
	// The back-chip overlay (MobileTabPager's z-30 LoadingChip) only renders on
	// LIST routes during a back-swipe toward a deep page or a cross-tab tap.
	// Family B (overlay) and Family C (compose) routes never host the overlay
	// (they use GesturePageLayout, not MobileTabPager), so chip-exit is gated
	// to `fabConfig.family === 'list'` and never applies to overlay/compose
	// navs. This keeps a same-tab back-swipe commit (e.g. /discussion/* -> /)
	// scaling in via the sampler instead of flashing to 0 when navInFlight
	// flips true at executePendingNav time.
	const chipExitActive = $derived.by(() => {
		const cfg = fabConfig;
		if (cfg?.family !== 'list') return false;
		const pending = navStore.pendingNav;
		if (pending !== null) {
			// Same source-list tab: the nav stays within the tab the FAB
			// represents (e.g. discussions list -> discussions list page 2).
			// The sampler / resting fraction drives the scale.
			return getCurrentTabIndex(pending.href) !== cfg.tabIndex;
		}
		// navInFlight without a pending nav: a cross-tab tap is a FORWARD nav
		// (navigateForward) and the LoadingChip covers the target pager. A
		// BACKWARD nav (back-swipe to this source list) has no chip; the
		// sampler gap holdover drives the scale across the swap.
		return navStore.navInFlight && navStore.direction === 'forward';
	});

	// Forward-nav holdover for Family B/C: at the swap instant the destination
	// track has not bound yet, so the resting default (0) would flash the FAB
	// to scale 0 before the sampler takes over. While the nav is a forward
	// entry into an overlay/compose route AND the sampler has not yet published
	// its first sample, hold the source-list fraction at 1 so the FAB starts
	// the scale-out from scale 1 (matching the pre-swap state). On a deep-link
	// (no forward nav in flight) the holdover is false and the resting 0
	// applies, so there is no flash of 1 on the deep-linked overlay.
	//
	// Reads `navStore.direction === 'forward'` only. `!chipExitActive` already
	// excludes cross-tab navs (chipExitActive is true when family is list AND a
	// forward nav is in flight with a different target tab), so the holdover
	// only fires for same-family forward enters where the atom stays mounted.
	//
	// Gated on `!pager.dragging` so the holdover cannot fire during a back-
	// swipe drag. A back-swipe starts on the destination of a prior forward
	// nav, so `direction === 'forward'` is stale until the back nav commits;
	// the sampler re-arm at drag start resets `samplerHasPublished`, which
	// would otherwise satisfy the holdover and pin fraction at 1 mid-drag (the
	// scale would jump to 1 from frame 1 of the back-swipe, defeating the
	// gesture-follow). A drag has no nav-gap to bridge, so the holdover is not
	// needed there.
	const forwardNavHoldoverActive = $derived(
		(fabConfig?.family === 'overlay' || fabConfig?.family === 'compose') &&
			!samplerHasPublished &&
			navStore.direction === 'forward' &&
			!pager.dragging &&
			!chipExitActive
	);

	/** Per-frame foreground fraction for the active FAB. The sampler output
	 *  drives Family A and Family B across BOTH the drag and the snap (reading
	 *  the track `m41` every frame), so the scale is a continuous function of the
	 *  track's visual position and never reads the logical `pager.fractionalIndex`
	 *  (which jumps to its integer endpoint on release while the track keeps
	 *  easing). The forward-nav holdover pins the fraction at 1 across the
	 *  swap-to-overlay gap until the sampler publishes its first sample. At rest
	 *  the route's known fraction (1 for a list, 0 for an overlay/compose route)
	 *  supplies a stable value. */
	const foregroundFraction = $derived.by(() => {
		const cfg = fabConfig;
		if (cfg === null) return 0;
		if (chipExitActive) return 0;
		if (samplerActive && sampledFractionalIndex !== null) {
			return fractionFromSample(sampledFractionalIndex, cfg);
		}
		if (forwardNavHoldoverActive) {
			// Hold the source-list fraction across the swap until the sampler
			// publishes; avoids a flash to scale 0 at the nav moment.
			return 1;
		}
		// Sampler gap holdover: the source track has unbound for a route swap
		// (sampler disarmed, track -> null) but the destination track has not
		// bound yet AND the route's family has not flipped to its resting
		// value. Hold the last sampled fraction so the scale does not flash to
		// its resting endpoint mid-transition (e.g. a back-swipe whose source
		// GPL unbinds before the URL swaps to the list would flash scale 0
		// before the list route's fraction 1 applies).
		//
		// Triggered by `track === null && samplerHasPublished`: the track
		// unbinds across the swap, and the last published fraction is the best
		// estimate until the destination track binds and the sampler
		// re-publishes. Also gated on a nav being in flight OR a non-trivial
		// direction so the hold does not strand at rest on a deep-linked route
		// whose sampler self-disarmed (there, no nav is in flight and the
		// resting fraction should apply). `!pager.dragging` excludes an active
		// drag (the drag path above owns that case).
		if (
			track === null &&
			samplerHasPublished &&
			sampledFractionalIndex !== null &&
			!pager.dragging &&
			(navStore.navInFlight || navStore.direction !== 'none')
		) {
			return fractionFromSample(sampledFractionalIndex, cfg);
		}
		// At rest the route's known logical position supplies a stable value (the
		// sampler is disarmed, so pager.fractionalIndex holds the integer activeIndex
		// and is not mid-jump). A list FAB rests at tabFraction of its tab vs the
		// active tab: 1 when its own tab is foreground, 0 when another tab is (the
		// source-list atom persists across a tab swap, so this is not always 1).
		// An overlay/compose route's source-list FAB is covered at rest (0).
		return cfg.family === 'list'
			? tabFraction(pager.fractionalIndex, cfg.tabIndex)
			: 0;
	});

	const scale = $derived(scaleFromFraction(foregroundFraction));

	// Family C (compose) eases the discrete foregroundFraction swap via a CSS
	// transition on the atom. The class is armed when the active family is compose
	// OR a compose<->list transition is in flight (`familyCInFlight`), so the ramp
	// eases on BOTH the source and the destination route for the full swap. It is
	// suppressed whenever the sampler is running or a drag is in progress
	// (Families A/B stay continuous via the per-frame sampler; a second CSS clock
	// would fight the track's own easing). The holdover window is sampler-adjacent
	// (it holds the fraction across the nav gap before the sampler publishes) and
	// is also suppressed here for the same reason.
	const transitionEnabled = $derived(
		(fabConfig?.family === 'compose' || familyCInFlight) &&
			!samplerActive &&
			!pager.dragging &&
			!forwardNavHoldoverActive
	);

	const fabHideProgress = $derived(
		hideProgress(scrollChrome.translateY, scrollChrome.headerHeight)
	);
	const fabTranslateY = $derived(
		translateYFromHideProgress(fabHideProgress, FAB_HEIGHT_PX, BOTTOM_CLEARANCE_PX)
	);
</script>

{#if fabConfig !== null}
	<div class="fab-layer z-35 md:hidden" data-fab-kind={fabConfig.kind}>
		<FloatingActionButton
			{scale}
			translateY={fabTranslateY}
			hideProgress={fabHideProgress}
			href={fabConfig.href}
			label={fabConfig.label}
			icon={fabConfig.icon}
			{transitionEnabled}
		/>
	</div>
{/if}

<style>
	/* The layer is a non-positioned wrapper that gates viewport (md:hidden) and
	   stacking (z-35). The atom positions itself (position: fixed, out of flow)
	   so the layer has zero in-flow size and does not intercept pointer events;
	   the atom manages its own pointer-events via the hidden gate
	   (class:pointer-events-none). */
	.fab-layer {
		min-width: 0;
		min-height: 0;
	}
</style>
