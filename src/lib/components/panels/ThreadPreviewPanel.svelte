<script lang="ts">
	/**
	 * ThreadPreviewPanel: a read-only rendering of a discussion thread, used as
	 * the back-swipe preview in MobileTabPager. Reuses the exact same atoms
	 * (DiscussionMetadata, LexicalRenderer) as the thread page so scoped CSS
	 * applies correctly (unlike the previous {@html} injection which lost all
	 * scoped styles). No forms, no editors, no interactive controls: it is a
	 * visual snapshot replaced by the real page on commit.
	 */
	import DiscussionMetadata from '$lib/components/molecules/DiscussionMetadata.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import type { ThreadPreviewData } from '$lib/stores/deep-page-snapshot.svelte';
	import type { TranslationDict } from '$lib/types/translation';

	interface ThreadPreviewPanelProps {
		data: ThreadPreviewData;
		t: TranslationDict;
	}

	let { data, t }: ThreadPreviewPanelProps = $props();

	const discussion = $derived(data.discussion);
	const opReply = $derived(data.opReply);
	const replies = $derived(data.replies);
	const mentionedUsers = $derived(data.mentionedUsers);
</script>

<div class="space-y-3">
	<!-- Discussion Header -->
	<div class="border-b border-base-300 flex justify-between items-center pb-3 gap-3">
		<h1 class="text-lg font-extrabold tracking-tight text-base-content break-words leading-tight">
			{discussion.title}
		</h1>
	</div>

	<!-- Original Post (OP) -->
	{#if opReply}
		<div id="reply-{opReply.id}" class="space-y-4">
			<DiscussionMetadata
				userId={opReply.authorId}
				username={opReply.authorUsername}
				displayName={opReply.authorDisplayName}
				avatarUrl={opReply.authorAvatarUrl}
				createdAt={opReply.createdAt}
				editedAt={opReply.editedAt}
				editedByDisplayName={opReply.editedByDisplayName}
				editedById={opReply.editedBy}
				{t}
			/>
			<LexicalRenderer contentJson={opReply.contentJson} {mentionedUsers} {t} />
		</div>
	{/if}

	<!-- Replies Stream -->
	{#if replies.length > 0}
		<div class="divide-y divide-base-300 border-t border-base-300 pt-4">
			{#each replies as reply (reply.id)}
				<div id="reply-{reply.id}" class="space-y-4 py-4 first:pt-0 last:pb-0">
					<DiscussionMetadata
						userId={reply.authorId}
						username={reply.authorUsername}
						displayName={reply.authorDisplayName}
						avatarUrl={reply.authorAvatarUrl}
						createdAt={reply.createdAt}
						editedAt={reply.editedAt}
						editedByDisplayName={reply.editedByDisplayName}
						editedById={reply.editedBy}
						{t}
					/>
					<LexicalRenderer contentJson={reply.contentJson} {mentionedUsers} {t} />
				</div>
			{/each}
		</div>
	{/if}
</div>
