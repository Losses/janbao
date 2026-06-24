<script lang="ts">
	import GesturePageLayout from '$lib/components/templates/GesturePageLayout.svelte';
	import ProfileMenuPanel from '$lib/components/panels/ProfileMenuPanel.svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import ProfileHeader from '$lib/components/molecules/ProfileHeader.svelte';
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import DiscussionRow from '$lib/components/organisms/DiscussionRow.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { goto, afterNavigate } from '$app/navigation';
	import { onMount } from 'svelte';
	import { writeList, passthroughEnabledFor } from '$lib/offline/passthrough';
	import type { DiscussionListItem } from '$lib/server/db/dao/discussions';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const profileT = $derived(t.profile);
	const user = $derived(data.user);
	import { formatDisplayName } from '$lib/utils/user';

	const targetUser = $derived(data.targetUser);
	const displayTargetUser = $derived(formatDisplayName(targetUser.displayName, targetUser.id, t));
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

	// DV07 C04 read passthrough: writes this profile-discussions page to IDB
	// when the user has the feature on and is online. Decision #5: gated on
	// `data.user` (passthroughEnabledFor) so guests never populate a cache.
	// Best-effort, no `$effect`.
	function runPassthrough(items: DiscussionListItem[]): void {
		if (typeof navigator !== 'undefined' && !navigator.onLine) return;
		if (!passthroughEnabledFor(data.user)) return;
		void writeList(items).catch((err) => {
			console.error('[offline passthrough] writeList failed', err);
		});
	}
	onMount(() => runPassthrough(data.discussions));
	afterNavigate(() => runPassthrough(data.discussions));
</script>

<svelte:head>
	<title>{formatTitle(`${displayTargetUser} - ${profileT.discussions}`)}</title>
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

{#snippet leftPanel()}
	{#if targetUser}
		<ProfileMenuPanel user={targetUser} {t} />
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<GesturePageLayout
		left={leftPanel}
		leftHref={targetUser && user && targetUser.id === user.id
			? '/profile'
			: `/profile/${targetUser.id}/${targetUserSlug}`}
		fallbackRoute="/profile"
	>
		<div class="space-y-3">
			<!-- Profile Header -->
			<ProfileHeader
				{targetUser}
				{invitedBy}
				email={headerEmail}
				{showLastActive}
				canMessage={!isOwner && !!user && targetUser.id !== 0}
				{t}
			/>

			<!-- Discussions Listing -->
			{#if discussionsList.length === 0}
				<EmptyState message={t.common.noResults} />
			{:else}
				<div class="bg-base-100 overflow-hidden border-t border-b border-base-300">
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
	</GesturePageLayout>
</DualColumnLayout>
