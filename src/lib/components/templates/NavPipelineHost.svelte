<script lang="ts">
	// src/lib/components/templates/NavPipelineHost.svelte
	//
	// The 5b1 pilot-route structural shell. Renders the multi-panel
	// track / scroll-pane / snippet slots / viewport-lock acquisition /
	// scroll-chrome registration / active-gesture-track publication for
	// the pilot route `/messages/[id]`. Replaces `GesturePageLayout` on
	// the pilot route ONLY (every other route still mounts GPL).
	//
	// Per the C05b1 spec's binding "UNIFY, DO NOT BRIDGE" constraint,
	// this component carries NO gesture / navigation state of its own.
	// The track's transform is written by `LiveNavDomDriver` each frame
	// (via `style.setProperty`); the navigation is dispatched by the
	// orchestrator on commit-settle; the pager store writes flow from
	// the orchestrator's reactive publication. The component does not
	// use `detectSwipe` directly (it uses `navPipelinePointer` which
	// forwards to the orchestrator); there is no CSS transition on the
	// track; there is no `transitionend` handler; there is no
	// `pendingNav` rAF-poll.

	import type { Snippet } from 'svelte';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { getRouteData } from '$lib/utils/route-data';
	import { MOBILE_TABS, getCurrentTabIndex, getPreviewPanel } from '$lib/utils/route-config';
	import { viewportLock } from '$lib/stores/viewport-lock.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import {
		setActiveGestureTrack,
		clearActiveGestureTrack
	} from '$lib/stores/active-gesture-track.svelte';
	import {
		NavPipelineOrchestrator,
		setNavPipelineOrchestrator
	} from '$lib/stores/nav-pipeline-orchestrator.svelte';
	import { navPipelinePointer } from '$lib/actions/nav-pipeline-pointer';
	import LoadingChip from '$lib/components/atoms/LoadingChip.svelte';
	import { HEADER_MORPH_THRESHOLD } from '$lib/utils/gesture-constants';
	import { getNavigationStore } from '$lib/stores/navigation.svelte';

	interface NavPipelineHostProps {
		/** The pilot route's back-target. The orchestrator resolves a
		 *  plan for the back-swipe to this URL. */
		readonly leftHref: string;
		/** The tab index (0=discussions, 1=activity, 2=messages) the
		 *  pilot's centerTab is rendered on. Drives the tab-bar pill
		 *  interpolation published to the pager store. */
		readonly centerTab: number;
		/** The left preview snippet (MessagesPanel for the pilot). */
		readonly left?: Snippet;
		/** The conversation body. */
		readonly children: Snippet;
	}

	let { leftHref, centerTab, left, children }: NavPipelineHostProps = $props();

	const MOBILE_BREAKPOINT = '(max-width: 767px)';
	const getIsMobile = (): boolean => {
		if (typeof window === 'undefined') return page.data.isMobile ?? false;
		return window.matchMedia(MOBILE_BREAKPOINT).matches;
	};
	let isMobile = $state(getIsMobile());

	// Forward enter animation: if this mount is a forward SPA navigation
	// from `leftHref` (e.g. user tapped a conversation in /messages/inbox),
	// slide the track from the left-panel position (translateX(0)) to the
	// centre rest (translateX(-50%)) over ~200ms, matching GPL's
	// `enterRaf`. Computed at script init (before render) via
	// `navStore.activeStack` so there is no first-paint flash.
	const navStore = getNavigationStore();
	const shouldEnter: boolean = (() => {
		if (!isMobile) return false;
		const stack = navStore.activeStack;
		if (stack.length < 2) return false;
		return stack[stack.length - 2].pathname === leftHref;
	})();

	// Reactive read of the orchestrator's publication. The host's $effect
	// (below) re-publishes to the pager store so the existing FAB / Header
	// layers react identically to the GesturePageLayout path on non-pilot
	// routes. The orchestrator is the authority; the pager store is the
	// downstream consumer.
	const orchestrator = new NavPipelineOrchestrator();
	const scrollChrome = getScrollChromeStore();

	// Element refs. The track is the multi-panel container the driver
	// writes each frame; the centre panel is the scroll-chrome source;
	// the viewport is the pointer surface.
	let viewportEl: HTMLElement | null = $state(null);
	let trackEl: HTMLElement | null = $state(null);
	let leftEl: HTMLElement | null = $state(null);
	let centerEl: HTMLElement | null = $state(null);

	// The back-target's tab label (drives the chip icon/label and the
	// exit preview's `data-tab-panel`).
	const leftTabDef = $derived(MOBILE_TABS.find((tab) => tab.href === leftHref) ?? null);
	const leftPreviewTab = $derived(leftTabDef?.labelKey ?? null);
	// The chip-exit's target tab (set when the orchestrator publishes a
	// chipExit). Read off the publication so the LoadingChip shows the
	// right tab.
	const publication = $derived(orchestrator.publication);
	const chipExit = $derived(orchestrator.chipExit);
	const chipTargetPath = $derived(publication.toPathname ?? '');
	const chipTargetTab = $derived(
		chipTargetPath ? (MOBILE_TABS.find((tab) => tab.href === chipTargetPath) ?? null) : null
	);
	// Whether the chip overlay should render: only when chipExit is true
	// and the orchestrator is in flight. Replicates GPL's
	// `swipeNeedsLoadingAtStart && (dragOffset !== null ||
	// isPendingNavigation || isTransitioningOut)` shape.
	const chipVisible = $derived(chipExit && publication.inFlight);
	// GPL drives the chip's grow + label reveal from the drag width; on
	// the pilot's click-triggered chip-exit the executor's commit
	// progress stands in for the drag, so the chip grows and its label
	// reveals across the 200ms slide.
	const chipProgress = $derived(chipExit ? Math.max(0, Math.min(1, publication.progress ?? 0)) : 0);
	const chipScale = $derived(0.5 + chipProgress * 0.8);
	const chipMaxWidth = $derived(36 + chipProgress * 94);
	const chipTextMaxWidth = $derived(chipProgress * 70);

	// The track's geometry. Replicates GPL's multi-panel layout: the
	// track is `panelCount * 100%` wide, the panels are equal-width
	// columns, the centre panel is the right half. The driver writes
	// the transform inline via `style.setProperty`; the trackStyle
	// carries the structural CSS only (no transform, no transition).
	const panelCount = 2;

	// Publish the bound track element to the active-gesture-track store
	// so the existing FloatingActionButtonLayer's Family A sampler (if
	// any reads this surface) and any other ancestor consumer can follow
	// the track. Mirrors the GPL pattern.
	$effect(() => {
		if (trackEl) setActiveGestureTrack(trackEl);
	});

	// Register the centre panel as the scroll-chrome source on mobile.
	// Mirrors the GPL effect; the cleanup reverts the store to window.
	$effect(() => {
		if (!isMobile || !centerEl) return;
		const el = scrollChrome.override ?? centerEl;
		scrollChrome.setScrollContainer(el);
		return () => scrollChrome.releaseContainer(el);
	});

	// When the orchestrator lands (publication.plan goes null), reset the
	// pager store to the at-rest values so the FAB and Header layers
	// drop their in-flight state. The orchestrator publishes to the
	// pager store on every drag-move / commit rAF tick itself; the host
	// only owns the at-rest reset (the in-flight publication is the
	// orchestrator's responsibility).
	$effect(() => {
		if (publication.plan === null) {
			orchestrator.resetPagerStore();
		}
	});

	// Mount the orchestrator + acquire the viewport-lock + register
	// teardowns. Idempotent mount so a re-mount (HMR, route swap) rebinds
	// the element refs.
	let held = false;
	onMount(() => {
		const mq = window.matchMedia(MOBILE_BREAKPOINT);
		const sync = (): void => {
			isMobile = mq.matches;
			if (isMobile) {
				if (!held) {
					viewportLock.acquire();
					held = true;
				}
				window.scrollTo(0, 0);
			} else if (held) {
				viewportLock.release();
				held = false;
			}
		};
		sync();
		mq.addEventListener('change', sync);

		// ResizeObserver on the viewport so the host's reactive
		// `viewportWidth` stays in sync with the live dimensions and
		// propagates into the orchestrator's plan math (distance +
		// restingTranslate) via `updateViewport`. Without this the plan
		// would desync from the inline style on a resize.
		const ro = new ResizeObserver(() => {
			if (!viewportEl) return;
			orchestrator.updateViewport(viewportEl.clientWidth, -viewportEl.clientWidth);
		});
		if (viewportEl) ro.observe(viewportEl);

		// Resolve the from/to route tags + tab indices for the mount.
		// The driver writes ONLY the track transform; the FAB and Header
		// are owned by their existing layers (FloatingActionButtonLayer
		// and Header), which read the pager store the orchestrator
		// publishes to. Returning null for fab / header makes the driver
		// skip those elements, avoiding a double-write race with the
		// existing layers.
		const fromPathname = page.url.pathname;
		const fromData = getRouteData(fromPathname);
		const toData = getRouteData(leftHref);
		orchestrator.mount({
			resolveElements: () => ({
				pageTrack: trackEl,
				fab: null,
				header: null
			}),
			viewportWidth: viewportEl?.clientWidth ?? 0,
			restingTranslate: -(viewportEl?.clientWidth ?? 0),
			backTarget: leftHref,
			fromPathname,
			fromTag: fromData.tag,
			toTag: toData.tag,
			fromTabIndex: centerTab,
			toTabIndex: getCurrentTabIndex(leftHref),
			centerTab
		});
		setNavPipelineOrchestrator(orchestrator);

		// Forward enter animation: if this mount is a forward SPA nav from
		// leftHref, seed the track at translateX(0) (left panel visible)
		// then drive the slide to rest via the executor's rAF. Deferred to
		// the next rAF so the viewport has a measured clientWidth (the
		// executor's plan needs distance > 0). Uses the SAME writer (the
		// driver's setProperty) as gestures; a gesture starting mid-enter
		// cleanly interrupts the enter. No CSS animation (no parallel
		// mechanism; UNIFY invariant preserved).
		if (shouldEnter && trackEl) {
			trackEl.style.setProperty('transform', 'translateX(0px)');
			requestAnimationFrame(() => {
				const w = viewportEl?.clientWidth ?? 0;
				if (w > 0) {
					orchestrator.updateViewport(w, -w);
					orchestrator.playEnterAnimation();
				}
			});
		}

		// Reset any parent element's scroll that might have been changed
		// by browser's native anchor scrolling before fixed-viewport
		// locked the scroll. Mirrors GPL's pattern.
		let parent = viewportEl?.parentElement;
		while (parent) {
			if (parent.scrollTop !== 0) parent.scrollTop = 0;
			if (parent.scrollLeft !== 0) parent.scrollLeft = 0;
			parent = parent.parentElement;
		}

		return () => {
			mq.removeEventListener('change', sync);
			ro.disconnect();
			if (held) {
				viewportLock.release();
				held = false;
			}
		};
	});

	onDestroy(() => {
		if (!browser) return;
		// Tear down: clear the active-gesture-track publication, release
		// the viewport-lock, deactivate the orchestrator. The lifecycle
		// controller is the single SSR-safe teardown path.
		if (trackEl) clearActiveGestureTrack();
		if (held) {
			viewportLock.release();
			held = false;
		}
		setNavPipelineOrchestrator(null);
		orchestrator.unmount();
	});

	// The structural style: the track is `panelCount * 100%` wide and
	// a flex row of equal-width panels. The driver writes the transform
	// inline; the CSS does NOT carry a transform or transition (the
	// executor's rAF is the sole writer of the transform property).
	const viewportStyle = $derived(
		!isMobile
			? 'touch-action: auto; overflow: visible; height: auto; width: 100%; position: relative;'
			: 'touch-action: pan-y pinch-zoom; flex: 1 1 auto; height: 100%; position: relative; width: 100%; overflow: clip;'
	);
	const trackStyle = $derived(
		!isMobile
			? 'width: 100%; display: block;'
			: `width: ${panelCount * 100}%; display: flex; height: 100%;`
	);
	const sectionWidth = `${100 / panelCount}%`;
	const leftStyle = $derived(
		!isMobile
			? 'display: none;'
			: `width: ${sectionWidth}; height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain; touch-action: pan-y pinch-zoom;`
	);
	const centerStyle = $derived(
		!isMobile
			? 'width: 100%; display: block;'
			: `width: ${sectionWidth}; height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain; touch-action: pan-y pinch-zoom;`
	);

	// The pointer action's disabled gate: only on mobile, only when the
	// host has bound elements. Non-mobile (desktop) keeps the bridge
	// inert.
	const pointerDisabled = $derived(() => !isMobile || trackEl === null);

	// Initial track transform: at-rest at the resting translate. The
	// driver overwrites this on the first frame; setting it inline at
	// SSR time means the server-rendered HTML has the centre panel
	// filling the viewport (the FAB SSR style test asserts scale(0)
	// which the resting state produces via the FAB layer reading
	// pager.coverProgress at 0).
	// The track's resting transform: CSS `translateX(-50%)` so the
	// centre panel fills the viewport at SSR, before the browser
	// measures viewportWidth. The driver writes px-based transforms via
	// `style.setProperty` after hydration, overriding this CSS value.
	const initialTrackTransform = $derived(!isMobile ? '' : 'transform: translateX(-50%);');

	// HEADER_MORPH_THRESHOLD is published via the plan's `header`
	// function (the resolver's header plan reads progress in [0,1] and
	// the orchestrator's dragProgress already absorbs the 0.2 threshold
	// before publishing). The constant is imported so the host can
	// assert it in the future without recomputing.
	void HEADER_MORPH_THRESHOLD;
