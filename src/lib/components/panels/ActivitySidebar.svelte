<script lang="ts">
	/**
	 * ActivitySidebar - Minimal activity-tab sidebar. Props are kept for call site
	 * compatibility, but the block is empty as the user block is rendered globally.
	 */
	import type { UserInfoSummary } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface ActivitySidebarProps {
		t: TranslationDict;
		user: UserInfoSummary | null;
	}

	let { t, user }: ActivitySidebarProps = $props();
	// svelte-ignore state_referenced_locally
	void t;
	// svelte-ignore state_referenced_locally
	void user;
</script>

<!-- Empty because user block is rendered globally -->
