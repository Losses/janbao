<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Header from '$lib/components/organisms/Header.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { captureSwipe, detectSwipe } from '$lib/actions/swipe';
	import { MOBILE_TABS, getCurrentTabIndex } from '$lib/utils/mobile-tabs';
	import type { UserInfoSummary } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface DualColumnLayoutProps {
		children: Snippet;
		sidebar?: Snippet;
		isDrawerOpen?: boolean;
		user?: UserInfoSummary | null;
		t: TranslationDict;
	}

	let {
		children,
		sidebar,
		isDrawerOpen = $bindable(false),
		user,
		t
	}: DualColumnLayoutProps = $props();

	// Attach the (idempotent, mobile-gated) scroll listener that drives the
	// hide-on-scroll App Bar. start() is guarded so re-mounting this layout on
	// each navigation never double-attaches.
	onMount(() => {
		getScrollChromeStore().start();
	});

	// Gestures are mobile-only. Match the scroll-chrome breakpoint so the chrome
	// and the gestures agree on what "mobile" means. Default false for SSR safety
	// ([[browser-gated-derived-hydration-mismatch]]): the flag only flips in the
	// browser, and gestures are runtime pointer events that never fire during SSR.
	const MOBILE_BREAKPOINT = '(max-width: 767px)';
	let isMobile = $state(false);
	onMount(() => {
		const mq = window.matchMedia(MOBILE_BREAKPOINT);
		const sync = () => (isMobile = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

	function openDrawer(): void {
		isDrawerOpen = true;
		void user;
	}
	function closeDrawer(): void {
		isDrawerOpen = false;
	}

	// ---- Drawer drag (edge-open + overlay-close, finger-follow) ----
	// `drawerOffset` is null while at rest (the CSS class + transition snaps the
	// panel open/closed); a live px offset while a pointer is dragging is applied
	// as an inline transform so the panel tracks the finger 1:1.
	const DRAWER_WIDTH = 280;
	const DRAWER_COMMIT = 80;
	let drawerOffset = $state<number | null>(null);
	const drawerDragging = $derived(drawerOffset !== null);
	const drawerVisible = $derived(isDrawerOpen || drawerDragging);
	const drawerOpenness = $derived(
		drawerOffset === null ? (isDrawerOpen ? 1 : 0) : (drawerOffset + DRAWER_WIDTH) / DRAWER_WIDTH
	);
	// The panel position is driven entirely by an inline transform (Tailwind v4's
	// translate-x-* utilities use the native `translate` property, which would
	// compose with - rather than override - an inline `transform` and pin the
	// panel off-screen). `transition: none` while dragging keeps it 1:1 with the
	// finger; the always-on transition-transform class animates the snap at rest.
	const panelStyle = $derived(
		drawerOffset === null
			? `transform: translateX(${isDrawerOpen ? 0 : -DRAWER_WIDTH}px)`
			: `transform: translateX(${drawerOffset}px); transition: none`
	);
	const overlayStyle = $derived(
		drawerOffset === null ? '' : `opacity: ${0.5 * drawerOpenness}; transition: none`
	);

	function clampDrawer(value: number): number {
		return Math.max(-DRAWER_WIDTH, Math.min(0, value));
	}

	function edgeMove(deltaX: number): void {
		if (isDrawerOpen) return;
		drawerOffset = clampDrawer(-DRAWER_WIDTH + Math.max(0, deltaX));
	}
	function edgeEnd(deltaX: number): void {
		isDrawerOpen = deltaX >= DRAWER_COMMIT;
		drawerOffset = null;
	}
	function overlayMove(deltaX: number): void {
		drawerOffset = clampDrawer(Math.min(0, deltaX));
	}
	function overlayEnd(deltaX: number): void {
		isDrawerOpen = deltaX > -DRAWER_COMMIT;
		drawerOffset = null;
	}

	// ---- Page-content swipe to switch the primary tab (finger-follow) ----
	const SWIPE_MAX = 100; // px of finger-follow feedback
	const SWIPE_COMMIT = 60; // px past which a release commits the switch
	let contentOffset = $state(0);
	const contentStyle = $derived(
		contentOffset === 0 ? '' : `transform: translateX(${contentOffset}px); transition: none`
	);
	const currentPath = $derived(page.url.pathname);
	const currentIndex = $derived(getCurrentTabIndex(currentPath));

	/** Translate the content by the drag delta, with rubber-band resistance at the tab boundaries. */
	function followTab(deltaX: number): number {
		const lastIndex = MOBILE_TABS.length - 1;
		let delta = deltaX;
		if (currentIndex <= 0 && delta > 0) delta *= 0.4; // leftmost: swiping toward a previous tab that does not exist
		if (currentIndex >= lastIndex && delta < 0) delta *= 0.4; // rightmost: swiping toward a next tab that does not exist
		return Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, delta));
	}
	function swipeMove(deltaX: number): void {
		contentOffset = followTab(deltaX);
	}
	function swipeEnd(deltaX: number): void {
		const lastIndex = MOBILE_TABS.length - 1;
		if (deltaX <= -SWIPE_COMMIT && currentIndex < lastIndex) {
			void goto(MOBILE_TABS[currentIndex + 1].href);
		} else if (deltaX >= SWIPE_COMMIT && currentIndex > 0) {
			void goto(MOBILE_TABS[currentIndex - 1].href);
		}
		contentOffset = 0;
	}
</script>

<div class="relative flex min-h-screen flex-col bg-base-200 text-base-content">
	<Header {t} onToggleDrawer={openDrawer} />

	<!-- Main Content Container -->
	<div class="mx-auto w-full max-w-[960px] flex-1 px-0 pb-6 md:px-6">
		<div
			class="flex flex-col gap-4 border-b border-base-300 bg-base-100 p-3 md:border-x md:flex-row"
		>
			<!-- Left Column (Main Page Content). detectSwipe adds left/right tab
			     switching with finger-follow; vertical scroll stays native. -->
			<main
				class="w-full min-w-0 flex-1 transition-transform duration-200"
				style={contentStyle}
				use:detectSwipe={{ onMove: swipeMove, onEnd: swipeEnd, disabled: () => !isMobile }}
			>
				{@render children()}
			</main>

			<!-- Right Column (Desktop Sidebar) -->
			{#if sidebar}
				<aside class="hidden w-full shrink-0 md:block md:w-[280px]">
					<div class="space-y-3">
						{@render sidebar()}
					</div>
				</aside>
			{/if}
		</div>
	</div>
</div>

{#if sidebar}
	<!-- Left-edge response zone: a rightward drag pulls the drawer out, tracking
	     the finger. captureSwipe sets touch-action:none + preventDefault so the
	     browser's built-in edge-back / pan never fires. -->
	<div
		class="fixed inset-y-0 left-0 z-30 w-5 md:hidden"
		use:captureSwipe={{
			onMove: edgeMove,
			onEnd: edgeEnd,
			disabled: () => isDrawerOpen || !isMobile
		}}
		aria-hidden="true"
	></div>

	<!-- Backdrop overlay: tap to close, or drag leftward to close with finger-follow. -->
	<button
		type="button"
		class="fixed inset-0 z-50 bg-black/50 transition-opacity duration-200 md:hidden {drawerVisible
			? 'opacity-100'
			: 'pointer-events-none opacity-0'}"
		style={overlayStyle}
		tabindex={drawerVisible ? 0 : -1}
		aria-hidden={!drawerVisible}
		aria-label={t.sidebar.closeAria}
		onclick={closeDrawer}
		use:captureSwipe={{
			onMove: overlayMove,
			onEnd: overlayEnd,
			disabled: () => !isMobile
		}}
	></button>

	<!-- Drawer panel: slides in from the left. Position is driven by the inline
	     panelStyle transform (see script); the always-on transition animates the
	     snap when not actively dragging. -->
	<div
		class="fixed inset-y-0 left-0 z-50 w-[280px] border-r border-base-300 bg-base-100 p-6 shadow-lg transition-transform duration-200 md:hidden {drawerVisible
			? 'pointer-events-auto'
			: 'pointer-events-none'}"
		style={panelStyle}
		inert={!drawerVisible}
		role="dialog"
		aria-modal="true"
		aria-label={t.nav.primary}
	>
		<div class="space-y-3">
			{@render sidebar()}
		</div>
	</div>
{/if}
