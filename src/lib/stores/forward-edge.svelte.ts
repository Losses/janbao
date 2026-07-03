/**
 * Forward-Edge Store - module-singleton bridge for the MobileTabPager forward
 * edge's deep-neighbour behaviour (Messages -> /search). Holds the right-edge
 * reveal width, the commit re-entry guard, and the `goto` commit, so the shared
 * MobileTabPager.svelte carries only a general dispatch hook (resolveForwardTarget
 * + target.kind + store reads) and no feature-named body or route literal.
 *
 * Mirrors the reachability pattern of active-gesture-track.svelte.ts and
 * mobile-pager.svelte.ts: closure-scoped `$state`, a module-level fallback and
 * a `window.__` mirror, an `initForwardEdgeStore()` called once from the root
 * layout, writers called by MobileTabPager, and getters that ForwardEdgeOverlay
 * and MobileTabPager read inside `$derived` / `$effect` so they track reactively.
 *
 * Named for the forward-edge concept (a peer of the back-edge chip overlay), not
 * for any consumer. SSR-safe (getters return null / false on the server; the
 * writers run only inside the mobile `MobileTabPager`, which is `{#if isMobile}`
 * gated and never renders server-side).
 */
import { goto } from '$app/navigation';

type SetRevealHandler = (px: number) => void;
type ClearHandler = () => void;
type CommitHandler = (href: string) => void;

interface ForwardEdgeStore {
	readonly reveal: number | null;
	readonly inFlight: boolean;
	setReveal: SetRevealHandler;
	clearReveal: ClearHandler;
	reset: ClearHandler;
	commit: CommitHandler;
}

declare global {
	interface Window {
		__forwardEdge?: ForwardEdgeStore;
	}
}

let reveal = $state<number | null>(null);
let inFlight = $state(false);
let globalForwardEdgeFallback: ForwardEdgeStore | undefined;

if (typeof window !== 'undefined') {
	if (window.__forwardEdge) globalForwardEdgeFallback = window.__forwardEdge;
}

/** Clear the in-flight guard when the commit navigation settles (resolved or rejected). */
function settleInFlight(): void {
	inFlight = false;
}

/**
 * Build the store's writer/getter surface against the closure `$state`. The
 * same closure is shared across the fallback, the `window.__` mirror, and future
 * init calls so a `$derived(getForwardEdgeStore().reveal)` read in a component
 * tracks writes by MobileTabPager.
 */
function createStore(): ForwardEdgeStore {
	return {
		get reveal() {
			return reveal;
		},
		get inFlight() {
			return inFlight;
		},
		setReveal: (px: number) => {
			reveal = px;
		},
		clearReveal: () => {
			reveal = null;
		},
		reset: () => {
			reveal = null;
			inFlight = false;
		},
		commit: (href: string) => {
			// `goto` does not flip navStore.navInFlight (only executePendingNav
			// does), so this local guard is what makes a second commit during the
			// in-flight navigation a no-op. It clears when goto settles, so it is
			// true only during the in-flight window, never permanently.
			if (inFlight) return;
			inFlight = true;
			reveal = null;
			void goto(href).then(settleInFlight, settleInFlight);
		}
	};
}

/** Seed the module singleton. Called once from the root layout alongside the other inits. */
export function initForwardEdgeStore(): ForwardEdgeStore {
	const store = createStore();
	globalForwardEdgeFallback = store;
	if (typeof window !== 'undefined') {
		window.__forwardEdge = store;
	}
	return store;
}

/** Reach the forward-edge store from anywhere. Throws if `initForwardEdgeStore` has not run. */
export function getForwardEdgeStore(): ForwardEdgeStore {
	if (globalForwardEdgeFallback) {
		return globalForwardEdgeFallback;
	}
	throw new Error(
		'ForwardEdge store not initialized. Call initForwardEdgeStore in +layout.svelte.'
	);
}
