<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
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
	const comments = $derived(data.comments as UserCommentItem[]);

	const targetSlug = $derived(generateSlug(targetUser.username));

	interface CommentView {
		comment: UserCommentItem;
		contextLabel: string;
		href: string;
	}

	function buildView(comment: UserCommentItem): CommentView {
		if (comment.kind === 'reply') {
			return {
				comment,
				contextLabel: `${commentT.replyIn}: ${comment.discussionTitle ?? ''}`,
				href: `/discussion/${comment.discussionId}/${comment.discussionSlug ?? 'discussion'}`
			};
		}
		return {
			comment,
			contextLabel: commentT.onActivity,
			href: `/activity#activity-${comment.parentActivityId ?? ''}`
		};
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
	/>
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-6">
		<h1 class="text-2xl font-bold border-b border-base-300 pb-4">
			{targetUser.displayName} - {profileT.comments}
		</h1>

		{#if views.length === 0}
			<div
				class="card bg-base-200/40 border border-base-200 p-10 text-center text-base-content/50 rounded-xl"
			>
				{commentT.noComments}
			</div>
		{:else}
			<div class="space-y-4">
				{#each views as view (view.comment.id)}
					<div class="card bg-base-100 border border-base-200 rounded-xl p-4 shadow-sm space-y-2">
						<LexicalRenderer
							contentJson={view.comment.contentJson}
							mentionedUsers={data.mentionedUsers}
						/>
						<div class="flex items-center justify-between gap-2 pt-2 border-t border-base-200">
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
		{/if}
	</div>
</DualColumnLayout>
