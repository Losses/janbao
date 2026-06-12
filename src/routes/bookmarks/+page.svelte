<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { goto } from '$app/navigation';
	import type { BookmarkListItem } from '$lib/types/api';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const bookmarkT = $derived(t.bookmark);
	const user = $derived(data.user);
	const bookmarks = $derived(data.bookmarks as BookmarkListItem[]);

	const userSlug = $derived(generateSlug(user?.username || ''));

	function handlePageChange(newPage: number) {
		goto(`?page=${newPage}`);
	}
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
	<div class="space-y-6">
		<h1 class="text-2xl font-bold border-b border-base-300 pb-4">{bookmarkT.myBookmarks}</h1>

		{#if bookmarks.length === 0}
			<div
				class="card bg-base-200/40 border border-base-200 p-10 text-center text-base-content/50 rounded-xl"
			>
				{bookmarkT.noBookmarks}
			</div>
		{:else}
			<div class="space-y-3">
				{#each bookmarks as bookmark (bookmark.discussionId)}
					<a
						href="/discussion/{bookmark.discussionId}/{bookmark.slug || 'discussion'}"
						class="card bg-base-100 border border-base-200 hover:border-primary/40 transition-colors rounded-xl p-4 shadow-sm block"
					>
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0 flex-1">
								<h3 class="font-semibold text-base-content truncate">{bookmark.title}</h3>
								<p class="text-xs text-base-content/50 mt-1">
									{bookmark.categoryTitle} · {bookmarkT.startedBy}
									{bookmark.authorDisplayName}
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
					</a>
				{/each}
			</div>

			<div class="flex justify-end pt-2">
				<Paginator
					currentPage={data.page}
					totalPages={data.totalPages}
					onPageChange={handlePageChange}
					{t}
				/>
			</div>
		{/if}
	</div>
</DualColumnLayout>
