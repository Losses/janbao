/**
 * Categories Store - Module-level reactive state for the sidebar category
 * list. Persists across component mounts so navigation between forum pages
 * does not trigger skeleton screens.
 *
 * Stale-while-revalidate, split into two entry points so neither mutates the
 * $state an $effect is tracking (which would loop):
 *   - load()    first load, blocks until data arrives (called from $effect)
 *   - refresh() background re-fetch (called from afterNavigate, not $effect)
 */
import type { CategoryItem } from '$lib/types/api';

interface CategoryStoreData {
	categories: CategoryItem[];
	loaded: boolean;
}

type LoadFn = () => Promise<void>;
type RefreshFn = () => Promise<void>;

interface CategoryStore extends CategoryStoreData {
	load: LoadFn;
	refresh: RefreshFn;
}

let categories = $state<CategoryItem[]>([]);
let loaded = $state(false);
let loading = $state(false);

async function load(): Promise<void> {
	if (loaded || loading) return;
	// First load - block until data arrives so skeleton shows correctly
	loading = true;
	try {
		const res = await fetch('/api/categories');
		if (res.ok) {
			categories = (await res.json()) as CategoryItem[];
		}
	} catch {
		// Non-critical - sidebar will show empty state
	}
	loaded = true;
	loading = false;
}

async function refresh(): Promise<void> {
	if (!loaded || loading) return;
	// Already loaded - background refresh, never show skeleton
	loading = true;
	try {
		const res = await fetch('/api/categories');
		if (res.ok) {
			categories = (await res.json()) as CategoryItem[];
		}
	} catch {
		// Non-critical - keep existing data
	}
	loading = false;
}

export function getCategoryStore(): CategoryStore {
	return {
		get categories() {
			return categories;
		},
		get loaded() {
			return loaded;
		},
		load,
		refresh
	};
}
