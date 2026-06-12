<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
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
	let isDrawerOpen = $state(false);

	const targetSlug = $derived(generateSlug(targetUser.username));
	const isOwner = $derived(user?.id === targetUser.id);

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
	<div class="card bg-base-200 border border-base-300 p-4 space-y-4">
		<div class="flex items-center gap-3">
			<Avatar
				src={targetUser.avatarFileId ? `/img/${targetUser.avatarFileId}` : null}
				displayName={targetUser.displayName}
				size="md"
			/>
			<div class="min-w-0">
				<a
					href="/profile/{targetUser.id}/{targetSlug}"
					class="font-semibold text-base-content hover:text-primary transition-colors block truncate"
				>
					{targetUser.displayName}
				</a>
				<span class="text-xs text-base-content/50">@{targetUser.username}</span>
			</div>
		</div>
		<div class="divider my-1"></div>
		<ul class="menu menu-sm w-full gap-1">
			<li><a href="/profile/{targetUser.id}/{targetSlug}">{profileT.dynamics}</a></li>
			{#if isOwner}
				<li><a href="/notifications">{profileT.notifications}</a></li>
				<li><a href="/profile/invitations">{profileT.invitations}</a></li>
				<li><a href="/messages/inbox">{profileT.mailbox}</a></li>
			{/if}
			<li>
				<a href="/profile/discussions/{targetUser.id}/{targetSlug}">{profileT.discussions}</a>
			</li>
			<li>
				<a href="/profile/comments/{targetUser.id}/{targetSlug}" class="active">
					{profileT.comments}
				</a>
			</li>
			{#if isOwner}
				<li class="menu-title mt-2">{profileT.accountSettings}</li>
				<li><a href="/profile/edit">{profileT.editAccount}</a></li>
				<li><a href="/profile/password">{profileT.changePassword}</a></li>
				<li><a href="/profile/preferences">{profileT.preferences}</a></li>
				<li><a href="/profile/picture">{profileT.avatar}</a></li>
				<li><a href="/profile/OnlineNow">{profileT.stealthSettings}</a></li>
			{/if}
		</ul>
	</div>
{/snippet}

<DualColumnLayout {sidebar} bind:isDrawerOpen>
	<div class="space-y-6">
		<h1 class="text-2xl font-bold border-b border-base-300 pb-4">
			{targetUser.displayName} — {profileT.comments}
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
						<LexicalRenderer contentJson={view.comment.contentJson} />
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
