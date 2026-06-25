<script lang="ts">
	import { onMount } from 'svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import DiscussionMetadata from '$lib/components/molecules/DiscussionMetadata.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import BookmarkButton from '$lib/components/atoms/BookmarkButton.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import { recordOfflineRead } from '$lib/offline/read-state';
	import { computeGapPlacements, type GapPlacement } from '$lib/offline/gap-placement';
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

	// Derive where to render each gap divider in the visible reply stream using
	// the pure helper. Dividers are placed at manifest RANGE BOUNDARIES (the
	// page where a cached block ends and an uncached gap begins), not by pre-
	// allocated per-range reply counts. See gap-placement.ts for the model.
	//
	// The OP-excluding `rest` array is the visible stream; `cachedReplyCount`
	// tells the helper where the last cached block ends so it can clamp the
	// trailing-divider index.
	const gapView = $derived.by(() => {
		const summary = data.replyGaps;
		const rest = partitioned.rest;
		return computeGapPlacements({
			cachedRanges: summary?.cachedRanges ?? [],
			gaps: summary?.gaps ?? [],
			pageSize: summary?.pageSize ?? 0,
			totalPages: summary?.totalPages ?? 0,
			cachedReplyCount: rest.length
		});
	});

	// Look up which gap (if any) should render before the i-th rest reply.
	function placementBeforeIndex(i: number): GapPlacement | null {
		for (const p of gapView.placements) {
			if (p.beforeIndex === i) return p;
		}
		return null;
	}

	function gapLabel(g: GapPlacement): string {
		const reader = data.t.offline.reader;
		const approx = String(g.approxReplies);
		if (g.gap.start === g.gap.end) {
			return reader.gapSingle.replace('{page}', String(g.gap.start)).replace('{count}', approx);
		}
		return reader.gapRange
			.replace('{start}', String(g.gap.start))
			.replace('{end}', String(g.gap.end))
			.replace('{count}', approx);
	}

	function restNotCachedLabel(): string {
		const hint = gapView.restNotCached;
		if (!hint) return '';
		return data.t.offline.reader.restNotCached.replace('{count}', String(hint.approxReplies));
	}

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
						avatarUrl={partitioned.op.author.avatarUrl}
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
				<p class="text-sm opacity-70">
					{#if data.listingOnly}
						{data.t.offline.reader.listingOnly}
					{:else}
						{data.t.offline.reader.empty}
					{/if}
				</p>
			{:else if partitioned.rest.length > 0}
				<!-- Replies Stream -->
				<div class="divide-y divide-base-300 border-t border-base-300">
					{#each partitioned.rest as reply, i (reply.id)}
						{@const placement = placementBeforeIndex(i)}
						{#if placement}
							<!-- DV07 multi-range gap divider: rendered at the boundary
							     between a cached block and the uncached page range that
							     follows it (or precedes it, for a leading divider). -->
							<p class="py-3 text-center text-xs italic text-base-content/50">
								{gapLabel(placement)}
							</p>
						{/if}
						<div id="reply-{reply.id}" class="space-y-4 py-4">
							<DiscussionMetadata
								userId={reply.authorId}
								username={resolveUsername(reply)}
								displayName={resolveName(reply)}
								avatarUrl={reply.author.avatarUrl}
								createdAt={reply.createdAt * 1000}
								editedAt={reply.editedAt ? reply.editedAt * 1000 : null}
								t={data.t}
							/>
							<article class="prose prose-sm max-w-none">
								<LexicalRenderer contentJson={reply.contentJson} t={data.t} />
							</article>
						</div>
					{/each}
					{#if gapView.trailingPlacement}
						<!-- DV07 trailing gap divider: the uncached page range that
						     follows the last cached block. Its slot index lands at
						     rest.length, past the each loop's [0, rest.length) range,
						     so it is rendered separately after the reply stream. -->
						<p class="py-3 text-center text-xs italic text-base-content/50">
							{gapLabel(gapView.trailingPlacement)}
						</p>
					{/if}
				</div>
			{:else if gapView.restNotCached}
				<!-- CO-C04-3: OP is cached but no paginated replies to anchor a
				     divider - show a single "rest not cached" hint after the OP. -->
				<p class="py-3 text-center text-xs italic text-base-content/50">
					{restNotCachedLabel()}
				</p>
			{/if}
		{:else}
			<p class="text-sm opacity-70">{data.t.offline.reader.notCached}</p>
			<a class="btn btn-outline btn-sm" href="/offline">
				← {data.t.offline.reader.backToList}
			</a>
		{/if}
	</div>
</DualColumnLayout>
