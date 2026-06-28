import { goto } from '$app/navigation';
import { hopForHref, backSwipeShouldPopHistory } from '$lib/utils/history-nav';
import {
	initialNavState,
	initNav,
	switchTabNav,
	handleBeforeNavigateNav,
	handleAfterNavigateNav,
	getTabFromPath as getTabFromPathLogic,
	backTargetFor,
	type NavState,
	type NavDirection
} from './navigation-logic';

// Back Handler Callback contract
export type BackCallback = () => boolean; // returns true if the back event is consumed

class BackHandlerDispatcher {
	#handlers = $state<BackCallback[]>([]);

	register(callback: BackCallback) {
		this.#handlers.push(callback);
		return () => {
			this.#handlers = this.#handlers.filter((h) => h !== callback);
		};
	}

	dispatch(): boolean {
		if (this.#handlers.length > 0) {
			// LIFO order: execute the last registered handler
			const handler = this.#handlers[this.#handlers.length - 1];
			const consumed = handler();
			if (consumed) return true;
		}
		return false;
	}
}

export const backHandler = new BackHandlerDispatcher();

export type { RouteEntry } from './navigation-logic';

interface PendingNavState {
	href: string;
	isBack: boolean;
	isForward: boolean;
	replaceState: boolean;
	isPopstate: boolean;
}

interface DirectionResult {
	isBack: boolean;
	isForward: boolean;
}

interface NavigationParamsResult {
	isBack: boolean;
	isForward: boolean;
	replaceState: boolean;
}

class NavigationStore {
	// Reactive nav state. All tab/stack maths live in navigation-logic.ts (pure,
	// unit-tested); this class only holds the $state and delegates transitions.
	#state = $state<NavState>(initialNavState());
	#lastHistoryIndex = $state<number | null>(null);
	#navInFlight = $state(false);
	#pendingNav = $state<PendingNavState | null>(null);

	get activeTab() {
		return this.#state.activeTab;
	}

	getTabFromPath(path: string): number {
		return getTabFromPathLogic(path, this.#state.activeTab);
	}

	get activeStack() {
		return this.#state.stacks[this.#state.activeTab];
	}

	getStack(tabIdx: number) {
		return this.#state.stacks[tabIdx];
	}

	get backTarget() {
		return backTargetFor(this.#state);
	}

	get direction(): NavDirection {
		return this.#state.direction;
	}

	get navInFlight() {
		return this.#navInFlight;
	}

	set navInFlight(value: boolean) {
		this.#navInFlight = value;
	}

	get pendingNav() {
		return this.#pendingNav;
	}

	// Synthetic stack initialization on startup to support deep linking back navigation
	init(initialPath: string, search: string = '') {
		this.#state = initNav(this.#state, initialPath, search);
		if (typeof window !== 'undefined') {
			this.#lastHistoryIndex = window.history.state?.['sveltekit:index'] ?? null;
		}
		// Dev-only readiness flag. The root layout runs init() in onMount, which
		// is AFTER the client is interactive - so a test that drives a tab click
		// right after hydration can race the deferred init('/') (which would
		// clobber activeTab). E2E waits on this flag so every interaction happens
		// after the one-time seed.
		if (import.meta.env.DEV && typeof window !== 'undefined') {
			(window as Window & { __navReady?: boolean }).__navReady = true;
		}
	}

	switchTab(toPath: string, search: string = '') {
		this.#state = switchTabNav(this.#state, toPath, search);
	}

	handleBeforeNavigate(to: string, from: string, type: string, toSearch: string = '') {
		this.#state = handleBeforeNavigateNav(this.#state, to, from, type, toSearch);
	}

	handleAfterNavigate() {
		this.#state = handleAfterNavigateNav(this.#state);
		this.#navInFlight = false;
		if (typeof window !== 'undefined') {
			this.#lastHistoryIndex = window.history.state?.['sveltekit:index'] ?? null;
		}
	}

	/**
	 * Determines if the current popstate or navigation is backward or forward.
	 * Compares against the tracked lastHistoryIndex for absolute popstate checks,
	 * or falls back to hopForHref for standard/click navigation hops.
	 */
	determineDirection(toUrl: string, type: string): DirectionResult {
		if (typeof window === 'undefined') {
			return { isBack: type === 'popstate', isForward: false };
		}
		if (type === 'popstate') {
			const newIndex = window.history.state?.['sveltekit:index'] ?? null;
			if (this.#lastHistoryIndex !== null && newIndex !== null) {
				return {
					isBack: newIndex < this.#lastHistoryIndex,
					isForward: newIndex > this.#lastHistoryIndex
				};
			}
		}
		const hop = hopForHref(toUrl);
		return {
			isBack: hop === 'back',
			isForward: hop === 'forward'
		};
	}

	/**
	 * Resolves unified navigation parameters: isBack (backward), isForward (forward),
	 * and replaceState (which must be false for forward/advance clicks/swipes).
	 */
	getNavigationParams(toUrl: string, type: string): NavigationParamsResult {
		const { isBack, isForward } = this.determineDirection(toUrl, type);
		// An advance/forward tab switch or link click must PUSH state so that the
		// originating page survives in history. A back/exit navigation replaces state
		// when not using history.back() to keep the virtual stack bounded.
		const replaceState = type === 'popstate' ? false : isBack;
		return { isBack, isForward, replaceState };
	}

	setPendingNav(href: string, type: string) {
		const params = this.getNavigationParams(href, type);
		this.#pendingNav = {
			...params,
			href,
			isPopstate: type === 'popstate'
		};
		return this.#pendingNav;
	}

	clearPendingNav() {
		this.#pendingNav = null;
	}

	executePendingNav() {
		if (!this.#pendingNav) return;
		const nav = this.#pendingNav;
		this.#pendingNav = null;
		this.#navInFlight = true;

		if (nav.isPopstate) {
			if (nav.isBack) {
				history.back();
			} else if (nav.isForward) {
				history.forward();
			} else {
				void goto(nav.href, { replaceState: nav.replaceState }).catch(() => {
					this.#navInFlight = false;
				});
			}
		} else {
			const hop = hopForHref(nav.href);
			if (hop === 'back') {
				history.back();
			} else if (hop === 'forward') {
				history.forward();
			} else {
				void goto(nav.href, { replaceState: nav.replaceState }).catch(() => {
					this.#navInFlight = false;
				});
			}
		}
	}

	/**
	 * Performs a backward step safely. Checks if history needs popping,
	 * otherwise falls back to a spatial hop matching the previous tab or root.
	 */
	navigateBackward(fallbackHref: string) {
		if (backSwipeShouldPopHistory()) {
			history.back();
		} else {
			const hop = hopForHref(fallbackHref);
			if (hop === 'back') {
				history.back();
			} else if (hop === 'forward') {
				history.forward();
			} else {
				void goto(fallbackHref);
			}
		}
	}

	/**
	 * Performs a forward step safely via hop tracking or standard goto.
	 */
	navigateForward(targetHref: string) {
		const hop = hopForHref(targetHref);
		if (hop === 'back') {
			history.back();
		} else if (hop === 'forward') {
			history.forward();
		} else {
			void goto(targetHref);
		}
	}
}

let navStoreInstance: NavigationStore;

export function getNavigationStore(): NavigationStore {
	if (!navStoreInstance) {
		navStoreInstance = new NavigationStore();
	}
	return navStoreInstance;
}
