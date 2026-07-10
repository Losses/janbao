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
		setNavPipelineOrchestrator,
		releaseNavPipelineOrchestrator
	} from '$lib/stores/nav-pipeline-orchestrator.svelte';
	import { navPipelinePointer } from '$lib/actions/nav-pipeline-pointer';
	import ActivityPanel from '$lib/components/panels/ActivityPanel.svelte';
	import ActivitySkeleton from '$lib/components/panels/ActivitySkeleton.svelte';
	import DiscussionsPanel from '$lib/components/panels/DiscussionsPanel.svelte';
	import DiscussionsSkeleton from '$lib/components/panels/DiscussionsSkeleton.svelte';
	import { getNavigationStore } from '$lib/stores/navigation.svelte';
	import type { PageUrlBuilder } from '$lib/types/tabs';

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

	// Constructed fresh per mount. The orchestrator publishes the in-flight
	// pager state itself (every drag-move / commit rAF tick); the host's
	// $effect below only handles the at-rest reset (when the publication's
	// plan goes null). The orchestrator is the authority; the pager store
	// is the downstream consumer.
	const orchestrator = new NavPipelineOrchestrator();
	const scrollChrome = getScrollChromeStore();

	// Element refs. The track is the multi-panel container the driver
	// writes each frame; the centre panel is the scroll-chrome source;
	// the viewport is the pointer surface.
	let viewportEl: HTMLElement | null = $state(null);
	let trackEl: HTMLElement | null = $state(null);
	let centerEl: HTMLElement | null = $state(null);

	// The back-target's tab label (drives the exit preview's data-tab-panel
	// when there is no chip-exit target).
	const leftTabDef = $derived(MOBILE_TABS.find((tab) => tab.href === leftHref) ?? null);
	const leftPreviewTab = $derived(leftTabDef?.labelKey ?? null);
	// The in-flight publication. chipExit + toPathname identify a cross-tab
	// exit's target, so the left panel can render that tab's real panel
	// (when its data is cached) or its skeleton. A cross-type interrupt
	// (e.g. a gesture starting mid chip-exit tab-click) flips the target,
	// so the left-panel content swaps to the new target's panel mid-slide;
	// the GEOMETRY stays continuous (the orchestrator's
	// #startProgressFromCurrentVisual hands off with no jump). The content
	// swap is expected - the panel reflects whichever transition is in
	// flight.
	const publication = $derived(orchestrator.publication);
	const chipExit = $derived(orchestrator.chipExit);
	const chipExitTarget = $derived(chipExit ? publication.toPathname : null);
	// The left panel's tab label: the chip-exit target's label during a
	// cross-tab exit, else the back-target's.
	const leftPanelTab = $derived(
		chipExitTarget
			? (MOBILE_TABS.find((tab) => tab.href === chipExitTarget)?.labelKey ?? null)
			: leftPreviewTab
	);

	// The track is always 2 panels: the left (the back-target's panel, or a
	// chip-exit target's real panel / skeleton) + the centre (conversation).
	// A chip-exit uses the SAME 2-panel geometry as a direct slide, so a
	// cross-geometry interrupt handoff never jumps.
	const panelCount = 2;

	// Page-url builder for a DiscussionsPanel rendered as a chip-exit preview
	// (matches the home route's pagination scheme).
	const discussionsBuildPageUrl: PageUrlBuilder = (p) => (p === 1 ? '/' : `/discussions/p${p}`);

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
	// Tracks whether the orchestrator has run at least one transition on
	// this mount. The at-rest $effect uses it to distinguish a real
	// settle (re-apply the resting -50% to correct a stale px) from the
	// initial mount (leave the forward-enter seed at translateX(0px)).
	let sawTransition = false;
	$effect(() => {
		if (publication.plan !== null) {
			sawTransition = true;
			return;
		}
		if (!isMobile) return;
		// Refresh the viewport dims + pager at rest.
		if (viewportEl) {
			orchestrator.updateViewport(viewportEl.clientWidth, -viewportEl.clientWidth);
		}
		orchestrator.resetPagerStore();
		// Re-apply the resting transform as a PERCENTAGE only after a
		// transition has settled (not at initial mount, where the
		// forward-enter seed at translateX(0px) must survive). This
		// corrects a resize that arrived during the transition: the
		// ResizeObserver skipped its -50% re-apply while plan !== null, so
		// the driver's last px write would otherwise strand the track
		// off-centre on the new width.
		if (sawTransition && trackEl) {
			trackEl.style.transform = 'translateX(-50%)';
		}
	});
	// Keep the orchestrator's from-pathname in sync with same-route param
	// changes (/messages/123 -> /messages/456) that reuse this host
	// without remounting, so a subsequent tab-exit is still owned
	// (#isPilotFrom matches the live pathname, not the stale mount one).
	$effect(() => {
		const pathname = page.url.pathname;
		if (orchestratorMounted) orchestrator.updateFromPathname(pathname);
	});

	// Mount the orchestrator + acquire the viewport-lock + register
	// teardowns. Idempotent mount so a re-mount (HMR, route swap) rebinds
	// the element refs.
	let held = false;
	let orchestratorMounted = false;
	onMount(() => {
		const mq = window.matchMedia(MOBILE_BREAKPOINT);

		// The gesture pipeline is mobile-only (Plan §Scope). Mount +
		// register the orchestrator on mobile; unmount + clear on desktop.
		// Called both for the initial platform and on a mobile <-> desktop
		// resize, so a session that crosses platforms does not leave the
		// orchestrator active on desktop (where it would consume tab-clicks
		// and write track transforms). On a mid-gesture/commit resize to
		// desktop, unmount aborts the in-flight transition (stops the rAF,
		// no dispatch) and clears the track transform.
		const mountOrchestrator = (): void => {
			if (orchestratorMounted || !trackEl || !viewportEl) return;
			const fromPathname = page.url.pathname;
			const fromData = getRouteData(fromPathname);
			const toData = getRouteData(leftHref);
			orchestrator.mount({
				resolveElements: () => ({ pageTrack: trackEl, fab: null, header: null }),
				viewportWidth: viewportEl.clientWidth,
				restingTranslate: -viewportEl.clientWidth,
				backTarget: leftHref,
				fromPathname,
				fromTag: fromData.tag,
				toTag: toData.tag,
				fromTabIndex: centerTab,
				toTabIndex: getCurrentTabIndex(leftHref),
				centerTab
			});
			setNavPipelineOrchestrator(orchestrator);
			orchestratorMounted = true;
		};
		const unmountOrchestrator = (): void => {
			if (!orchestratorMounted) return;
			orchestrator.unmount();
			releaseNavPipelineOrchestrator(orchestrator);
			// Clear any transform a gesture/commit wrote so the desktop
			// track (which carries no inline transform) is not left
			// off-screen.
			if (trackEl) trackEl.style.transform = '';
			orchestratorMounted = false;
		};

		const sync = (): void => {
			isMobile = mq.matches;
			if (isMobile) {
				if (!held) {
					viewportLock.acquire();
					held = true;
				}
				mountOrchestrator();
				window.scrollTo(0, 0);
			} else {
				// A mobile->desktop flip: land an in-flight committed
				// transition (matches GPL's pendingNav wall-clock cap) before
				// the orchestrator is torn down. A route-away unmount
				// (onDestroy) does NOT do this, so the user's fresh nav wins.
				if (orchestratorMounted) orchestrator.recoverDesktopFlipNav();
				unmountOrchestrator();
				if (held) {
					viewportLock.release();
					held = false;
				}
			}
		};
		sync();
		mq.addEventListener('change', sync);

		// ResizeObserver on the viewport so the orchestrator's plan math
		// (distance + restingTranslate) stays in sync with the live
		// dimensions via `updateViewport`. On desktop the orchestrator is
		// not mounted, so updateViewport is a no-op.
		const ro = new ResizeObserver(() => {
			if (!viewportEl) return;
			const w = viewportEl.clientWidth;
			orchestrator.updateViewport(w, -w);
			// On a mobile-only resize (portrait <-> landscape, both
			// <767px) AFTER a transition settled, re-apply the resting
			// transform as a PERCENTAGE so it scales with the new width.
			// The driver's last px write (translateX(-Wpx)) would
			// otherwise stay stale (GPL uses -50% which scales). Only when
			// at-rest; an in-flight transition keeps its locked plan and
			// picks up the new width on the next transition.
			if (isMobile && publication.plan === null && trackEl) {
				trackEl.style.transform = 'translateX(-50%)';
			}
		});
		if (viewportEl) ro.observe(viewportEl);

		// Forward enter animation (initial mount only): if this mount is a
		// forward SPA nav from leftHref, seed the track at translateX(0)
		// (left panel visible) then drive the slide to rest via the
		// executor's rAF. Deferred to the next rAF so the viewport has a
		// measured clientWidth. Not replayed on a resize-remount (a resize
		// is not a forward navigation).
		if (isMobile && shouldEnter && trackEl) {
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
			unmountOrchestrator();
			if (held) {
				viewportLock.release();
				held = false;
			}
		};
	});

	onDestroy(() => {
		if (!browser) return;
		// Tear down: clear the active-gesture-track publication, release
		// the viewport-lock, deactivate the orchestrator. Each release is
		// guarded by `browser` (onDestroy also runs in SSR).
		if (trackEl) clearActiveGestureTrack();
		if (held) {
			viewportLock.release();
			held = false;
		}
		releaseNavPipelineOrchestrator(orchestrator);
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
	const sectionWidth = $derived(`${100 / panelCount}%`);
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
		{#if isMobile}
			<section
				data-tab-panel={leftPanelTab}
				class="shrink-0 scroll-pane md:hidden"
				style={leftStyle}
			>
				<div class="gpl-card">
					<!-- The chip-exit reveals the target's REAL panel from the
					     eager-loaded root-layout data. The skeleton renders
					     when the eager load rejected (Promise.allSettled); the
					     two chip-exit targets (/ and /activity) are
					     eager-loaded on every route, so the skeleton is a
					     degraded-mode fallback. -->
					{#if chipExitTarget === '/activity'}
						{#if page.data.activity}
							<ActivityPanel
								activities={page.data.activity.activities}
								currentPage={page.data.activity.page}
								totalPages={page.data.activity.totalPages}
								activityDraft={page.data.activity.activityDraft}
								mentionedUsers={page.data.activity.mentionedUsers}
								t={page.data.t}
								user={page.data.user}
								paginate={false}
							/>
						{:else}
							<ActivitySkeleton />
						{/if}
					{:else if chipExitTarget === '/'}
						{#if page.data.home}
							<DiscussionsPanel
								discussions={page.data.home.discussions}
								currentPage={page.data.home.page}
								totalPages={page.data.home.totalPages}
								t={page.data.t}
								buildPageUrl={discussionsBuildPageUrl}
								paginate={false}
							/>
						{:else}
							<DiscussionsSkeleton />
						{/if}
					{:else if left}
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
</div>
