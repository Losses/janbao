<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import ActiveUsersWall from '$lib/components/molecules/ActiveUsersWall.svelte';
	import CategoryListWidget from '$lib/components/molecules/CategoryListWidget.svelte';
	import DiscussionMetadata from '$lib/components/molecules/DiscussionMetadata.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditor.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const user = $derived(data.user);
	const discussion = $derived(data.discussion);
	const opReply = $derived(data.opReply);
	const repliesList = $derived(data.replies);
	const currentPage = $derived(data.page);
	const totalPages = $derived(data.totalPages);

	let replyContent = $state('');
	let isSubmitting = $state(false);
	let editorKey = $state(0);

	function handlePageChange(newPage: number) {
		goto(`/discussion/${discussion.id}/${discussion.slug}/p${newPage}`);
	}

	// 1. Reactive Theme Override
	$effect(() => {
		if (typeof document !== 'undefined' && data.theme) {
			const originalTheme = document.documentElement.getAttribute('data-theme');
			document.documentElement.setAttribute('data-theme', data.theme);
			return () => {
				if (originalTheme) {
					document.documentElement.setAttribute('data-theme', originalTheme);
				} else {
					document.documentElement.removeAttribute('data-theme');
				}
			};
		}
	});

	// 2. Navigation Anchor Smooth Scroll
	$effect(() => {
		const hash = page.url.hash;
		if (hash) {
			const targetId = hash.startsWith('#') ? hash.substring(1) : hash;
			// Match either exactly targetId or reply-targetId
			const element =
				document.getElementById(targetId) || document.getElementById(`reply-${targetId}`);
			if (element) {
				const timer = setTimeout(() => {
					element.scrollIntoView({ behavior: 'smooth', block: 'start' });
				}, 200);
				return () => clearTimeout(timer);
			}
		}
	});
</script>

<svelte:head>
	<title>{formatTitle(discussion.title)}</title>
</svelte:head>

{#snippet sidebar()}
	<div class="card bg-base-200 border border-base-300 p-4 space-y-4">
		{#if user}
			<UserInfoBlock {user} {t} />
			<div class="divider my-1"></div>
			<div class="flex flex-col gap-2">
				<a
					href="/post/discussion?category={discussion.categorySlug}"
					class="btn btn-primary btn-sm w-full"
				>
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
		<div class="divider my-1"></div>
		<CategoryListWidget {t} activeSlug={discussion.categorySlug} />
		<div class="divider my-1"></div>
		<ActiveUsersWall {t} />
	</div>
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-6">
		<!-- Discussion Header -->
		<div class="border-b border-base-300 pb-4">
			<div class="text-xs text-primary font-semibold mb-1 uppercase tracking-wider">
				<a href="/category/{discussion.categorySlug}" class="hover:underline">
					{discussion.categoryTitle}
				</a>
			</div>
			<h1
				class="text-3xl font-extrabold tracking-tight text-base-content break-words leading-tight"
			>
				{discussion.title}
			</h1>
		</div>

		<!-- Original Post (OP) - Only visible on Page 1 -->
		{#if currentPage === 1 && opReply}
			<div
				id="reply-{opReply.id}"
				class="card bg-base-100 border border-base-200 rounded-xl p-5 shadow-sm space-y-4"
			>
				<DiscussionMetadata
					userId={opReply.authorId}
					username={opReply.authorUsername}
					displayName={opReply.authorDisplayName}
					avatarFileId={opReply.authorAvatarFileId}
					createdAt={opReply.createdAt}
					updatedAt={opReply.updatedAt}
					categoryName={discussion.categoryTitle}
					categorySlug={discussion.categorySlug}
					{t}
				/>
				<div class="divider my-1"></div>
				<LexicalRenderer contentJson={opReply.contentJson} />
			</div>
		{/if}

		<!-- Paginator Top -->
		<div class="flex justify-end">
			<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
		</div>

		<!-- Replies Stream -->
		{#if repliesList.length > 0}
			<div class="space-y-4">
				{#each repliesList as reply (reply.id)}
					<div
						id="reply-{reply.id}"
						class="card bg-base-100 border border-base-200 hover:border-base-300 transition-colors rounded-xl p-5 shadow-sm space-y-4"
					>
						<DiscussionMetadata
							userId={reply.authorId}
							username={reply.authorUsername}
							displayName={reply.authorDisplayName}
							avatarFileId={reply.authorAvatarFileId}
							createdAt={reply.createdAt}
							updatedAt={reply.updatedAt}
							{t}
						/>
						<div class="divider my-1"></div>
						<LexicalRenderer contentJson={reply.contentJson} />
					</div>
				{/each}
			</div>
		{:else if currentPage > 1}
			<div class="text-center py-10 text-base-content/50">
				{t.common.noResults}
			</div>
		{/if}

		<!-- Paginator Bottom -->
		<div class="flex justify-between items-center gap-4 pt-2">
			<span class="text-xs text-base-content/50">
				{t.discussion.replies}: {data.totalRepliesCount}
			</span>
			<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
		</div>

		<!-- Reply Composer at the bottom -->
		<div class="border-t border-base-300 pt-6">
			{#if user}
				<h3 class="text-lg font-bold mb-3 text-base-content">{t.common.reply}</h3>
				{#key editorKey}
					<LexicalEditor
						contextType="reply"
						contextId={discussion.id}
						initialContent={data.replyDraft}
						placeholder={t.editor.placeholderReply}
						onContentChange={(json) => (replyContent = json)}
						{t}
						class="mb-3"
					/>
				{/key}

				<form
					method="POST"
					action="?/reply"
					use:enhance={() => {
						isSubmitting = true;
						return async ({ result, update }) => {
							isSubmitting = false;
							if (result.type === 'success') {
								replyContent = '';
								editorKey++;
								// Remount and scroll to bottom or reload page data
								update();
							}
						};
					}}
					class="flex justify-end"
				>
					<input type="hidden" name="contentJson" value={replyContent} />
					<button type="submit" class="btn btn-primary" disabled={!replyContent || isSubmitting}>
						{#if isSubmitting}
							<span class="loading loading-spinner loading-xs"></span>
						{/if}
						{t.common.submit}
					</button>
				</form>
			{:else}
				<div class="card bg-base-200 border border-base-300 p-6 text-center rounded-xl">
					<p class="text-base-content/70 mb-3">
						{t.discussion.signInToReply}
					</p>
					<div class="flex justify-center gap-2">
						<a href="/entry/signin" class="btn btn-sm btn-primary">{t.nav.signin}</a>
						<a href="/entry/register" class="btn btn-sm btn-outline">{t.nav.register}</a>
					</div>
				</div>
			{/if}
		</div>
	</div>
</DualColumnLayout>
