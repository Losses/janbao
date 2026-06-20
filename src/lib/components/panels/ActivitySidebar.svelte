<script lang="ts">
	/**
	 * ActivitySidebar - Minimal activity-tab sidebar (user block only). Shared by
	 * the desktop activity route and the mobile pager drawer.
	 */
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import type { UserInfoSummary } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface ActivitySidebarProps {
		t: TranslationDict;
		user: UserInfoSummary | null;
	}

	let { t, user }: ActivitySidebarProps = $props();
</script>

{#if user}
	<UserInfoBlock {user} {t} />
{/if}
