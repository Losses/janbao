<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import DiscussionRow from '$lib/components/organisms/DiscussionRow.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const profileT = $derived(t.profile);
	const user = $derived(data.user);
	const targetUser = $derived(data.targetUser);
	const discussionsList = $derived(data.discussions);
	const currentPage = $derived(data.page);
	const totalPages = $derived(data.totalPages);

	let isDrawerOpen = $state(false);
	const targetUserSlug = $derived(generateSlug(targetUser.username));
	const isOwner = $derived(user ? user.id === targetUser.id : false);

	function handlePageChange(newPage: number) {
		goto(`?page=${newPage}`);
	}
</script>

<svelte:head>
	<title>{formatTitle(`${targetUser.displayName} - ${profileT.discussions}`)}</title>
</svelte:head>

{#snippet sidebar()}
	<div class="card bg-base-200 border border-base-300 p-4 space-y-4">
		{#if user}
			<UserInfoBlock {user} {t} />
			<div class="divider my-1"></div>
			{#if isOwner}
				<ul class="menu menu-sm w-full gap-1">
					<li><a href="/profile/{user.id}/{targetUserSlug}">{profileT.dynamics}</a></li>
					<li><a href="/notifications">{profileT.notifications}</a></li>
					<li><a href="/profile/invitations">{profileT.invitations}</a></li>
					<li><a href="/messages/inbox">{profileT.mailbox}</a></li>
					<li>
						<a href="/profile/discussions/{user.id}/{targetUserSlug}" class="active"
							>{profileT.discussions}</a
						>
					</li>
					<li><a href="/profile/comments/{user.id}/{targetUserSlug}">{profileT.comments}</a></li>
					<li class="menu-title mt-2">{profileT.accountSettings}</li>
					<li><a href="/profile/edit">{profileT.editAccount}</a></li>
					<li><a href="/profile/password">{profileT.changePassword}</a></li>
					<li><a href="/profile/preferences">{profileT.preferences}</a></li>
					<li><a href="/profile/picture">{profileT.avatar}</a></li>
					<li><a href="/profile/onlineNow">{profileT.stealthSettings}</a></li>
				</ul>
			{:else}
				<ul class="menu menu-sm w-full gap-1">
					<li><a href="/profile/{targetUser.id}/{targetUserSlug}">{profileT.dynamics}</a></li>
					<li>
						<a href="/profile/discussions/{targetUser.id}/{targetUserSlug}" class="active"
							>{profileT.discussions}</a
						>
					</li>
					<li>
						<a href="/profile/comments/{targetUser.id}/{targetUserSlug}">{profileT.comments}</a>
					</li>
				</ul>
			{/if}
		{:else}
			<ul class="menu menu-sm w-full gap-1">
				<li><a href="/profile/{targetUser.id}/{targetUserSlug}">{profileT.dynamics}</a></li>
				<li>
					<a href="/profile/discussions/{targetUser.id}/{targetUserSlug}" class="active"
						>{profileT.discussions}</a
					>
				</li>
			</ul>
			<div class="divider my-1"></div>
			<div class="flex gap-2">
				<a href="/entry/signin" class="btn btn-sm btn-primary flex-1">{t.nav.signin}</a>
				<a href="/entry/register" class="btn btn-sm btn-outline flex-1">{t.nav.register}</a>
			</div>
		{/if}
	</div>
{/snippet}

<DualColumnLayout {sidebar} bind:isDrawerOpen>
	<div class="space-y-6">
		<!-- Title Banner -->
		<div class="flex items-center justify-between border-b border-base-300 pb-4">
			<h1 class="text-2xl font-bold tracking-tight">
				{targetUser.displayName} — {profileT.discussions}
			</h1>
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

			<!-- Bottom Paginator -->
			<div class="flex justify-end pt-2">
				<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
			</div>
		{/if}
	</div>
</DualColumnLayout>
