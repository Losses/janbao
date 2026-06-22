<script lang="ts">
	/**
	 * (tabs) layout - branch point for the three primary tabs AND the thread
	 * routes (`/discussion/*`, `/messages/[id]`), which live in this group so the
	 * pager below stays mounted across list↔thread nav (no remount, no white flash).
	 *
	 * Desktop: render the active route's own page (`children`) - each renders its
	 * own DualColumnLayout + inline sidebar.
	 *
	 * Mobile: render ONE DualColumnLayout shell (Header/tab bar + a single drawer).
	 * The MobileTabPager (all three panels) is a SINGLE persistent instance - on a
	 * list route it is the in-flow content (`contents` wrapper); on a thread route
	 * it is repositioned BEHIND a transparent OverlayLayer that hosts the thread
	 * page. The thread's back-swipe slides its content away (ThreadPager) to reveal
	 * the preserved pager at its captured scroll. The drawer shows the active tab's
	 * sidebar, OR the overlay page's sidebar (via the overlay-sidebar store) when a
	 * thread is open.
	 *
	 * SSR renders the desktop branch (isMobile defaults false); the mobile client
	 * flips isMobile in onMount - a normal reactive update, not a hydration
	 * mismatch.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { beforeNavigate } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import MobileTabPager from '$lib/components/templates/MobileTabPager.svelte';
	import OverlayLayer from '$lib/components/templates/OverlayLayer.svelte';
	import DiscussionsSidebar from '$lib/components/panels/DiscussionsSidebar.svelte';
	import ActivitySidebar from '$lib/components/panels/ActivitySidebar.svelte';
	import MessagesSidebar from '$lib/components/panels/MessagesSidebar.svelte';
	import { getCurrentTabIndex } from '$lib/utils/mobile-tabs';
	import { getDrawerStore } from '$lib/stores/drawer.svelte';
	import { getListScrollStore } from '$lib/stores/list-scroll.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { getOverlaySidebarStore } from '$lib/stores/overlay-sidebar.svelte';
	import type { LayoutData } from './$types';

	interface TabsLayoutProps {
		data: LayoutData;
		children: Snippet;
	}

	let { data, children }: TabsLayoutProps = $props();

	const MOBILE_BREAKPOINT = '(max-width: 767px)';
	// svelte-ignore state_referenced_locally
	let isMobile = $state(data.isMobile ?? false);
	onMount(() => {
		const mq = window.matchMedia(MOBILE_BREAKPOINT);
		const sync = () => {
			isMobile = mq.matches;
			if (!isMobile) {
				const drawer = getDrawerStore();
				if (drawer.isOpen) {
					drawer.close();
				}
			}
		};
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

	// A thread route renders as a slide-in overlay over the persistent
	// MobileTabPager (see the mobile branch below); a list route is the pager's
	// own tab the thread was reached from (and swipe-back returns to).
	function isOverlayRoute(p: string): boolean {
		return p.startsWith('/discussion') || /^\/messages\/\d+/.test(p);
	}
	function isListRoute(p: string): boolean {
		return p === '/' || p === '/messages/inbox';
	}
	const overlayActive = $derived(isOverlayRoute(page.url.pathname));

	const listScroll = getListScrollStore();
	const overlaySidebar = getOverlaySidebarStore();

	// Capture the list scroll when leaving a list route for a thread overlay, and
	// restore it SYNCHRONOUSLY in beforeNavigate (before the new route paints)
	// when returning, so the revealed pager is at the right scroll on the first
	// frame - no white frame. This covers the browser/OS back button;
	// ThreadPager's swipeEnd does the same restore for the swipe gesture -
	// `consume()` resets to 0, so whoever restores first wins and the other's
	// `y > 0` guard is a no-op. Release the scroll-chrome hold here (pinning the
	// header visible) once the position is set.
	beforeNavigate(({ to, from }) => {
		if (typeof window === 'undefined') return;
		const toPath = to?.url.pathname ?? '';
		const fromPath = from?.url.pathname ?? '';
		if (isOverlayRoute(toPath) && isListRoute(fromPath)) {
			listScroll.capture(window.scrollY);
		}
		if (isOverlayRoute(fromPath) && isListRoute(toPath)) {
			const y = listScroll.consume();
			if (y > 0) window.scrollTo(0, y);
			getScrollChromeStore().releaseNavigation();
		}
	});
</script>

{#if isMobile}
	<DualColumnLayout {t} {user} flush>
		{#snippet sidebar()}
			{#if overlayActive && overlaySidebar.current}
				{@render overlaySidebar.current()}
			{:else if activeIndex === 0}
				<DiscussionsSidebar {t} {user} />
			{:else if activeIndex === 1}
				<ActivitySidebar {t} {user} />
			{:else}
				<MessagesSidebar {t} {user} />
			{/if}
		{/snippet}
		<!-- ONE persistent MobileTabPager instance - never unmounts across list↔thread
		     nav, only repositioned. On list routes everything is `contents` so the
		     pager is a direct flex child of the shell (fills, window-scrolls). On a
		     thread route the wrapper becomes `relative overflow-hidden` (sized to the
		     in-flow OverlayLayer = the thread height) and the pager lifts to
		     `absolute inset-0 z-0` INSIDE it - so the pager's height is the thread
		     height, not the viewport, and the wrapper's overflow-hidden CLIPS it. A
		     short thread no longer lets the pager leak out below; what shows below is
		     the shell's own card background (as when the list was a separate route). -->
		<div class={overlayActive ? 'relative overflow-hidden' : 'contents'}>
			<div class={overlayActive ? 'absolute inset-0 z-0 flex flex-col' : 'contents'}>
				<MobileTabPager {data} {t} {user} />
			</div>
			{#if overlayActive}
				<OverlayLayer>
					{@render children()}
				</OverlayLayer>
			{/if}
		</div>
	</DualColumnLayout>

	<div class="fixed inset-y-0 right-0 z-30 w-8 md:hidden" aria-hidden="true">
		<!-- Right-edge reserve for the OS back gesture. The pager claims horizontal
		     (touch-action: pan-y) across the content, which would also swallow the
		     system back gesture at the right edge. This strip's touch-action is left
		     unrestricted (auto), so touches at the right edge are handled by the
		     browser/OS (back gesture) instead of the pager; vertical scroll still
		     passes through. Mirrors the left drawer edge zone (which, by contrast,
		     claims its edge for the drawer). z-30 sits above the pager, below the
		     header (z-40) and drawer (z-50). -->
	</div>
{:else}
	{@render children()}
{/if}
