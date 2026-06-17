<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import ProfileHeader from '$lib/components/molecules/ProfileHeader.svelte';
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
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
	const invitedBy = $derived(data.invitedBy);
	const headerEmail = $derived(data.headerEmail);
	const discussionsList = $derived(data.discussions);
	const currentPage = $derived(data.page);
	const totalPages = $derived(data.totalPages);

	const targetUserSlug = $derived(generateSlug(targetUser.username));
	const isOwner = $derived(!!user && user.id === targetUser.id);
	const showLastActive = $derived(!targetUser.isStealth || isOwner || user?.groupSlug === 'admin');

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
		targetUserGroupSlug={data.targetUserGroupSlug}
		targetUserEmail={data.targetUserEmail}
		manageableGroups={data.manageableGroups}
	/>
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-3">
		<!-- Profile Header -->
		<ProfileHeader {targetUser} {invitedBy} email={headerEmail} {showLastActive} {t} />

		<!-- Discussions Listing -->
		{#if discussionsList.length === 0}
			<EmptyState message={t.common.noResults} />
		{:else}
			<div class="bg-base-100 overflow-hidden">
				<div class="divide-y divide-base-300">
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
			{#if totalPages > 1}
				<div class="flex justify-end pt-2">
					<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
				</div>
			{/if}
		{/if}
	</div>
</DualColumnLayout>
