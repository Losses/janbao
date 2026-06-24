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

class NavigationStore {
	// Reactive nav state. All tab/stack maths live in navigation-logic.ts (pure,
	// unit-tested); this class only holds the $state and delegates transitions.
	#state = $state<NavState>(initialNavState());

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

	// Synthetic stack initialization on startup to support deep linking back navigation
	init(initialPath: string, search: string = '') {
		this.#state = initNav(this.#state, initialPath, search);
		// Dev-only readiness flag. The root layout runs init() in onMount, which
		// is AFTER the client is interactive — so a test that drives a tab click
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
	}
}

let navStoreInstance: NavigationStore;

export function getNavigationStore(): NavigationStore {
	if (!navStoreInstance) {
		navStoreInstance = new NavigationStore();
	}
	return navStoreInstance;
}
