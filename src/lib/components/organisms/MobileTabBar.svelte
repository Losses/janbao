<script lang="ts">
	/**
	 * MobileTabBar Organism - The three primary destinations rendered as a row of
	 * expanding pills inside the top App Bar (see Header). Each pill shows its
	 * icon; the active pill - and, on hover, any pill - expands to reveal its
	 * label beside the icon via a max-width transition. The Messages pill shows a
	 * solid unread dot (never a count) sourced from the badges store.
	 */
	import { page } from '$app/state';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { getBadgesStore } from '$lib/stores/badges.svelte';
	import { MOBILE_TABS } from '$lib/utils/mobile-tabs';
	import type { TranslationDict } from '$lib/types/translation';

	interface MobileTabBarProps {
		t: TranslationDict;
	}

	let { t }: MobileTabBarProps = $props();

	const badges = getBadgesStore();
	const tNav = $derived(t.nav);
	const currentPath = $derived(page.url.pathname);
	const showMessagesDot = $derived(badges.unreadMessages > 0);
</script>

<nav class="flex items-center justify-center gap-1 px-2 pb-2" aria-label={tNav['primary']}>
	{#each MOBILE_TABS as item (item.href)}
		{@const active = item.isActive(currentPath)}
		<a
			href={item.href}
			class="group flex items-center rounded-full px-2.5 py-1.5 transition-colors {active
				? 'bg-neutral-content/15 text-accent'
				: 'text-neutral-content/70'}"
			aria-current={active ? 'page' : undefined}
		>
			<span class="relative inline-flex">
				<Icon path={item.icon} size={20} />
				{#if item.labelKey === 'messages' && showMessagesDot}
					<span
						class="pointer-events-none absolute -right-1 -top-0.5 size-2 rounded-full bg-accent ring-2 ring-neutral"
					></span>
				{/if}
			</span>
			<span
				class="overflow-hidden whitespace-nowrap text-sm font-medium transition-all duration-200 ease-out {active
					? 'ml-1.5 max-w-[8rem] opacity-100'
					: 'max-w-0 opacity-0 group-hover:ml-1.5 group-hover:max-w-[8rem] group-hover:opacity-100'}"
			>
				{tNav[item.labelKey]}
			</span>
		</a>
	{/each}
</nav>
