<script lang="ts">
	import { onMount } from 'svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import DiscussionRow from '$lib/components/organisms/DiscussionRow.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import { loadOfflineDiscussions } from '$lib/offline/queries';
	import type { OfflineDiscussionView } from '$lib/offline/types';
	import type { DiscussionRowItem } from '$lib/types/discussion-row';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Cached content is read from IndexedDB after hydration (client-only). The
	// route itself is server-rendered, so the layout's user/t — and therefore the
	// sidebar's logged-in state — are embedded in the document and survive a
	// direct load / offline navigation. See $lib/offline/queries.ts.
	let discussions = $state<OfflineDiscussionView[]>([]);
	let loading = $state(true);

	onMount(async () => {
		discussions = await loadOfflineDiscussions();
		loading = false;
	});

	function displayName(d: OfflineDiscussionView): string {
		return d.author.displayName ?? data.t.offline.reader.unknownUser;
	}

	// Project a cached discussion into the shape DiscussionRow renders. viewCount
	// is omitted (not cached offline) so the views label is hidden; the row links
	// to the offline reader instead of the online thread. lastReplyAt falls back
	// to createdAt (the online DAO coalesces the same way) so threads with no
	// replies still show a timestamp instead of 1970.
	function toRow(d: OfflineDiscussionView): DiscussionRowItem {
		return {
			id: d.id,
			title: d.title,
			slug: d.slug,
			authorId: d.authorId,
			authorDisplayName: displayName(d),
			authorUsername: d.author.username ?? 'user',
			authorAvatarFileId: d.author.avatarFileId,
			commentCount: d.commentCount,
			isPinned: d.isPinned,
			lastReplyAt: (d.lastReplyAt ?? d.createdAt) * 1000
		};
	}
</script>

<svelte:head>
	<title>Janbao</title>
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
		{#if loading}
			<div class="flex items-center justify-center gap-2 py-10 text-sm text-base-content/50">
				<span class="loading loading-spinner loading-sm"></span>
				{data.t.common.loading}
			</div>
		{:else if discussions.length === 0}
			<EmptyState message={data.t.offline.reader.empty} bordered={false} />
		{:else}
			<!-- Same wrapper + row component as the home page (DiscussionListPage)
			     so the offline list stays pixel-aligned with the online front page.
			     Rows link to the offline reader and omit the bookmark star. -->
			<div class="bg-base-100 overflow-hidden border-t border-b border-base-300">
				<div class="divide-y divide-base-300">
					{#each discussions as d (d.id)}
						<DiscussionRow
							discussion={toRow(d)}
							discussionHref={`/offline/${d.id}`}
							showBookmark={false}
							t={data.t}
						/>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</DualColumnLayout>
