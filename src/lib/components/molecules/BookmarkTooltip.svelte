<script lang="ts">
	/**
	 * BookmarkTooltip Molecule — Popover displaying the 5 most recent bookmarked discussions.
	 * During Cycle 2, uses mock data.
	 */
	import Tooltip from '$lib/components/atoms/Tooltip.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiBookmark } from '@mdi/js';

	interface BookmarkTooltipProps {
		isOpen: boolean;
		onToggle: () => void;
		onClose: () => void;
		t: Record<string, Record<string, string> | string>;
	}

	let { isOpen, onToggle, onClose, t }: BookmarkTooltipProps = $props();

	const tSidebar = $derived((t as Record<string, Record<string, string>>).sidebar ?? {});

	// Mock bookmark data for Cycle 2
	const mockBookmarks = [
		{
			id: '1',
			title: 'Welcome to Janbao Forum',
			slug: 'welcome-to-janbao-forum',
			time: '1 hour ago'
		},
		{ id: '2', title: 'Getting Started Guide', slug: 'getting-started-guide', time: '3 hours ago' },
		{ id: '3', title: 'Feature Requests Thread', slug: 'feature-requests', time: '1 day ago' },
		{ id: '4', title: 'Bug Reports & Feedback', slug: 'bug-reports-feedback', time: '2 days ago' },
		{ id: '5', title: 'Community Guidelines', slug: 'community-guidelines', time: '1 week ago' }
	];
</script>

<Tooltip {isOpen} {onToggle} {onClose}>
	<button
		type="button"
		class="btn btn-ghost btn-xs"
		aria-label={tSidebar['bookmarks'] ?? 'Bookmarks'}
		title={tSidebar['bookmarks'] ?? 'Bookmarks'}
		aria-expanded={isOpen}
		aria-haspopup="dialog"
	>
		<Icon path={mdiBookmark} size={16} />
	</button>

	{#snippet popover()}
		<div class="flex flex-col">
			<!-- Header -->
			<div class="border-b border-base-300 px-4 py-2">
				<span class="text-sm font-medium">{tSidebar['bookmarks'] ?? 'Bookmarks'}</span>
			</div>
			<!-- Bookmark List -->
			<ul class="max-h-64 overflow-y-auto">
				{#each mockBookmarks as bookmark (bookmark.id)}
					<li
						class="border-b border-base-200 px-4 py-2 transition-colors duration-150 hover:bg-base-200"
					>
						<a href="/discussion/{bookmark.id}/{bookmark.slug}" class="block">
							<p class="text-xs text-base-content/80 hover:text-primary">{bookmark.title}</p>
							<span class="text-xs text-base-content/40">{bookmark.time}</span>
						</a>
					</li>
				{/each}
			</ul>
			<!-- Footer -->
			<div class="border-t border-base-300 px-4 py-2 text-center">
				<a href="/bookmarks" class="text-xs text-primary hover:font-bold">
					{tSidebar['showAll'] ?? 'Show All'}
				</a>
			</div>
		</div>
	{/snippet}
</Tooltip>
