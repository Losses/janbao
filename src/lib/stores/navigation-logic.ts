import { MOBILE_TAB_DEFS, GLOBAL_PREFIXES } from '$lib/utils/tab-config';

/**
 * Pure (runes-free) navigation state logic, extracted from navigation.svelte.ts
 * so it is unit-testable with bun:test without a browser or the Svelte runtime.
 * The NavigationStore class holds a $state<NavState> and delegates every
 * transition to the reducers here - single source of truth for the tab/stack
 * maths that drive the mobile back-swipe target.
 *
 * Nothing about the site's routes is hardcoded here: the tab count, root hrefs,
 * and path-to-tab matching all derive from the shared MOBILE_TAB_DEFS config,
 * and the global (non-tab) routes come from GLOBAL_PREFIXES. Adding a tab is a
 * change in tab-config.ts only.
 */

export interface RouteEntry {
	pathname: string;
	search: string;
}

export type NavDirection = 'forward' | 'backward' | 'none';

export interface NavState {
	/** Virtual per-tab history stacks, one entry per tab in MOBILE_TAB_DEFS. */
	stacks: Record<number, RouteEntry[]>;
	activeTab: number;
	direction: NavDirection;
}

/** Tab count + per-index root href, derived from the shared config. */
const TAB_COUNT = MOBILE_TAB_DEFS.length;
const TAB_ROOT_HREFS: readonly string[] = MOBILE_TAB_DEFS.map((tab) => tab.href);

export function initialNavState(): NavState {
	const stacks: Record<number, RouteEntry[]> = {};
	for (let i = 0; i < TAB_COUNT; i++) {
		stacks[i] = [{ pathname: TAB_ROOT_HREFS[i], search: '' }];
	}
	return { stacks, activeTab: 0, direction: 'none' };
}

/**
 * Index of the tab a path belongs to. Global routes (sidebar destinations like
 * /bookmarks) inherit the CURRENT active tab; any tab route matches its tab via
 * the config's isActive matcher; anything unmatched defaults to tab 0.
 */
export function getTabFromPath(path: string, activeTab: number): number {
	const isGlobal = GLOBAL_PREFIXES.some(
		(prefix) => path === prefix || path.startsWith(prefix + '/')
	);
	if (isGlobal) return activeTab;
	const idx = MOBILE_TAB_DEFS.findIndex((tab) => tab.isActive(path));
	return idx >= 0 ? idx : 0;
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

/** Clone every tab's stack so reducers stay pure (callers can mutate freely). */
function clone(state: NavState): NavState {
	const stacks: Record<number, RouteEntry[]> = {};
	for (let i = 0; i < TAB_COUNT; i++) {
		stacks[i] = state.stacks[i].slice();
	}
	return { stacks, activeTab: state.activeTab, direction: state.direction };
}

/**
 * Seed a tab's stack for a fresh landing: a single root entry when landing on
 * the tab root, else `[root, path]` so a back-swipe lands on the list. Shared by
 * initNav (first load / deep-link), switchTabNav (a tab-bar tap), and the
 * cross-tab branch of handleBeforeNavigateNav. Centralising this is what
 * prevents a stale thread entry from a prior visit surviving below the stack
 * top after returning to a tab - which would otherwise break the list→thread
 * enter animation's `shouldEnter` precondition (the stack's previous pathname
 * must equal `resolvedLeftHref`, so a stale thread entry there suppresses the
 * slide-in).
 */
function seedStackForLanding(
	stacks: Record<number, RouteEntry[]>,
	tabIdx: number,
	path: string,
	search: string
): void {
	const rootPath = TAB_ROOT_HREFS[tabIdx];
	stacks[tabIdx] =
		path === rootPath
			? [{ pathname: path, search }]
			: [
					{ pathname: rootPath, search: '' },
					{ pathname: path, search }
				];
}

/**
 * Seed a tab's stack on first load / reload / deep-link. When the entry is a
 * tab root it becomes the sole entry; otherwise a synthetic root parent is
 * unshifted so a back-swipe lands on the list.
 */
export function initNav(state: NavState, path: string, search: string): NavState {
	const tabIdx = getTabFromPath(path, state.activeTab);
	const next = clone(state);
	seedStackForLanding(next.stacks, tabIdx, path, search);
	// Seed activeTab from the landed path. Without this a direct load / reload /
	// deep-link onto /activity or /messages/inbox leaves activeTab at its default
	// (0), so a subsequent navigation to a global route (/bookmarks, /profile,
	// ...) inherits the wrong tab and the back-swipe target degrades to '/'.
	next.activeTab = tabIdx;
	return next;
}

/**
 * Tap a primary tab: switch activeTab and RESET that tab's stack for a fresh
 * landing (seedStackForLanding). Resetting - rather than preserving whatever the
 * tab had before - is what stops a stale thread entry from a prior visit sitting
 * below the stack top and suppressing the next list→thread enter animation.
 */
export function switchTabNav(state: NavState, path: string, search: string): NavState {
	const toTab = getTabFromPath(path, state.activeTab);
	const next = clone(state);
	next.activeTab = toTab;
	seedStackForLanding(next.stacks, toTab, path, search);
	return next;
}

/**
 * Apply a SvelteKit navigation event. A cross-tab navigation switches activeTab
 * and re-seeds the destination tab's stack (a fresh landing, same as a tab tap);
 * within the same tab, popstate pops and a push appends (deduping consecutive
 * identical paths).
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
		seedStackForLanding(next.stacks, toTab, to, toSearch);
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
