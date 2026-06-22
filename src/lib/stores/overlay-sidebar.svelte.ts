import type { Snippet } from 'svelte';
import type { VoidHandler } from '$lib/types/handlers';

/**
 * Overlay-Sidebar Store - lets a thread page rendered as a mobile overlay (a
 * discussion or conversation, mounted over the persistent MobileTabPager)
 * publish its page-specific sidebar so the `(tabs)` layout's SINGLE
 * DualColumnLayout can render it in the drawer.
 *
 * Why a store, not Svelte context: the `(tabs)` layout (parent) owns the only
 * DualColumnLayout/drawer, but the sidebar content is page-specific
 * (CategoryListWidget on a discussion, participants on a conversation). Context
 * only flows parent→child, so the child page cannot push a snippet up to the
 * parent via setContext. A module-level reactive slot is the correct channel.
 *
 * The thread page sets its sidebar snippet on mount (mobile only) and clears it
 * on destroy; the `(tabs)` layout reads `current` while an overlay route is
 * active and falls back to the default per-tab sidebar otherwise.
 */
type SetSidebarFn = (sidebar: Snippet) => void;

interface OverlaySidebarStore {
	set: SetSidebarFn;
	clear: VoidHandler;
	/** The page-specific sidebar for the active overlay route, or null. */
	readonly current: Snippet | null;
}

let sidebar: Snippet | null = $state(null);

function set(next: Snippet): void {
	sidebar = next;
}
function clear(): void {
	sidebar = null;
}

export function getOverlaySidebarStore(): OverlaySidebarStore {
	return {
		set,
		clear,
		get current() {
			return sidebar;
		}
	};
}
