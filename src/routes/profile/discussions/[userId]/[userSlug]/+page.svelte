<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import DiscussionRow from '$lib/components/organisms/DiscussionRow.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const profileT = $derived(t.profile);
	const user = $derived(data.user);
	const targetUser = $derived(data.targetUser);
	const discussionsList = $derived(data.discussions);
	const currentPage = $derived(data.page);
	const totalPages = $derived(data.totalPages);

	const targetUserSlug = $derived(generateSlug(targetUser.username));

	function handlePageChange(newPage: number) {
		goto(`?page=${newPage}`);
	}
</script>

<svelte:head>
	<title>{formatTitle(`${targetUser.displayName} - ${profileT.discussions}`)}</title>
</svelte:head>

{#snippet sidebar()}
	<ProfileSidebar
		{user}
		{t}
		activeItem="discussions"
		targetUserId={targetUser.id}
		{targetUserSlug}
	/>
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-6">
		<!-- Title Banner -->
		<div class="flex items-center justify-between border-b border-base-300 pb-4">
			<h1 class="text-2xl font-bold tracking-tight">
				{targetUser.displayName} - {profileT.discussions}
			</h1>
			<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
		</div>

		<!-- Discussions Listing -->
		{#if discussionsList.length === 0}
			<div
				class="card bg-base-200/40 border border-base-200 p-10 text-center text-base-content/50 rounded-xl"
			>
				{t.common.noResults}
			</div>
		{:else}
			<div class="bg-base-100 overflow-hidden">
				<div class="divide-y divide-base-200">
					{#each discussionsList as discussion (discussion.id)}
						<DiscussionRow
							{discussion}
							readHistory={discussion.readHistory}
							isBookmarked={discussion.isBookmarked}
							unreadCount={discussion.unreadCount}
							lastReplyAuthorDisplayName={discussion.lastReplyAuthorDisplayName}
							lastReplyAuthorId={discussion.lastReplyAuthorId}
							lastReplyAuthorUsername={discussion.lastReplyAuthorUsername}
							{t}
						/>
					{/each}
				</div>
			</div>

			<!-- Bottom Paginator -->
			<div class="flex justify-end pt-2">
				<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
			</div>
		{/if}
	</div>
</DualColumnLayout>
