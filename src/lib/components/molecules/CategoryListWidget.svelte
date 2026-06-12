<script lang="ts">
	/**
	 * CategoryListWidget Molecule - Displays a vertical navigation list of
	 * categories. Fetches /api/categories on mount. Rendered in forum route
	 * sidebars per RQ00-Frontend §3.3.1.
	 */
	import type { TranslationDict } from '$lib/types/translation';

	interface CategoryItem {
		slug: string;
		title: string;
	}

	interface CategoryListWidgetProps {
		t: TranslationDict;
		/** Currently active category slug for highlighting */
		activeSlug?: string;
	}

	let { t, activeSlug }: CategoryListWidgetProps = $props();

	let categories = $state<CategoryItem[]>([]);
	let loaded = $state(false);

	const title = $derived(t.sidebar.categoryList);

	$effect(() => {
		void fetchCategories();
	});

	async function fetchCategories() {
		try {
			const res = await fetch('/api/categories');
			if (res.ok) {
				categories = (await res.json()) as CategoryItem[];
			}
		} catch {
			// Silently fail - the widget is non-critical
		}
		loaded = true;
	}
</script>

<div class="space-y-3">
	<h3 class="text-sm font-semibold text-base-content/70">{title}</h3>
	{#if !loaded}
		<div class="space-y-2">
			{#each [0, 1, 2, 3] as i (i)}
				<div class="skeleton h-5 w-full rounded"></div>
			{/each}
		</div>
	{:else if categories.length === 0}
		<div class="h-4"></div>
	{:else}
		<nav class="flex flex-col gap-1">
			{#each categories as cat (cat.slug)}
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
