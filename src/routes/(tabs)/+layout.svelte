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
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import MobileTabPager from '$lib/components/templates/MobileTabPager.svelte';
	import DiscussionsSidebar from '$lib/components/panels/DiscussionsSidebar.svelte';
	import ActivitySidebar from '$lib/components/panels/ActivitySidebar.svelte';
	import MessagesSidebar from '$lib/components/panels/MessagesSidebar.svelte';
	import { getCurrentTabIndex } from '$lib/utils/mobile-tabs';
	import { getListScrollStore } from '$lib/stores/list-scroll.svelte';
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

	// Remember the discussions-list scroll when leaving `/` for a thread, and
	// restore it when returning (covers the programmatic swipe-back goto).
	const listScroll = getListScrollStore();
	beforeNavigate(({ to }) => {
		if (to?.url.pathname.startsWith('/discussion')) {
			listScroll.capture(window.scrollY);
		}
	});
	afterNavigate(({ to }) => {
		if (to?.url.pathname === '/' && typeof window !== 'undefined') {
			const y = listScroll.consume();
			if (y > 0) window.scrollTo(0, y);
		}
	});
</script>

{#if isMobile}
	<DualColumnLayout {t} {user} flush>
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

	<!-- Right-edge reserve for the OS back gesture. The pager claims horizontal
	     (touch-action: pan-y) across the content, which would also swallow the
	     system back gesture at the right edge. This strip's touch-action is left
	     unrestricted (auto), so touches at the right edge are handled by the
	     browser/OS (back gesture) instead of the pager; vertical scroll still
	     passes through. Mirrors the left drawer edge zone (which, by contrast,
	     claims its edge for the drawer). z-30 sits above the pager, below the
	     header (z-40) and drawer (z-50). -->
	<div class="fixed inset-y-0 right-0 z-30 w-8 md:hidden" aria-hidden="true"></div>
{:else}
	{@render children()}
{/if}
