<script lang="ts">
	/**
	 * SearchSortSheet - the sort picker for the mobile search filter. A DaisyUI
	 * modal (patterned on ConfirmationModal) with NO confirm button: a flat list
	 * of sort options where a single tap selects and closes. The `replies` option
	 * appears only for the discussions scope (the only scope that supports it).
	 */
	import type { SearchScope, SearchSort } from '$lib/types/search';
	import type { TranslationDict } from '$lib/types/translation';
	import type { VoidHandler } from '$lib/types/handlers';

	type SortSelectHandler = (sort: SearchSort) => void;

	interface SortOption {
		value: SearchSort;
		label: string;
	}

	interface SearchSortSheetProps {
		open: boolean;
		t: TranslationDict;
		scope: SearchScope;
		sort: SearchSort;
		onSelect: SortSelectHandler;
		onClose: VoidHandler;
	}

	let { open, t, scope, sort, onSelect, onClose }: SearchSortSheetProps = $props();

	const tSearch = $derived(t.search);

	const options = $derived<SortOption[]>([
		{ value: 'newest', label: tSearch.sortNewest },
		{ value: 'oldest', label: tSearch.sortOldest },
		{ value: 'relevance', label: tSearch.sortRelevance },
		...(scope === 'discussions'
			? [{ value: 'replies' as SearchSort, label: tSearch.sortReplies }]
			: [])
	]);

	function choose(value: SearchSort): void {
		onSelect(value);
		onClose();
	}
</script>

{#if open}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="search-sort-title">
		<div class="modal-box">
			<h3 id="search-sort-title" class="text-lg font-bold">{tSearch.sortBy}</h3>
			<ul class="mt-2 divide-y divide-base-300">
				{#each options as o (o.value)}
					<li>
						<button
							type="button"
							class="flex w-full items-center justify-between px-1 py-3 text-left {sort === o.value
								? 'text-accent'
								: 'text-base-content'}"
							aria-current={sort === o.value ? 'true' : undefined}
							onclick={() => choose(o.value)}
						>
							<span class="font-medium">{o.label}</span>
							{#if sort === o.value}
								<span class="text-accent">✓</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		</div>
		<button
			class="modal-backdrop"
			onclick={onClose}
			onkeydown={() => {}}
			tabindex="-1"
			aria-label={tSearch.sortBy}
		></button>
	</div>
{/if}
