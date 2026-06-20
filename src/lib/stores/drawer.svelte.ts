/**
 * Drawer Store - module-level reactive flag for the mobile nav drawer's open
 * state. Shared so the persistent AppShell's hamburger can drive a drawer that
 * lives in the per-page DualColumnLayout, and so the drag-to-open/close in
 * DualColumnLayout mutates the same state. Persisting across navigations would
 * leave a stale-open drawer, so AppShell closes it on each afterNavigate.
 */
import type { VoidHandler } from '$lib/types/handlers';

interface DrawerStore {
	readonly isOpen: boolean;
	open: VoidHandler;
	close: VoidHandler;
	toggle: VoidHandler;
}

let isOpen = $state(false);

function open(): void {
	isOpen = true;
}
function close(): void {
	isOpen = false;
}
function toggle(): void {
	isOpen = !isOpen;
}

export function getDrawerStore(): DrawerStore {
	return {
		get isOpen() {
			return isOpen;
		},
		open,
		close,
		toggle
	};
}
