<script lang="ts">
	/**
	 * ActiveUsersWall Molecule - Grid of avatars for users active in the last
	 * 10 minutes (stealth users excluded server-side). Uses a module-level
	 * store so data persists across page navigations  - no skeleton flash on
	 * subsequent visits.
	 */
	import { afterNavigate } from '$app/navigation';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import type { TranslationDict } from '$lib/types/translation';
	import { getActiveUsersStore } from '$lib/stores/active-users.svelte';

	interface ActiveUsersWallProps {
		t: TranslationDict;
	}

	let { t }: ActiveUsersWallProps = $props();

	const store = getActiveUsersStore();
	const title = $derived(t.sidebar.activeUsers);

	$effect(() => {
		if (!store.loaded) void store.load();
	});

	// Background refresh on navigation only - never inside the $effect, since
	// the store mutates the same $state the effect tracks, which would loop.
	afterNavigate(() => {
		void store.refresh();
	});
</script>

<div class="space-y-3">
	<h3 class="text-sm font-semibold text-base-content/70">{title}</h3>
	{#if !store.loaded}
		<div class="flex flex-wrap gap-2">
			{#each [0, 1, 2, 3, 4, 5] as i (i)}
				<div class="skeleton w-10 h-10 rounded-box"></div>
			{/each}
		</div>
	{:else if store.users.length === 0}
		<div class="h-4"></div>
	{:else}
		<div class="flex flex-wrap gap-2">
			{#each store.users as u (u.id)}
				<a
					href="/messages/new?recipient={u.id}"
					title={u.displayName}
					class="transition-transform hover:scale-110"
				>
					<Avatar
						userId={u.id}
						avatarFileId={u.avatarFileId}
						displayName={u.displayName}
						size="sm"
					/>
				</a>
			{/each}
		</div>
	{/if}
</div>
