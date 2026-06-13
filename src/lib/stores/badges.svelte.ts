/**
 * Badges Store — Module-level reactive state for the sidebar icon unread
 * counts (notifications + private messages). Persists across component mounts
 * so navigating between forum pages does not flicker the badges.
 *
 * Seeded from the root layout server load on every navigation (no polling).
 * The notification tooltip clears its own count optimistically when opened, so
 * the badge disappears immediately; the next navigation re-syncs from the
 * server, which by then has the notifications marked read.
 */
import type { VoidHandler } from '$lib/types/handlers';

interface BadgeCounts {
	unreadNotifications: number;
	unreadMessages: number;
}

type SeedBadgesFn = (counts: BadgeCounts) => void;

interface BadgesStore extends BadgeCounts {
	seed: SeedBadgesFn;
	clearNotifications: VoidHandler;
}

let unreadNotifications = $state(0);
let unreadMessages = $state(0);

function seed(counts: BadgeCounts): void {
	unreadNotifications = counts.unreadNotifications;
	unreadMessages = counts.unreadMessages;
}

function clearNotifications(): void {
	unreadNotifications = 0;
}

export function getBadgesStore(): BadgesStore {
	return {
		get unreadNotifications() {
			return unreadNotifications;
		},
		get unreadMessages() {
			return unreadMessages;
		},
		seed,
		clearNotifications
	};
}
