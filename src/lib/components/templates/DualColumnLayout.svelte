<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getDrawerStore } from '$lib/stores/drawer.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { captureSwipe, detectSwipe, reversedAtRelease } from '$lib/actions/swipe';
	import { MOBILE_TABS, getSwipeBaseline, isPagerRoute } from '$lib/utils/mobile-tabs';
	import type { UserInfoSummary } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';

	interface DualColumnLayoutProps {
		children: Snippet;
		sidebar?: Snippet;
		/** Accepted for call-site compatibility but unused now that the Header lives in AppShell. */
		user?: UserInfoSummary | null;
		t: TranslationDict;
	}

	let { children, sidebar, user, t }: DualColumnLayoutProps = $props();

	const resolvedUser = $derived(
		user !== undefined ? user : (page.data.user as UserInfoSummary | null)
	);

	// The drawer's open state lives in the shared drawer store (the persistent
	// AppShell Header drives it). The per-page sidebar snippet rendered in the
	// drawer + the desktop inline aside stays here.
	const drawer = getDrawerStore();
	const isDrawerOpen = $derived(drawer.isOpen);

	// Drawer gestures are mobile-only. Match the scroll-chrome breakpoint.
	const MOBILE_BREAKPOINT = '(max-width: 767px)';
	let isMobile = $state(page.data.isMobile ?? false);
	onMount(() => {
		const mq = window.matchMedia(MOBILE_BREAKPOINT);
		const sync = () => {
			isMobile = mq.matches;
			if (!isMobile && drawer.isOpen) {
				drawer.close();
			}
		};
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

	// ---- Drawer drag (edge-open + overlay-close, finger-follow) ----
	// `drawerOffset` is null while at rest; a live px offset while a pointer is
	// dragging is applied as an inline transform so the panel tracks 1:1.
	const DRAWER_WIDTH = 280;
	const DRAWER_COMMIT = 80;
	let drawerOffset = $state<number | null>(null);
	const drawerDragging = $derived(drawerOffset !== null);
	const drawerVisible = $derived(isDrawerOpen || drawerDragging);
	const drawerOpenness = $derived(
		drawerOffset === null ? (isDrawerOpen ? 1 : 0) : (drawerOffset + DRAWER_WIDTH) / DRAWER_WIDTH
	);
	// Position driven by an inline transform (Tailwind v4 translate-x-* uses the
	// native `translate` property and would compose with, not override, this).
	// `transition: none` while dragging keeps it 1:1; the always-on
	// transition-transform class animates the snap at rest.
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
	function edgeEnd(deltaX: number, velocity: number): void {
		// Reversed at release (finger flicked back toward closed) is a change of
		// intent: leave the drawer closed even if the drag crossed the commit line.
		if (deltaX >= DRAWER_COMMIT && !reversedAtRelease(deltaX, velocity)) drawer.open();
		else drawer.close();
		drawerOffset = null;
	}
	function overlayMove(deltaX: number): void {
		drawerOffset = clampDrawer(Math.min(0, deltaX));
	}
	function overlayEnd(deltaX: number, velocity: number): void {
		// Reversed at release (finger flicked back toward open) keeps the drawer
		// open even if the drag crossed the close-commit line.
		if (deltaX > -DRAWER_COMMIT || reversedAtRelease(deltaX, velocity)) drawer.open();
		else drawer.close();
		drawerOffset = null;
	}

	// ---- Swipe to switch tab on inner (non-pager) pages ----
	// On the pager routes the MobileTabPager owns the swipe (1:1 drag + live
	// reveal); everywhere else a horizontal drag slides the page content with the
	// finger (clamped + rubber-banded at the tab boundaries) and a committed
	// release jumps to the next/prev tab, relative to the tab the current page
	// belongs to. touch-action: pan-y lets vertical scroll stay native while
	// yielding horizontal to us (without it the browser claims the gesture and
	// fires pointercancel).
	const TAB_SWIPE_COMMIT = 60;
	const TAB_SWIPE_MAX = 100; // px of finger-follow feedback on inner pages
	const swipeBaseline = $derived(getSwipeBaseline(page.url.pathname));
	// Disabled on pager/thread routes (the MobileTabPager / ThreadPager viewports
	// own the gesture there - their `min-height: 100%` fills main so there's no
	// dead zone). If this were enabled too, both detectSwipe nodes would race to
	// setPointerCapture on the same bubbled touch, and main (higher in the DOM)
	// would win → the old translate-content behaviour would override the pager's
	// 1:1 + reveal. Enabled elsewhere for inner pages with a tab baseline.
	const swipeDisabled = $derived(
		isPagerRoute(page.url.pathname) ||
			page.url.pathname.startsWith('/discussion') ||
			/^\/messages\/\d+/.test(page.url.pathname) ||
			swipeBaseline < 0 ||
			!isMobile
	);
	let swipeOffset = $state(0);
	/** 1:1 toward a neighbour (clamped); 0.4x rubber-band past the first/last tab. */
	function swipeFollow(deltaX: number): number {
		const last = MOBILE_TABS.length - 1;
		let d = deltaX;
		if (swipeBaseline <= 0 && d > 0) d *= 0.4;
		if (swipeBaseline >= last && d < 0) d *= 0.4;
		return Math.max(-TAB_SWIPE_MAX, Math.min(TAB_SWIPE_MAX, d));
	}
	const contentSwipeStyle = $derived(
		swipeOffset === 0 ? '' : `transform: translateX(${swipeOffset}px); transition: none`
	);
	function tabSwipeMove(deltaX: number): void {
		swipeOffset = swipeFollow(deltaX);
		getScrollChromeStore().show();
	}
	function tabSwipeEnd(deltaX: number, velocity: number): void {
		const last = MOBILE_TABS.length - 1;
		// Reversed at release = change of intent: stay on the current tab.
		const reversed = reversedAtRelease(deltaX, velocity);
		if (deltaX <= -TAB_SWIPE_COMMIT && swipeBaseline < last && !reversed) {
			void goto(MOBILE_TABS[swipeBaseline + 1].href);
		} else if (deltaX >= TAB_SWIPE_COMMIT && swipeBaseline > 0 && !reversed) {
			void goto(MOBILE_TABS[swipeBaseline - 1].href);
		}
		swipeOffset = 0;
	}

	let sidebarEl: HTMLElement | null = $state(null);
	let middleContentEl: HTMLElement | null = $state(null);
	let sloganEl: HTMLElement | null = $state(null);
	let isSticky = $state(true);

	function updateStickyState() {
		if (!sidebarEl || !middleContentEl) return;
		const children = Array.from(sidebarEl.children) as HTMLElement[];
		let totalHeight = 0;
		for (const child of children) {
			if (child === sloganEl && !isSticky) {
				totalHeight += 24;
			}
			totalHeight += child.offsetHeight;
		}
		const gapCount = children.length - 1;
		totalHeight += gapCount * 16;

		const headerHeight =
			parseInt(
				typeof window !== 'undefined'
					? getComputedStyle(document.documentElement).getPropertyValue('--header-height')
					: ''
			) || 62;
		const availableHeight =
			(typeof window !== 'undefined' ? window.innerHeight : 800) - headerHeight - 48;

		if (totalHeight <= availableHeight) {
			isSticky = true;
			return;
		}

		const middleRect = middleContentEl.getBoundingClientRect();
		const sloganHeight = sloganEl?.offsetHeight || 200;
		const neededSpace = sloganHeight + 40;

		isSticky = middleRect.bottom <= window.innerHeight - neededSpace;
	}

	$effect(() => {
		if (!sidebarEl || !middleContentEl) return;

		const observer = new ResizeObserver(() => {
			updateStickyState();
		});

		const children = Array.from(sidebarEl.children);
		for (const child of children) {
			observer.observe(child);
		}

		window.addEventListener('resize', updateStickyState);
		window.addEventListener('scroll', updateStickyState, { passive: true });
		updateStickyState();

		return () => {
			observer.disconnect();
			window.removeEventListener('resize', updateStickyState);
			window.removeEventListener('scroll', updateStickyState);
		};
	});
</script>

<div class="dual-column-layout relative flex min-h-0 flex-1 flex-col text-base-content">
	<!-- Main Content Container -->
	<div
		class="dual-column-layout-inner mx-auto flex w-full max-w-[960px] flex-1 flex-col px-0 pb-6 md:px-6"
	>
		<div
			class="dual-column-layout-columns flex flex-1 flex-col gap-3 border-b border-base-300 bg-base-100 p-0 md:p-3 md:flex-initial md:border-x md:flex-row desktop-min-height"
		>
			<!-- Left Column (Main Page Content). On non-pager pages a horizontal
			     drag slides the content with the finger and a committed swipe
			     switches to the next/prev tab (disabled on the pager routes, where
			     MobileTabPager owns the gesture). -->
			<main
				class="dual-column-layout-main flex w-full min-w-0 flex-1 flex-col"
				style="touch-action: pan-y pinch-zoom"
				use:detectSwipe={{
					onMove: tabSwipeMove,
					onEnd: tabSwipeEnd,
					disabled: () => swipeDisabled
				}}
			>
				<div
					class="dual-column-layout-content flex min-h-0 flex-1 flex-col transition-transform duration-200 ease-out"
					style={contentSwipeStyle}
				>
					{@render children()}
				</div>
			</main>

			<!-- Right Column (Desktop Sidebar) -->
			{#if sidebar}
				<aside
					bind:this={sidebarEl}
					class="hidden w-full shrink-0 md:flex md:flex-col md:gap-4 md:w-[280px] sidebar"
				>
					<!-- Top Widget -->
					{#if resolvedUser}
						<UserInfoBlock user={resolvedUser} {t} />
					{:else}
						<div class="space-y-2">
							<h3 class="text-sm font-semibold text-base-content/70">{t.home.welcomeTo}</h3>
							<div class="flex gap-2">
								<a href="/entry/signin" class="btn btn-sm btn-primary flex-1">{t.nav.signin}</a>
								<a href="/entry/register" class="btn btn-sm btn-outline flex-1">{t.nav.register}</a>
							</div>
						</div>
					{/if}

					<!-- Middle Content -->
					<div bind:this={middleContentEl} class="space-y-3">
						{@render sidebar()}
					</div>

					<!-- Bottom Slogan -->
					<div
						bind:this={sloganEl}
						class="pt-2"
						class:mt-auto={isSticky}
						class:mt-6={!isSticky}
						class:slogan-sticky={isSticky}
					>
						<img src="/slogan.jpg" alt="Slogan" class="w-full rounded-box slogan" />
					</div>
				</aside>
			{/if}
		</div>
	</div>
</div>

{#if sidebar}
	<div
		class="fixed inset-y-0 left-0 z-30 w-8 md:hidden"
		use:captureSwipe={{
			onMove: edgeMove,
			onEnd: edgeEnd,
			disabled: () => isDrawerOpen || !isMobile
		}}
		aria-hidden="true"
	>
		<!-- Left-edge response zone: a rightward drag pulls the drawer out, tracking
		     the finger. captureSwipe sets touch-action:none + preventDefault so the
		     browser's built-in edge-back / pan never fires. -->
	</div>

	<button
		type="button"
		class="fixed inset-0 z-50 bg-black/50 transition-opacity duration-200 md:hidden {drawerVisible
			? 'opacity-100'
			: 'pointer-events-none opacity-0'}"
		style={overlayStyle}
		tabindex={drawerVisible ? 0 : -1}
		inert={!drawerVisible}
		aria-label={t.sidebar.closeAria}
		onclick={drawer.close}
		use:captureSwipe={{
			onMove: overlayMove,
			onEnd: overlayEnd,
			disabled: () => !isMobile
		}}
	>
		<!-- Backdrop overlay: tap to close, or drag leftward to close with finger-follow. -->
	</button>

	<div
		class="fixed inset-y-0 left-0 z-50 w-[280px] border-r border-base-300 bg-base-100 flex flex-col shadow-lg transition-transform duration-200 md:hidden {drawerVisible
			? 'pointer-events-auto'
			: 'pointer-events-none'}"
		style={panelStyle}
		inert={!drawerVisible}
		role="dialog"
		aria-modal="true"
		aria-label={t.nav.primary}
	>
		<!-- Drawer panel: slides in from the left. An inline transform follows the
		     finger while dragging; otherwise the CSS class + transition snaps it. -->
		<!-- Scrollable content area: contains Top Widget and Middle Content -->
		<div class="flex-1 overflow-y-auto p-6 space-y-4">
			<!-- Top Widget -->
			{#if resolvedUser}
				<UserInfoBlock user={resolvedUser} {t} />
			{:else}
				<div class="space-y-2">
					<h3 class="text-sm font-semibold text-base-content/70">{t.home.welcomeTo}</h3>
					<div class="flex gap-2">
						<a href="/entry/signin" class="btn btn-sm btn-primary flex-1">{t.nav.signin}</a>
						<a href="/entry/register" class="btn btn-sm btn-outline flex-1">{t.nav.register}</a>
					</div>
				</div>
			{/if}

			<!-- Middle Content -->
			<div class="space-y-3">
				{@render sidebar()}
			</div>
		</div>

		<!-- Bottom Slogan pinned to the bottom of the page/drawer -->
		<div class="w-full mt-auto">
			<img src="/slogan.jpg" alt="Slogan" class="w-full object-cover slogan" />
		</div>
	</div>
{/if}

<style>
	@media (min-width: 768px) {
		.slogan {
			opacity: 0.02;
			filter: grayscale(90%);
			transition:
				opacity 300ms,
				filter 300ms;
		}

		.slogan:hover {
			opacity: 1;
			filter: grayscale(0%);
		}

		.desktop-min-height {
			min-height: calc(100vh - var(--header-height, 62px) - 3rem);
		}
		.slogan-sticky {
			position: sticky;
			bottom: calc(var(--spacing) * 3);
			z-index: 10;
		}
	}
</style>