</script>

<div
	bind:this={viewportEl}
	class={isMobile ? 'overflow-clip h-full w-full' : ''}
	style={viewportStyle}
	use:navPipelinePointer={{ orchestrator, disabled: pointerDisabled }}
>
	<div
		bind:this={trackEl}
		data-testid="nav-pipeline-track"
		class={isMobile ? 'flex items-start h-full w-full' : 'h-full w-full'}
		style={trackStyle + ' ' + initialTrackTransform}
	>
		{#if isMobile && !chipExit}
			<section
				bind:this={leftEl}
				data-tab-panel={leftPreviewTab}
				class="shrink-0 scroll-pane md:hidden"
				style={leftStyle}
			>
				<div class="gpl-card">
					{#if left}
						{@render left()}
					{:else}
						{@const PreviewPanel = getPreviewPanel(leftHref)}
						{#if PreviewPanel}
							<PreviewPanel />
						{/if}
					{/if}
				</div>
			</section>
		{/if}
		<section
			bind:this={centerEl}
			class="shrink-0 scroll-pane detail-scroll-pane h-full w-full"
			style={centerStyle}
		>
			<div class="gpl-card">
				{@render children()}
			</div>
		</section>
	</div>

	{#if chipVisible}
		<div
			class="loading-overlay absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
		>
			<LoadingChip
				icon={chipTargetTab?.icon}
				label={chipTargetTab ? page.data.t.nav[chipTargetTab.labelKey] : page.data.t.nav.back}
				scale={chipScale}
				expanded={true}
				pulsing={true}
				dragging={false}
				opacity={1}
				maxWidth={chipMaxWidth}
				textMaxWidth={chipTextMaxWidth}
			/>
		</div>
	{/if}
</div>

<style>
	.loading-overlay {
		background-color: var(--color-base-200);
		overflow: visible;
	}
</style>
