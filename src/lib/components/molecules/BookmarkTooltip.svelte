<script lang="ts">
	/**
	 * BookmarkTooltip Molecule - Popover displaying the 5 most recently
	 * bookmarked discussions. Lazily fetches `/api/bookmarks?limit=5` when opened.
	 */
	import Tooltip from '$lib/components/atoms/Tooltip.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import { mdiBookmark } from '@mdi/js';
	import type { VoidHandler } from '$lib/types/handlers';
	import type { BookmarkListItem } from '$lib/types/api';

	import type { TranslationDict } from '$lib/types/translation';

	interface BookmarkTooltipProps {
		isOpen: boolean;
		onToggle: VoidHandler;
		onClose: VoidHandler;
		t: TranslationDict;
	}

	let { isOpen, onToggle, onClose, t }: BookmarkTooltipProps = $props();

	const tSidebar = $derived((t['sidebar'] as Record<string, string> | undefined) ?? {});
	const tBookmark = $derived((t['bookmark'] as Record<string, string> | undefined) ?? {});

	let bookmarks = $state<BookmarkListItem[]>([]);
	let loaded = $state(false);

	$effect(() => {
		if (!isOpen || loaded) return;
		void load();
	});

	async function load() {
		try {
			const res = await fetch('/api/bookmarks?limit=5');
			if (res.ok) {
				const data = (await res.json()) as { bookmarks: BookmarkListItem[] };
				bookmarks = data.bookmarks ?? [];
			}
		} catch {
			bookmarks = [];
		}
		loaded = true;
	}
</script>

<Tooltip {isOpen} {onToggle} {onClose}>
	<button
		type="button"
		class="btn btn-ghost btn-xs sidebar-icon-btn"
		aria-label={tSidebar['bookmarks'] ?? ''}
		title={tSidebar['bookmarks'] ?? ''}
		aria-expanded={isOpen}
		aria-haspopup="dialog"
	>
		<Icon path={mdiBookmark} size={16} />
	</button>

	{#snippet popover()}
		<div class="flex flex-col">
			<!-- Header -->
			<div class="border-b border-base-300 px-4 py-2">
				<span class="text-sm font-medium">{tSidebar['bookmarks']}</span>
			</div>
			<!-- Bookmark List -->
			<ul class="max-h-64 overflow-y-auto">
				{#each bookmarks as bookmark (bookmark.discussionId)}
					<li
						class="border-b border-base-200 px-4 py-2 transition-colors duration-150 hover:bg-base-200"
					>
						<a
							href="/discussion/{bookmark.discussionId}/{bookmark.slug || 'discussion'}"
							class="block"
						>
							<p class="text-xs text-base-content/80 hover:text-primary truncate">
								{bookmark.title}
							</p>
							<DateComponent
								value={bookmark.bookmarkedAt}
								{t}
								class="text-xs text-base-content/40"
							/>
						</a>
					</li>
				{:else}
					<li class="px-4 py-3 text-xs text-base-content/40">{tBookmark['noBookmarks']}</li>
				{/each}
			</ul>
			<!-- Footer -->
			<div class="border-t border-base-300 px-4 py-2 text-center">
				<a href="/bookmarks" class="text-xs text-primary hover:font-bold">
					{tSidebar['showAll']}
				</a>
			</div>
		</div>
	{/snippet}
</Tooltip>
