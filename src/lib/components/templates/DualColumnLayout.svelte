<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { getDrawerStore } from '$lib/stores/drawer.svelte';
	import { captureSwipe } from '$lib/actions/swipe';
	import type { UserInfoSummary } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface DualColumnLayoutProps {
		children: Snippet;
		sidebar?: Snippet;
		/** Accepted for call-site compatibility but unused now that the Header lives in AppShell. */
		user?: UserInfoSummary | null;
		t: TranslationDict;
	}

	let { children, sidebar, user, t }: DualColumnLayoutProps = $props();
	// svelte-ignore state_referenced_locally
	void user;

	// The drawer's open state lives in the shared drawer store (the persistent
	// AppShell Header drives it). The per-page sidebar snippet rendered in the
	// drawer + the desktop inline aside stays here.
	const drawer = getDrawerStore();
	const isDrawerOpen = $derived(drawer.isOpen);

	// Drawer gestures are mobile-only. Match the scroll-chrome breakpoint.
	const MOBILE_BREAKPOINT = '(max-width: 767px)';
	let isMobile = $state(false);
	onMount(() => {
		const mq = window.matchMedia(MOBILE_BREAKPOINT);
		const sync = () => (isMobile = mq.matches);
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
	function edgeEnd(deltaX: number): void {
		if (deltaX >= DRAWER_COMMIT) drawer.open();
		else drawer.close();
		drawerOffset = null;
	}
	function overlayMove(deltaX: number): void {
		drawerOffset = clampDrawer(Math.min(0, deltaX));
	}
	function overlayEnd(deltaX: number): void {
		if (deltaX > -DRAWER_COMMIT) drawer.open();
		else drawer.close();
		drawerOffset = null;
	}
</script>

<div class="relative flex min-h-screen flex-col bg-base-200 text-base-content">
	<!-- Main Content Container -->
	<div class="mx-auto w-full max-w-[960px] flex-1 px-0 pb-6 md:px-6">
		<div
			class="flex h-full flex-col gap-4 border-b border-base-300 bg-base-100 p-3 md:h-auto md:border-x md:flex-row"
		>
			<!-- Left Column (Main Page Content) -->
			<main class="w-full min-w-0 flex-1">
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
		class="fixed inset-y-0 left-0 z-30 w-8 md:hidden"
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
		onclick={drawer.close}
		use:captureSwipe={{
			onMove: overlayMove,
			onEnd: overlayEnd,
			disabled: () => !isMobile
		}}
	></button>

	<!-- Drawer panel: slides in from the left. An inline transform follows the
	     finger while dragging; otherwise the CSS class + transition snaps it. -->
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
