<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import DiscussionRow from '$lib/components/organisms/DiscussionRow.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiRss } from '@mdi/js';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const user = $derived(data.user);
	const category = $derived(data.category);
	const discussionsList = $derived(data.discussions);
	const currentPage = $derived(data.page);
	const totalPages = $derived(data.totalPages);

	function handlePageChange(newPage: number) {
		goto(`?page=${newPage}`);
	}
</script>

<svelte:head>
	<title>{formatTitle(category.title)}</title>
</svelte:head>

{#snippet sidebar()}
	<div class="card bg-base-200 border border-base-300 p-4 space-y-4">
		{#if user}
			<UserInfoBlock {user} {t} />
			<div class="divider my-1"></div>
			<div class="flex flex-col gap-2">
				<a href="/post/discussion?category={category.slug}" class="btn btn-primary btn-sm w-full">
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
	</div>
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-6">
		<!-- Category Title + Description + RSS Link -->
		<div class="border-b border-base-300 pb-4">
			<div class="flex items-center gap-3 flex-wrap">
				<h1 class="text-3xl font-extrabold tracking-tight text-base-content">{category.title}</h1>

				{#if user && user.rssToken}
					<a
						href="/category/{category.slug}/rss?token={user.rssToken}"
						target="_blank"
						class="btn btn-ghost btn-circle btn-sm text-warning hover:bg-warning/10"
						title={t.category.subscribeRss}
						aria-label={t.category.subscribeRss}
					>
						<Icon path={mdiRss} size={20} />
					</a>
				{/if}
			</div>
			<p class="text-base-content/70 text-sm mt-1">{category.description}</p>
		</div>

		<!-- Paginator Top -->
		<div class="flex justify-between items-center gap-4 flex-wrap">
			<span class="text-xs text-base-content/50">
				{t.category.total}: {data.totalCount}
			</span>
			<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
		</div>

		<!-- Discussions Listing -->
		{#if discussionsList.length === 0}
			<div
				class="card bg-base-200/40 border border-base-200 p-10 text-center text-base-content/50 rounded-xl"
			>
				{t.common.noResults}
			</div>
		{:else}
			<div class="card bg-base-100 border border-base-200 rounded-xl overflow-hidden shadow-sm">
				<div class="divide-y divide-base-200">
					{#each discussionsList as discussion (discussion.id)}
						<DiscussionRow
							{discussion}
							readHistory={discussion.readHistory}
							isBookmarked={discussion.isBookmarked}
							unreadCount={discussion.unreadCount}
							lastReplyAuthorDisplayName={discussion.lastReplyAuthorDisplayName}
							{t}
						/>
					{/each}
				</div>
			</div>

			<!-- Paginator Bottom -->
			<div class="flex justify-end pt-2">
				<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
			</div>
		{/if}
	</div>
</DualColumnLayout>
