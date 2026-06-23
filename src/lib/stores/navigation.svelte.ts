// src/lib/stores/navigation.svelte.ts
import { page } from '$app/state';

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

export interface RouteEntry {
	pathname: string;
	search: string;
}

class NavigationStore {
	// Virtual stacks for each of the 3 tabs: 0 (Discussions), 1 (Activity), 2 (Messages)
	#stacks = $state<Record<number, RouteEntry[]>>({
		0: [{ pathname: '/', search: '' }],
		1: [{ pathname: '/activity', search: '' }],
		2: [{ pathname: '/messages/inbox', search: '' }]
	});
	#activeTab = $derived(this.getTabFromPath(page.url.pathname));
	#direction = $state<'forward' | 'backward' | 'none'>('none');

	getTabFromPath(path: string): number {
		if (path.startsWith('/activity')) return 1;
		if (path.startsWith('/messages')) return 2;
		return 0;
	}

	get activeStack() {
		return this.#stacks[this.#activeTab];
	}

	getStack(tabIdx: number): RouteEntry[] {
		return this.#stacks[tabIdx];
	}

	get backTarget() {
		const currentStack = this.activeStack;
		if (currentStack.length > 1) {
			const target = currentStack[currentStack.length - 2];
			return target.pathname + target.search;
		}
		return '/';
	}

	get direction() {
		return this.#direction;
	}

	// Synthetic stack initialization on startup to support deep linking back navigation
	init(initialPath: string, search: string = '') {
		const tabIdx = this.getTabFromPath(initialPath);
		const tabRoots = {
			0: '/',
			1: '/activity',
			2: '/messages/inbox'
		};
		const rootPath = tabRoots[tabIdx as 0 | 1 | 2];

		if (initialPath === rootPath) {
			this.#stacks[tabIdx] = [{ pathname: initialPath, search }];
		} else {
			// Synthetically construct root parent history so swiping back lands on the list page
			this.#stacks[tabIdx] = [
				{ pathname: rootPath, search: '' },
				{ pathname: initialPath, search }
			];
		}
	}

	switchTab(toPath: string, search: string = '') {
		const toTab = this.getTabFromPath(toPath);
		// If stack is empty or only has root, ensure it is set up
		if (this.#stacks[toTab].length === 0) {
			this.#stacks[toTab] = [{ pathname: toPath, search }];
		}
	}

	handleBeforeNavigate(to: string, from: string, type: string, toSearch: string = '') {
		const toTab = this.getTabFromPath(to);
		const fromTab = this.getTabFromPath(from);

		if (toTab !== fromTab) {
			// Tab switch - does not modify stack structures
			return;
		}

		if (type === 'popstate') {
			this.#direction = 'backward';
			if (this.#stacks[toTab].length > 1) {
				this.#stacks[toTab].pop();
			}
		} else {
			this.#direction = 'forward';
			// Check if we are pushing a duplicate path to avoid stack pollution
			const currentStack = this.#stacks[toTab];
			if (currentStack.length === 0 || currentStack[currentStack.length - 1].pathname !== to) {
				this.#stacks[toTab].push({ pathname: to, search: toSearch });
			}
		}
	}

	handleAfterNavigate() {
		this.#direction = 'none';
	}
}

let navStoreInstance: NavigationStore;

export function getNavigationStore(): NavigationStore {
	if (!navStoreInstance) {
		navStoreInstance = new NavigationStore();
	}
	return navStoreInstance;
}
