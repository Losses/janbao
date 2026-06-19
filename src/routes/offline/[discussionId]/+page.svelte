<script lang="ts">
	import { onMount } from 'svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import DiscussionMetadata from '$lib/components/molecules/DiscussionMetadata.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import BookmarkButton from '$lib/components/atoms/BookmarkButton.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import { recordOfflineRead } from '$lib/offline/read-state';
	import type { ReplyGap } from '$lib/offline/manifest';
	import type { PageProps } from './$types';
	import type { OfflineReplyView } from '$lib/offline/types';

	// Page size used to map each cached reply's position to a page number, so a
	// gap divider can be rendered at the right boundary in the visible stream.
	// Comes from the manifest row (same pageSize the writers used to bucket).
	interface RenderedGap {
		gap: ReplyGap;
		// Render the divider BEFORE the reply at this index in `rest`.
		beforeIndex: number;
		// Approximate reply count covered by this gap (page count * pageSize,
		// already clamped to commentCount in manifest-recompute).
		approxReplies: number;
	}

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

	// Derive where to render each gap divider in the visible reply stream.
	//
	// The cached replies (sorted by id, OP split off) are a SUBSET of the full
	// thread — they may represent non-contiguous absolute pages (e.g. sync
	// depth 'firstLast' caches page 1 + the last page; passthrough caches a
	// single visited page). To place a gap divider correctly we must know
	// where one cached block ends and the next begins IN THE VISIBLE STREAM.
	//
	// Approach: walk the manifest's cachedRanges in order. Each range covers
	// (end - start + 1) pages × pageSize reply slots. The first slot of page 1
	// is the OP (already split off), so the first cached range contributes
	// (pages × pageSize - 1) replies to `rest`. Subsequent ranges contribute
	// (pages × pageSize) replies each. We consume `rest` replies into each
	// range in order; a gap exists between consecutive ranges, and we render
	// its divider at the boundary index in `rest`.
	const gapPlacements = $derived.by<RenderedGap[]>(() => {
		const summary = data.replyGaps;
		const gaps = summary?.gaps ?? [];
		if (gaps.length === 0) return [];
		const pageSize = summary?.pageSize ?? 0;
		if (pageSize <= 0) return [];
		const cachedRanges = summary?.cachedRanges ?? [];
		if (cachedRanges.length === 0) return [];
		const rest = partitioned.rest;
		if (rest.length === 0) return [];

		// Allocate rest replies to cached ranges in order. repliesPerRange[i]
		// is how many `rest` replies belong to cachedRanges[i]. The first range
		// that includes page 1 has the OP subtracted (1 fewer rest reply).
		const repliesPerRange: number[] = cachedRanges.map((r, i) => {
			const pages = r.end - r.start + 1;
			const includesPage1 = r.start === 1;
			const base = pages * pageSize;
			return includesPage1 && i === 0 ? Math.max(0, base - 1) : base;
		});

		// Walk ranges, consuming rest replies. A gap exists between range[i]
		// and range[i+1]; find the matching gap and place its divider at the
		// boundary (the cumulative consumed count).
		const placements: RenderedGap[] = [];
		let consumed = 0;
		for (let i = 0; i < cachedRanges.length; i++) {
			consumed += repliesPerRange[i];
			// Clamp to rest.length so a divider never lands past the end.
			const boundary = Math.min(consumed, rest.length);
			if (i + 1 >= cachedRanges.length) break; // no gap after the last range
			const nextRange = cachedRanges[i + 1];
			// Find the gap that sits between this range and the next.
			const gap = gaps.find(
				(g) => g.start === cachedRanges[i].end + 1 && g.end === nextRange.start - 1
			);
			if (gap && boundary > 0 && boundary <= rest.length) {
				placements.push({
					gap,
					beforeIndex: boundary,
					approxReplies: gap.pageCount * pageSize
				});
			}
		}
		return placements;
	});

	// Look up which gap (if any) should render before the i-th rest reply.
	function gapBeforeIndex(i: number): RenderedGap | null {
		for (const p of gapPlacements) {
			if (p.beforeIndex === i) return p;
		}
		return null;
	}

	function gapLabel(g: RenderedGap): string {
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
						{@const gap = gapBeforeIndex(i)}
						{#if gap}
							<!-- DV07 multi-range gap divider: rendered before the first
							     cached reply that follows an uncached page range. -->
							<p class="py-3 text-center text-xs italic text-base-content/50">
								{gapLabel(gap)}
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
