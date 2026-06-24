/**
 * Pure (runes-free) navigation state logic, extracted from navigation.svelte.ts
 * so it is unit-testable with bun:test without a browser or the Svelte runtime.
 * The NavigationStore class holds a $state<NavState> and delegates every
 * transition to the reducers here — single source of truth for the tab/stack
 * maths that drive the mobile back-swipe target.
 */

export interface RouteEntry {
	pathname: string;
	search: string;
}

export type NavDirection = 'forward' | 'backward' | 'none';

export interface NavState {
	/** Virtual per-tab history stacks: 0 Discussions, 1 Activity, 2 Messages. */
	stacks: Record<number, RouteEntry[]>;
	activeTab: number;
	direction: NavDirection;
}

export const TAB_ROOTS: Record<number, string> = {
	0: '/',
	1: '/activity',
	2: '/messages/inbox'
};

/** Routes that belong to whichever tab the user is currently on (no tab of their own). */
const GLOBAL_PREFIXES = ['/admin', '/profile', '/search', '/bookmarks', '/notifications'];

export function initialNavState(): NavState {
	return {
		stacks: {
			0: [{ pathname: '/', search: '' }],
			1: [{ pathname: '/activity', search: '' }],
			2: [{ pathname: '/messages/inbox', search: '' }]
		},
		activeTab: 0,
		direction: 'none'
	};
}

/**
 * Index of the tab a path belongs to. Global routes (sidebar destinations like
 * /bookmarks) inherit the CURRENT active tab; everything else maps to its own
 * tab (/discussion* and `/` → 0, /activity* → 1, /messages* → 2).
 */
export function getTabFromPath(path: string, activeTab: number): number {
	const isGlobal = GLOBAL_PREFIXES.some(
		(prefix) => path === prefix || path.startsWith(prefix + '/')
	);
	if (isGlobal) return activeTab;
	if (path.startsWith('/activity')) return 1;
	if (path.startsWith('/messages')) return 2;
	return 0;
}

/** Back target = the entry below the active stack's top, or '/' when at a root. */
export function backTargetFor(state: NavState): string {
	const stack = state.stacks[state.activeTab];
	if (stack.length > 1) {
		const target = stack[stack.length - 2];
		return target.pathname + target.search;
	}
	return '/';
}

/** Shallow-per-tab clone so reducers stay pure (callers can mutate freely). */
function clone(state: NavState): NavState {
	return {
		stacks: {
			0: state.stacks[0].slice(),
			1: state.stacks[1].slice(),
			2: state.stacks[2].slice()
		},
		activeTab: state.activeTab,
		direction: state.direction
	};
}

/**
 * Seed a tab's stack on first load / reload / deep-link. When the entry is a
 * tab root it becomes the sole entry; otherwise a synthetic root parent is
 * unshifted so a back-swipe lands on the list.
 */
export function initNav(state: NavState, path: string, search: string): NavState {
	const tabIdx = getTabFromPath(path, state.activeTab);
	const rootPath = TAB_ROOTS[tabIdx];
	const next = clone(state);
	if (path === rootPath) {
		next.stacks[tabIdx] = [{ pathname: path, search }];
	} else {
		next.stacks[tabIdx] = [
			{ pathname: rootPath, search: '' },
			{ pathname: path, search }
		];
	}
	// Seed activeTab from the landed path. Without this a direct load / reload /
	// deep-link onto /activity or /messages/inbox leaves activeTab at its default
	// (0), so a subsequent navigation to a global route (/bookmarks, /profile,
	// ...) inherits the wrong tab and the back-swipe target degrades to '/'.
	next.activeTab = tabIdx;
	return next;
}

/** Tap a primary tab: switch activeTab, seeding an empty stack with the target. */
export function switchTabNav(state: NavState, path: string, search: string): NavState {
	const toTab = getTabFromPath(path, state.activeTab);
	const next = clone(state);
	next.activeTab = toTab;
	if (next.stacks[toTab].length === 0) {
		next.stacks[toTab] = [{ pathname: path, search }];
	}
	return next;
}

/**
 * Apply a SvelteKit navigation event. A cross-tab navigation just switches
 * activeTab (stacks untouched); within the same tab, popstate pops and a push
 * appends (deduping consecutive identical paths).
 */
export function handleBeforeNavigateNav(
	state: NavState,
	to: string,
	from: string,
	type: string,
	toSearch: string
): NavState {
	const toTab = getTabFromPath(to, state.activeTab);
	const fromTab = getTabFromPath(from, state.activeTab);
	const next = clone(state);
	if (toTab !== fromTab) {
		next.activeTab = toTab;
		return next;
	}
	if (type === 'popstate') {
		next.direction = 'backward';
		if (next.stacks[toTab].length > 1) next.stacks[toTab].pop();
	} else {
		next.direction = 'forward';
		const stack = next.stacks[toTab];
		if (stack.length === 0 || stack[stack.length - 1].pathname !== to) {
			stack.push({ pathname: to, search: toSearch });
		}
	}
	return next;
}

export function handleAfterNavigateNav(state: NavState): NavState {
	return { ...state, direction: 'none' };
}
