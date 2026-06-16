<script lang="ts">
	/**
	 * UserInfoBlock Molecule - Displays user avatar, display name, and a row of icon buttons
	 * for Notifications, Messages, Bookmarks, and Settings.
	 */
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import NotificationTooltip from '$lib/components/molecules/NotificationTooltip.svelte';
	import MessageTooltip from '$lib/components/molecules/MessageTooltip.svelte';
	import BookmarkTooltip from '$lib/components/molecules/BookmarkTooltip.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import type { UserInfoSummary } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';
	import { mdiCog, mdiShieldAccount } from '@mdi/js';

	interface UserInfoBlockProps {
		user: UserInfoSummary;
		t: TranslationDict;
		class?: string;
	}

	let { user, t, class: className = '' }: UserInfoBlockProps = $props();

	// Track which tooltip popover is open (only one at a time)
	let openTooltip: 'notifications' | 'messages' | 'bookmarks' | null = $state(null);

	const tSidebar = $derived(t.sidebar);
	const tAdmin = $derived(t.admin);
	const userSlug = $derived(generateSlug(user.username));
	const isAdmin = $derived(user.groupSlug === 'admin');

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
			userId={user.id}
			avatarFileId={user.avatarFileId}
			displayName={user.displayName}
			size="md"
		/>
		<div>
			<a
				href="/profile/{user.id}/{userSlug}"
				class="user-display-name text-base-content hover:text-primary"
			>
				{user.displayName}
			</a>
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
			class="btn btn-ghost btn-xs sidebar-icon-btn"
			aria-label={tSidebar['settings']}
			title={tSidebar['settings']}
		>
			<Icon path={mdiCog} size={16} />
		</a>

		<!-- Admin panel (admin-only direct link) -->
		{#if isAdmin}
			<a
				href="/admin"
				class="btn btn-ghost btn-xs sidebar-icon-btn"
				aria-label={tAdmin['adminPanel']}
				title={tAdmin['adminPanel']}
			>
				<Icon path={mdiShieldAccount} size={16} />
			</a>
		{/if}
	</div>
</div>
