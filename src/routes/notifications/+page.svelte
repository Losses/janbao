<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import Badge from '$lib/components/atoms/Badge.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import type { NotificationItem, ApiResult } from '$lib/types/api';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const notificationT = $derived(t.notification);
	const profileT = $derived(t.profile);
	const user = $derived(data.user);
	const notifications = $derived(data.notifications as NotificationItem[]);
	let isDrawerOpen = $state(false);
	let marking = $state(false);

	// Locally-marked-read ids (session-only) so "mark all as read" updates the
	// UI without mutating server-loaded prop data.
	let markedReadIds = $state<Set<string>>(new Set());
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
		const sourceName = item.sourceDisplayName ?? '';
		const isRead = item.isRead || markedReadIds.has(item.id);
		let label: string;
		let href: string | null = null;
		let target: string | null = null;

		if (item.type === 'message' && item.conversationId) {
			label = `${sourceName} ${notificationT.message}`;
			href = `/messages/${item.conversationId}`;
		} else if (
			(item.type === 'mention' || item.type === 'reply' || item.type === 'discussion_comment') &&
			item.discussionId
		) {
			const verb =
				item.type === 'mention'
					? notificationT.mention
					: item.type === 'reply'
						? notificationT.reply
						: notificationT.discussionComment;
			label = `${sourceName} ${verb}`;
			target = item.discussionTitle;
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

{#snippet sidebar()}
	<div class="card bg-base-200 border border-base-300 p-4 space-y-4">
		{#if user}
			<UserInfoBlock {user} {t} />
			<div class="divider my-1"></div>
			<ul class="menu menu-sm w-full gap-1">
				<li><a href="/profile/{user.id}/{userSlug}">{profileT.activities}</a></li>
				<li><a href="/notifications" class="active">{profileT.notifications}</a></li>
				<li><a href="/profile/invitations">{profileT.invitations}</a></li>
				<li><a href="/messages/inbox">{profileT.mailbox}</a></li>
				<li><a href="/profile/discussions/{user.id}/{userSlug}">{profileT.discussions}</a></li>
				<li><a href="/profile/comments/{user.id}/{userSlug}">{profileT.comments}</a></li>
				<li class="menu-title mt-2">{profileT.accountSettings}</li>
				<li><a href="/profile/edit">{profileT.editAccount}</a></li>
				<li><a href="/profile/password">{profileT.changePassword}</a></li>
				<li><a href="/profile/preferences">{profileT.preferences}</a></li>
				<li><a href="/profile/picture">{profileT.avatar}</a></li>
				<li><a href="/profile/onlineNow">{profileT.stealthSettings}</a></li>
			</ul>
		{/if}
	</div>
{/snippet}

<DualColumnLayout {sidebar} bind:isDrawerOpen>
	<div class="space-y-6">
		<div class="flex items-center justify-between border-b border-base-300 pb-4">
			<h1 class="text-2xl font-bold">{notificationT.title}</h1>
			{#if hasUnread}
				<button class="btn btn-sm btn-outline" onclick={markAllRead} disabled={marking}>
					{notificationT.markAllRead}
				</button>
			{/if}
		</div>

		{#if views.length === 0}
			<div
				class="card bg-base-200/40 border border-base-200 p-10 text-center text-base-content/50 rounded-xl"
			>
				{notificationT.allCaughtUp}
			</div>
		{:else}
			<div class="card bg-base-100 border border-base-200 rounded-xl shadow-sm px-4">
				{#each views as view (view.item.id)}
					{@const item = view.item}
					<div
						class="flex gap-3 py-3 border-b border-base-200 last:border-b-0 {view.isRead
							? 'opacity-60'
							: ''}"
					>
						<div class="flex-shrink-0">
							{#if item.sourceUserId}
								<a href="/profile/{item.sourceUserId}/{generateSlug(item.sourceUsername ?? '')}">
									<Avatar
										src={item.sourceAvatarFileId ? `/img/${item.sourceAvatarFileId}` : null}
										displayName={item.sourceDisplayName ?? '?'}
										size="sm"
									/>
								</a>
							{:else}
								<Avatar src={null} displayName="?" size="sm" />
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0">
									{#if view.href}
										<a href={view.href} class="block">
											<span class="text-sm text-base-content hover:text-primary transition-colors">
												{view.label}
											</span>
										</a>
									{:else}
										<span class="text-sm text-base-content">{view.label}</span>
									{/if}
									{#if view.target}
										<span class="block text-xs text-base-content/50 truncate">
											{notificationT.in}
											{view.target}
										</span>
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
</DualColumnLayout>
