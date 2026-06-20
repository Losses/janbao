<script lang="ts">
	/**
	 * (tabs) layout - branch point for the three primary tabs.
	 *
	 * Desktop: render the active route's own page (`children`) - each renders its
	 * own DualColumnLayout + inline sidebar, exactly as before.
	 *
	 * Mobile: render ONE DualColumnLayout shell (Header with the tab bar + a single
	 * drawer) whose main content is the MobileTabPager (all three panels mounted)
	 * and whose drawer shows the ACTIVE tab's sidebar. Suppresses the route's own
	 * page so there is exactly one Header/drawer.
	 *
	 * SSR renders the desktop branch (isMobile defaults false); the mobile client
	 * flips isMobile in onMount - a normal reactive update, not a hydration
	 * mismatch.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import MobileTabPager from '$lib/components/templates/MobileTabPager.svelte';
	import DiscussionsSidebar from '$lib/components/panels/DiscussionsSidebar.svelte';
	import ActivitySidebar from '$lib/components/panels/ActivitySidebar.svelte';
	import MessagesSidebar from '$lib/components/panels/MessagesSidebar.svelte';
	import { getCurrentTabIndex } from '$lib/utils/mobile-tabs';
	import type { LayoutData } from './$types';

	interface TabsLayoutProps {
		data: LayoutData;
		children: Snippet;
	}

	let { data, children }: TabsLayoutProps = $props();

	const MOBILE_BREAKPOINT = '(max-width: 767px)';
	let isMobile = $state(false);
	onMount(() => {
		const mq = window.matchMedia(MOBILE_BREAKPOINT);
		const sync = () => (isMobile = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

	function clampTab(pathname: string): number {
		const idx = getCurrentTabIndex(pathname);
		return idx < 0 ? 0 : idx;
	}
	const activeIndex = $derived(clampTab(page.url.pathname));
	const t = $derived(data.t);
	const user = $derived(data.user);
</script>

{#if isMobile}
	<DualColumnLayout {t} {user}>
		{#snippet sidebar()}
			{#if activeIndex === 0}
				<DiscussionsSidebar {t} {user} />
			{:else if activeIndex === 1}
				<ActivitySidebar {t} {user} />
			{:else}
				<MessagesSidebar {t} {user} />
			{/if}
		{/snippet}
		<MobileTabPager {data} {t} {user} />
	</DualColumnLayout>
{:else}
	{@render children()}
{/if}
