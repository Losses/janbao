<script lang="ts">
	/**
	 * FloatingActionButtonLayer - mobile-only layer rendered by AppShell as a
	 * sibling of <Header>. Survives every non-`/entry` route, so the FAB's
	 * route-transition scale animation has a stable home.
	 *
	 * Scale is a pure function of a single transition signal, read from the
	 * orchestrator's publication:
	 *
	 *   - In flight (publication.inFlight): `computeFabScale(inputs)` where
	 *     `inputs.progress` is the orchestrator's raw drag fraction
	 *     (`publication.progress`); on a non-bidirectional host (every
	 *     NavPipelineHost route: threads, compose, deep pages) the page-track
	 *     threshold-absorbs this same drag (`trackProgress` absorbs the first
	 *     20% as a deadzone), so the FAB reacts from the first pixel while
	 *     the track absorbs the deadzone (spec §5), and fromHasFab /
	 *     toHasFab come from `RouteData.fab` on the from/to pathnames. The
	 *     natural formula (`fabScale`) exits the FAB in the first half
	 *     (0 -> 0.5) if FROM shows a FAB and enters in the second half
	 *     (0.5 -> 1) if TO shows a FAB; a tab-to-tab swap (both have a FAB)
	 *     dips to 0 at the midpoint, handing off the icon at the visual
	 *     centre. The boundary / suppressed / enter-anchor / drag-anchor
	 *     branches override the natural formula; see `computeFabScale`'s
	 *     docstring for the branch-by-branch behaviour.
	 *   - At rest: 1 if the current route shows a FAB (`RouteData.fab`),
	 *     0 otherwise.
	 *
	 * The kind/icon/href/label resolution is independent of scale: the atom
	 * stays mounted across non-FAB routes via `retainedConfig` so the
	 * scale-in/out has a stable target, and `displayConfig` swaps the kind
	 * at the visual midpoint of an in-flight transition so the destination's
	 * icon scales in.
	 */
	import { page } from '$app/state';
	import FloatingActionButton from '$lib/components/atoms/FloatingActionButton.svelte';
	import { getNavigationStore } from '$lib/stores/navigation.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { getGlobalNavPipelineOrchestrator } from '$lib/stores/nav-pipeline-orchestrator.svelte';
	import {
		getFabRouteAttributes,
		FAB_KIND_CONFIGS,
		backTargetListKind
	} from '$lib/utils/route-config';
	import { getRouteData } from '$lib/utils/route-data';
	import { translateYFromHideProgress, hideProgress, computeFabScale } from '$lib/utils/fab-scale';
	import type { FabListKind } from '$lib/utils/route-config';
	import type { TranslationDict } from '$lib/types/translation';

	interface FloatingActionButtonLayerProps {
		t: TranslationDict;
	}

	let { t }: FloatingActionButtonLayerProps = $props();

	const navStore = getNavigationStore();
	const scrollChrome = getScrollChromeStore();
	const orchestrator = getGlobalNavPipelineOrchestrator();
	const publication = $derived(orchestrator.publication);

	// Fixed geometry (kept in sync with the atom). `size-14` = 56px FAB; the
	// resting bottom inset is 1rem + the device safe-area inset (env). The slide
	// distance = fabHeight + bottomClearance so a fully-hidden FAB clears the
	// viewport bottom edge entirely.
	const FAB_HEIGHT_PX = 56;
	const BOTTOM_CLEARANCE_PX = 16;

	interface FabConfig {
		readonly kind: FabListKind;
		readonly href: string;
		readonly label: string;
		readonly icon: string;
	}

	/** Resolve the current route's resting FAB config, or null when the
	 *  route shows no FAB of its own. The atom stays mounted across non-FAB
	 *  routes via `retainedConfig` (below), so a scale-in/out has a stable
	 *  target. The 'deep' and 'dynamic' branches resolve the source-list
	 *  kind from the back-target so a non-FAB atom (scale 0) carries the
	 *  kind the user will see when they swipe back to a list. */
	const fabConfig = $derived.by<FabConfig | null>(() => {
		const attrs = getFabRouteAttributes(page.url.pathname);
		if (!attrs) return null;

		if (attrs.kind === 'deep' || attrs.kind === 'dynamic') {
			const resolvedKind = backTargetListKind(navStore.backTarget);
			const kindConfig = FAB_KIND_CONFIGS[resolvedKind];
			return {
				kind: resolvedKind,
				href: kindConfig.href,
				label: kindConfig.label(t),
				icon: kindConfig.icon
			};
		}

		if (attrs.kind === 'discussions' || attrs.kind === 'messages') {
			const kindConfig = FAB_KIND_CONFIGS[attrs.kind];
			return {
				kind: attrs.kind,
				href: kindConfig.href,
				label: kindConfig.label(t),
				icon: kindConfig.icon
			};
		}

		return null;
	});

	// Retain the last non-null FAB config so the atom stays mounted across
	// every route, including ones with no FAB of their own (e.g. /activity,
	// /bookmarks, /profile/*). `computeFabScale`'s default natural branch
	// drives the scale to 0 on those routes (RouteData.fab is false), but
	// the atom must persist so the scale-in/out has a stable target.
	let retainedConfig = $state<FabConfig | null>(null);
	$effect(() => {
		if (fabConfig !== null) retainedConfig = fabConfig;
	});

	/** Resolve the FAB kind to display, swapping to the destination's kind
	 *  at the visual midpoint of an in-flight transition so the
	 *  destination's icon scales in (matching the scale's dip-to-0 at the
	 *  midpoint). At rest or before the midpoint, the resting config's kind
	 *  holds. */
	const displayConfig = $derived.by<FabConfig | null>(() => {
		const cfg = fabConfig ?? retainedConfig;
		if (cfg === null) return null;
		const pub = publication;
		if (pub.inFlight && pub.fromPathname && pub.toPathname && pub.progress >= 0.5) {
			const toAttrs = getFabRouteAttributes(pub.toPathname);
			if (toAttrs !== null && (toAttrs.kind === 'discussions' || toAttrs.kind === 'messages')) {
				const toKind: FabListKind = toAttrs.kind;
				if (toKind !== cfg.kind) {
					const kc = FAB_KIND_CONFIGS[toKind];
					return {
						...cfg,
						kind: toKind,
						href: kc.href,
						label: kc.label(t),
						icon: kc.icon
					};
				}
			}
		}
		return cfg;
	});

	/** FAB scale: a pure function of the orchestrator's transition progress
	 *  + FROM/TO FAB presence + the boundary / suppressed / enter-anchor /
	 *  drag-anchor overrides. At rest, visible iff the current route shows
	 *  a FAB.
	 *
	 *  Branch-by-branch behaviour and the anchor-shift / enter-lerp
	 *  rationale live in `computeFabScale`'s docstring (single source of
	 *  truth; the orchestrator's `#fabScaleAtSettleInstant` helper calls
	 *  the same function so the anchor capture mirrors the displayed FAB
	 *  by construction - DV21 §5). */
	const scale = $derived.by(() => {
		const pub = publication;
		if (!pub.inFlight || !pub.fromPathname || !pub.toPathname) {
			return getRouteData(page.url.pathname).fab ? 1 : 0;
		}
		const fromPathname = pub.fromPathname;
		const toPathname = pub.toPathname;
		const fromHasFab = getRouteData(fromPathname).fab;
		const toHasFab = getRouteData(toPathname).fab;
		return computeFabScale({
			progress: pub.progress,
			fromHasFab,
			toHasFab,
			isBoundary: fromPathname === toPathname,
			isSuppressedTab: pub.plan?.pageTrack.distance === 0 && getRouteData(toPathname).tag === 'tab',
			settleActive: pub.settleActive,
			settleMorphFraction: pub.settleMorphFraction,
			enterAnchor: orchestrator.enterFabAnchor,
			dragAnchor: orchestrator.dragFabAnchor
		});
	});

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
