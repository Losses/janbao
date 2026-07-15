<script lang="ts">
	/**
	 * FloatingActionButtonLayer - mobile-only layer rendered by AppShell as a
	 * sibling of <Header>. Survives every non-`/entry` route, so the FAB's
	 * route-transition scale animation has a stable home.
	 *
	 * Scale is a pure function of a live gesture/page signal, read from the
	 * reactive pager store, selected by family:
	 *
	 *   - Family A (list / tab swipe): the orchestrator publishes the tab
	 *     host's 1:1 track fractional position (`pager.trackFractionalIndex`),
	 *     computed from `trackTranslateX(plan, executor.progress)`.
	 *     `tabFraction(track position, tabIndex)` maps it to 0..1.
	 *   - Family B (overlay: thread + deep): reads `pager.coverProgress`
	 *     (0..1, deadzone-free), published by `NavPipelineOrchestrator` as
	 *     the raw slide fraction. The store signal drives the scale directly
	 *     each frame.
	 *   - Family C (compose): like Family B, reads `pager.coverProgress`.
	 *
	 * `scaleFromFraction` maps foregroundFraction over the second half of its
	 * range (`clamp(2·f − 1, 0, 1)`): the FAB disappears over the first 50% of a
	 * route transition and appears over the last 50%, tracking the finger across
	 * the whole drag.
	 *
	 * Non-drag navigation across a family swap (list -> compose, list ->
	 * overlay, etc.) is eased by the orchestrator (the persistent singleton
	 * spans the route swap). The orchestrator detects the family change on
	 * `configure`, interpolates the published `pager.familySwapScale` from the
	 * pre-swap rendered scale to the destination family's resting scale over
	 * `TRACK_TRANSITION_MS` (200ms) via the constant-deceleration curve
	 * `s(u) = 2u - u^2` on its own rAF, and publishes the eased scale each
	 * tick. This layer is a READER: when `pager.familySwapScale` is non-null
	 * it takes precedence over the resting formula; when the ease completes
	 * (or a higher-priority driver takes over) the orchestrator clears the
	 * field and this layer falls through to the coverProgress /
	 * trackFractionalIndex-driven resting scale. Same-family tab taps
	 * (list<->list) do not trigger the ease; their easing track is driven by
	 * the published track fractional index.
	 */
	import { page } from '$app/state';
	import FloatingActionButton from '$lib/components/atoms/FloatingActionButton.svelte';
	import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';
	import { getNavigationStore } from '$lib/stores/navigation.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import {
		getFabRouteAttributes,
		FAB_KIND_CONFIGS,
		backTargetListKind,
		getCurrentTabIndex
	} from '$lib/utils/route-config';
	import { isTabRootPath } from '$lib/utils/history-nav';
	import type { FabListKind } from '$lib/utils/route-config';
	import {
		scaleFromFraction,
		tabFraction,
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

	// Fixed geometry (kept in sync with the atom). `size-14` = 56px FAB; the
	// resting bottom inset is 1rem + the device safe-area inset (env). The slide
	// distance = fabHeight + bottomClearance so a fully-hidden FAB clears the
	// viewport bottom edge entirely.
	const FAB_HEIGHT_PX = 56;
	const BOTTOM_CLEARANCE_PX = 16;

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
		const attrs = getFabRouteAttributes(page.url.pathname);
		if (!attrs) return null;

		if (attrs.kind === 'dynamic') {
			// The Activity route resolves its FAB from the gesture's source tab.
			// The orchestrator publishes the tab host's 1:1 track fractional
			// position (`pager.trackFractionalIndex`); on a committing swipe the
			// route lands on Activity while the track is still mid-slide, and that
			// published position is the true visual index (fractionalIndex, the
			// pill, would unmount the source-list FAB before it can ease out), so
			// defer to it and keep the FAB mounted until the slide finishes.
			const trackFrac = pager.trackFractionalIndex;
			const sliding = trackFrac !== null && Math.abs(trackFrac - Math.round(trackFrac)) > 0.01;
			const index = sliding && trackFrac !== null ? trackFrac : pager.fractionalIndex;
			if (pager.active && Math.abs(index - 1) > 0.01) {
				const resolvedKind: FabListKind = index < 1 ? 'discussions' : 'messages';
				const kindConfig = FAB_KIND_CONFIGS[resolvedKind];
				return {
					kind: resolvedKind,
					family: attrs.family,
					href: kindConfig.href,
					label: kindConfig.label(t),
					icon: kindConfig.icon,
					tabIndex: kindConfig.tabIndex
				};
			}
			return null;
		}

		if (attrs.kind === 'deep') {
			// A non-FAB deep route (bookmarks, profile/*, search,
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
				family: attrs.family,
				href: kindConfig.href,
				label: kindConfig.label(t),
				icon: kindConfig.icon,
				tabIndex: kindConfig.tabIndex
			};
		}

		if (attrs.kind === null) return null;

		const kindConfig = FAB_KIND_CONFIGS[attrs.kind];
		return {
			kind: attrs.kind,
			family: attrs.family,
			href: kindConfig.href,
			label: kindConfig.label(t),
			icon: kindConfig.icon,
			tabIndex: kindConfig.tabIndex
		};
	});

	// Retain the last non-null FAB config so the atom stays mounted across every
	// tab route, including ones with no FAB of their own (e.g. /activity). The
	// published track fractional index then drives the scale continuously:
	// tabFraction(track position, tabIndex) follows the slide, so a tab tap
	// animates the FAB without any latch or timing dependency. A fresh deep-link to a no-FAB route has retainedConfig ===
	// null (no prior FAB seen), so the atom does not render there (the
	// "activity has no FAB" contract holds on first load); once any FAB route
	// has been visited the atom persists and the published track index carries the scale to
	// 0 on no-FAB tabs.
	let retainedConfig = $state<FabConfig | null>(null);
	$effect(() => {
		if (fabConfig !== null) retainedConfig = fabConfig;
	});

	// Kind follows the visual track position (the published track fractional
	// index), NOT the URL. The URL swaps at click time (before the track
	// moves); the published position lags by the executor's rAF slide. Using it
	// for kind means the kind swaps at the trackFrac = 1 boundary (the tab-0 /
	// tab-1 crossing, where the source-list FAB is already at scale 0; the
	// midpoint of a multi-panel swap, the destination of an adjacent one), not
	// at the click, so no flicker. This is active whenever the tab host
	// publishes trackFractionalIndex (including at integer rest on the tab
	// host); on routes where it is null (deep pages) the kind falls through to
	// the URL/config value, so the URL-swap frame cannot leak the incoming kind
	// before the track has crossed that boundary.
	const effectiveKind = $derived.by<FabKind>(() => {
		const trackFrac = pager.trackFractionalIndex;
		if (trackFrac !== null) {
			return trackFrac < 1 ? 'discussions' : 'messages';
		}
		// SSR / before the tab host publishes: URL-derived kind.
		return fabConfig?.kind ?? retainedConfig?.kind ?? null;
	});

	// The destination's resting FAB kind during a pipeline transition,
	// or null when no transition is in flight or the destination shows no FAB at
	// rest (the conversation, which is the overlay family; /activity, whose kind
	// is 'dynamic' and resolves to no resting FAB). Used so the correct atom
	// scales in with the slide, and so no FAB appears for a destination without
	// one.
	const pilotTransitionListKind = $derived.by<FabListKind | null>(() => {
		const target = pager.transitionTarget;
		if (target === null) return null;
		const attrs = getFabRouteAttributes(target);
		if (attrs === null || attrs.family !== 'list') return null;
		if (attrs.kind === 'discussions') return 'discussions';
		if (attrs.kind === 'messages') return 'messages';
		return null;
	});

	const displayConfig = $derived.by<FabConfig | null>(() => {
		const cfg = fabConfig ?? retainedConfig;
		if (cfg === null) return null;
		let kind = cfg.family === 'list' ? effectiveKind : cfg.kind;
		// A pipeline transition resolves the destination's FAB kind so
		// the correct atom scales in with coverProgress. On the tab pager the
		// published track fractional index is live; effectiveKind handles the
		// kind switch at the visual midpoint, so the override is gated off.
		if (pilotTransitionListKind !== null && pager.trackFractionalIndex === null) {
			kind = pilotTransitionListKind;
		}
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

	// Cross-tab slide coverage: every route is a pipeline route, so
	// SvelteKit's `beforeNavigate` is consumed by the orchestrator, which
	// publishes the tab host's 1:1 track fractional index; the Family A FAB
	// reads it directly. No `navInFlight` gate is involved.

	/** Per-family foreground fraction (0 = source list covered, 1 = fully
	 *  foreground). Family A reads the published track fractional index;
	 *  Families B and C read `coverProgress`. */
	const foregroundFraction = $derived.by(() => {
		const cfg = displayConfig;
		if (cfg === null) return 0;
		// A pipeline transition whose destination shows no resting FAB
		// scales the FAB OUT. Two cases:
		//   1. Non-tab host (trackFractionalIndex is null): the destination
		//      has no list FAB (a compose, overlay, or dynamic-kind tab). The
		//      source family is overlay/compose (resting scale 0), so a
		//      direct return 0 is continuous with the at-rest scale.
		//   2. Tab host + backward-to-deep-page (target is NOT a tab root):
		//      the track would otherwise drive the FAB IN toward the previous
		//      tab's kind; the deep destination has no FAB, so scale OUT.
		//      When the source route's tab matches the retained config's tab
		//      (resting scale 1, e.g. / or /messages/inbox), ease out via
		//      `1 - coverProgress` so `scaleFromFraction` ramps the FAB from
		//      1 to 0 over the first half of the slide (matching the handoff
		//      curve, continuous at the gate's first firing). When the source
		//      route's tab differs from the retained config's tab (resting
		//      scale 0, e.g. /activity whose dynamic-kind branch returns null
		//      at rest and retainedConfig carries a different list kind),
		//      return 0 so the FAB stays hidden (both endpoints have no FAB).
		// Tab-to-tab transitions on the tab host (including to /activity,
		// whose kind is dynamic) pass through: the target IS a tab root,
		// so the track index drives the FAB.
		if (
			pager.transitionTarget !== null &&
			pilotTransitionListKind === null &&
			(pager.trackFractionalIndex === null || !isTabRootPath(pager.transitionTarget))
		) {
			if (cfg.family === 'list') {
				// The source route's resting FAB fraction (URL-derived,
				// stable during the gesture). On /activity the dynamic-kind
				// branch returns null at rest and retainedConfig carries a
				// different list kind, so this fraction is 0; `1 -
				// coverProgress` would jump the visible scale from 0 to ~1
				// on the first frame (a FAB flash). Return 0 so the FAB
				// stays hidden when the source has no FAB at rest.
				const sourceTab = getCurrentTabIndex(page.url.pathname);
				if (sourceTab >= 0 && tabFraction(sourceTab, cfg.tabIndex) === 0) {
					return 0;
				}
				return 1 - (pager.coverProgress ?? 0);
			}
			return 0;
		}
		if (cfg.family === 'list') {
			const trackFrac = pager.trackFractionalIndex;
			if (trackFrac !== null) {
				// Known continuity gap: when a Family-A-to-tab gesture
				// (a tab-to-tab swipe, both endpoints list family)
				// interrupts a running family-swap ease, the seed
				// (`#fabDragSeedFraction` in the orchestrator) only
				// feeds the `coverProgress`-based branches above. This
				// branch derives the FAB scale from the orchestrator's
				// 1:1 `trackFractionalIndex` signal, which is not
				// seeded because that signal also drives `effectiveKind`
				// (the visual kind swap at trackFrac = 1) and the
				// `displayConfig` gate; publishing a fractional seed
				// here would corrupt both, and the seed would only
				// bridge one frame anyway (the first `onDragMove`
				// overwrites `trackFractionalIndex` with the real
				// finger position). At gesture start `trackFrac` is the
				// rest tab, so `tabFraction(restTab, cfg.tabIndex)` is
				// 0 or 1: the FAB snaps from the mid-ease scale to
				// that binary value, then tracks the finger 1:1. The
				// 1:1 finger-tracking invariant takes precedence over a
				// continuity bridge here.
				return tabFraction(trackFrac, cfg.tabIndex);
			}
			// Resting / SSR: the route's known tab position. `pager.active`
			// fallback to the URL tab makes a deep-link SSR render at the right
			// scale before the pager mounts.
			const restActiveTab = pager.active
				? pager.fractionalIndex
				: getCurrentTabIndex(page.url.pathname);
			return tabFraction(restActiveTab, cfg.tabIndex);
		}
		// Families B (overlay) and C (compose) read `coverProgress`,
		// published by `NavPipelineOrchestrator` as the raw slide fraction
		// (so the FAB follows the finger across the drag and the commit
		// slide). Resting (null server-side / pre-mount, 0 client-side) maps
		// to 0; the discrete forward/back swap is eased by the orchestrator's
		// family-swap ease (published via `pager.familySwapScale`).
		return pager.coverProgress ?? 0;
	});

	const restingScale = $derived(scaleFromFraction(foregroundFraction));

	// The orchestrator publishes `pager.familySwapScale` while a route-swap
	// family-change ease is in flight on its own rAF; it takes precedence
	// over the resting formula. When the ease completes (or a higher-priority
	// driver takes over), the orchestrator clears the field and this layer
	// falls through to the resting scale.
	const scale = $derived(pager.familySwapScale ?? restingScale);

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
