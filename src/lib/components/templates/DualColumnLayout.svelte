<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { getDrawerStore } from '$lib/stores/drawer.svelte';
	import { captureSwipe } from '$lib/actions/swipe';
	import { buildSignInRedirectUrl } from '$lib/utils/redirect';
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
	function edgeEnd(deltaX: number, velocity: number, reversed: boolean): void {
		// `reversed` = finger rebounded toward closed at release (change of intent):
		// leave the drawer closed even if the drag crossed the commit line.
		if (deltaX >= DRAWER_COMMIT && !reversed) drawer.open();
		else drawer.close();
		drawerOffset = null;
	}
	function overlayMove(deltaX: number): void {
		drawerOffset = clampDrawer(Math.min(0, deltaX));
	}
	function overlayEnd(deltaX: number, velocity: number, reversed: boolean): void {
		// `reversed` = finger rebounded toward open at release: keep the drawer
		// open even if the drag crossed the close-commit line.
		if (deltaX > -DRAWER_COMMIT || reversed) drawer.open();
		else drawer.close();
		drawerOffset = null;
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
			<!-- Left Column (Main Page Content). -->
			<main
				class="dual-column-layout-main flex w-full min-w-0 flex-1 flex-col"
				style="touch-action: pan-y pinch-zoom"
			>
				<div class="dual-column-layout-content flex min-h-0 flex-1 flex-col">
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
								<a
									href={buildSignInRedirectUrl(page.url.pathname)}
									class="btn btn-sm btn-primary flex-1">{t.nav.signin}</a
								>
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
						<a
							href={buildSignInRedirectUrl(page.url.pathname)}
							class="btn btn-sm btn-primary flex-1">{t.nav.signin}</a
						>
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
