<script lang="ts">
	/**
	 * BottomNav Organism - Mobile-only fixed bottom navigation bar with the
	 * primary destinations (Discussions / Activity / Messages). Hides together
	 * with the App Bar on scroll-down via the shared scroll-chrome store, and
	 * returns on scroll-up. Search lives on the App Bar (see Header) rather than
	 * here. The messages item surfaces an unread badge from the badges store.
	 */
	import { page } from '$app/state';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import Badge from '$lib/components/atoms/Badge.svelte';
	import { mdiForum, mdiLightningBolt, mdiEmailOutline } from '@mdi/js';
	import { getBadgesStore } from '$lib/stores/badges.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { formatBadgeCount } from '$lib/utils/count';
	import type { TranslationDict } from '$lib/types/translation';

	type NavLabelKey = 'discussions' | 'activity' | 'messages';

	type NavMatcher = (pathname: string) => boolean;

	interface NavItem {
		href: string;
		labelKey: NavLabelKey;
		icon: string;
		showMessageBadge: boolean;
		isActive: NavMatcher;
	}

	interface BottomNavProps {
		t: TranslationDict;
	}

	let { t }: BottomNavProps = $props();

	const scrollChrome = getScrollChromeStore();
	const badges = getBadgesStore();

	// The Discussions tab covers the discussion list (`/`, `/discussions/pN`) AND a
	// thread view (`/discussion/[id]/...`) - all share the same primary section.
	const isDiscussions: NavMatcher = (p) => p === '/' || p.startsWith('/discussion');
	const isActivity: NavMatcher = (p) => p.startsWith('/activity');
	const isMessages: NavMatcher = (p) => p.startsWith('/messages');

	const items: NavItem[] = [
		{
			href: '/',
			labelKey: 'discussions',
			icon: mdiForum,
			showMessageBadge: false,
			isActive: isDiscussions
		},
		{
			href: '/activity',
			labelKey: 'activity',
			icon: mdiLightningBolt,
			showMessageBadge: false,
			isActive: isActivity
		},
		{
			href: '/messages/inbox',
			labelKey: 'messages',
			icon: mdiEmailOutline,
			showMessageBadge: true,
			isActive: isMessages
		}
	];

	const tNav = $derived(t.nav);
	const currentPath = $derived(page.url.pathname);
	const unreadMessages = $derived(badges.unreadMessages);
</script>

<nav
	class="fixed bottom-0 left-0 right-0 z-40 border-t border-neutral-content/10 bg-neutral text-neutral-content transition-transform duration-200 md:hidden {scrollChrome.hidden
		? 'translate-y-full'
		: ''}"
	aria-label={tNav['primary']}
>
	<ul class="mx-auto flex max-w-[960px] items-stretch justify-around">
		{#each items as item (item.href)}
			{@const active = item.isActive(currentPath)}
			<li class="flex-1">
				<a
					href={item.href}
					class="flex flex-col items-center justify-center gap-0.5 py-2 text-[0.7rem] leading-none {active
						? 'text-accent'
						: 'text-neutral-content/70'}"
					aria-current={active ? 'page' : undefined}
				>
					<span class="relative inline-flex">
						<Icon path={item.icon} size={22} />
						{#if item.showMessageBadge && unreadMessages > 0}
							<Badge
								variant="primary"
								size="xs"
								class="pointer-events-none absolute -right-2 -top-1.5 min-w-[1rem]"
							>
								{formatBadgeCount(unreadMessages)}
							</Badge>
						{/if}
					</span>
					<span>{tNav[item.labelKey]}</span>
				</a>
			</li>
		{/each}
	</ul>
</nav>
