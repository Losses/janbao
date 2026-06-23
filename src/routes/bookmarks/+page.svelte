<script lang="ts">
	import { onMount } from 'svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { goto } from '$app/navigation';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import type { BookmarkListItem } from '$lib/types/api';
	import type { PageData } from './$types';
	import GesturePageLayout from '$lib/components/templates/GesturePageLayout.svelte';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();
	const online = getOnlineStore();
	const t = $derived(data.t);
	const bookmarkT = $derived(t.bookmark);
	const user = $derived(data.user);
	const bookmarks = $derived(data.bookmarks as BookmarkListItem[]);

	const userSlug = $derived(user ? generateSlug(user.username) : '');

	function handlePageChange(page: number) {
		void goto(`/bookmarks?page=${page}`);
	}

	onMount(() => {
		if (!user) {
			void goto('/entry/signin');
		}
	});
</script>

<svelte:head>
	<title>{formatTitle(bookmarkT.myBookmarks)}</title>
</svelte:head>

{#snippet sidebar()}
	{#if user}
		<ProfileSidebar {user} {t} targetUserId={user.id} targetUserSlug={userSlug} />
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<GesturePageLayout fallbackRoute="/">
		<div class="space-y-3">
			<h1 class="page-title border-b border-base-300 pb-4">{bookmarkT.myBookmarks}</h1>

			{#if !online.online || bookmarks.length === 0}
				<EmptyState message={!online.online ? t.offline.disabled.title : bookmarkT.noBookmarks} />
			{:else}
				<div class="divide-y divide-base-300">
					{#each bookmarks as bookmark (bookmark.discussionId)}
						{@const authorSlug = generateSlug(bookmark.authorUsername || '')}
						<div class="py-3 px-0">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0 flex-1">
									<a
										href="/discussion/{bookmark.discussionId}/{bookmark.slug || 'discussion'}"
										class="font-semibold text-base-content hover:text-primary transition-colors truncate block"
									>
										{bookmark.title}
									</a>
									<p class="text-xs text-base-content/50 mt-1">
										{bookmark.categoryTitle} ·
										<a href="/profile/{bookmark.authorId}/{authorSlug}" class="hover:underline">
											{bookmark.authorDisplayName}
										</a>
									</p>
								</div>
								<div class="flex items-center gap-2 flex-shrink-0">
									<DateComponent
										value={bookmark.bookmarkedAt}
										{t}
										class="text-xs text-base-content/40"
									/>
								</div>
							</div>
						</div>
					{/each}
				</div>

				{#if data.totalPages > 1}
					<div class="flex justify-end pt-2">
						<Paginator
							currentPage={data.page}
							totalPages={data.totalPages}
							onPageChange={handlePageChange}
							{t}
						/>
					</div>
				{/if}
			{/if}
		</div>
	</GesturePageLayout>
</DualColumnLayout>
