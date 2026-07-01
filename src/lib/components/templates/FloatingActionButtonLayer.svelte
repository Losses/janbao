<script lang="ts">
	/**
	 * FloatingActionButtonLayer - mobile-only layer rendered by AppShell as a
	 * sibling of <Header>. Survives every non-`/entry` route, so the FAB's
	 * route-transition scale animation has a stable home.
	 *
	 * Scale is a pure function of a live gesture/page signal, read from the
	 * reactive pager store, selected by family:
	 *
	 *   - Family A (list / tab swipe): the per-frame track sampler reads the
	 *     MobileTabPager track `m41` (the fractional tab index). The store's
	 *     `fractionalIndex` jumps to its integer endpoint on release while the
	 *     track keeps easing, so the per-frame read is the continuous signal
	 *     across the snap. `tabFraction(sample, tabIndex)` maps it to 0..1.
	 *   - Family B (overlay: thread + deep): reads `pager.coverProgress` (0..1,
	 *     deadzone-free) published by GesturePageLayout on both the centerTab and
	 *     deep branches from the live `rawDragOffset`. The store signal drives
	 *     the scale directly each frame.
	 *   - Family C (compose): discrete resting fraction (0, covered). The
	 *     discrete-nav CSS transition eases the list<->compose swap.
	 *
	 * `scaleFromFraction` maps foregroundFraction 1:1 over [0,1], so the FAB
	 * tracks the finger across the whole drag.
	 *
	 * Non-drag navigation (drawer tap, back arrow, forward enter, commit) is
	 * eased by the atom's CSS transition. `discreteNavInFlight` latches on any
	 * distinct family swap and holds the transition class for the 200ms ease.
	 * Same-family tab taps (list<->list) do not latch; their easing track is
	 * driven by the Family A sampler. During a drag the transition is off (the
	 * live signal drives), so there is no double-clock.
	 *
	 * Cross-tab chip-exit: on a cross-tab tap FROM a list route, the
	 * MobileTabPager's z-30 LoadingChip covers the pager and the FAB at z-35
	 * must not render above it, so scale is forced to 0 (tested first).
	 *
	 * The active track reaches this ancestor via the `active-gesture-track`
	 * module-singleton store (Family A sampler only; overlay reads the store
	 * signal directly and does not use the track).
	 */
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import FloatingActionButton from '$lib/components/atoms/FloatingActionButton.svelte';
	import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';
	import { getNavigationStore } from '$lib/stores/navigation.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { getActiveGestureTrack } from '$lib/stores/active-gesture-track.svelte';
	import { getRouteFabRule, FAB_KIND_CONFIGS, backTargetListKind } from '$lib/utils/route-config';
	import type { FabListKind } from '$lib/utils/route-config';
	import type { FabFamily } from '$lib/utils/fab-scale';
	import { getCurrentTabIndex } from '$lib/utils/mobile-tabs';
	import {
		scaleFromFraction,
		tabFraction,
		familyNeedsSamplerDuringDrag,
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

	// Discrete-nav CSS transition latch. Arms on any distinct family swap
	// (overlay<->list, compose<->list) and holds the atom's transition class
	// across the route swap so the 200ms ease completes on BOTH routes. A
	// same-family tab tap does not latch (the Family A sampler drives its easing
	// track). Cleared by the timer; a later distinct swap re-arms it.
	const FAMILY_TRANSITION_WINDOW_MS = 280;
	let discreteNavInFlight = $state(false);
	let discreteNavTimer: ReturnType<typeof setTimeout> | undefined;
	let previousFamily: FabFamily | null = null;

	// Fixed geometry (kept in sync with the atom). `size-14` = 56px FAB; the
	// resting bottom inset is 1rem + the device safe-area inset (env). The slide
	// distance = fabHeight + bottomClearance so a fully-hidden FAB clears the
	// viewport bottom edge entirely.
	const FAB_HEIGHT_PX = 56;
	const BOTTOM_CLEARANCE_PX = 16;

	// Family A sampler state. Declared before `fabConfig` because the Activity
	// `'dynamic'` branch reads `samplerActive`/`sampledFractionalIndex`, and the
	// family-swap `$effect.pre` (which runs before the first render) can trigger
	// that evaluation during init - declaring these here avoids a temporal-dead-
	// zone access at hydration.
	let sampledFractionalIndex = $state<number | null>(null);
	let samplerActive = $state(false);
	let samplerRafId: number | undefined;

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
	 *  its scale animation. The atom stays mounted on overlay/compose routes so
	 *  the scale-out/in runs across the route swap. */
	const fabConfig = $derived.by<FabConfig | null>(() => {
		const rule = getRouteFabRule(page.url.pathname);
		if (!rule || !rule.fab) return null;

		if (rule.fab.kind === 'dynamic') {
			// The Activity route resolves its FAB from the gesture's source tab. The
			// live pager.fractionalIndex is the prompt signal for the drag and at
			// rest. On a committing swipe the route lands on Activity while the track
			// is still mid-slide: the live value has already jumped to the integer
			// endpoint and would unmount the source-list FAB before it can ease out.
			// In that mid-slide window the sampler's visual index is the true
			// position, so defer to it and keep the FAB mounted until the slide
			// finishes.
			const sliding =
				samplerActive &&
				sampledFractionalIndex !== null &&
				Math.abs(sampledFractionalIndex - Math.round(sampledFractionalIndex)) > 0.01;
			const index =
				sliding && sampledFractionalIndex !== null ? sampledFractionalIndex : pager.fractionalIndex;
			if (pager.active && Math.abs(index - 1) > 0.01) {
				const resolvedKind: FabListKind = index < 1 ? 'discussions' : 'messages';
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

		if (rule.fab.kind === 'deep') {
			// A non-FAB GesturePageLayout route (bookmarks, profile/*, search,
			// notifications, admin/*). Resolve the source-list kind from the back
			// target so the FAB scales toward the list the user came from. Family
			// 'overlay' reads `pager.coverProgress` directly. This branch does not
			// read pager.active, so the atom mounts (scale 0) at rest and in SSR.
			// Must return before the static branch: FAB_KIND_CONFIGS indexes only
			// the concrete list kinds, not the 'deep' sentinel.
			const resolvedKind = backTargetListKind(navStore.backTarget);
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

	// Retain the last non-null FAB config so the atom stays mounted across every
	// tab route, including ones with no FAB of their own (e.g. /activity). The
	// Family A sampler then drives the scale continuously from the MobileTabPager
	// track: tabFraction(track position, tabIndex) follows the slide, so a tab
	// tap animates the FAB without any latch or timing dependency. A fresh
	// deep-link to a no-FAB route has retainedConfig === null (no prior FAB
	// seen), so the atom does not render there (the "activity has no FAB"
	// contract holds on first load); once any FAB route has been visited the atom
	// persists and the sampler carries the scale to 0 on no-FAB tabs.
	let retainedConfig = $state<FabConfig | null>(null);
	$effect(() => {
		if (fabConfig !== null) retainedConfig = fabConfig;
	});

	// Kind follows the visual track position (the sampler's sample), NOT the URL.
	// The URL swaps at click time (before the track moves); the sample lags by
	// the CSS transition. Using the sample for kind means the kind swaps at the
	// visual midpoint (scale 0 via 2f-1), not at the click, so no flicker. This
	// is ALWAYS active (even at integer rest) so the URL-swap frame cannot leak
	// the incoming kind before the track has crossed the midpoint.
	const effectiveKind = $derived.by<FabKind>(() => {
		if (samplerActive && sampledFractionalIndex !== null) {
			return sampledFractionalIndex < 1 ? 'discussions' : 'messages';
		}
		// SSR / before sampler mounts: URL-derived kind.
		return fabConfig?.kind ?? retainedConfig?.kind ?? null;
	});

	const displayConfig = $derived.by<FabConfig | null>(() => {
		const cfg = fabConfig ?? retainedConfig;
		if (cfg === null) return null;
		// For the list family, effectiveKind (sampler-driven) is authoritative.
		const kind = cfg.family === 'list' ? effectiveKind : cfg.kind;
		if (kind !== null && kind !== cfg.kind) {
			const kc = FAB_KIND_CONFIGS[kind];
			return {
				...cfg,
				kind,
				tabIndex: kc.tabIndex,
				href: kc.href,
				label: kc.label(t),
				icon: kc.icon
			};
		}
		return cfg;
	});

	// Latch `discreteNavInFlight` on any distinct family swap so the atom's CSS
	// transition stays armed across the route swap (the 200ms ease must run on
	// both the source and destination route). A same-family swap (tab tap) does
	// not latch: the Family A sampler drives its easing track, and a second CSS
	// clock would fight it. `$effect.pre` runs before the DOM update, so the
	// latch is set in the same flush as the new family's resting scale change
	// and the transition catches the change.
	$effect.pre(() => {
		const current = fabConfig?.family ?? null;
		const prev = previousFamily;
		previousFamily = current;
		if (prev !== current && (prev !== null || current !== null)) {
			discreteNavInFlight = true;
			if (discreteNavTimer !== undefined) clearTimeout(discreteNavTimer);
			discreteNavTimer = setTimeout(() => {
				discreteNavInFlight = false;
				discreteNavTimer = undefined;
			}, FAMILY_TRANSITION_WINDOW_MS);
		}
	});

	// The sampled fractional index, written by the rAF callback (NOT inside a
	// $effect that reads pager.fractionalIndex) so the arm/disarm effect does
	// not loop (svelte-effect-fetch-loop memory). Holds its last value when no
	// sampler is running. (State declared above, before `fabConfig`.)

	/** Read the live Family A track m41 (px) and convert to the fractional tab
	 *  index (0..2 for the three tabs). Returns null when there is no track. */
	function sampleFraction(): number | null {
		const el = track;
		if (!el || !browser) return null;
		const panelWidth = window.innerWidth;
		if (panelWidth <= 0) return null;
		try {
			const m41 = new DOMMatrix(getComputedStyle(el).transform).m41;
			return Math.max(0, Math.min(2, -m41 / panelWidth));
		} catch {
			return null;
		}
	}

	function startSampler(): void {
		if (!browser) return;
		if (samplerRafId !== undefined) return;
		samplerActive = true;
		// The sampler runs CONTINUOUSLY while a list-family track is bound. It does
		// NOT self-stop at the resting integer: a tab TAP slides the track (CSS
		// transition) without changing any arm-effect dependency (track element,
		// family, dragging all stay the same), so a self-stopped sampler would never
		// re-arm and the FAB would snap instead of following the slide. Reading the
		// track transform every frame is one getComputedStyle on one element
		// (mobile-only, list routes only) - cheap, and the only way to follow the
		// visual track motion across drags, snaps, cancels, and tab taps uniformly.
		const tick = (): void => {
			// Track unmounted (route swap took it): disarm.
			if (activeGestureTrack.track === null) {
				stopSampler();
				return;
			}
			const sample = sampleFraction();
			if (sample !== null) {
				sampledFractionalIndex = sample;
			}
			samplerRafId = requestAnimationFrame(tick);
		};
		samplerRafId = requestAnimationFrame(tick);
	}

	function stopSampler(): void {
		samplerActive = false;
		// Clear the last sample so a re-arm (e.g. list -> overlay -> list
		// roundtrip) does not read a stale value from the previous family for
		// one frame before the first fresh rAF sample arrives. effectiveKind
		// falls back to the URL-derived resting kind when the sample is null.
		sampledFractionalIndex = null;
		if (samplerRafId !== undefined) {
			cancelAnimationFrame(samplerRafId);
			samplerRafId = undefined;
		}
	}

	// Arm/disarm the Family A sampler. Plain $effect (NOT $effect.pre) per the
	// svelte-effect-pre-same-flush-rerun memory. The sampler runs ONLY for the
	// list family: overlay reads `pager.coverProgress` directly and never arms a
	// sampler. The effect does NOT write sampledFractionalIndex synchronously
	// (it only starts/stops the rAF), so it cannot loop (svelte-effect-fetch-loop).
	$effect(() => {
		const hasTrack = track !== null;
		const rule = getRouteFabRule(page.url.pathname);
		const hasCfg = rule !== null && rule.fab !== undefined && rule.fab.kind !== null;
		const family = rule?.fab?.family ?? null;
		if (!hasTrack || !hasCfg || family !== 'list' || chipExitActive) {
			stopSampler();
			return;
		}
		// `familyNeedsSamplerDuringDrag('list')` is true, so a drag never disarms
		// the Family A sampler; this guard is defensive for any future family.
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
		if (discreteNavTimer !== undefined) {
			clearTimeout(discreteNavTimer);
			discreteNavTimer = undefined;
		}
	});

	// Cross-tab chip-exit / pendingNav: forces scale 0 directly, bypassing the
	// foregroundFraction derivation. The back-chip overlay (MobileTabPager's
	// z-30 LoadingChip) renders on LIST routes during a back-swipe toward a deep
	// page or a cross-tab tap. Family B (overlay) and Family C (compose) routes
	// never host the overlay, so chip-exit is gated to `fabConfig.family ===
	// 'list'`. Tested first in foregroundFraction so it overrides coverProgress.
	const chipExitActive = $derived.by(() => {
		const cfg = fabConfig;
		if (cfg?.family !== 'list') return false;
		const pending = navStore.pendingNav;
		if (pending !== null) {
			// Same source-list tab: the nav stays within the tab the FAB
			// represents (e.g. discussions list -> discussions list page 2).
			return getCurrentTabIndex(pending.href) !== cfg.tabIndex;
		}
		// navInFlight without a pending nav: a cross-tab tap is a FORWARD nav
		// (navigateForward) and the LoadingChip covers the target pager. A
		// BACKWARD nav (back-swipe to this source list) has no chip.
		return navStore.navInFlight && navStore.direction === 'forward';
	});

	/** Per-family foreground fraction (0 = source list covered, 1 = fully
	 *  foreground). Family A reads the sampler; Family B reads `coverProgress`;
	 *  Family C rests at 0. `chipExitActive` overrides to 0. */
	const foregroundFraction = $derived.by(() => {
		const cfg = displayConfig;
		if (cfg === null) return 0;
		if (chipExitActive) return 0;
		if (cfg.family === 'list') {
			if (samplerActive && sampledFractionalIndex !== null) {
				return tabFraction(sampledFractionalIndex, cfg.tabIndex);
			}
			// Resting / SSR: the route's known tab position. `pager.active`
			// fallback to the URL tab makes a deep-link SSR render at the right
			// scale before the pager mounts.
			const restActiveTab = pager.active
				? pager.fractionalIndex
				: getCurrentTabIndex(page.url.pathname);
			return tabFraction(restActiveTab, cfg.tabIndex);
		}
		if (cfg.family === 'overlay') {
			// Live coverProgress from the pager store. Resting (null) = 0.
			return pager.coverProgress ?? 0;
		}
		// Family C (compose): covered at rest. The discrete-nav CSS transition
		// eases the list<->compose swap.
		return 0;
	});

	const scale = $derived(scaleFromFraction(foregroundFraction));

	// The atom's CSS transition eases non-drag scale changes across a route
	// swap or a GesturePageLayout exit slide. Armed by `discreteNavInFlight`
	// (any distinct family swap, latched via $effect.pre so it lands in the same
	// flush as the scale change) OR by `navStore.pendingNav` (a GPL exit slide
	// sets pendingNav and publishes the logical endpoint coverProgress; the
	// transition eases the FAB toward it across the slide). Off during a drag
	// (the live signal drives), so there is no double-clock. A same-family tab
	// tap sets neither flag; its easing track is driven by the Family A sampler.
	const transitionEnabled = $derived(
		!pager.dragging && (discreteNavInFlight || navStore.pendingNav !== null)
	);

	const fabHideProgress = $derived(
		hideProgress(scrollChrome.translateY, scrollChrome.headerHeight)
	);
	const fabTranslateY = $derived(
		translateYFromHideProgress(fabHideProgress, FAB_HEIGHT_PX, BOTTOM_CLEARANCE_PX)
	);
</script>

{#if displayConfig !== null}
	<div class="fab-layer z-35 md:hidden" data-fab-kind={displayConfig.kind}>
		<FloatingActionButton
			{scale}
			translateY={fabTranslateY}
			hideProgress={fabHideProgress}
			href={displayConfig.href}
			label={displayConfig.label}
			icon={displayConfig.icon}
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
