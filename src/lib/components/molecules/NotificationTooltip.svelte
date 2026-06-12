<script lang="ts">
	/**
	 * NotificationTooltip Molecule — Popover displaying the 5 most recent notifications.
	 * During Cycle 2, uses mock data. Will be connected to API in later cycles.
	 */
	import Tooltip from '$lib/components/atoms/Tooltip.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiBell, mdiCog } from '@mdi/js';

	interface NotificationTooltipProps {
		isOpen: boolean;
		onToggle: () => void;
		onClose: () => void;
		t: Record<string, Record<string, string> | string>;
	}

	let { isOpen, onToggle, onClose, t }: NotificationTooltipProps = $props();

	const tSidebar = $derived((t as Record<string, Record<string, string>>).sidebar ?? {});

	// Mock notification data for Cycle 2
	const mockNotifications = [
		{
			id: '1',
			text: '@user1 replied to your discussion "Welcome to Janbao"',
			time: '5 min ago',
			isRead: false
		},
		{
			id: '2',
			text: '@user2 mentioned you in "Getting Started"',
			time: '1 hour ago',
			isRead: false
		},
		{ id: '3', text: '@user3 commented on your activity', time: '3 hours ago', isRead: true },
		{ id: '4', text: '@user4 sent you a private message', time: '1 day ago', isRead: true },
		{ id: '5', text: '@user5 replied to "Feature Requests"', time: '2 days ago', isRead: true }
	];
</script>

<Tooltip {isOpen} {onToggle} {onClose}>
	<button
		type="button"
		class="btn btn-ghost btn-xs"
		aria-label={tSidebar['notifications'] ?? 'Notifications'}
		title={tSidebar['notifications'] ?? 'Notifications'}
	>
		<Icon path={mdiBell} size={16} />
	</button>

	{#snippet popover()}
		<div class="flex flex-col">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-base-300 px-4 py-2">
				<span class="text-sm font-medium">{tSidebar['notifications'] ?? 'Notifications'}</span>
				<a
					href="/profile/preferences"
					class="text-xs text-primary hover:font-bold"
					aria-label={tSidebar['settings'] ?? 'Settings'}
				>
					<Icon path={mdiCog} size={14} />
				</a>
			</div>
			<!-- Notification List -->
			<ul class="max-h-64 overflow-y-auto">
				{#each mockNotifications as notification (notification.id)}
					<li
						class="border-b border-base-200 px-4 py-2 transition-colors duration-150 hover:bg-base-200"
					>
						<p
							class="text-xs {notification.isRead
								? 'text-base-content/60'
								: 'font-medium text-base-content'}"
						>
							{notification.text}
						</p>
						<span class="text-xs text-base-content/40">{notification.time}</span>
					</li>
				{/each}
			</ul>
			<!-- Footer -->
			<div class="border-t border-base-300 px-4 py-2 text-center">
				<a href="/notifications" class="text-xs text-primary hover:font-bold">
					{tSidebar['showAll'] ?? 'Show All'}
				</a>
			</div>
		</div>
	{/snippet}
</Tooltip>
