<script lang="ts">
	/**
	 * DiscussionsPanel - Content-only discussion stream (paginator + rows). The
	 * presentational body shared by the home route, the `/discussions/pN`
	 * paginated route (via DiscussionListPage), and the mobile tab pager. Owns no
	 * chrome (no sidebar / DualColumnLayout) so it can be mounted three-wide in
	 * the pager track.
	 */
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import DiscussionRow from '$lib/components/organisms/DiscussionRow.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import { goto } from '$app/navigation';
	import type { DiscussionListItem } from '$lib/server/db/dao/discussions';
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

	function handlePageChange(newPage: number) {
		goto(buildPageUrl(newPage));
	}
</script>

<div class="space-y-3">
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
</div>
