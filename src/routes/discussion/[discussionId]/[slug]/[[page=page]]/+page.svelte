<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ThreadPager from '$lib/components/templates/ThreadPager.svelte';
	import DiscussionsPanel from '$lib/components/panels/DiscussionsPanel.svelte';
	import ActivityPanel from '$lib/components/panels/ActivityPanel.svelte';
	import type { PageUrlBuilder } from '$lib/types/tabs';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import ActiveUsersWall from '$lib/components/molecules/ActiveUsersWall.svelte';
	import CategoryListWidget from '$lib/components/molecules/CategoryListWidget.svelte';
	import DiscussionMetadata from '$lib/components/molecules/DiscussionMetadata.svelte';
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditorLazy.svelte';
	import BookmarkButton from '$lib/components/atoms/BookmarkButton.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import ConfirmationModal from '$lib/components/organisms/ConfirmationModal.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { isLexicalEmpty, MAX_CONTENT_SIZE } from '$lib/utils/lexical';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { writeThread, passthroughEnabledFor } from '$lib/offline/passthrough';
	import type { ThreadPassthroughInput } from '$lib/offline/passthrough';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	interface ReplyActionResult {
		success?: boolean;
		error?: string;
		replyId?: string;
		page?: number;
	}

	let { data }: PageProps = $props();

	const online = getOnlineStore();

	// Offline fallback: when the network drops while viewing a discussion that is
	// cached locally, switch to the client-only offline reader (IDB, no server
	// round-trip). The online read-mutation has already run for this view.
	//
	// Read passthrough (DV07 C04): when online and the user has the feature on,
	// also write this page's SSR data (discussion + opReply + replies + manifest
	// reconcile) to IDB. Issues no server request of its own (INV-4) — it only
	// consumes the data already in `data`. Re-entry re-runs this so revisits
	// refresh the cache. No bare `$effect` (per [[svelte-effect-fetch-loop]]).
	onMount(() => {
		const discussionId = Number(page.params.discussionId);
		const redirectIfCached = () => {
			if (navigator.onLine) return;
			void (async () => {
				const { getOfflineDB } = await import('$lib/offline/idb');
				const cached = await getOfflineDB().discussions.get(discussionId);
				if (cached) await goto(`/offline/${discussionId}`);
			})();
		};
		redirectIfCached();
		window.addEventListener('offline', redirectIfCached);
		return () => window.removeEventListener('offline', redirectIfCached);
	});

	onMount(() => {
		runThreadPassthrough(data);
	});

	// Re-run on every in-app navigation (e.g. flipping between thread pages).
	// afterNavigate fires after the new data has loaded; onMount does NOT fire
	// for these (the component stays mounted). Reads the latest `data` snapshot
	// each time. No bare `$effect` per [[svelte-effect-fetch-loop]].
	afterNavigate(() => {
		runThreadPassthrough(data);
	});

	function runThreadPassthrough(current: PageData): void {
		const d = current.discussion;
		if (!d) return;
		if (typeof navigator !== 'undefined' && !navigator.onLine) return;
		// Decision #5: guests must never populate a cache. The thread page is a
		// public route (data.user is null for guests), so gate on the authed
		// session in addition to the prefs gate inside writeThread.
		if (!passthroughEnabledFor(current.user)) return;
		const input: ThreadPassthroughInput = {
			discussion: {
				id: d.id,
				title: d.title,
				slug: d.slug,
				categorySlug: d.categorySlug,
				authorId: d.authorId,
				commentCount: d.commentCount,
				isPinned: d.isPinned,
				viewCount: d.viewCount,
				// Drizzle timestamp-mode values arrive as Date instances on the
				// client; passthrough converts them to epoch seconds.
				createdAt: d.createdAt,
				updatedAt: d.updatedAt,
				lastReplyAt: d.lastReplyAt
			},
			opReply: current.opReply,
			replies: current.replies,
			page: current.page,
			totalPages: current.totalPages,
			pageSize: current.replyPageSize
		};
		void writeThread(input).catch((err) => {
			console.error('[offline passthrough] writeThread failed', err);
		});
	}

	const buildPageUrl: PageUrlBuilder = (p) => (p === 1 ? '/' : `/discussions/p${p}`);

	const t = $derived(data.t);
	const user = $derived(data.user);
	const discussion = $derived(data.discussion);
	const opReply = $derived(data.opReply);
	const repliesList = $derived(data.replies);
	const currentPage = $derived(data.page);
	const totalPages = $derived(data.totalPages);
	const canDelete = $derived(data.canDelete);
	const canCreate = $derived(data.canCreate);
	const canUpdate = $derived(data.canUpdate);
	const mentionedUsers = $derived(data.mentionedUsers);

	let replyContent = $state('');
	let isSubmitting = $state(false);
	let isTogglingPin = $state(false);
	let editorKey = $state(0);

	// Quick Reply & inline editing states
	let replyEditor: ReturnType<typeof LexicalEditor> | undefined = $state();
	let replyComposerElem: HTMLElement | undefined = $state();
	let replyForm: HTMLFormElement | undefined = $state();
	let editReplyForm: HTMLFormElement | undefined = $state();
	let editingReplyId = $state<number | null>(null);
	let editReplyContent = $state('');

	// Delete confirmation states
	let showDeleteModal = $state(false);
	let deleteTarget = $state<'discussion' | 'reply' | null>(null);
	let deleteReplyId = $state<number | null>(null);
	let deleteDiscussionForm: HTMLFormElement | undefined = $state();
	let deleteReplyForm: HTMLFormElement | undefined = $state();

	let loadedDiscussionId = $state<number | null>(null);
	let loadedPage = $state<number | null>(null);

	$effect(() => {
		if (discussion && (discussion.id !== loadedDiscussionId || currentPage !== loadedPage)) {
			replyContent = data.replyDraft || '';
			editingReplyId = null;
			editReplyContent = '';
			loadedDiscussionId = discussion.id;
			loadedPage = currentPage;
		}
	});

	function handlePageChange(newPage: number) {
		goto(`/discussion/${discussion.id}/${discussion.slug}/p${newPage}`);
	}

	function quickReply(username: string, displayName: string) {
		if (replyEditor) {
			replyEditor.insertMention(username, displayName);
			if (replyComposerElem) {
				replyComposerElem.scrollIntoView({ behavior: 'smooth', block: 'start' });
			}
		}
	}

	function triggerDeleteDiscussion() {
		deleteTarget = 'discussion';
		showDeleteModal = true;
	}

	function triggerDeleteReply(replyId: number) {
		deleteTarget = 'reply';
		deleteReplyId = replyId;
		showDeleteModal = true;
	}

	function handleConfirmDelete() {
		if (deleteTarget === 'discussion') {
			deleteDiscussionForm?.requestSubmit();
		} else if (deleteTarget === 'reply') {
			deleteReplyForm?.requestSubmit();
		}
		showDeleteModal = false;
		deleteTarget = null;
		deleteReplyId = null;
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
	let lastScrolledHash: string | null = null;
	$effect(() => {
		const hash = page.url.hash;
		if (hash) {
			if (hash !== lastScrolledHash) {
				const targetId = hash.startsWith('#') ? hash.substring(1) : hash;
				// Match either exactly targetId or reply-targetId
				const element =
					document.getElementById(targetId) || document.getElementById(`reply-${targetId}`);
				if (element) {
					lastScrolledHash = hash;
					const timer = setTimeout(() => {
						element.scrollIntoView({ behavior: 'smooth', block: 'start' });
					}, 200);
					return () => clearTimeout(timer);
				}
			}
		} else {
			lastScrolledHash = null;
		}
	});
</script>

<svelte:head>
	<title>{formatTitle(discussion.title)}</title>
</svelte:head>

{#snippet sidebar()}
	<div class="space-y-4">
		{#if user}
			<UserInfoBlock {user} {t} />
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
		<CategoryListWidget {t} activeSlug={discussion.categorySlug} />
		<ActiveUsersWall {t} />
	</div>
{/snippet}

<DualColumnLayout {sidebar} {user} {t} flush>
	<ThreadPager centerTab={0} rightTab={1} leftHref="/" rightHref="/activity">
		{#snippet left()}
			<DiscussionsPanel
				discussions={data.list.discussions}
				currentPage={data.list.page}
				totalPages={data.list.totalPages}
				{t}
				{buildPageUrl}
				paginate={false}
			/>
		{/snippet}
		{#snippet right()}
			<ActivityPanel
				activities={data.activity.activities}
				currentPage={data.activity.page}
				totalPages={data.activity.totalPages}
				activityDraft={data.activity.activityDraft}
				mentionedUsers={data.activity.mentionedUsers}
				{t}
				{user}
				paginate={false}
			/>
		{/snippet}
		<div class="space-y-3">
			<!-- Discussion Header -->
			<div class="border-b border-base-300 flex justify-between items-center pb-3 gap-3">
				<h1
					class="text-lg font-extrabold tracking-tight text-base-content break-words leading-tight"
				>
					{discussion.title}
				</h1>
				{#if user}
					<BookmarkButton
						discussionId={discussion.id}
						bookmarked={!!discussion.isBookmarked}
						{t}
						class="flex-shrink-0 mt-0.5"
					/>
				{/if}
			</div>

			<!-- Original Post (OP) - Only visible on Page 1 -->
			{#if currentPage === 1 && opReply}
				<div id="reply-{opReply.id}" class="space-y-4">
					<DiscussionMetadata
						userId={opReply.authorId}
						username={opReply.authorUsername}
						displayName={opReply.authorDisplayName}
						avatarFileId={opReply.authorAvatarFileId}
						createdAt={opReply.createdAt}
						editedAt={opReply.editedAt}
						editedByDisplayName={opReply.editedByDisplayName}
						editedById={opReply.editedBy}
						{t}
					/>
					<LexicalRenderer contentJson={opReply.contentJson} {mentionedUsers} {t} />
					{#if user}
						<div class="flex justify-end items-center gap-2 pt-2">
							{#if canDelete}
								<form
									method="POST"
									action="?/togglePin"
									use:enhance={() => {
										isTogglingPin = true;
										return async ({ update }) => {
											isTogglingPin = false;
											update();
										};
									}}
								>
									<button
										type="submit"
										class="btn btn-xs btn-ghost text-base-content/60 hover:text-primary"
										disabled={isTogglingPin}
									>
										{#if isTogglingPin}
											<span class="loading loading-spinner loading-xs"></span>
										{/if}
										{discussion.isPinned ? t.discussion.unpin : t.discussion.pin}
									</button>
								</form>
							{/if}
							{#if canUpdate || user.id === opReply.authorId}
								<a
									href="/post/editDiscussion/{discussion.id}"
									class="btn btn-xs btn-ghost text-base-content/60 hover:text-primary"
								>
									{t.common.edit}
								</a>
							{/if}
							{#if canDelete}
								<button
									type="button"
									class="btn btn-xs btn-ghost text-error/60 hover:text-error"
									onclick={() => triggerDeleteDiscussion()}
								>
									{t.common.delete}
								</button>
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Paginator Top -->
			{#if totalPages > 1}
				<div class="flex justify-end">
					<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
				</div>
			{/if}

			<!-- Replies Stream -->
			{#if repliesList.length > 0}
				<div
					class="divide-y divide-base-300 {currentPage === 1 && opReply
						? 'border-t border-base-300 pt-4'
						: ''}"
				>
					{#each repliesList as reply (reply.id)}
						<div id="reply-{reply.id}" class="space-y-4 py-4 first:pt-0 last:pb-0">
							<DiscussionMetadata
								userId={reply.authorId}
								username={reply.authorUsername}
								displayName={reply.authorDisplayName}
								avatarFileId={reply.authorAvatarFileId}
								createdAt={reply.createdAt}
								editedAt={reply.editedAt}
								editedByDisplayName={reply.editedByDisplayName}
								editedById={reply.editedBy}
								{t}
							/>
							{#if editingReplyId === reply.id}
								<LexicalEditor
									initialContent={reply.contentJson}
									placeholder={t.editor.placeholderReply}
									onContentChange={(json) => (editReplyContent = json)}
									onSubmit={() => {
										if (!isSubmitting && online.online) editReplyForm?.requestSubmit();
									}}
									{t}
									class="mb-3"
								/>
								<form
									method="POST"
									action="?/editReply"
									bind:this={editReplyForm}
									use:enhance={({ cancel }) => {
										if (isSubmitting) {
											cancel();
											return;
										}
										isSubmitting = true;
										return async ({ result, update }) => {
											isSubmitting = false;
											if (
												result.type === 'success' &&
												result.data &&
												'success' in result.data &&
												result.data.success === false
											) {
												alert(result.data.error || t.discussion.editReplyFailed);
											} else if (result.type === 'success') {
												await update();
												editingReplyId = null;
												editReplyContent = '';
											} else if (result.type === 'failure') {
												alert(result.data?.error || t.discussion.editReplyFailed);
											}
										};
									}}
									class="flex gap-2 justify-end"
								>
									<input type="hidden" name="replyId" value={reply.id} />
									<input type="hidden" name="contentJson" value={editReplyContent} />
									<button
										type="button"
										class="btn btn-sm btn-ghost"
										onclick={() => {
											editingReplyId = null;
											editReplyContent = '';
										}}
									>
										{t.common.cancel}
									</button>
									<button
										type="submit"
										class="btn btn-sm btn-primary"
										disabled={isLexicalEmpty(editReplyContent) ||
											editReplyContent.length > MAX_CONTENT_SIZE ||
											isSubmitting ||
											!online.online}
									>
										{t.discussion.saveReply}
									</button>
								</form>
							{:else}
								<LexicalRenderer contentJson={reply.contentJson} {mentionedUsers} {t} />
								{#if user}
									<div class="flex justify-end items-center gap-2 mt-2">
										{#if canCreate}
											<button
												type="button"
												class="btn btn-xs btn-ghost text-base-content/60 hover:text-primary"
												onclick={() => quickReply(reply.authorUsername, reply.authorDisplayName)}
											>
												{t.discussion.quickReply}
											</button>
										{/if}
										{#if canUpdate || user.id === reply.authorId}
											<button
												type="button"
												class="btn btn-xs btn-ghost text-base-content/60 hover:text-primary"
												disabled={!online.online}
												onclick={() => {
													if (!online.online) return;
													editingReplyId = reply.id;
													editReplyContent = reply.contentJson;
												}}
											>
												{t.common.edit}
											</button>
										{/if}
										{#if canDelete}
											<button
												type="button"
												class="btn btn-xs btn-ghost text-error/60 hover:text-error"
												onclick={() => triggerDeleteReply(reply.id)}
											>
												{t.common.delete}
											</button>
										{/if}
									</div>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			{:else if currentPage > 1}
				<EmptyState message={t.common.noResults} bordered={false} />
			{/if}

			<!-- Paginator Bottom -->
			{#if totalPages > 1}
				<div class="flex justify-end pt-2">
					<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
				</div>
			{/if}

			<!-- Reply Composer at the bottom -->
			<div bind:this={replyComposerElem} class="pt-6">
				{#if user}
					{#if canCreate}
						<h3 class="text-lg font-bold mb-3 text-base-content">{t.common.reply}</h3>
						{#key `${discussion.id}_${editorKey}`}
							<LexicalEditor
								bind:this={replyEditor}
								contextType="reply"
								contextId={discussion.id}
								initialContent={data.replyDraft}
								placeholder={t.editor.placeholderReply}
								onContentChange={(json) => (replyContent = json)}
								onSubmit={() => {
									if (!isSubmitting && online.online) replyForm?.requestSubmit();
								}}
								{t}
								class="mb-3"
							/>
						{/key}

						<form
							method="POST"
							action="?/reply"
							bind:this={replyForm}
							use:enhance={({ cancel }) => {
								if (isSubmitting) {
									cancel();
									return;
								}
								isSubmitting = true;
								return async ({ result, update }) => {
									isSubmitting = false;
									if (result.type === 'success') {
										const resData = result.data as ReplyActionResult | null;
										if (resData && resData.success === false) {
											alert(resData.error || t.discussion.createReplyFailed);
											return;
										}
										await update({ reset: true });
										replyContent = '';
										editorKey++;
										const replyId = resData?.replyId;
										const page = resData?.page;
										if (replyId && page) {
											const url =
												page <= 1
													? `/discussion/${discussion.id}/${discussion.slug}#reply-${replyId}`
													: `/discussion/${discussion.id}/${discussion.slug}/p${page}#reply-${replyId}`;
											goto(url);
										}
									} else if (result.type === 'failure') {
										alert(result.data?.error || t.discussion.createReplyFailed);
									}
								};
							}}
							class="flex justify-end"
						>
							<input type="hidden" name="contentJson" value={replyContent} />
							<button
								type="submit"
								class="btn btn-primary"
								disabled={isLexicalEmpty(replyContent) ||
									replyContent.length > MAX_CONTENT_SIZE ||
									isSubmitting ||
									!online.online}
							>
								{#if isSubmitting}
									<span class="loading loading-spinner loading-xs"></span>
								{/if}
								{t.common.submit}
							</button>
						</form>
					{:else}
						<div class="bg-base-200 p-6 text-center text-base-content/70 rounded-box">
							{t.discussion.noPermission}
						</div>
					{/if}
				{:else}
					<div class="bg-base-200 p-6 text-center">
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
	</ThreadPager>
</DualColumnLayout>

<ConfirmationModal
	open={showDeleteModal}
	title={t.common.delete}
	message={deleteTarget === 'discussion'
		? t.discussion.deleteDiscussionConfirm
		: t.discussion.deleteReplyConfirm}
	confirmLabel={t.common.delete}
	cancelLabel={t.common.cancel}
	onconfirm={handleConfirmDelete}
	oncancel={() => {
		showDeleteModal = false;
		deleteTarget = null;
		deleteReplyId = null;
	}}
/>

<form
	bind:this={deleteDiscussionForm}
	method="POST"
	action="?/deleteDiscussion"
	use:enhance={() => {
		return async ({ result }) => {
			if (result.type === 'redirect') {
				goto(result.location);
			} else if (result.type === 'failure') {
				alert(result.data?.error || t.discussion.deleteDiscussionFailed);
			}
		};
	}}
	class="hidden"
></form>

<form
	bind:this={deleteReplyForm}
	method="POST"
	action="?/deleteReply"
	use:enhance={() => {
		return async ({ result, update }) => {
			if (result.type === 'failure') {
				alert(result.data?.error || t.discussion.deleteReplyFailed);
			}
			await update();
		};
	}}
	class="hidden"
>
	<input type="hidden" name="replyId" value={deleteReplyId || ''} />
</form>
