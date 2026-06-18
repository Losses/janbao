<script lang="ts">
	import { onMount } from 'svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import DiscussionMetadata from '$lib/components/molecules/DiscussionMetadata.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import BookmarkButton from '$lib/components/atoms/BookmarkButton.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import { recordOfflineRead } from '$lib/offline/read-state';
	import type { PageProps } from './$types';
	import type { OfflineReplyView } from '$lib/offline/types';

	let { data }: PageProps = $props();

	// Record this offline read into the local outbox; it syncs back to the server
	// (last-write-wins) on reconnect without touching the online read mechanism.
	onMount(() => {
		if (navigator.onLine) return;
		const disc = data.discussion;
		if (!disc) return;
		const last = data.replies.length > 0 ? data.replies[data.replies.length - 1] : null;
		void recordOfflineRead(disc.id, last?.id ?? null, 1);
	});

	// The lowest-id reply is the OP (existing convention). Split it out so it can
	// render with the same prominence as the online thread (full-width, above the
	// divider); the rest stream below as normal replies.
	const partitioned = $derived.by(() => {
		const sorted = [...data.replies].sort((a, b) => a.id - b.id);
		const op = sorted.length > 0 ? sorted[0] : null;
		const rest: OfflineReplyView[] = op ? sorted.slice(1) : sorted;
		return { op, rest };
	});

	// Fallback display for replies whose author isn't cached yet (e.g. editedBy
	// referencing a now-deleted account, or content synced before the users
	// stream shipped). Keeps the reader from crashing on partial cache.
	function resolveName(reply: OfflineReplyView): string {
		return reply.author.displayName ?? data.t.offline.reader.unknownUser;
	}
	function resolveUsername(reply: OfflineReplyView): string {
		return reply.author.username ?? 'user';
	}
</script>

<svelte:head>
	<title>{data.discussion?.title ?? 'Janbao'} · Janbao</title>
</svelte:head>

{#snippet sidebar()}
	<div class="space-y-4">
		{#if data.user}
			<UserInfoBlock user={data.user} t={data.t} />
			<div class="flex flex-col gap-2">
				<a
					class="btn btn-outline btn-sm w-full"
					href="/profile/discussions/{data.user.id}/{generateSlug(data.user.username)}"
				>
					{data.t.sidebar.myDiscussions}
				</a>
				<a class="btn btn-outline btn-sm w-full" href="/drafts">
					{data.t.sidebar.myDrafts}
				</a>
			</div>
		{:else}
			<div class="space-y-2">
				<h3 class="font-semibold text-sm text-base-content/70">{data.t.home.welcomeTo}</h3>
			</div>
		{/if}
	</div>
{/snippet}

<DualColumnLayout t={data.t} user={data.user} {sidebar}>
	<div class="space-y-3">
		{#if data.discussion}
			<!-- Discussion Header: single subtle "offline" badge, no repetition per reply -->
			<div class="border-b border-base-300 flex justify-between items-center pb-3 gap-3">
				<div class="flex items-center gap-2 min-w-0">
					<h1
						class="text-lg font-extrabold tracking-tight text-base-content break-words leading-tight"
					>
						{data.discussion.title}
					</h1>
				</div>
				<BookmarkButton
					discussionId={data.discussionId}
					bookmarked={data.isBookmarked}
					t={data.t}
					class="flex-shrink-0 mt-0.5"
				/>
			</div>

			{#if partitioned.op}
				<!-- Original Post -->
				<div id="reply-{partitioned.op.id}" class="space-y-4 pb-4">
					<DiscussionMetadata
						userId={partitioned.op.authorId}
						username={resolveUsername(partitioned.op)}
						displayName={resolveName(partitioned.op)}
						avatarFileId={partitioned.op.author.avatarFileId}
						createdAt={partitioned.op.createdAt * 1000}
						editedAt={partitioned.op.editedAt ? partitioned.op.editedAt * 1000 : null}
						t={data.t}
					/>
					<article class="prose prose-sm max-w-none">
						<LexicalRenderer contentJson={partitioned.op.contentJson} t={data.t} />
					</article>
				</div>
			{/if}

			{#if partitioned.rest.length === 0 && !partitioned.op}
				<p class="text-sm opacity-70">{data.t.offline.reader.empty}</p>
			{:else if partitioned.rest.length > 0}
				<!-- Replies Stream -->
				<div class="divide-y divide-base-300 border-t border-base-300">
					{#each partitioned.rest as reply, i (reply.id)}
						{#if data.partialGap && i === data.partialGap.firstPageRestCount}
							<p class="py-3 text-center text-xs italic text-base-content/50">
								{data.t.offline.reader.uncachedReplies.replace(
									'{count}',
									String(data.partialGap.uncachedPages)
								)}
							</p>
						{/if}
						<div id="reply-{reply.id}" class="space-y-4 py-4">
							<DiscussionMetadata
								userId={reply.authorId}
								username={resolveUsername(reply)}
								displayName={resolveName(reply)}
								avatarFileId={reply.author.avatarFileId}
								createdAt={reply.createdAt * 1000}
								editedAt={reply.editedAt ? reply.editedAt * 1000 : null}
								t={data.t}
							/>
							<article class="prose prose-sm max-w-none">
								<LexicalRenderer contentJson={reply.contentJson} t={data.t} />
							</article>
						</div>
					{/each}
				</div>
			{/if}
		{:else}
			<p class="text-sm opacity-70">{data.t.offline.reader.notCached}</p>
			<a class="btn btn-outline btn-sm" href="/offline">
				← {data.t.offline.reader.backToList}
			</a>
		{/if}
	</div>
</DualColumnLayout>
