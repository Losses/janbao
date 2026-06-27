<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import GesturePageLayout from '$lib/components/templates/GesturePageLayout.svelte';
	import DiscussionsPanel from '$lib/components/panels/DiscussionsPanel.svelte';
	import ActivityPanel from '$lib/components/panels/ActivityPanel.svelte';
	import type { PageUrlBuilder } from '$lib/types/tabs';
	import type { VoidHandler } from '$lib/types/handlers';
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
	import { onMount, onDestroy } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { getPageThemeStore } from '$lib/stores/page-theme.svelte';
	import { writeThread, passthroughEnabledFor } from '$lib/offline/passthrough';
	import type { ThreadPassthroughInput } from '$lib/offline/passthrough';
	import { getListCacheStore } from '$lib/stores/list-cache.svelte';
	import { getListScrollStore } from '$lib/stores/list-scroll.svelte';
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

	const listCache = getListCacheStore();
	const listScroll = getListScrollStore();

	let listScrollTop = $state(listScroll.captured);
	let detailScrollTop = $state(0);

	export const snapshot = {
		capture: () => ({ listScrollTop, detailScrollTop }),
		restore: (value) => {
			listScrollTop = value.listScrollTop;
			detailScrollTop = value.detailScrollTop;
		}
	};

	const MOBILE_BREAKPOINT = '(max-width: 767px)';

	const online = getOnlineStore();
	const pageTheme = getPageThemeStore();
	// Offline fallback: when the network drops while viewing a discussion that is
	// cached locally, switch to the client-only offline reader (IDB, no server
	// round-trip). The online read-mutation has already run for this view.
	//
	// Read passthrough (DV07 C04): when online and the user has the feature on,
	// also write this page's SSR data (discussion + opReply + replies + manifest
	// reconcile) to IDB. Issues no server request of its own (INV-4) - it only
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

	// Mobile hash-enter lands at the anchor here, NOT in the $effect below:
	// afterNavigate runs after SvelteKit's own scroll but before the browser
	// paints, so landAtAnchor's synchronous first scroll puts the anchor on the
	// first visible frame instead of flashing the thread top. (The $effect below
	// handles desktop only.) No bare `$effect` per [[svelte-effect-fetch-loop]].
	afterNavigate(({ to }) => {
		if (!to?.url.hash || !to.url.pathname.startsWith('/discussion')) return;
		if (!window.matchMedia(MOBILE_BREAKPOINT).matches) return;
		const targetId = to.url.hash.startsWith('#') ? to.url.hash.substring(1) : to.url.hash;
		landAtAnchor(targetId);
	});

	// Cancel an in-flight landing if the component unmounts mid-landing.
	onDestroy(() => {
		cancelLanding?.();
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

	// Cancellation handle for the in-flight mobile anchor landing (see landAtAnchor
	// / the mobile afterNavigate). Plain let, not $state: it is not read in markup.
	let cancelLanding: VoidHandler | null = null;

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

	/**
	 * Bring an element to the top of the viewport by scrolling the WINDOW only -
	 * never via Element.scrollIntoView. The thread lives inside the ThreadPager
	 * viewport, which is `overflow: hidden`, and an overflow:hidden box is still a
	 * CSS scroll container: scrollIntoView on a descendant scrolls that viewport
	 * internally, where the user cannot scroll it back, locking the page on the
	 * target with everything above clipped. Offset by the sticky header height so
	 * the target lands just below the app bar.
	 */
	function scrollToElement(el: HTMLElement, behavior: ScrollBehavior = 'smooth'): void {
		if (typeof window === 'undefined') return;
		const headerOffset =
			parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 0;
		const isMobile = window.matchMedia(MOBILE_BREAKPOINT).matches;
		if (isMobile) {
			const container = document.querySelector('.detail-scroll-pane') as HTMLElement | null;
			if (container) {
				const targetY = Math.max(
					0,
					container.scrollTop + el.getBoundingClientRect().top - headerOffset
				);
				container.scrollTo({
					top: targetY,
					behavior
				});
				detailScrollTop = targetY;
			}
		} else {
			const absoluteTop = el.getBoundingClientRect().top + window.scrollY;
			window.scrollTo({
				top: Math.max(0, absoluteTop - headerOffset),
				behavior
			});
		}
	}

	/**
	 * Resolve once the document layout has stopped shifting - same scrollHeight
	 * across several rAFs (capped so it never waits forever). Entering a thread
	 * with a #reply anchor fires the anchor scroll; if it runs while the thread
	 * content, images, and the pager's height measurement are still settling, the
	 * smooth scroll chases a moving target and the scroll-chrome header twitches.
	 * A quiet layout makes the scroll a single, accurate motion.
	 */
	function waitForStableLayout(): Promise<void> {
		return new Promise((resolve) => {
			let lastHeight = -1;
			let stableFrames = 0;
			let frame = 0;
			const maxFrames = 40; // ~660ms cap at 60fps
			const tick = () => {
				frame += 1;
				const height = document.documentElement.scrollHeight;
				if (height === lastHeight) {
					stableFrames += 1;
					if (stableFrames >= 3) {
						resolve();
						return;
					}
				} else {
					stableFrames = 0;
					lastHeight = height;
				}
				if (frame >= maxFrames) {
					resolve();
					return;
				}
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
	}

	/**
	 * Mobile-only anchor landing, called from afterNavigate. afterNavigate runs
	 * AFTER SvelteKit's own scroll but BEFORE the browser paints, so the
	 * SYNCHRONOUS first scroll below lands the anchor on the first visible frame
	 * instead of flashing the thread top. It then re-scrolls each rAF while the
	 * layout settles (images/fonts reflow) so it never chases a moving target.
	 * The header is held + pinned visible for the whole navigation (see root
	 * +layout.svelte), so these scrolls cause no hide-on-scroll twitch. A previous
	 * in-flight landing is cancelled via cancelLanding; finish() releases the hold.
	 */
	function landAtAnchor(targetId: string): void {
		cancelLanding?.();
		cancelLanding = null;
		// The container is now the scroll-chrome source (GesturePageLayout
		// registered `.detail-scroll-pane` on mobile), so this landing scroll
		// WOULD drive hide-on-scroll. On a hash deep-link beforeNavigate never
		// fired (no root-layout hold), so hold here and release at finish/cancel
		// to keep the Header visible through the landing instead of twitching on
		// the top→anchor jump.
		getScrollChromeStore().holdThroughNavigation(false);
		const headerOffset =
			parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 0;
		const resolveEl = (): HTMLElement | null =>
			document.getElementById(targetId) || document.getElementById(`reply-${targetId}`);
		let frame = 0;
		let prevTargetY = 0;
		let hasScrolled = false;
		let stableFrames = 0;
		let rafId = 0;
		let done = false;

		function finish(): void {
			if (done) return;
			done = true;
			if (rafId) cancelAnimationFrame(rafId);
			cancelLanding = null;
			getScrollChromeStore().releaseNavigation();
		}

		function tick(): void {
			if (done) return;
			frame += 1;
			const el = resolveEl();
			const container = document.querySelector('.detail-scroll-pane') as HTMLElement | null;
			if (el && container) {
				const targetY = Math.max(
					0,
					container.scrollTop + el.getBoundingClientRect().top - headerOffset
				);
				if (!hasScrolled || Math.abs(targetY - prevTargetY) > 1) {
					container.scrollTop = targetY;
					detailScrollTop = targetY;
					hasScrolled = true;
					stableFrames = 0;
				} else {
					stableFrames += 1;
				}
				prevTargetY = targetY;
				if (stableFrames >= 3) {
					finish();
					return;
				}
			}
			if (frame >= 40) {
				finish();
				return;
			}
			rafId = requestAnimationFrame(tick);
		}

		// Synchronous first scroll: this is what beats the first paint. (Only when
		// the anchor is already in the DOM - afterNavigate fires after load, so it
		// is. If not, the rAF poll in tick() handles it with a brief flash.)
		const el0 = resolveEl();
		const container0 = document.querySelector('.detail-scroll-pane') as HTMLElement | null;
		if (el0 && container0) {
			const targetY = Math.max(
				0,
				container0.scrollTop + el0.getBoundingClientRect().top - headerOffset
			);
			container0.scrollTop = targetY;
			detailScrollTop = targetY;
			hasScrolled = true;
			prevTargetY = targetY;
		}

		rafId = requestAnimationFrame(tick);
		cancelLanding = (): void => {
			if (done) return;
			done = true;
			if (rafId) cancelAnimationFrame(rafId);
			// Release the hold on cancel (superseded by a new landing, or the
			// component unmounted) so the store is never left frozen.
			getScrollChromeStore().releaseNavigation();
		};
	}

	function quickReply(username: string, displayName: string) {
		if (replyEditor) {
			replyEditor.insertMention(username, displayName);
			if (replyComposerElem) {
				scrollToElement(replyComposerElem);
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

	// 1. Publish the thread's theme as a page-level override. The root layout
	// owns <html data-theme> in a single effect (interface theme vs. this page
	// override), so the thread theme wins while this page is open and the
	// interface theme resumes on unmount - no ordering race between a layout
	// effect and a page effect. data.theme is null when the user blocks post
	// themes, so the override is simply not published and the interface theme
	// carries through the thread.
	$effect(() => {
		if (typeof document !== 'undefined' && data.theme) {
			pageTheme.set(data.theme);
			return () => pageTheme.clear();
		}
	});

	// 2. Navigation Anchor Scroll (DESKTOP only). Uses scrollToElement
	// (window-only), never scrollIntoView: the ThreadPager viewport is
	// overflow:hidden, so scrollIntoView would scroll it internally and lock the
	// page on the anchor. Deferred until the layout is stable (waitForStableLayout)
	// so it does not chase a moving target mid-enter and twitch the header. Mobile
	// lands in afterNavigate (below) so the anchor is on the first paint - no flash.
	let lastScrolledHash: string | null = null;
	$effect(() => {
		const hash = page.url.hash;
		if (!hash) {
			lastScrolledHash = null;
			return;
		}
		if (hash === lastScrolledHash) return;
		if (window.matchMedia(MOBILE_BREAKPOINT).matches) return; // mobile: afterNavigate
		const targetId = hash.startsWith('#') ? hash.substring(1) : hash;
		// Match either exactly targetId or reply-targetId
		const element =
			document.getElementById(targetId) || document.getElementById(`reply-${targetId}`);
		if (!element) return;
		lastScrolledHash = hash;
		let cancelled = false;
		void waitForStableLayout().then(() => {
			if (cancelled) return;
			// Resume header reaction (frozen on nav) right before the clean
			// scroll so it hides smoothly instead of twitching on the nav scroll.
			getScrollChromeStore().releaseNavigation();
			scrollToElement(element);
		});
		return () => {
			cancelled = true;
		};
	});
</script>

<svelte:head>
	<title>{formatTitle(discussion.title)}</title>
</svelte:head>

{#snippet sidebar()}
	<div class="space-y-4">
		{#if user}
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
		{/if}
		<CategoryListWidget {t} activeSlug={discussion.categorySlug} />
		<ActiveUsersWall {t} />
	</div>
{/snippet}

{#snippet leftSnippet()}
	<DiscussionsPanel
		discussions={listCache.discussions?.items ?? data.home?.discussions}
		currentPage={listCache.discussions?.page ?? data.home?.page ?? 1}
		totalPages={listCache.discussions?.totalPages ?? data.home?.totalPages ?? 1}
		{t}
		{buildPageUrl}
		paginate={true}
	/>
{/snippet}
{#snippet rightSnippet()}
	<ActivityPanel
		activities={listCache.activity?.items ?? data.activity?.activities ?? []}
		currentPage={listCache.activity?.page ?? data.activity?.page ?? 1}
		totalPages={listCache.activity?.totalPages ?? data.activity?.totalPages ?? 1}
		activityDraft={listCache.activity?.activityDraft ?? data.activity?.activityDraft ?? null}
		mentionedUsers={listCache.activity?.mentionedUsers ?? data.activity?.mentionedUsers ?? {}}
		{t}
		{user}
		paginate={true}
	/>
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<GesturePageLayout
		centerTab={0}
		rightTab={1}
		leftHref="/"
		rightHref="/activity"
		left={leftSnippet}
		right={rightSnippet}
	>
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
						avatarUrl={opReply.authorAvatarUrl}
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
								avatarUrl={reply.authorAvatarUrl}
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
											// Mobile: let landAtAnchor own the scroll (no SvelteKit top-scroll
											// competing during the reply render window). Desktop unchanged.
											goto(
												url,
												window.matchMedia(MOBILE_BREAKPOINT).matches
													? { noScroll: true }
													: undefined
											);
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
	</GesturePageLayout>
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
