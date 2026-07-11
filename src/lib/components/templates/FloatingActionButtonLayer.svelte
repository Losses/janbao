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
	 *     NavPipelineTabHost track `m41` (the fractional tab index). The
	 *     store's `fractionalIndex` jumps to its integer endpoint on release
	 *     while the track keeps easing, so the per-frame read is the
	 *     continuous signal across the snap. `tabFraction(sample, tabIndex)`
	 *     maps it to 0..1.
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
	 * overlay, etc.) is eased by the layer's own rAF family-swap ease: the
	 * published scale is interpolated from the pre-swap resting scale to the
	 * new family's resting scale over `TRACK_TRANSITION_MS` (200ms) via the
	 * constant-deceleration curve `s(u) = 2u - u^2` (the same curve the
	 * executor uses). Same-family tab taps (list<->list) do not trigger it;
	 * their easing track is driven by the Family A sampler. During a drag the
	 * rAF ease is off (the live signal drives), so there is no double-clock.
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
	import {
		getFabRouteAttributes,
		FAB_KIND_CONFIGS,
		backTargetListKind,
		getCurrentTabIndex
	} from '$lib/utils/route-config';
	import type { FabListKind } from '$lib/utils/route-config';
	import type { FabFamily } from '$lib/utils/fab-scale';
	import {
		scaleFromFraction,
		tabFraction,
		familyNeedsSamplerDuringDrag,
		hideProgress,
		translateYFromHideProgress
	} from '$lib/utils/fab-scale';
	import { TRACK_TRANSITION_MS } from '$lib/utils/gesture-constants';
	import type { TranslationDict } from '$lib/types/translation';

	interface FloatingActionButtonLayerProps {
		t: TranslationDict;
	}

	let { t }: FloatingActionButtonLayerProps = $props();

	const pager = getMobilePagerStore();
	const navStore = getNavigationStore();
	const scrollChrome = getScrollChromeStore();
	const activeGestureTrack = getActiveGestureTrack();

	// rAF family-swap ease state. On a distinct family swap (overlay<->list,
	// compose<->list) the published scale is interpolated from the pre-swap
	// resting scale to the new family's resting scale over TRACK_TRANSITION_MS
	// (200ms) via the constant-deceleration curve `s(u) = 2u - u^2` (the same
	// curve the executor uses). The ease runs on the layer's own rAF loop, a
	// persistent consumer that survives the route swap. It is gated off when a
	// higher-priority driver owns the FAB scale: a drag (the live signal
	// drives) or the orchestrator (pilotTransitionListKind !== null;
	// coverProgress ramps the scale). A same-family tab tap (list<->list)
	// does not trigger it (the Family A sampler drives that easing track).
	let familySwapRafId: number | undefined;
	let familySwapFromScale = 0;
	let familySwapToScale = 0;
	let familySwapToScaleCaptured = false;
	let familySwapStartTs = 0;
	let familySwapScale = $state<number | null>(null);
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
		const attrs = getFabRouteAttributes(page.url.pathname);
		if (!attrs) return null;

		if (attrs.kind === 'dynamic') {
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

	const track = $derived(activeGestureTrack.track);

	// Retain the last non-null FAB config so the atom stays mounted across every
	// tab route, including ones with no FAB of their own (e.g. /activity). The
	// Family A sampler then drives the scale continuously from the
	// NavPipelineTabHost track: tabFraction(track position, tabIndex) follows
	// the slide, so a tab tap animates the FAB without any latch or timing
	// dependency. A fresh deep-link to a no-FAB route has retainedConfig ===
	// null (no prior FAB seen), so the atom does not render there (the
	// "activity has no FAB" contract holds on first load); once any FAB route
	// has been visited the atom persists and the sampler carries the scale to
	// 0 on no-FAB tabs.
	let retainedConfig = $state<FabConfig | null>(null);
	$effect(() => {
		if (fabConfig !== null) retainedConfig = fabConfig;
	});

	// Kind follows the visual track position (the sampler's sample), NOT the URL.
	// The URL swaps at click time (before the track moves); the sample lags by
	// the executor's rAF slide. Using the sample for kind means the kind swaps
	// at the visual midpoint (scale 0 via 2f-1), not at the click, so no
	// flicker. This is ALWAYS active (even at integer rest) so the URL-swap
	// frame cannot leak the incoming kind before the track has crossed the
	// midpoint.
	const effectiveKind = $derived.by<FabKind>(() => {
		if (samplerActive && sampledFractionalIndex !== null) {
			return sampledFractionalIndex < 1 ? 'discussions' : 'messages';
		}
		// SSR / before sampler mounts: URL-derived kind.
		return fabConfig?.kind ?? retainedConfig?.kind ?? null;
	});

	// The destination's resting FAB kind during a pilot detail-page transition,
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
		// A pilot detail-page transition resolves the destination's FAB kind so
		// the correct atom scales in with coverProgress. On the tab pager the
		// Family A sampler is active; effectiveKind handles the kind switch at
		// the visual midpoint, so the override is gated off.
		if (pilotTransitionListKind !== null && !samplerActive) {
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

	// Detect a distinct family swap and start the rAF ease. `$effect.pre` runs
	// before the DOM update, so reading the atom's inline transform here returns
	// the last committed (visible) scale, even if the reactive `restingScale`
	// has already raced ahead to a transient post-swap value (e.g. an incoming
	// route's coverProgress published mid-flush). `startFamilySwapEase` pins
	// `familySwapScale` to that from-scale in this same flush so the swap frame
	// renders the pre-swap scale (no snap), then the rAF interpolates toward the
	// new resting scale over the next 200ms.
	$effect.pre(() => {
		const current = fabConfig?.family ?? null;
		const prev = previousFamily;
		previousFamily = current;
		// Only ease a real family swap. Skip the initial mount (prev === null):
		// the atom renders at its resting scale already, and easing from 0
		// would flash the FAB on every hydration. A swap to no-config
		// (current === null, e.g. landing on /activity where no FAB renders)
		// still eases the scale out toward the new resting scale (0). Same-
		// family transitions (tab taps within the list family) are handled by
		// the Family A sampler, not this ease.
		if (prev !== null && prev !== current) {
			// Gate: skip when a higher-priority driver owns the FAB scale.
			if (pager.dragging || pilotTransitionListKind !== null) {
				return;
			}
			// Anchor from the atom's visible scale (the DOM ground truth). On a
			// re-swap mid-ease this is the current eased value, so the trajectory
			// stays continuous. Falls back to 0 only if the atom is absent.
			const fromScale = readRenderedFabScale() ?? 0;
			startFamilySwapEase(fromScale);
		}
	});

	// The sampled fractional index, written by the rAF callback (NOT inside a
	// $effect that reads pager.fractionalIndex) so the arm/disarm effect does
	// not loop (svelte-effect-fetch-loop memory). Holds its last value when no
	// sampler is running. (State declared above, before `fabConfig`.)

	/** Read the live Family A track m41 (px) and convert to the fractional tab
	 *  index. Deliberately NOT clamped to [0,2]: at the first/last tab a void
	 *  swipe rubber-bands the track (follow() applies a 0.4x factor), so the
	 *  index briefly goes negative or past 2. The FAB must track that motion
	 *  the same way the MobileTabBar pill does: the pill's closeness and the
	 *  FAB's tabFraction share the formula 1 - |idx - tabIndex| over the
	 *  unclamped fractionalIndex. tabFraction clamps the OUTPUT to [0,1], so
	 *  an input clamp here would suppress only the boundary rubber-band and
	 *  leave the FAB still while the pill moves. Returns null when there is
	 *  no track. */
	function sampleFraction(): number | null {
		const el = track;
		if (!el || !browser) return null;
		const panelWidth = window.innerWidth;
		if (panelWidth <= 0) return null;
		try {
			const m41 = new DOMMatrix(getComputedStyle(el).transform).m41;
			return -m41 / panelWidth;
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
		const attrs = getFabRouteAttributes(page.url.pathname);
		const hasCfg = attrs !== null && attrs.kind !== null;
		const family = attrs?.family ?? null;
		if (!hasTrack || !hasCfg || family !== 'list') {
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

	/** Read the FAB atom's currently-rendered scale from its inline transform.
	 *  Used by the family-swap `$effect.pre` to anchor the ease at the visible
	 *  scale (the DOM ground truth), which is immune to the reactive
	 *  `restingScale` racing ahead to a transient post-swap value in the same
	 *  flush. Returns null when the atom is not in the DOM (SSR, or no FAB
	 *  route). */
	function readRenderedFabScale(): number | null {
		if (!browser) return null;
		const el = document.querySelector('[data-testid="fab"]');
		if (!el) return null;
		const transform = (el as HTMLElement).style.transform;
		const m = transform.match(/scale\(([-0-9.]+)\)/);
		return m ? Number(m[1]) : null;
	}

	/** Start the rAF family-swap ease from `fromScale` to the new family's
	 *  resting scale (captured on the first tick from the recomputed
	 *  `restingScale`). Cancels any in-flight ease first (a second family swap
	 *  mid-ease); the caller passes the current visible scale as `fromScale` so
	 *  the trajectory stays continuous. Pins `familySwapScale` to `fromScale`
	 *  immediately so the swap frame does not snap before the first tick. */
	function startFamilySwapEase(fromScale: number): void {
		if (!browser) return;
		if (familySwapRafId !== undefined) {
			cancelAnimationFrame(familySwapRafId);
		}
		familySwapFromScale = fromScale;
		familySwapToScale = fromScale;
		familySwapToScaleCaptured = false;
		// The clock starts on the FIRST tick, not here: the $effect.pre that
		// arms the ease can run during a SvelteKit navigation whose DOM work
		// delays the first rAF by many frames. Starting the clock here would
		// make the first tick compute a large elapsed `u` and skip the
		// early-ease scale range. Pinning `familySwapScale` to `fromScale`
		// holds the atom at the pre-swap scale during that gap, then the ease
		// runs the full curve from the first real frame.
		familySwapStartTs = 0;
		familySwapScale = fromScale;
		const tick = (): void => {
			// If a higher-priority driver took over mid-ease (a drag or the
			// orchestrator), cancel and hand the scale back to the
			// resting/live signal.
			if (pager.dragging || pilotTransitionListKind !== null) {
				stopFamilySwapEase();
				return;
			}
			const now = performance.now();
			if (!familySwapToScaleCaptured) {
				// By the first tick `restingScale` has recomputed for the new
				// family; capture it as the ease target once, and start the
				// clock on this frame so the full 200ms curve plays.
				familySwapToScale = restingScale;
				familySwapToScaleCaptured = true;
				familySwapStartTs = now;
			}
			const u = Math.min((now - familySwapStartTs) / TRACK_TRANSITION_MS, 1);
			const eased = 2 * u - u * u;
			familySwapScale = familySwapFromScale + (familySwapToScale - familySwapFromScale) * eased;
			if (u >= 1) {
				familySwapScale = null;
				familySwapRafId = undefined;
				return;
			}
			familySwapRafId = requestAnimationFrame(tick);
		};
		familySwapRafId = requestAnimationFrame(tick);
	}

	/** Cancel the rAF family-swap ease and hand the published scale back to the
	 *  resting formula. */
	function stopFamilySwapEase(): void {
		if (familySwapRafId !== undefined) {
			cancelAnimationFrame(familySwapRafId);
			familySwapRafId = undefined;
		}
		familySwapScale = null;
	}

	onDestroy(() => {
		// onDestroy runs in SSR; guard DOM-touching teardown (svelte-ondestroy-
		// runs-in-ssr memory). cancelAnimationFrame is a no-op on the server but
		// the guard is defensive.
		if (!browser) return;
		stopSampler();
		stopFamilySwapEase();
	});

	// Cross-tab slide coverage: every route is a pipeline route, so
	// SvelteKit's `beforeNavigate` is consumed by the orchestrator and the
	// Family A sampler (live track m41) drives the FAB scale across a
	// cross-tab slide directly. No `navInFlight` gate is involved.

	/** Per-family foreground fraction (0 = source list covered, 1 = fully
	 *  foreground). Family A reads the sampler; Families B and C read
	 *  `coverProgress`. */
	const foregroundFraction = $derived.by(() => {
		const cfg = displayConfig;
		if (cfg === null) return 0;
		// A pilot detail-page transition scales the FAB in only when the
		// destination shows a FAB at rest. For a destination without one (the
		// forward-enter to the conversation; a tab-click to /activity from the
		// pilot route), the FAB stays at 0 throughout. On the tab pager
		// (NavPipelineTabHost) the Family A sampler is active and reads the
		// pipeline-driven track, so it drives the FAB scale across the slide
		// even when the destination has no resting FAB (e.g. /activity). Gate
		// the override on `!samplerActive` so the sampler takes precedence on
		// list routes.
		if (pager.transitionTarget !== null && pilotTransitionListKind === null && !samplerActive)
			return 0;
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
		// Families B (overlay) and C (compose) read `coverProgress`,
		// published by `NavPipelineOrchestrator` as the raw slide fraction
		// (so the FAB follows the finger across the drag and the commit
		// slide). Resting (null server-side / pre-mount, 0 client-side) maps
		// to 0; the discrete forward/back swap is eased by the layer's rAF
		// family-swap ease (the `startFamilySwapEase` loop).
		return pager.coverProgress ?? 0;
	});

	const restingScale = $derived(scaleFromFraction(foregroundFraction));

	// While the rAF family-swap ease is running, publish the eased scale;
	// otherwise fall through to the resting formula. The ease sets
	// `familySwapScale` back to null on completion so the handoff to
	// `restingScale` is seamless (the ease target equals the new resting scale).
	const scale = $derived(familySwapScale !== null ? familySwapScale : restingScale);

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
