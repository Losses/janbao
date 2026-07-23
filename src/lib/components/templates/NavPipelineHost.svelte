<script lang="ts">
	// src/lib/components/templates/NavPipelineHost.svelte
	//
	// The pipeline structural shell for the deep-page, thread, and
	// compose routes (the three tab roots mount `NavPipelineTabHost`
	// instead). Renders the multi-panel track / scroll-pane / snippet
	// slots / viewport-lock acquisition / scroll-chrome registration.
	//
	// Per the binding "UNIFY, DO NOT BRIDGE" constraint,
	// this component carries NO gesture / navigation state of its own.
	// The track's transform is written by `LiveNavDomDriver` each frame
	// (via `style.setProperty`); the navigation is dispatched by the
	// orchestrator on commit-settle; the pager store writes flow from
	// the orchestrator's reactive publication. The component does not
	// use `detectSwipe` directly (it uses `navPipelinePointer` which
	// forwards to the orchestrator); there is no CSS transition on the
	// track; there is no `transitionend` handler.

	import type { Snippet } from 'svelte';
	import type { VoidHandler } from '$lib/types/handlers';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { getRouteData } from '$lib/utils/route-data';
	import { MOBILE_TABS, getCurrentTabIndex, getPreviewPanel } from '$lib/utils/route-config';
	import { isTabRootPath, previousEntryPathname } from '$lib/utils/history-nav';
	import { viewportLock } from '$lib/stores/viewport-lock.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { getPageCacheStore } from '$lib/stores/page-cache.svelte';
	import {
		getGlobalNavPipelineOrchestrator,
		setNavPipelineOrchestrator,
		releaseNavPipelineOrchestrator
	} from '$lib/stores/nav-pipeline-orchestrator.svelte';
	import { navPipelinePointer } from '$lib/actions/nav-pipeline-pointer';
	import ActivityPanel from '$lib/components/panels/ActivityPanel.svelte';
	import DiscussionsPanel from '$lib/components/panels/DiscussionsPanel.svelte';
	import MessagesPanel from '$lib/components/panels/MessagesPanel.svelte';
	import MessagesSkeleton from '$lib/components/panels/MessagesSkeleton.svelte';
	import DeepPreviewSkeleton from '$lib/components/panels/DeepPreviewSkeleton.svelte';
	import { getNavigationStore } from '$lib/stores/navigation.svelte';
	import type { PageUrlBuilder } from '$lib/types/tabs';

	interface NavPipelineHostProps {
		/** The route's back-target. The orchestrator resolves a plan for
		 *  the back-swipe to this URL. */
		readonly leftHref: string;
		/** The tab index (0=discussions, 1=activity, 2=messages) the
		 *  route's centerTab is rendered on. Drives the tab-bar pill
		 *  interpolation published to the pager store. Undefined for
		 *  deep pages (bookmarks, profile/*, admin/*, etc.) which have
		 *  no tab of their own; the orchestrator falls back to the
		 *  route's URL-derived tab index. */
		readonly centerTab?: number;

		/** The conversation body. */
		readonly children: Snippet;
	}

	let { leftHref, centerTab, children }: NavPipelineHostProps = $props();

	const MOBILE_BREAKPOINT = '(max-width: 767px)';
	// isMobile seeds from the server's UA-derived value so SSR and the first
	// client render agree (no hydration mismatch); onMount's sync flips it to
	// the live matchMedia value (the repo pattern used by the (tabs) layout
	// and the search page).
	let isMobile = $state(page.data.isMobile ?? false);

	// Forward enter animation: if this mount is a forward SPA navigation
	// from `leftHref` (e.g. user tapped a conversation in /messages/inbox),
	// slide the track from the left-panel position (translateX(0)) to the
	// centre rest (translateX(-33.333%)) over ~300ms (COMMIT_T_DEFAULT_MS).
	// The enter check (`shouldEnter` below) is a lazy `$derived.by` that
	// reads `navStore.activeStack`; it is evaluated in onMount, not at
	// script init. The no-first-paint-flash comes from onMount's
	// synchronous `translateX(0px)` seed on the track (written before the
	// executor's rAF starts the slide), not from eager script-init
	// evaluation.
	const navStore = getNavigationStore();

	// The resolved back-target: follows the live navigation stack so a
	// back-swipe lands on the correct entry (the tab root or structural
	// parent the user actually came from). Falls back to the static
	// leftHref prop when the stack has no prior entry.
	const resolvedLeftHref = $derived.by<string>(() => {
		// Prefer the real browser-history previous entry so a thread reached
		// cross-tab backs to the source (macro §3: a thread reached from
		// elsewhere backs to where the user came from), not the synthetic
		// navStore stack which re-seeds to the tab root on a cross-tab
		// landing. For a thread reached from its own list the two agree.
		const prev = previousEntryPathname();
		if (prev) return prev;
		const bt = navStore.backTarget;
		if (!bt) return leftHref;
		const queryIdx = bt.indexOf('?');
		return queryIdx >= 0 ? bt.slice(0, queryIdx) : bt;
	});

	// The shared singleton orchestrator. Every mobile host reaches the same
	// instance via `getGlobalNavPipelineOrchestrator`; the host calls
	// `configure` on mount and `releaseInputs` on destroy so the
	// singleton's executor + driver + rAF persist across the route swap.
	// The orchestrator publishes the in-flight pager state itself (every
	// drag-move / commit rAF tick); the host's $effect below only handles
	// the at-rest reset (when the publication's plan goes null). The
	// orchestrator is the authority; the pager store is the downstream
	// consumer.
	const orchestrator = getGlobalNavPipelineOrchestrator();
	const scrollChrome = getScrollChromeStore();

	// Element refs. The track is the multi-panel container the driver
	// writes each frame; the centre panel is the scroll-chrome source;
	// the viewport is the pointer surface.
	let viewportEl: HTMLElement | null = $state(null);
	let trackEl: HTMLElement | null = $state(null);
	let leftEl: HTMLElement | null = $state(null);
	let centerEl: HTMLElement | null = $state(null);
	let rightEl: HTMLElement | null = $state(null);

	// The in-flight publication. toPathname identifies the transition's
	// target, so the left panel can render that tab's real panel (when its
	// data is cached) or its skeleton. A cross-type interrupt (e.g. a
	// gesture starting mid tab-click) flips the target, so the left-panel
	// content swaps to the new target's panel mid-slide; the geometry stays
	// continuous (the orchestrator's #startProgressFromCurrentVisual hands
	// off with no jump). The content swap is expected - the panel reflects
	// whichever transition is in flight.
	const publication = $derived(orchestrator.publication);
	// Forward enter animation: play only on a FORWARD SPA nav whose previous
	// entry is this route's resolved back-target (a popstate-back sets
	// direction='backward' and must skip the slide-in). A $derived so it
	// re-evaluates after onMount's sync flips isMobile to the live matchMedia
	// value; the onMount enter check reads the post-flip value, not the
	// UA-derived seed.
	// The check uses `resolvedLeftHref` (which follows the live navigation
	// stack via `previousEntryPathname()` / `navStore.backTarget`) rather
	// than the static `leftHref` prop: a route like `/profile/edit` has
	// `leftHref = /profile/settings` (its structural parent), but the user
	// may have arrived from `/` or `/messages/inbox`. Matching against the
	// resolved back-target makes the enter slide play for every real
	// source route, so the FAB scale (which reads the orchestrator's
	// publication during the enter) transitions across every list -> deep
	// boundary, not only the structural one.
	// Suppressed when the orchestrator's `lastDispatchWasDeepToDeep`
	// publication is true: a deep-to-deep nav (e.g. /profile/settings ->
	// /profile/password) was intercepted on the source host and the slide
	// already played there. The orchestrator sets the flag in the
	// interception branch and clears it in `#landAtRest` (which runs in
	// afterNavigate, AFTER this onMount read), so the flag is still true
	// here.
	const shouldEnter = $derived.by<boolean>(() => {
		if (!isMobile) return false;
		if (navStore.direction !== 'forward') return false;
		const stack = navStore.activeStack;
		if (stack.length < 2) return false;
		if (publication.lastDispatchWasDeepToDeep) return false;
		return stack[stack.length - 2].pathname === resolvedLeftHref;
	});
	// Stable views of the publication's plan / in-flight flag. The
	// orchestrator publishes a new publication object each frame of a
	// drag (the progress advances), but the plan reference and the
	// in-flight boolean are stable mid-transition; deriving them here
	// means $effects that only care whether a transition is in flight
	// (not its per-frame progress) do not re-run every frame.
	const publicationPlan = $derived(publication.plan);
	const publicationInFlight = $derived(publication.inFlight);
	// The transition target (null at rest / when no transition is in
	// flight). The left panel renders the back-target's panel at rest and
	// during a back-swipe; it renders a different tab's panel when the
	// transition targets that tab.
	const transitionTarget = $derived(publication.inFlight ? publication.toPathname : null);
	// The pathname whose panel the left slot renders: the transition's
	// target when it is a tab root other than the back-target, else the
	// back-target.
	const crossTabPanelPath = $derived.by<string | null>(() => {
		const target = transitionTarget;
		if (target === null) return null;
		if (!isTabRootPath(target) || target === resolvedLeftHref) return null;
		return target;
	});
	const leftPanelPathname = $derived(crossTabPanelPath ?? resolvedLeftHref);
	// Forward deep-to-deep: the in-flight transition is a detail -> detail
	// push intercepted by the orchestrator (the source is a deep page). The
	// RIGHT panel renders a skeleton for the destination; the real content
	// mounts on landing. Null when no transition is in flight, the target is
	// a tab root, or the source is a tab root (a tab -> deep forward-enter:
	// the LEFT panel shows the source's panel via leftPanelPathname below,
	// and the RIGHT panel stays empty).
	const forwardDeepTarget = $derived.by<string | null>(() => {
		const target = transitionTarget;
		if (target === null) return null;
		// Only a forward deep-to-deep push renders the destination skeleton
		// in the RIGHT panel. A backward deep-to-deep back-swipe reveals
		// the back-target via the LEFT panel (its cached preview panel
		// renders via leftPanelPathname below), so it must not be
		// classified as a forward deep-to-deep.
		if (publication.direction !== 'forward') return null;
		if (isTabRootPath(target)) return null;
		// Only a deep-to-deep interception (`lastDispatchWasDeepToDeep` true)
		// renders the destination skeleton. A tab -> deep `playEnterAnimation`
		// (the flag false) shows the source panel via `leftPanelPathname`
		// below. The handshake flag is set in the orchestrator's
		// deep-to-deep interception branch and is the authoritative signal
		// that the slide already played on the source host.
		if (!publication.lastDispatchWasDeepToDeep) return null;
		return target;
	});
	// The left panel's tab label.
	const leftPanelTab = $derived(
		MOBILE_TABS.find((tab) => tab.href === leftPanelPathname)?.labelKey ?? null
	);

	// Cached scroll positions for the left (back-target) and centre
	// (conversation) panels, restored on mount / re-entry so a back-swipe
	// preview shows the list at its last scroll position. The left
	// restore is gated to the back-target being the rendered panel: when
	// the slide reveals a different tab (crossTabPanelPath), that panel
	// is fresh content, so the back-target's cached scroll does not apply.
	const pageCache = getPageCacheStore();
	const leftScrollTop = $derived(
		crossTabPanelPath === null ? (pageCache.get(resolvedLeftHref)?.scrollTop ?? 0) : 0
	);
	const currentScrollTop = $derived(
		page.url.pathname ? (pageCache.get(page.url.pathname)?.scrollTop ?? 0) : 0
	);

	// The track is always 3 panels: LEFT (the back-target's panel, or
	// another tab's real panel / skeleton), CENTER (the conversation), and
	// RIGHT (a forward deep-to-deep destination's skeleton). A forward
	// deep-to-deep push (axis='left') slides the track left so the RIGHT
	// panel enters from the right edge; a backward swipe (axis='right')
	// slides it right so the LEFT panel enters from the left edge. The
	// slide geometry is the same for a back-target reveal and a cross-tab
	// interrupt, so a handoff never jumps.
	const panelCount = 3;

	// Page-url builder for a DiscussionsPanel rendered as a tab preview
	// (matches the home route's pagination scheme).
	const discussionsBuildPageUrl: PageUrlBuilder = (p) => (p === 1 ? '/' : `/discussions/p${p}`);

	// Restore a panel's cached scroll position: set it immediately and
	// again on the next frame. Setting scrollTop programmatically
	// does not fire `onscroll`, so this cannot loop. Returns a rAF cleanup
	// so an `$effect` can use it directly.
	const restoreScroll = (el: HTMLElement | null, top: number): VoidHandler => {
		if (el && top > 0) {
			el.scrollTop = top;
			const rafId = requestAnimationFrame(() => {
				if (el) el.scrollTop = top;
			});
			return () => cancelAnimationFrame(rafId);
		}
		return () => {};
	};
	$effect(() => restoreScroll(leftEl, leftScrollTop));
	$effect(() => restoreScroll(centerEl, currentScrollTop));
	// When the slide reveals a different tab's panel (crossTabPanelPath),
	// the `<section>` element is stable across the content swap, so its
	// scrollTop would otherwise inherit the inbox preview's restored
	// position; reset it to 0 so the target panel starts at the top (no
	// stale-scroll jump on landing).
	$effect(() => {
		if (crossTabPanelPath !== null && leftEl) leftEl.scrollTop = 0;
	});

	// Register the centre panel as the scroll-chrome source on mobile.
	// The cleanup reverts the store to window.
	$effect(() => {
		if (!isMobile || !centerEl) return;
		const el = scrollChrome.override ?? centerEl;
		scrollChrome.setScrollContainer(el);
		return () => scrollChrome.releaseContainer(el);
	});

	// When the orchestrator lands (publication.plan goes null), reset the
	// pager store to the at-rest values so the Header layer drops its
	// in-flight state. The FAB's in-flight state is dropped separately
	// by its own reactive derivation re-evaluating when
	// `publication.plan` becomes null (the FAB reads
	// `orchestrator.publication` directly, not the pager store). The
	// orchestrator publishes to the pager store on every drag-move /
	// commit rAF tick itself; the host only owns the at-rest reset (the
	// in-flight publication is the orchestrator's responsibility).
	// Tracks whether the orchestrator has run at least one transition on
	// this mount. The at-rest $effect uses it to distinguish a real
	// settle (re-apply the resting -33.333% to correct a stale px) from
	// the initial mount (leave the forward-enter seed at translateX(0px)).
	let sawTransition = false;
	$effect(() => {
		if (publicationPlan !== null) {
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
		// ResizeObserver skipped its -33.333% re-apply while plan !== null,
		// so the driver's last px write would otherwise strand the track
		// off-centre on the new width.
		if (sawTransition && trackEl) {
			trackEl.style.transform = 'translateX(-33.333%)';
		}
	});
	// Keep the orchestrator's from-pathname in sync with same-route param
	// changes (/messages/123 -> /messages/456) that reuse this host
	// without remounting, so a subsequent tab-exit is still owned
	// (#isPipelineFrom matches the live pathname, not the stale mount one).
	$effect(() => {
		const pathname = page.url.pathname;
		// Skip during an in-flight transition (the dispatch's URL change
		// would corrupt fromPathname; the host unmounts before it matters).
		if (orchestratorMounted && !publicationInFlight) orchestrator.updateFromPathname(pathname);
	});
	// Keep the orchestrator's back-target in sync with the live navigation
	// stack so a back-swipe lands on the correct entry (the user's actual
	// previous tab, not the static leftHref default).
	$effect(() => {
		// Skip during an in-flight transition (the orchestrator's method
		// guards against this too, but the early return avoids re-deriving
		// the mount inputs mid-transition).
		if (orchestratorMounted && !publicationInFlight) {
			orchestrator.updateBackTarget(resolvedLeftHref);
		}
	});

	// Mount the orchestrator + acquire the viewport-lock + register
	// teardowns. `configure` rebinds the element refs on each call so a
	// re-mount (HMR) or a desktop -> mobile re-entry picks up the live
	// `bind:this` values.
	let held = false;
	let orchestratorMounted = $state(false);
	// Light teardown for a route-away destroy: drop the inputs +
	// deactivate. The singleton's executor + driver + rAF persist for the
	// next mobile host's configure (the route swap rebinds in place).
	// Idempotent: guarded by `orchestratorMounted` so a destroy that
	// follows a desktop flip (already unmounted via `unmountOrchestrator`)
	// is a no-op.
	const releaseOrchestrator = (): void => {
		if (!orchestratorMounted) return;
		orchestrator.releaseInputs();
		releaseNavPipelineOrchestrator(orchestrator);
		orchestratorMounted = false;
	};
	onMount(() => {
		const mq = window.matchMedia(MOBILE_BREAKPOINT);

		// The gesture pipeline is mobile-only (Plan §Scope). Configure +
		// register the orchestrator on mobile; tear down + clear on desktop.
		// Called both for the initial platform and on a mobile <-> desktop
		// resize, so a session that crosses platforms does not leave the
		// orchestrator active on desktop (where it would consume tab-clicks
		// and write track transforms). On a mid-gesture/commit resize to
		// desktop, `unmountOrchestrator` aborts the in-flight transition
		// (stops the rAF, no dispatch) and clears the track transform. A
		// route-away destroy (component onDestroy) takes the lighter
		// `releaseOrchestrator` path so the singleton persists for the next
		// mobile host.
		const mountOrchestrator = (): void => {
			if (orchestratorMounted || !trackEl || !viewportEl) return;
			const fromPathname = page.url.pathname;
			const fromData = getRouteData(fromPathname);
			const toData = getRouteData(resolvedLeftHref);
			orchestrator.configure({
				resolveElements: () => ({ pageTrack: trackEl, fab: null, header: null }),
				viewportWidth: viewportEl.clientWidth,
				restingTranslate: -viewportEl.clientWidth,
				backTarget: resolvedLeftHref,
				fromPathname,
				fromTag: fromData.tag,
				toTag: toData.tag,
				fromTabIndex: centerTab ?? getCurrentTabIndex(fromPathname),
				toTabIndex: getCurrentTabIndex(resolvedLeftHref),
				centerTab
			});
			setNavPipelineOrchestrator(orchestrator);
			orchestratorMounted = true;
		};
		// Full teardown for the mobile -> desktop flip: the host stays
		// mounted but the gesture surface leaves the mobile breakpoint.
		// The singleton's executor + driver are torn down; a subsequent
		// desktop -> mobile flip reconstructs them on the next configure.
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
				// transition (the mobile->desktop analogue of commit-settle)
				// before the orchestrator is torn down. A route-away destroy
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
			// otherwise stay stale. Only when at-rest; an in-flight
			// transition keeps its locked plan and
			// picks up the new width on the next transition.
			if (isMobile && publication.plan === null && trackEl) {
				trackEl.style.transform = 'translateX(-33.333%)';
			}
		});
		if (viewportEl) ro.observe(viewportEl);

		// Forward enter animation (initial mount only): if this mount is a
		// forward SPA nav from leftHref, seed the track at translateX(0)
		// (left panel visible) then drive the slide to rest via the
		// executor's rAF. Called synchronously in onMount (the DOM is
		// mounted so clientWidth is available). Not replayed on a
		// resize-remount (a resize is not a forward navigation).
		if (isMobile && shouldEnter && trackEl) {
			trackEl.style.setProperty('transform', 'translateX(0px)');
			// Called synchronously in onMount: the DOM is mounted so
			// clientWidth is available, and starting the enter plan here
			// means executor.activePlan is non-null before any tab-click's
			// beforeNavigate can arrive (no seed/plan race window).
			const w = viewportEl?.clientWidth ?? 0;
			if (w > 0) {
				orchestrator.updateViewport(w, -w);
				orchestrator.playEnterAnimation();
			}
		}

		// Reset any parent element's scroll that might have been changed
		// by browser's native anchor scrolling before fixed-viewport
		// locked the scroll.
		let parent = viewportEl?.parentElement;
		while (parent) {
			if (parent.scrollTop !== 0) parent.scrollTop = 0;
			if (parent.scrollLeft !== 0) parent.scrollLeft = 0;
			parent = parent.parentElement;
		}

		return () => {
			mq.removeEventListener('change', sync);
			ro.disconnect();
			// A route-away destroy takes the light path so the singleton's
			// executor + driver persist for the next mobile host. A desktop
			// flip already called `unmountOrchestrator` (clearing
			// `orchestratorMounted`); this is a no-op in that case.
			releaseOrchestrator();
			if (held) {
				viewportLock.release();
				held = false;
			}
		};
	});

	onDestroy(() => {
		if (!browser) return;
		// Route-away destroy: release the viewport-lock and the singleton's
		// per-host inputs (the executor + driver persist for the next mobile
		// host). Each release is guarded by `browser` (onDestroy also runs
		// in SSR). `releaseOrchestrator` is idempotent with the onMount
		// cleanup above.
		if (held) {
			viewportLock.release();
			held = false;
		}
		releaseOrchestrator();
	});

	// The structural style: the track is `panelCount * 100%` wide and
	// a flex row of equal-width panels. The CSS carries no transition
	// (the slide is written by the executor via `LiveNavDomDriver`:
	// synchronously per pointermove during a drag, and via the executor's
	// rAF during a commit/cancel slide; never a CSS transition).
	// The transform is written by `LiveNavDomDriver` each frame, and also
	// by the SSR seed (`initialTrackTransform`), the at-rest `$effect`,
	// and the forward-enter seed when at rest.
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
	// The RIGHT panel mirrors CENTER's mobile sizing (a scroll-pane that
	// fills its third of the track) and is hidden on desktop alongside
	// LEFT. Content is rendered only for a forward deep-to-deep push
	// (forwardDeepTarget); at rest the panel is empty.
	const rightStyle = $derived(centerStyle);

	// The pointer action's disabled gate: only on mobile, only when the
	// host has bound elements. Non-mobile (desktop) keeps the bridge
	// inert.
	const pointerDisabled = (): boolean => !isMobile || trackEl === null;

	// Initial track transform: at-rest at the resting translate. The
	// driver overwrites this on the first frame; setting it inline at
	// SSR time means the server-rendered HTML has the centre panel
	// filling the viewport. The FAB layer's at-rest scale reads
	// `getRouteData(page.url.pathname).fab ? 1 : 0` (1 on a FAB route,
	// 0 on a non-FAB route), not the pager store.
	// The track's resting transform: CSS `translateX(-33.333%)` so the
	// centre panel (the middle third of a 3*W track) fills the viewport
	// at SSR, before the browser measures viewportWidth. The driver
	// writes px-based transforms via `style.setProperty` after
	// hydration, overriding this CSS value.
	const initialTrackTransform = $derived(!isMobile ? '' : 'transform: translateX(-33.333%);');
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
				bind:this={leftEl}
				data-tab-panel={leftPanelTab}
				class="shrink-0 scroll-pane md:hidden"
				style={leftStyle}
				onscroll={(e) => {
					if (crossTabPanelPath === null && e.currentTarget.scrollTop > 0) {
						pageCache.capture(resolvedLeftHref, undefined, {
							scrollTop: e.currentTarget.scrollTop
						});
					}
				}}
			>
				<div class="gpl-card">
					<!-- When the slide reveals another tab, the left panel
					     renders that tab's real panel from the eager-loaded
					     root-layout data. Activity and Discussions lists are
					     always present: the root layout's Promise.allSettled
					     returns truthy EMPTY_* objects on rejection (never
					     null), so page.data.activity and page.data.home are
					     always truthy and the panel renders the real list, or
					     the truthy-but-empty EMPTY_* on a partial-load failure.
					     The panels render with paginate={true} to match the
					     landing tab page (DiscussionsPanel /
					     ActivityPanel), so the preview is faithful when
					     totalPages > 1. The messages case additionally guards
					     against the array shadow: on `/messages/[id]` the
					     route's message-row array replaces
					     page.data.messages, so the panel cannot render and
					     MessagesSkeleton stands in until the back-swipe lands.
					     A forward deep-to-deep push does NOT render here: the
					     LEFT panel keeps the back-target content and the
					     destination skeleton renders in the RIGHT panel
					     (forwardDeepTarget branch below). -->
					{#if leftPanelPathname === '/activity'}
						<ActivityPanel
							activities={page.data.activity.activities}
							currentPage={page.data.activity.page}
							totalPages={page.data.activity.totalPages}
							activityDraft={page.data.activity.activityDraft}
							mentionedUsers={page.data.activity.mentionedUsers}
							t={page.data.t}
							user={page.data.user}
							paginate={true}
						/>
					{:else if leftPanelPathname === '/'}
						<DiscussionsPanel
							discussions={page.data.home.discussions}
							currentPage={page.data.home.page}
							totalPages={page.data.home.totalPages}
							t={page.data.t}
							buildPageUrl={discussionsBuildPageUrl}
							paginate={true}
						/>
					{:else if leftPanelPathname === '/messages/inbox'}
						{#if page.data.messages && !Array.isArray(page.data.messages)}
							<MessagesPanel
								conversations={page.data.messages.conversations}
								currentPage={page.data.messages.page}
								totalPages={page.data.messages.totalPages}
								t={page.data.t}
								paginate={true}
							/>
						{:else}
							<!-- The inbox list object is the root-layout
							     `messages` data; on `/messages/[id]` that key
							     is shadowed by the route's message-row array,
							     so the preview falls back to a skeleton and
							     the real inbox loads on land. -->
							<MessagesSkeleton />
						{/if}
					{:else}
						{@const PreviewPanel = getPreviewPanel(resolvedLeftHref)}
						{#if PreviewPanel}
							<PreviewPanel />
						{:else}
							<DeepPreviewSkeleton />
						{/if}
					{/if}
				</div>
			</section>
		{/if}
		<section
			bind:this={centerEl}
			class="shrink-0 scroll-pane detail-scroll-pane h-full w-full"
			style={centerStyle}
			onscroll={(e) => {
				if (e.currentTarget.scrollTop > 0) {
					pageCache.capture(page.url.pathname, undefined, {
						scrollTop: e.currentTarget.scrollTop
					});
				}
			}}
		>
			<div class="gpl-card">
				{@render children()}
			</div>
		</section>
		{#if isMobile}
			<section bind:this={rightEl} class="shrink-0 scroll-pane md:hidden" style={rightStyle}>
				<div class="gpl-card">
					{#if forwardDeepTarget !== null}
						<!-- Forward deep-to-deep push: the slide reveals the
						     destination's skeleton in the RIGHT panel; the
						     track slides left (resolver axis='left') so the
						     RIGHT panel enters from the right edge. The real
						     content + its data mount on navigation land via
						     SvelteKit's `load` (this layer shows the skeleton
						     and does not preload). -->
						<DeepPreviewSkeleton />
					{:else}
						<!-- No forward deep-to-deep in flight: the RIGHT panel
						     is empty placeholder; the track rests with CENTER
						     filling the viewport. -->
					{/if}
				</div>
			</section>
		{/if}
	</div>
</div>
