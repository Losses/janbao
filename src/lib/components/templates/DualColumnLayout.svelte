<script lang="ts">
	import type { Snippet } from 'svelte';
	import Header from '$lib/components/organisms/Header.svelte';
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

	function openDrawer() {
		isDrawerOpen = true;
	}
</script>

<div class="drawer drawer-end">
	<!-- Drawer Toggle checkbox bound to isDrawerOpen state -->
	<input id="sidebar-drawer" type="checkbox" class="drawer-toggle" bind:checked={isDrawerOpen} />

	<div class="drawer-content flex min-h-screen flex-col bg-base-100 text-base-content">
		<!-- Global Header -->
		<Header user={user ?? null} {t} onToggleDrawer={openDrawer} />

		<!-- Main Content Container -->
		<div class="mx-auto w-full max-w-[960px] flex-1 px-4 py-6 md:px-6">
			<div class="flex flex-col gap-6 md:flex-row">
				<!-- Left Column (Main Page Content) -->
				<main class="w-full min-w-0 flex-1">
					{@render children()}
				</main>

				<!-- Right Column (Desktop Sidebar) -->
				{#if sidebar}
					<aside class="hidden w-full shrink-0 md:block md:w-[320px]">
						<div class="space-y-6">
							{@render sidebar()}
						</div>
					</aside>
				{/if}
			</div>
		</div>
	</div>

	<!-- Drawer Sidebar for Mobile viewports -->
	{#if sidebar}
		<div class="drawer-side z-50 md:hidden">
			<label for="sidebar-drawer" aria-label="close sidebar" class="drawer-overlay"></label>
			<div class="min-h-full w-80 border-l border-base-300 bg-base-100 p-6 shadow-lg">
				<div class="space-y-6">
					{@render sidebar()}
				</div>
			</div>
		</div>
	{/if}
</div>
