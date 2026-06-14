<script lang="ts">
	/**
	 * CategoryListWidget Molecule - Displays a vertical navigation list of
	 * categories. Uses a module-level store so data persists across page
	 * navigations  - no skeleton flash on subsequent visits.
	 */
	import type { TranslationDict } from '$lib/types/translation';
	import { getCategoryStore } from '$lib/stores/categories.svelte';

	interface CategoryListWidgetProps {
		t: TranslationDict;
		/** Currently active category slug for highlighting */
		activeSlug?: string;
	}

	let { t, activeSlug }: CategoryListWidgetProps = $props();

	const store = getCategoryStore();
	const title = $derived(t.sidebar.categoryList);

	$effect(() => {
		void store.fetchIfNeeded();
	});
</script>

<div class="space-y-3">
	<h3 class="text-sm font-semibold text-base-content/70">{title}</h3>
	{#if !store.loaded}
		<div class="space-y-2">
			{#each [0, 1, 2, 3] as i (i)}
				<div class="skeleton h-5 w-full rounded"></div>
			{/each}
		</div>
	{:else if store.categories.length === 0}
		<div class="h-4"></div>
	{:else}
		<nav class="flex flex-col gap-1">
			{#each store.categories as cat (cat.slug)}
				<a
					href="/category/{cat.slug}"
					class="text-sm px-2 py-1.5 rounded transition-colors {activeSlug === cat.slug
						? 'bg-primary/10 text-primary font-semibold'
						: 'text-base-content/70 hover:text-primary hover:bg-base-200/50'}"
				>
					{cat.title}
				</a>
			{/each}
		</nav>
	{/if}
</div>
