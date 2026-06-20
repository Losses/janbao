<script lang="ts">
	/**
	 * MessagesSidebar - Inbox-tab sidebar (profile nav with "mailbox" active).
	 * Shared by the desktop messages route and the mobile pager drawer.
	 */
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import type { UserInfoSummary } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface MessagesSidebarProps {
		t: TranslationDict;
		user: UserInfoSummary | null;
	}

	let { t, user }: MessagesSidebarProps = $props();

	const userSlug = $derived(generateSlug(user?.username || ''));
</script>

{#if user}
	<ProfileSidebar
		{user}
		{t}
		activeItem="mailbox"
		targetUserId={user.id}
		targetUserSlug={userSlug}
	/>
{/if}
