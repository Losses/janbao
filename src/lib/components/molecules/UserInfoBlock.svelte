<script lang="ts">
	/**
	 * UserInfoBlock Molecule — Displays user avatar, display name, and a row of icon buttons
	 * for Notifications, Messages, Bookmarks, and Settings.
	 */
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import NotificationTooltip from '$lib/components/molecules/NotificationTooltip.svelte';
	import MessageTooltip from '$lib/components/molecules/MessageTooltip.svelte';
	import BookmarkTooltip from '$lib/components/molecules/BookmarkTooltip.svelte';
	import { mdiCog } from '@mdi/js';

	interface UserInfoBlockProps {
		user: {
			id: string;
			username: string;
			displayName: string;
			avatarFileId: string | null;
		};
		t: Record<string, Record<string, string> | string>;
		class?: string;
	}

	let { user, t, class: className = '' }: UserInfoBlockProps = $props();

	// Track which tooltip popover is open (only one at a time)
	let openTooltip: 'notifications' | 'messages' | 'bookmarks' | null = $state(null);

	const tSidebar = $derived((t as Record<string, Record<string, string>>).sidebar ?? {});

	function toggleTooltip(name: 'notifications' | 'messages' | 'bookmarks') {
		if (openTooltip === name) {
			openTooltip = null;
		} else {
			openTooltip = name;
		}
	}

	function closeTooltip() {
		openTooltip = null;
	}
</script>

<div class="flex flex-col gap-3 {className}">
	<!-- User Avatar + Display Name -->
	<div class="flex items-center gap-3">
		<Avatar
			src={user.avatarFileId ? `/img/${user.avatarFileId}` : null}
			displayName={user.displayName}
			size="md"
		/>
		<div>
			<a
				href="/profile/{user.id}/{user.username}"
				class="font-medium text-base-content hover:text-primary"
			>
				{user.displayName}
			</a>
			<p class="text-xs text-base-content/60">@{user.username}</p>
		</div>
	</div>

	<!-- Icon Button Row -->
	<div class="flex items-center gap-1">
		<!-- Notifications -->
		<NotificationTooltip
			isOpen={openTooltip === 'notifications'}
			onToggle={() => toggleTooltip('notifications')}
			onClose={closeTooltip}
			{t}
		/>

		<!-- Messages -->
		<MessageTooltip
			isOpen={openTooltip === 'messages'}
			onToggle={() => toggleTooltip('messages')}
			onClose={closeTooltip}
			{t}
		/>

		<!-- Bookmarks -->
		<BookmarkTooltip
			isOpen={openTooltip === 'bookmarks'}
			onToggle={() => toggleTooltip('bookmarks')}
			onClose={closeTooltip}
			{t}
		/>

		<!-- Settings (direct link, no tooltip) -->
		<a
			href="/profile/edit"
			class="btn btn-ghost btn-xs"
			aria-label={tSidebar['settings'] ?? 'Settings'}
			title={tSidebar['settings'] ?? 'Settings'}
		>
			<Icon path={mdiCog} size={16} />
		</a>
	</div>
</div>
