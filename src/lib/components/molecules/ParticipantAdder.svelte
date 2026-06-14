<script lang="ts">
	/**
	 * ParticipantAdder Molecule - Username autocomplete that queries
	 * /api/users/search and emits a selected user. The parent owns the chip list
	 * and submission. Used by the /messages/new recipient field and the
	 * /messages/[id] sidebar "add participant" widget (RQ00-Frontend §3.3.4).
	 */
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import type { UserSearchResult } from '$lib/types/api';

	interface UserSelectHandler {
		(user: UserSearchResult): void;
	}

	interface ParticipantAdderProps {
		/** Placeholder text for the input */
		placeholder?: string;
		/** User IDs to exclude from suggestions (already added / the caller) */
		excludeIds?: number[];
		/** Called when a suggestion is selected */
		onSelect: UserSelectHandler;
	}

	let { placeholder = '', excludeIds = [], onSelect }: ParticipantAdderProps = $props();

	let query = $state('');
	let results = $state<UserSearchResult[]>([]);
	let showDropdown = $state(false);
	let loading = $state(false);
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	const excludeSet = $derived(new Set(excludeIds));
	const filteredResults = $derived(results.filter((r) => !excludeSet.has(r.id)));

	$effect(() => {
		const q = query.trim();
		if (debounceTimer) clearTimeout(debounceTimer);
		if (q.length === 0) {
			results = [];
			showDropdown = false;
			return;
		}
		debounceTimer = setTimeout(() => {
			void search(q);
		}, 250);
	});

	async function search(q: string) {
		loading = true;
		showDropdown = true;
		try {
			const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
			if (res.ok) {
				const data = (await res.json()) as { users: UserSearchResult[] };
				results = data.users || [];
			}
		} catch {
			results = [];
		}
		loading = false;
	}

	function pick(user: UserSearchResult) {
		onSelect(user);
		query = '';
		results = [];
		showDropdown = false;
	}

	function handleBlur() {
		// Delay so click events on suggestions fire before the dropdown closes
		setTimeout(() => {
			showDropdown = false;
		}, 150);
	}
</script>

<div class="relative">
	<input
		type="text"
		class="input input-sm input-bordered w-full"
		{placeholder}
		bind:value={query}
		onfocus={() => (showDropdown = true)}
		onblur={handleBlur}
	/>
	{#if showDropdown && (loading || filteredResults.length > 0)}
		<div
			class="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-base-300 bg-base-100 shadow-lg"
		>
			{#each filteredResults as user (user.id)}
				<button
					type="button"
					class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-base-200 transition-colors"
					onmousedown={() => pick(user)}
				>
					<Avatar
						userId={user.id}
						avatarFileId={user.avatarFileId}
						displayName={user.displayName}
						size="xs"
					/>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm font-medium text-base-content">
							{user.displayName}
						</span>
						<span class="block truncate text-xs text-base-content/50">@{user.username}</span>
					</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
