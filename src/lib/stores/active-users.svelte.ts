/**
 * Active Users Store - Module-level reactive state for the sidebar online
 * users wall. Persists across component mounts so navigation between forum
 * pages does not trigger skeleton screens.
 *
 * Stale-while-revalidate, split into two entry points so neither mutates the
 * $state an $effect is tracking (which would loop):
 *   - load()    first load, blocks until data arrives (called from $effect)
 *   - refresh() background re-fetch (called from afterNavigate, not $effect)
 */
import type { OnlineUser } from '$lib/types/api';

interface ActiveUsersStoreData {
	users: OnlineUser[];
	loaded: boolean;
}

type LoadFn = () => Promise<void>;
type RefreshFn = () => Promise<void>;

interface ActiveUsersStore extends ActiveUsersStoreData {
	load: LoadFn;
	refresh: RefreshFn;
}

let users = $state<OnlineUser[]>([]);
let loaded = $state(false);
let loading = $state(false);

async function load(): Promise<void> {
	if (loaded || loading) return;
	// First load - block until data arrives so skeleton shows correctly
	loading = true;
	try {
		const res = await fetch('/api/users/online');
		if (res.ok) {
			users = (await res.json()) as OnlineUser[];
		}
	} catch {
		// Non-critical - wall will show empty state
	}
	loaded = true;
	loading = false;
}

async function refresh(): Promise<void> {
	if (!loaded || loading) return;
	// Already loaded - background refresh, never show skeleton
	loading = true;
	try {
		const res = await fetch('/api/users/online');
		if (res.ok) {
			users = (await res.json()) as OnlineUser[];
		}
	} catch {
		// Non-critical - keep existing data
	}
	loading = false;
}

export function getActiveUsersStore(): ActiveUsersStore {
	return {
		get users() {
			return users;
		},
		get loaded() {
			return loaded;
		},
		load,
		refresh
	};
}
