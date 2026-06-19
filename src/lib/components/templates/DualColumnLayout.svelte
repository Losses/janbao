<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import Header from '$lib/components/organisms/Header.svelte';
	import BottomNav from '$lib/components/organisms/BottomNav.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
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
	// hide-on-scroll App Bar + bottom nav. start() is guarded so re-mounting this
	// layout on each navigation never double-attaches.
	onMount(() => {
		getScrollChromeStore().start();
	});

	function openDrawer() {
		isDrawerOpen = true;
		void user;
	}
</script>

<div class="drawer">
	<!-- Drawer Toggle checkbox bound to isDrawerOpen state -->
	<input id="sidebar-drawer" type="checkbox" class="drawer-toggle" bind:checked={isDrawerOpen} />

	<div class="drawer-content flex min-h-screen flex-col bg-base-200 text-base-content">
		<!-- Global Header -->
		<Header {t} onToggleDrawer={openDrawer} />

		<!-- Main Content Container -->
		<div class="mx-auto w-full max-w-[960px] flex-1 px-0 pb-20 md:px-6 md:pb-6">
			<div
				class="bg-base-100 border-b md:border-x border-base-300 p-3 flex flex-col gap-4 md:flex-row"
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

		<!-- Mobile-only bottom navigation (hidden on scroll via the shared store) -->
		<BottomNav {t} />
	</div>

	<!-- Drawer Sidebar for Mobile viewports (opens from the left) -->
	{#if sidebar}
		<div class="drawer-side z-50 md:hidden">
			<label for="sidebar-drawer" aria-label={t.sidebar.closeAria} class="drawer-overlay"></label>
			<div class="min-h-full w-[280px] border-r border-base-300 bg-base-100 p-6 shadow-lg">
				<div class="space-y-3">
					{@render sidebar()}
				</div>
			</div>
		</div>
	{/if}
</div>
