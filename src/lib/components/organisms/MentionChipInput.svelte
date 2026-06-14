<script lang="ts">
	/**
	 * MentionChipInput - Single-line recipient picker for the message compose
	 * page. Type to search users (no @ required), Enter/click to add a chip,
	 * Backspace on empty input removes the last chip. Styled with DaisyUI
	 * `input input-bordered` so it matches the subject field's border, height
	 * and focus highlight exactly.
	 */
	import { onMount, onDestroy, untrack } from 'svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import type { UserSearchResult } from '$lib/types/api';

	type RecipientsChangeHandler = (users: UserSearchResult[]) => void;

	interface MentionChipInputProps {
		/** Extra user IDs to hide from suggestions (e.g. already selected upstream) */
		excludeIds?: number[];
		/** Pre-loaded recipients (e.g. from URL prefill) */
		initialRecipients?: UserSearchResult[];
		/** Called with the current recipients whenever they change */
		onRecipientsChange?: RecipientsChangeHandler;
		/** Disable the input */
		disabled?: boolean;
	}

	let {
		excludeIds = [],
		initialRecipients,
		onRecipientsChange,
		disabled = false
	}: MentionChipInputProps = $props();

	// `initialRecipients` only seeds the chips once on mount; later prop changes
	// shouldn't overwrite the user's selection, so untrack the reactive read.
	let recipients = $state<UserSearchResult[]>(untrack(() => initialRecipients ?? []));
	let query = $state('');
	let results = $state<UserSearchResult[]>([]);
	let selectedIndex = $state(0);
	let isOpen = $state(false);

	let inputEl = $state<HTMLInputElement>();
	let containerEl = $state<HTMLDivElement>();
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	const DEBOUNCE_MS = 200;

	function notify() {
		onRecipientsChange?.(recipients);
	}

	function excludedSet(): Set<number> {
		return new Set([...excludeIds, ...recipients.map((r) => r.id)]);
	}

	function onInput() {
		if (debounceTimer) clearTimeout(debounceTimer);
		const q = query.trim();
		if (q.length === 0) {
			results = [];
			isOpen = false;
			return;
		}
		isOpen = true;
		debounceTimer = setTimeout(() => {
			void search(q);
		}, DEBOUNCE_MS);
	}

	async function search(q: string) {
		try {
			const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}&limit=5`);
			if (!res.ok) {
				results = [];
				isOpen = false;
				return;
			}
			const data = (await res.json()) as { users: UserSearchResult[] };
			const exclude = excludedSet();
			results = (data.users || []).filter((u) => !exclude.has(u.id));
			selectedIndex = 0;
			if (results.length === 0) isOpen = false;
		} catch {
			results = [];
			isOpen = false;
		}
	}

	function addRecipient(user: UserSearchResult) {
		if (!excludedSet().has(user.id)) {
			recipients = [...recipients, user];
			notify();
		}
		query = '';
		results = [];
		isOpen = false;
		inputEl?.focus();
	}

	function removeRecipient(id: number) {
		recipients = recipients.filter((r) => r.id !== id);
		notify();
		inputEl?.focus();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown') {
			if (!isOpen || results.length === 0) return;
			event.preventDefault();
			selectedIndex = (selectedIndex + 1) % results.length;
		} else if (event.key === 'ArrowUp') {
			if (!isOpen || results.length === 0) return;
			event.preventDefault();
			selectedIndex = (selectedIndex - 1 + results.length) % results.length;
		} else if (event.key === 'Enter') {
			// Single-line: Enter only ever selects a suggestion, never inserts a newline.
			event.preventDefault();
			if (isOpen && results.length > 0) {
				addRecipient(results[selectedIndex]);
			}
		} else if (event.key === 'Escape') {
			isOpen = false;
		} else if (event.key === 'Backspace' && query === '' && recipients.length > 0) {
			event.preventDefault();
			removeRecipient(recipients[recipients.length - 1].id);
		}
	}

	function onFocus() {
		if (results.length > 0) isOpen = true;
	}

	function closeIfOutside(event: MouseEvent) {
		if (containerEl && !containerEl.contains(event.target as Node)) {
			isOpen = false;
		}
	}

	onMount(() => {
		document.addEventListener('mousedown', closeIfOutside);
		notify();
	});

	onDestroy(() => {
		document.removeEventListener('mousedown', closeIfOutside);
		if (debounceTimer) clearTimeout(debounceTimer);
	});
</script>

<div class="relative" bind:this={containerEl}>
	<!-- `.input input-bordered` mirrors the subject field's border, height, focus ring. -->
	<div
		class="input input-bordered w-full h-auto min-h-[2.5rem] flex-wrap items-center gap-1 {disabled
			? 'pointer-events-none'
			: ''}"
	>
		{#each recipients as r (r.id)}
			<span
				class="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary flex-shrink-0"
			>
				{r.displayName}
				{#if !disabled}
					<button
						type="button"
						class="-mr-0.5 leading-none hover:opacity-70"
						aria-label="Remove {r.displayName}"
						onclick={() => removeRecipient(r.id)}
					>
						×
					</button>
				{/if}
			</span>
		{/each}
		<input
			bind:this={inputEl}
			bind:value={query}
			oninput={onInput}
			onkeydown={onKeydown}
			onfocus={onFocus}
			{disabled}
			type="text"
			autocomplete="off"
			aria-autocomplete="list"
			aria-expanded={isOpen}
			aria-controls={isOpen && results.length > 0 ? 'mention-listbox' : undefined}
			role="combobox"
			class="min-w-0 flex-1 border-none bg-transparent outline-none"
		/>
	</div>

	{#if isOpen && results.length > 0}
		<div
			id="mention-listbox"
			class="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-50 max-h-60 overflow-y-auto rounded-lg border border-base-300 bg-base-100 shadow-lg"
			role="listbox"
		>
			{#each results as user, index (user.id)}
				<button
					type="button"
					class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors {index ===
					selectedIndex
						? 'bg-base-200'
						: 'hover:bg-base-200'}"
					role="option"
					aria-selected={index === selectedIndex}
					onmouseenter={() => (selectedIndex = index)}
					onclick={() => addRecipient(user)}
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
