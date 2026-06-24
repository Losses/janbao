<script lang="ts">
	import GesturePageLayout from '$lib/components/templates/GesturePageLayout.svelte';
	import ProfileMenuPanel from '$lib/components/panels/ProfileMenuPanel.svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import ProfileHeader from '$lib/components/molecules/ProfileHeader.svelte';
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { goto } from '$app/navigation';
	import type { UserCommentItem } from '$lib/server/db/dao/comments';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const commentT = $derived(t.comment);
	const profileT = $derived(t.profile);
	const user = $derived(data.user);
	const targetUser = $derived(data.targetUser);
	const invitedBy = $derived(data.invitedBy);
	const headerEmail = $derived(data.headerEmail);
	const comments = $derived(data.comments);
	const currentPage = $derived(data.page);
	const totalPages = $derived(data.totalPages);

	const targetSlug = $derived(generateSlug(targetUser.username));
	const isOwner = $derived(!!user && user.id === targetUser.id);
	const showLastActive = $derived(!targetUser.isStealth || isOwner || user?.groupSlug === 'admin');

	interface CommentView {
		comment: UserCommentItem;
		contextLabel: string;
		href: string;
	}

	function buildView(comment: UserCommentItem): CommentView {
		return {
			comment,
			contextLabel: `${commentT.replyIn}: ${comment.discussionTitle}`,
			href: `/discussion/${comment.discussionId}/${comment.discussionSlug}`
		};
	}

	function handlePageChange(newPage: number) {
		goto(`?page=${newPage}`);
	}

	const views = $derived(comments.map(buildView));
</script>

<svelte:head>
	<title>{formatTitle(profileT.comments)}</title>
</svelte:head>

{#snippet sidebar()}
	<ProfileSidebar
		{user}
		{t}
		activeItem="comments"
		targetUserId={targetUser.id}
		targetUserSlug={targetSlug}
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
			: `/profile/${targetUser.id}/${targetSlug}`}
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

			{#if views.length === 0}
				<EmptyState message={commentT.noComments} />
			{:else}
				<div class="bg-base-100 overflow-hidden">
					<div class="divide-y divide-base-300">
						{#each views as view (view.comment.id)}
							<div class="py-4 space-y-2">
								<LexicalRenderer
									contentJson={view.comment.contentJson}
									mentionedUsers={data.mentionedUsers}
									{t}
								/>
								<div class="flex items-center justify-between gap-2 pt-2">
									<a href={view.href} class="text-xs text-primary hover:underline truncate">
										{view.contextLabel}
									</a>
									<DateComponent
										value={view.comment.createdAt}
										{t}
										class="text-xs text-base-content/40 flex-shrink-0"
									/>
								</div>
							</div>
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
