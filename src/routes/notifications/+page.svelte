<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import Badge from '$lib/components/atoms/Badge.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { formatDisplayName } from '$lib/utils/user';
	import type { NotificationItem, ApiResult } from '$lib/types/api';
	import type { PageData } from './$types';
	import GesturePageLayout from '$lib/components/templates/GesturePageLayout.svelte';
	import { getListCacheStore } from '$lib/stores/list-cache.svelte';
	import DiscussionsPanel from '$lib/components/panels/DiscussionsPanel.svelte';
	import type { DiscussionListItem } from '$lib/server/db/dao/discussions';

	const online = getOnlineStore();

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const listCache = getListCacheStore();
	const cachedDiscussions = $derived(
		listCache.home?.discussions as DiscussionListItem[] | undefined
	);

	const t = $derived(data.t);
	const notificationT = $derived(t.notification);
	const user = $derived(data.user);
	const notifications = $derived(data.notifications as NotificationItem[]);
	let marking = $state(false);

	// Locally-marked-read ids (session-only) so "mark all as read" updates the
	// UI without mutating server-loaded prop data.
	let markedReadIds = $state<Set<number>>(new Set());
	const hasUnread = $derived(notifications.some((n) => !n.isRead && !markedReadIds.has(n.id)));

	const userSlug = $derived(generateSlug(user?.username || ''));

	interface NotificationView {
		item: NotificationItem;
		isRead: boolean;
		href: string | null;
		label: string;
		target: string | null;
	}

	function buildView(item: NotificationItem): NotificationView {
		const sourceName = formatDisplayName(item.sourceDisplayName, item.sourceUserId, t);
		const isRead = item.isRead || markedReadIds.has(item.id);
		let label: string;
		let href: string | null = null;
		let target: string | null = null;

		if (
			(item.type === 'mention' ||
				item.type === 'reply' ||
				item.type === 'discussion_comment' ||
				item.type === 'participated_comment' ||
				item.type === 'bookmarked_comment') &&
			item.discussionId
		) {
			let verbPattern: string;
			if (item.type === 'mention') {
				verbPattern = item.discussionTitle
					? (notificationT.mention ?? '')
					: (notificationT.mentionFallback ?? '');
			} else if (item.type === 'reply') {
				verbPattern = item.discussionTitle
					? (notificationT.reply ?? '')
					: (notificationT.replyFallback ?? '');
			} else if (item.type === 'participated_comment') {
				verbPattern = item.discussionTitle
					? (notificationT.participatedComment ?? '')
					: (notificationT.participatedCommentFallback ?? '');
			} else if (item.type === 'bookmarked_comment') {
				verbPattern = item.discussionTitle
					? (notificationT.bookmarkedComment ?? '')
					: (notificationT.bookmarkedCommentFallback ?? '');
			} else {
				verbPattern = item.discussionTitle
					? (notificationT.discussionComment ?? '')
					: (notificationT.discussionCommentFallback ?? '');
			}

			const verb = verbPattern.replace('{title}', item.discussionTitle ?? '');
			label = `${sourceName} ${verb}`;
			href = `/discussion/${item.discussionId}/${item.discussionSlug ?? 'discussion'}`;
		} else if (item.type === 'profile_comment' && item.activityId) {
			label = `${sourceName} ${notificationT.profileComment}`;
			href = `/activity#activity-${item.activityId}`;
		} else {
			label = sourceName;
		}

		return { item, isRead, href, label, target };
	}

	const views = $derived(notifications.map(buildView));

	async function markAllRead() {
		if (!online.online) return;
		marking = true;
		try {
			const res = await fetch('/api/notifications', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ all: true })
			});
			const result: ApiResult = await res.json();
			if (result.success) {
				markedReadIds = new Set(notifications.map((n) => n.id));
			}
		} catch {
			// silently fail
		}
		marking = false;
	}
</script>

<svelte:head>
	<title>{formatTitle(notificationT.title)}</title>
</svelte:head>

{#snippet leftPanel()}
	{#if user}
		<DiscussionsPanel
			discussions={cachedDiscussions}
			currentPage={listCache.home?.page ?? 1}
			totalPages={listCache.home?.totalPages ?? 1}
			{t}
			buildPageUrl={(page) => (page === 1 ? '/' : `/discussions/p${page}`)}
			paginate={true}
		/>
	{/if}
{/snippet}

{#snippet sidebar()}
	{#if user}
		<ProfileSidebar
			{user}
			{t}
			activeItem="notifications"
			targetUserId={user.id}
			targetUserSlug={userSlug}
		/>
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<GesturePageLayout left={leftPanel} leftHref="/" fallbackRoute="/">
		<div class="space-y-3">
			<div class="flex items-center justify-between border-b border-base-300 pb-4">
				<h1 class="page-title">{notificationT.title}</h1>
				{#if hasUnread}
					<button
						class="btn btn-sm btn-outline"
						onclick={markAllRead}
						disabled={marking || !online.online}
					>
						{notificationT.markAllRead}
					</button>
				{/if}
			</div>

			{#if !online.online || views.length === 0}
				<EmptyState
					message={!online.online ? t.offline.disabled.title : notificationT.allCaughtUp}
				/>
			{:else}
				<div class="divide-y divide-base-300">
					{#each views as view (view.item.id)}
						{@const item = view.item}
						<div
							class="flex gap-3 py-3 border-b border-base-300 last:border-b-0 {view.isRead
								? 'opacity-60'
								: ''}"
						>
							<div class="flex-shrink-0">
								{#if item.sourceUserId}
									{@const sourceSlug = generateSlug(item.sourceUsername || '')}
									<a href="/profile/{item.sourceUserId}/{sourceSlug}">
										<Avatar
											userId={item.sourceUserId}
											avatarFileId={item.sourceAvatarFileId}
											displayName={item.sourceDisplayName}
											size="sm"
										/>
									</a>
								{:else}
									<Avatar userId={0} avatarFileId={null} displayName="System" size="sm" />
								{/if}
							</div>
							<div class="flex-grow min-w-0">
								<div class="flex items-start justify-between gap-3">
									<div class="text-sm break-words flex-1 min-w-0">
										{#if item.sourceUserId}
											{@const sourceSlug = generateSlug(item.sourceUsername || '')}
											<a
												href="/profile/{item.sourceUserId}/{sourceSlug}"
												class="font-semibold text-base-content hover:underline"
											>
												{formatDisplayName(item.sourceDisplayName, item.sourceUserId, t)}
											</a>
										{:else}
											<span class="font-semibold text-base-content">System</span>
										{/if}
										<span class="text-base-content/75">
											{view.label}
										</span>
										{#if view.target}
											{#if view.href}
												<a href={view.href} class="text-primary font-medium hover:underline">
													{view.target}
												</a>
											{:else}
												<span class="font-medium text-base-content/85">
													{view.target}
												</span>
											{/if}
										{/if}
									</div>
									{#if !view.isRead}
										<Badge variant="primary" class="badge-xs"></Badge>
									{/if}
								</div>
								<DateComponent value={item.createdAt} {t} class="text-xs text-base-content/40" />
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</GesturePageLayout>
</DualColumnLayout>
