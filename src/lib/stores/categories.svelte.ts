/**
 * Categories Store — Module-level reactive state for the sidebar category
 * list. Persists across component mounts so navigation between forum pages
 * does not trigger skeleton screens.
 *
 * Stale-while-revalidate: first call fetches and blocks; subsequent calls
 * return cached data immediately and refresh silently in the background.
 */
import type { CategoryItem } from '$lib/types/api';

interface CategoryStoreData {
	categories: CategoryItem[];
	loaded: boolean;
}

type FetchIfNeededFn = () => Promise<void>;

interface CategoryStore extends CategoryStoreData {
	fetchIfNeeded: FetchIfNeededFn;
}

let categories = $state<CategoryItem[]>([]);
let loaded = $state(false);
let loading = $state(false);

async function fetchIfNeeded(): Promise<void> {
	if (loading) return;

	if (!loaded) {
		// First load — block until data arrives so skeleton shows correctly
		loading = true;
		try {
			const res = await fetch('/api/categories');
			if (res.ok) {
				categories = (await res.json()) as CategoryItem[];
			}
		} catch {
			// Non-critical — sidebar will show empty state
		}
		loaded = true;
		loading = false;
		return;
	}

	// Already loaded — background refresh, never show skeleton
	loading = true;
	try {
		const res = await fetch('/api/categories');
		if (res.ok) {
			categories = (await res.json()) as CategoryItem[];
		}
	} catch {
		// Non-critical — keep existing data
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
		fetchIfNeeded
	};
}
