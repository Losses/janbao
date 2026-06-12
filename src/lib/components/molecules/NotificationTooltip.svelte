<script lang="ts">
	/**
	 * NotificationTooltip Molecule — Popover displaying the 5 most recent
	 * notifications. Lazily fetches `/api/notifications?limit=5` when opened.
	 */
	import Tooltip from '$lib/components/atoms/Tooltip.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import { mdiBell, mdiCog } from '@mdi/js';
	import { generateSlug } from '$lib/utils/slug';
	import type { VoidHandler } from '$lib/types/handlers';
	import type { NotificationItem } from '$lib/types/api';

	interface TranslationDict {
		[key: string]: string | Record<string, string>;
	}

	interface NotificationTooltipProps {
		isOpen: boolean;
		onToggle: VoidHandler;
		onClose: VoidHandler;
		t: TranslationDict;
	}

	let { isOpen, onToggle, onClose, t }: NotificationTooltipProps = $props();

	const tSidebar = $derived((t['sidebar'] as Record<string, string> | undefined) ?? {});
	const tNotification = $derived((t['notification'] as Record<string, string> | undefined) ?? {});

	let items = $state<NotificationItem[]>([]);
	let loaded = $state(false);

	interface NotificationView {
		item: NotificationItem;
		label: string;
		href: string;
	}

	function buildView(item: NotificationItem): NotificationView {
		const source = item.sourceDisplayName ?? '';
		if (item.type === 'message' && item.conversationId) {
			return {
				item,
				label: `${source} ${tNotification['message'] ?? ''}`,
				href: `/messages/${item.conversationId}`
			};
		}
		if (
			(item.type === 'mention' || item.type === 'reply' || item.type === 'discussion_comment') &&
			item.discussionId
		) {
			const verb =
				item.type === 'mention'
					? (tNotification['mention'] ?? '')
					: item.type === 'reply'
						? (tNotification['reply'] ?? '')
						: (tNotification['discussionComment'] ?? '');
			return {
				item,
				label: `${source} ${verb}`,
				href: `/discussion/${item.discussionId}/${item.discussionSlug ?? 'discussion'}`
			};
		}
		if (item.type === 'profile_comment' && item.activityId) {
			return {
				item,
				label: `${source} ${tNotification['profileComment'] ?? ''}`,
				href: `/activity#activity-${item.activityId}`
			};
		}
		return { item, label: source, href: '/notifications' };
	}

	const views = $derived(items.map(buildView));

	$effect(() => {
		if (!isOpen || loaded) return;
		void load();
	});

	async function load() {
		try {
			const res = await fetch('/api/notifications?limit=5');
			if (res.ok) {
				const data = (await res.json()) as { notifications: NotificationItem[] };
				items = data.notifications ?? [];
			}
		} catch {
			items = [];
		}
		loaded = true;
	}
</script>

<Tooltip {isOpen} {onToggle} {onClose}>
	<button
		type="button"
		class="btn btn-ghost btn-xs"
		aria-label={tSidebar['notifications'] ?? ''}
		title={tSidebar['notifications'] ?? ''}
		aria-expanded={isOpen}
		aria-haspopup="dialog"
	>
		<Icon path={mdiBell} size={16} />
	</button>

	{#snippet popover()}
		<div class="flex flex-col">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-base-300 px-4 py-2">
				<span class="text-sm font-medium">{tSidebar['notifications']}</span>
				<a
					href="/profile/preferences"
					class="text-xs text-primary hover:font-bold"
					aria-label={tSidebar['settings'] ?? ''}
				>
					<Icon path={mdiCog} size={14} />
				</a>
			</div>
			<!-- Notification List -->
			<ul class="max-h-64 overflow-y-auto">
				{#each views as view (view.item.id)}
					<li class="border-b border-base-200 transition-colors duration-150 hover:bg-base-200">
						<a href={view.href} class="flex gap-2 px-4 py-2">
							<div class="flex-shrink-0">
								<Avatar
									src={view.item.sourceAvatarFileId ? `/img/${view.item.sourceAvatarFileId}` : null}
									displayName={view.item.sourceDisplayName ?? '?'}
									size="xs"
								/>
							</div>
							<div class="min-w-0">
								<p
									class="text-xs {view.item.isRead
										? 'text-base-content/60'
										: 'font-medium text-base-content'}"
								>
									{view.label}
								</p>
								<DateComponent
									value={view.item.createdAt}
									{t}
									class="text-xs text-base-content/40"
								/>
							</div>
						</a>
					</li>
				{:else}
					<li class="px-4 py-3 text-xs text-base-content/40">{tNotification['noNotifications']}</li>
				{/each}
			</ul>
			<!-- Footer -->
			<div class="border-t border-base-300 px-4 py-2 text-center">
				<a href="/notifications" class="text-xs text-primary hover:font-bold">
					{tSidebar['showAll']}
				</a>
			</div>
		</div>
	{/snippet}
</Tooltip>
