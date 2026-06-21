<script lang="ts">
	/**
	 * DiscussionsPanel - Content-only discussion stream (paginator + rows). The
	 * presentational body shared by the home route, the `/discussions/pN`
	 * paginated route (via DiscussionListPage), and the mobile tab pager. Owns no
	 * chrome (no sidebar / DualColumnLayout) so it can be mounted three-wide in
	 * the pager track.
	 *
	 * Offline: reads cached discussions from IndexedDB and renders them as rows
	 * that link to the `/offline/{id}` reader (no bookmark star, no paginator) -
	 * so the Discussions tab is the offline list when there is no network.
	 */
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import DiscussionRow from '$lib/components/organisms/DiscussionRow.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import { goto } from '$app/navigation';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { loadOfflineDiscussions, mapOfflineDiscussionRow } from '$lib/offline/queries';
	import type { DiscussionListItem } from '$lib/server/db/dao/discussions';
	import type { OfflineDiscussionView } from '$lib/offline/types';
	import type { PageUrlBuilder } from '$lib/types/tabs';
	import type { TranslationDict } from '$lib/types/translation';

	interface DiscussionsPanelProps {
		discussions: DiscussionListItem[];
		currentPage: number;
		totalPages: number;
		t: TranslationDict;
		buildPageUrl: PageUrlBuilder;
		/** Show the paginator. Desktop always; mobile pager only on the active panel. */
		paginate?: boolean;
	}

	let {
		discussions,
		currentPage,
		totalPages,
		t,
		buildPageUrl,
		paginate = true
	}: DiscussionsPanelProps = $props();

	const online = getOnlineStore();
	const unknownUser = $derived(t.offline.reader.unknownUser);

	// Cached discussions are read from IDB when offline. The effect only reads
	// `online.online`, so flipping it (online<->offline) re-runs without looping.
	let offlineDiscussions = $state<OfflineDiscussionView[]>([]);
	let offlineLoading = $state(true);
	$effect(() => {
		if (online.online) {
			offlineDiscussions = [];
			offlineLoading = false;
			return;
		}
		offlineLoading = true;
		void loadOfflineDiscussions().then((items) => {
			offlineDiscussions = items;
			offlineLoading = false;
		});
	});

	function handlePageChange(newPage: number) {
		goto(buildPageUrl(newPage));
	}
</script>

<div class="space-y-3">
	{#if !online.online}
		<!-- Offline: cached discussions from IDB -->
		{#if offlineLoading}
			<div class="flex items-center justify-center gap-2 py-10 text-sm text-base-content/50">
				<span class="loading loading-spinner loading-sm"></span>
				{t.common.loading}
			</div>
		{:else if offlineDiscussions.length === 0}
			<EmptyState message={t.offline.reader.empty} bordered={false} />
		{:else}
			<div class="overflow-hidden border-y border-base-300 bg-base-100">
				<div class="divide-y divide-base-300">
					{#each offlineDiscussions as d (d.id)}
						<DiscussionRow
							discussion={mapOfflineDiscussionRow(d, unknownUser)}
							discussionHref={`/offline/${d.id}`}
							showBookmark={false}
							{t}
						/>
					{/each}
				</div>
			</div>
		{/if}
	{:else}
		<!-- Online: server data -->
		<!-- Top Paginator -->
		{#if paginate && totalPages > 1}
			<div class="flex justify-end">
				<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
			</div>
		{/if}

		<!-- Discussions Stream -->
		{#if discussions.length === 0}
			<EmptyState message={t.common.noResults} />
		{:else}
			<div class="overflow-hidden border-y border-base-300 bg-base-100">
				<div class="divide-y divide-base-300">
					{#each discussions as discussion (discussion.id)}
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
			{#if paginate && totalPages > 1}
				<div class="flex justify-end pt-2">
					<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
				</div>
			{/if}
		{/if}
	{/if}
</div>
