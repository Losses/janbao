<script lang="ts">
	/**
	 * MobileTabBar Organism - The three primary destinations rendered as a row of
	 * expanding pills inside the top App Bar (see Header). The active pill
	 * expands to reveal its label beside the icon, and - via the mobile-pager
	 * store - the expansion tracks the swipe drag live: as you drag from one tab
	 * to the next, the source pill's label collapses (width -> 0, text clipped by
	 * overflow) and the target's expands, in sync with the finger (no opacity
	 * fade). The Messages pill shows a solid unread dot (never a count).
	 */
	import { page } from '$app/state';
	import { env } from '$env/dynamic/public';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import LogoGeometry from '$lib/components/atoms/LogoGeometry.svelte';
	import LogoText from '$lib/components/atoms/LogoText.svelte';
	import { getBadgesStore } from '$lib/stores/badges.svelte';
	import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';
	import { getNavigationStore } from '$lib/stores/navigation.svelte';
	import { MOBILE_TABS, getCurrentTabIndex } from '$lib/utils/route-config';
	import { hopForHref } from '$lib/utils/history-nav';
	import { PILL_EXPANSION_THRESHOLD } from '$lib/utils/gesture-constants';
	import type { TranslationDict } from '$lib/types/translation';

	interface MobileTabBarProps {
		t: TranslationDict;
	}

	let { t }: MobileTabBarProps = $props();

	const badges = getBadgesStore();
	const pager = getMobilePagerStore();
	const navStore = getNavigationStore();
	const tNav = $derived(t.nav);
	const currentPath = $derived(page.url.pathname);
	const showMessagesDot = $derived(badges.unreadMessages > 0);
	// When enabled, the first tab (Discussions) shows the brand mark + wordmark
	// instead of the forum icon / "Discussions" label. currentColor makes both
	// inherit the tab's active/inactive text color like every other tab.
	const brandedFirstTab = ['1', 'true', 'yes'].includes(
		(env.PUBLIC_BRANDED_FIRST_TAB ?? '').trim().toLowerCase()
	);

	// fractionalIndex tracks the pager's drag once it is mounted; before that (or
	// where the bar renders without a pager) fall back to the URL's tab. -1 means
	// the page is no tab at all (search, settings, ...): then NO pill is active
	// (every closeness is 0, round(-1) matches no pill) - do NOT clamp to 0 or
	// every non-tab page would highlight Discussions.
	const urlIndex = $derived(getCurrentTabIndex(currentPath));
	const fractionalIndex = $derived(pager.active ? pager.fractionalIndex : urlIndex);
	const dragging = $derived(pager.dragging);
	const labelTransition = 'max-width 200ms ease-out, margin-left 200ms ease-out';

	// Deep-page back/forward swipe detection: when we are swiping to/from a deep
	// page, we directly transition the target tab instead of sliding intermediate tabs.
	const isDeepSwipe = $derived(
		pager.active && pager.backMorph !== null && pager.targetIndex !== null && pager.targetIndex >= 0
	);

	function getDeepSwipePillProgress(): number {
		if (!isDeepSwipe) return 0;
		const progress = pager.backMorph ?? 0;
		return Math.max(0, progress - PILL_EXPANSION_THRESHOLD) / (1 - PILL_EXPANSION_THRESHOLD);
	}

	/** Per-pill expansion: 1 at the tab's centre, 0 once the drag is a full tab away. */
	function closeness(index: number): number {
		if (isDeepSwipe) {
			return index === pager.targetIndex ? getDeepSwipePillProgress() : 0;
		}
		return Math.max(0, Math.min(1, 1 - Math.abs(fractionalIndex - index)));
	}

	function labelStyle(index: number): string {
		const c = closeness(index);
		return `max-width: ${(c * 8).toFixed(2)}rem; margin-left: ${(c * 0.375).toFixed(3)}rem; transition: ${dragging ? 'none' : labelTransition}`;
	}
</script>

<nav class="flex items-center justify-center gap-1" aria-label={tNav['primary']}>
	{#each MOBILE_TABS as item, i (item.href)}
		{@const pillActive = isDeepSwipe
			? getDeepSwipePillProgress() >= 0.5 && pager.targetIndex === i
			: Math.round(fractionalIndex) === i}
		{@const branded = brandedFirstTab && item.labelKey === 'discussions'}
		<a
			href={item.href}
			data-tab-nav
			class="flex items-center rounded-full px-2.5 py-1.5 {dragging
				? ''
				: 'transition-colors duration-200'} {pillActive
				? 'bg-neutral-content/15 text-accent'
				: 'text-neutral-content/70'}"
			aria-current={pillActive ? 'page' : undefined}
			onclick={(event) => {
				// Hop via history.back/forward when an adjacent entry already matches
				// this tab, so toggling two tabs collapses instead of pushing each time
				// (no back-trap). preventDefault cancels SvelteKit's enhanced link nav;
				// the resulting popstate runs the same cross-tab stack logic as a tap.
				const hop = hopForHref(item.href);
				if (hop === 'back' || hop === 'forward') {
					event.preventDefault();
					navStore.navigateForward(item.href);
				}
			}}
		>
			<span class="relative inline-flex">
				{#if branded}
					<LogoGeometry class="size-5" />
				{:else}
					<Icon path={item.icon} size={20} />
				{/if}
				{#if item.labelKey === 'messages' && showMessagesDot}
					<span
						class="pointer-events-none absolute -right-1 -top-0.5 size-2 rounded-full bg-accent ring-2 ring-neutral"
					></span>
				{/if}
			</span>
			<span class="overflow-hidden whitespace-nowrap text-sm font-medium" style={labelStyle(i)}>
				{#if branded}
					<LogoText class="block h-3 w-auto" />
				{:else}
					{tNav[item.labelKey]}
				{/if}
			</span>
		</a>
	{/each}
</nav>
