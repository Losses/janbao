<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
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
	const profileT = $derived(t.profile);
	const user = $derived(data.user);
	const bookmarks = $derived(data.bookmarks as BookmarkListItem[]);
	let isDrawerOpen = $state(false);

	const userSlug = $derived(generateSlug(user?.username || ''));

	function handlePageChange(newPage: number) {
		goto(`?page=${newPage}`);
	}
</script>

<svelte:head>
	<title>{formatTitle(bookmarkT.myBookmarks)}</title>
</svelte:head>

{#snippet sidebar()}
	<div class="card bg-base-200 border border-base-300 p-4 space-y-4">
		{#if user}
			<UserInfoBlock {user} {t} />
			<div class="divider my-1"></div>
			<ul class="menu menu-sm w-full gap-1">
				<li><a href="/profile/{user.id}/{userSlug}">{profileT.dynamics}</a></li>
				<li><a href="/notifications">{profileT.notifications}</a></li>
				<li><a href="/profile/invitations">{profileT.invitations}</a></li>
				<li><a href="/messages/inbox">{profileT.mailbox}</a></li>
				<li><a href="/profile/discussions/{user.id}/{userSlug}">{profileT.discussions}</a></li>
				<li><a href="/profile/comments/{user.id}/{userSlug}">{profileT.comments}</a></li>
				<li class="menu-title mt-2">{profileT.accountSettings}</li>
				<li><a href="/profile/edit">{profileT.editAccount}</a></li>
				<li><a href="/profile/password">{profileT.changePassword}</a></li>
				<li><a href="/profile/preferences">{profileT.preferences}</a></li>
				<li><a href="/profile/picture">{profileT.avatar}</a></li>
				<li><a href="/profile/OnlineNow">{profileT.stealthSettings}</a></li>
			</ul>
		{/if}
	</div>
{/snippet}

<DualColumnLayout {sidebar} bind:isDrawerOpen>
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
									{bookmark.categoryTitle} · {t.message.startedBy}
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
