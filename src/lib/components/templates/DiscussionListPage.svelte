<script lang="ts">
	/**
	 * DiscussionListPage Template - The shared discussion-stream listing used by
	 * the home page (`/`, always page 1) and the paginated `/discussions/pN`
	 * route. Pagination targets are supplied per-route via `buildPageUrl`.
	 */
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import ActiveUsersWall from '$lib/components/molecules/ActiveUsersWall.svelte';
	import CategoryListWidget from '$lib/components/molecules/CategoryListWidget.svelte';
	import DiscussionRow from '$lib/components/organisms/DiscussionRow.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import { goto } from '$app/navigation';
	import type { DiscussionListItem } from '$lib/server/db/dao/discussions';
	import type { UserInfoSummary } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	type PageUrlBuilder = (page: number) => string;

	interface DiscussionListPageProps {
		discussions: DiscussionListItem[];
		currentPage: number;
		totalPages: number;
		t: TranslationDict;
		user: UserInfoSummary | null;
		buildPageUrl: PageUrlBuilder;
	}

	let { discussions, currentPage, totalPages, t, user, buildPageUrl }: DiscussionListPageProps =
		$props();

	function handlePageChange(newPage: number) {
		goto(buildPageUrl(newPage));
	}
</script>

{#snippet sidebar()}
	<div class="space-y-4">
		{#if user}
			<UserInfoBlock {user} {t} />
			<div class="flex flex-col gap-2">
				<a href="/post/discussion" class="btn btn-primary btn-sm w-full">
					{t.sidebar.createDiscussion}
				</a>
				<a
					href="/profile/discussions/{user.id}/{generateSlug(user.username)}"
					class="btn btn-outline btn-sm w-full"
				>
					{t.sidebar.myDiscussions}
				</a>
				<a href="/drafts" class="btn btn-outline btn-sm w-full">
					{t.sidebar.myDrafts}
				</a>
			</div>
		{:else}
			<div class="space-y-2">
				<h3 class="font-semibold text-sm text-base-content/70">{t.home.welcomeTo}</h3>
				<div class="flex gap-2">
					<a href="/entry/signin" class="btn btn-sm btn-primary flex-1">{t.nav.signin}</a>
					<a href="/entry/register" class="btn btn-sm btn-outline flex-1">{t.nav.register}</a>
				</div>
			</div>
		{/if}
		<CategoryListWidget {t} />
		<ActiveUsersWall {t} />
	</div>
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-3">
		<!-- Top Paginator -->
		{#if totalPages > 1}
			<div class="flex justify-end">
				<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
			</div>
		{/if}

		<!-- Discussions Stream -->
		{#if discussions.length === 0}
			<div class="card bg-base-200/40 border border-base-300 p-10 text-center text-base-content/50">
				{t.common.noResults}
			</div>
		{:else}
			<div class="bg-base-100 overflow-hidden">
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
			{#if totalPages > 1}
				<div class="flex justify-end pt-2">
					<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
				</div>
			{/if}
		{/if}
	</div>
</DualColumnLayout>
