<script lang="ts">
	/**
	 * ActiveUsersWall Molecule — Grid of avatars for users active in the last
	 * 10 minutes (stealth users excluded server-side). Fetches /api/users/online
	 * on mount. Rendered in the Messages inbox sidebar per RQ00-Frontend §3.3.3.
	 */
	import Avatar from '$lib/components/atoms/Avatar.svelte';

	interface OnlineUser {
		id: string;
		username: string;
		displayName: string;
		avatarFileId: string | null;
	}

	interface TranslationDict {
		[key: string]: string | Record<string, string>;
	}

	interface ActiveUsersWallProps {
		t: TranslationDict;
	}

	let { t }: ActiveUsersWallProps = $props();

	let users = $state<OnlineUser[]>([]);
	let loaded = $state(false);

	const title = $derived(
		((t['sidebar'] as Record<string, string> | undefined) ?? {})['activeUsers'] ?? ''
	);

	$effect(() => {
		void fetchOnline();
	});

	async function fetchOnline() {
		try {
			const res = await fetch('/api/users/online');
			if (res.ok) {
				users = (await res.json()) as OnlineUser[];
			}
		} catch {
			// Silently fail — the wall is non-critical
		}
		loaded = true;
	}
</script>

<div class="space-y-3">
	<h3 class="text-sm font-semibold text-base-content/70">{title}</h3>
	{#if !loaded}
		<div class="flex flex-wrap gap-2">
			{#each [0, 1, 2, 3, 4, 5] as i (i)}
				<div class="skeleton w-10 h-10 rounded-full"></div>
			{/each}
		</div>
	{:else if users.length === 0}
		<p class="text-xs text-base-content/40">—</p>
	{:else}
		<div class="flex flex-wrap gap-2">
			{#each users as u (u.id)}
				<a
					href="/messages/new?recipient={u.id}"
					title={u.displayName}
					class="transition-transform hover:scale-110"
				>
					<Avatar
						src={u.avatarFileId ? `/img/${u.avatarFileId}` : null}
						displayName={u.displayName}
						size="sm"
					/>
				</a>
			{/each}
		</div>
	{/if}
</div>
