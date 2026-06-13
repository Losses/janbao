/**
 * Active Users Store — Module-level reactive state for the sidebar online
 * users wall. Persists across component mounts so navigation between forum
 * pages does not trigger skeleton screens.
 *
 * Stale-while-revalidate: first call fetches and blocks; subsequent calls
 * return cached data immediately and refresh silently in the background.
 */
import type { OnlineUser } from '$lib/types/api';

interface ActiveUsersStoreData {
	users: OnlineUser[];
	loaded: boolean;
}

type FetchIfNeededFn = () => Promise<void>;

interface ActiveUsersStore extends ActiveUsersStoreData {
	fetchIfNeeded: FetchIfNeededFn;
}

let users = $state<OnlineUser[]>([]);
let loaded = $state(false);
let loading = $state(false);

async function fetchIfNeeded(): Promise<void> {
	if (loading) return;

	if (!loaded) {
		// First load — block until data arrives so skeleton shows correctly
		loading = true;
		try {
			const res = await fetch('/api/users/online');
			if (res.ok) {
				users = (await res.json()) as OnlineUser[];
			}
		} catch {
			// Non-critical — wall will show empty state
		}
		loaded = true;
		loading = false;
		return;
	}

	// Already loaded — background refresh, never show skeleton
	loading = true;
	try {
		const res = await fetch('/api/users/online');
		if (res.ok) {
			users = (await res.json()) as OnlineUser[];
		}
	} catch {
		// Non-critical — keep existing data
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
		fetchIfNeeded
	};
}
