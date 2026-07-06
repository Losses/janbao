// src/lib/utils/page-lifecycle-logic.ts
/**
 * Pure (runes-free) half of the Cycle-5a PageLifecycle module. Per
 * `docs/DV20-Plan.md` §8 + the C05a spec: owns the four-phase page
 * lifecycle contract (`mount` / `activate` / `deactivate` / `unmount`)
 * as a total reducer, the refcount-with-microtask-deferral helper that
 * is the template for any html-singleton class (memory:
 * `viewport-lock-refcount-pattern`), and the SSR-safe `unmount`
 * planner that is the single teardown path (memory:
 * `svelte-ondestroy-runs-in-ssr`).
 *
 * The reactive shell `src/lib/stores/page-lifecycle.svelte.ts` is a
 * thin `$state` wrapper that delegates every transition to this
 * module so the totality has unit coverage under `bun:test` with no
 * Svelte runes loader (per the `bun-test-no-runes-loader` memory the
 * runes loader is unavailable there, mirroring the Cycle 2/3/4 split).
 *
 * In Cycle 5a shadow mode no Svelte component drives these
 * transitions and no html-singleton is migrated to the new helper.
 * The unit suite exercises the reducer, the refcount helper, and the
 * unmount planner directly. Cycle 5b wires the lifecycle into the
 * gesture components and migrates the lifecycle-adjacent stores
 * (`viewport-lock`, `scroll-chrome`, `active-gesture-track`,
 * `page-scroll`) to register their html-singleton releases here.
 */

import type { VoidHandler } from '$lib/types/handlers';

// ---------------------------------------------------------------------------
// Page-phase reducer.

/** The four phases of the page lifecycle (per `docs/DV20-Plan.md` §8).
 *
 *  - `'unmounted'`: initial state, or after `unmount` has run.
 *  - `'mounted'`: SSR + hydrate complete; no listeners, no store writes.
 *  - `'active'`: DOM bound; locks acquired, gesture track published,
 *    scroll source registered.
 *  - `'inactive'`: navigation away committed; publishing stopped; locks
 *    held through the swap.
 *
 *  In Cycle 5a shadow mode no Svelte component drives these
 *  transitions; the unit suite exercises the reducer directly. */
export type PagePhase = 'unmounted' | 'mounted' | 'active' | 'inactive';

/** A lifecycle event. The reducer is total: every (state, event) pair
 *  has a defined result; some results are no-ops (see `reduce`). */
export type PageLifecycleEvent = 'mount' | 'activate' | 'deactivate' | 'unmount';

/** Reducer state. The reactive shell holds this as `$state`. */
export interface PageLifecycleState {
	readonly phase: PagePhase;
}

/** Initial state. The SSR render and a first-load landing both start
 *  here; the layout's first transition is `mount`. */
export function initialLifecycleState(): PageLifecycleState {
	return { phase: 'unmounted' };
}

/** The total reducer. Every (state, event) pair has a defined result:
 *
 *  - `mount`: `unmounted` -> `mounted`. No-op on any other phase
 *    (idempotent against re-mounting an already-mounted page).
 *  - `activate`: `mounted` or `inactive` -> `active`. No-op on
 *    `unmounted` (must mount first) or `active` (idempotent).
 *  - `deactivate`: `active` -> `inactive`. No-op on any other phase.
 *  - `unmount`: any phase -> `unmounted`. Idempotent against
 *    `unmounted`. The single teardown transition; the SSR-safe
 *    teardown work is gated by `planUnmount` (below). */
export function reduce(state: PageLifecycleState, event: PageLifecycleEvent): PageLifecycleState {
	switch (event) {
		case 'mount': {
			if (state.phase === 'unmounted') return { phase: 'mounted' };
			return state;
		}
		case 'activate': {
			if (state.phase === 'mounted' || state.phase === 'inactive') {
				return { phase: 'active' };
			}
			return state;
		}
		case 'deactivate': {
			if (state.phase === 'active') return { phase: 'inactive' };
			return state;
		}
		case 'unmount': {
			if (state.phase === 'unmounted') return state;
			return { phase: 'unmounted' };
		}
	}
}

// ---------------------------------------------------------------------------
// Refcount-with-microtask-deferral helper. The template for any
// html-singleton class (memory: `viewport-lock-refcount-pattern`):
// the class is added on the first ref and removed on a microtask after
// the last ref, so a same-tick remove+add does not flicker.

/** Internal refcount state. `pendingRemoval` is true between the
 *  last-ref release and the microtask that re-checks the count. */
export interface RefcountState {
	readonly count: number;
	readonly pendingRemoval: boolean;
}

/** Initial refcount state: zero holders, no pending removal. */
export function initialRefcountState(): RefcountState {
	return { count: 0, pendingRemoval: false };
}

/** What an acquire / release / settle tells the caller to do. */
export type RefcountEffect = 'add' | 'remove' | 'none';

/** Result of an acquire or release. */
export interface RefcountTransition {
	readonly state: RefcountState;
	/** What the caller should do immediately (synchronously). */
	readonly immediate: RefcountEffect;
	/** Whether the caller should queue a microtask to settle the
	 *  removal. The microtask re-checks the count; a same-tick acquire
	 *  cancels the pending removal. */
	readonly scheduleMicrotask: boolean;
}

/** Acquire a reference. On the first ref (0 -> 1) the caller must add
 *  the class. If a removal was pending (count = 0 but the class is
 *  still on the element because the removal microtask has not fired),
 *  the acquire cancels the removal and does NOT re-add (the class is
 *  already there). Higher refs just bump the count. */
export function acquireRef(state: RefcountState): RefcountTransition {
	if (state.pendingRemoval) {
		return {
			state: { count: state.count + 1, pendingRemoval: false },
			immediate: 'none',
			scheduleMicrotask: false
		};
	}
	if (state.count === 0) {
		return {
			state: { count: 1, pendingRemoval: false },
			immediate: 'add',
			scheduleMicrotask: false
		};
	}
	return {
		state: { count: state.count + 1, pendingRemoval: false },
		immediate: 'none',
		scheduleMicrotask: false
	};
}

/** Release a reference. On the last ref (1 -> 0) the caller must queue
 *  a microtask to settle the removal; the microtask re-checks the count
 *  and only removes if still 0. Idempotent against count = 0 (no-op). */
export function releaseRef(state: RefcountState): RefcountTransition {
	if (state.count === 0) {
		return { state, immediate: 'none', scheduleMicrotask: false };
	}
	const nextCount = state.count - 1;
	if (nextCount === 0) {
		return {
			state: { count: 0, pendingRemoval: true },
			immediate: 'none',
			scheduleMicrotask: true
		};
	}
	return {
		state: { count: nextCount, pendingRemoval: state.pendingRemoval },
		immediate: 'none',
		scheduleMicrotask: false
	};
}

/** Result of the microtask re-check. */
export interface RefcountSettleResult {
	readonly state: RefcountState;
	readonly effect: RefcountEffect;
}

/** The microtask re-check. If `pendingRemoval` is true and count is
 *  still 0, the caller removes the class. If an acquire landed in the
 *  same tick (count > 0), the removal is cancelled. Pure: returns the
 *  next state and the effect; the caller applies the effect through
 *  its `HtmlClassApplier`. */
export function settleRefcountRemoval(state: RefcountState): RefcountSettleResult {
	if (!state.pendingRemoval) {
		return { state, effect: 'none' };
	}
	if (state.count === 0) {
		return { state: { count: 0, pendingRemoval: false }, effect: 'remove' };
	}
	return { state: { count: state.count, pendingRemoval: false }, effect: 'none' };
}

// ---------------------------------------------------------------------------
// Live refcount-with-microtask-deferral controller. Wraps the pure
// logic with an injectable DOM applier and an injectable scheduler.
// Pure with respect to Svelte (no `$state`); unit-tested under
// `bun:test` with stub appliers and stub schedulers, plus an async
// test that exercises the real `queueMicrotask`.

/** The DOM touch the controller makes. Production writes to
 *  `document.documentElement.classList`; tests use a capturing stub. */
export interface HtmlClassApplier {
	addClass(cls: string): void;
	removeClass(cls: string): void;
}

/** The microtask scheduler. The default uses `queueMicrotask`; tests
 *  inject a capturing stub to fire microtasks deterministically. */
export interface MicrotaskScheduler {
	queueMicrotask(fn: VoidHandler): void;
}

/** Default scheduler. Uses the global `queueMicrotask` (defined in all
 *  evergreen browsers and in the runtimes this project ships: Bun,
 *  Node 14+, Cloudflare Workers, workerd). The Promise fallback covers
 *  a hypothetical runtime without `queueMicrotask`. The bun:test
 *  suite exercises this default directly; in the integrated pipeline
 *  (Cycle 5b) `acquire` is called from Svelte effect callbacks, which
 *  do not run during SSR, so production scheduler activity is
 *  browser-only. */
export const defaultMicrotaskScheduler: MicrotaskScheduler = {
	queueMicrotask(fn: VoidHandler): void {
		if (typeof queueMicrotask === 'function') {
			queueMicrotask(fn);
			return;
		}
		Promise.resolve().then(fn);
	}
};

/** Default applier. Writes to `document.documentElement.classList`.
 *  SSR-safe: no-ops when `document` is undefined so an acquire or
 *  release invoked outside the browser does not throw. In Cycle 5b
 *  the registered teardowns run only when `planUnmount` reports
 *  `runTeardowns: true`, so this `typeof document` gate is
 *  defense-in-depth: even if a release is invoked outside the unmount
 *  path, the applier stays safe. */
export const defaultHtmlClassApplier: HtmlClassApplier = {
	addClass(cls: string): void {
		if (typeof document === 'undefined') return;
		document.documentElement.classList.add(cls);
	},
	removeClass(cls: string): void {
		if (typeof document === 'undefined') return;
		document.documentElement.classList.remove(cls);
	}
};

/** A refcount-with-microtask-deferral helper for a single
 *  html-singleton class. The class is added on the first ref and
 *  removed on a microtask after the last ref, so a same-tick
 *  remove+add does not flicker.
 *
 *  In Cycle 5a shadow mode this controller is exercised only by the
 *  unit suite; the existing `viewport-lock.svelte.ts` keeps its inline
 *  refcount and is NOT modified. Cycle 5b migrates the
 *  lifecycle-adjacent stores to construct one of these per
 *  html-singleton class. */
export class HtmlSingletonClassController {
	#state: RefcountState = initialRefcountState();
	readonly #className: string;
	readonly #applier: HtmlClassApplier;
	readonly #scheduler: MicrotaskScheduler;

	constructor(
		className: string,
		applier: HtmlClassApplier = defaultHtmlClassApplier,
		scheduler: MicrotaskScheduler = defaultMicrotaskScheduler
	) {
		this.#className = className;
		this.#applier = applier;
		this.#scheduler = scheduler;
	}

	/** Acquire a reference. Adds the class on the first ref and cancels
	 *  any pending microtask removal. */
	acquire(): void {
		const result = acquireRef(this.#state);
		this.#state = result.state;
		if (result.immediate === 'add') {
			this.#applier.addClass(this.#className);
		}
	}

	/** Release a reference. On the last ref queues a microtask that
	 *  re-checks the count and removes the class if still 0; a
	 *  same-tick acquire cancels the removal. */
	release(): void {
		const result = releaseRef(this.#state);
		this.#state = result.state;
		if (result.scheduleMicrotask) {
			this.#scheduler.queueMicrotask(() => {
				const settled = settleRefcountRemoval(this.#state);
				this.#state = settled.state;
				if (settled.effect === 'remove') {
					this.#applier.removeClass(this.#className);
				}
			});
		}
	}

	/** Test-only: the current ref count. In Cycle 5a the controller is
	 *  constructed only by the unit suite, which asserts `count` to
	 *  verify acquire/release pairs; the integrated pipeline (Cycle 5b)
	 *  will not read this field. */
	get count(): number {
		return this.#state.count;
	}

	/** Test-only: whether a microtask removal is pending. */
	get pendingRemoval(): boolean {
		return this.#state.pendingRemoval;
	}
}

// ---------------------------------------------------------------------------
// SSR-safe unmount planner.

/** Plan for an unmount. The phase transition always runs; the
 *  registered html-singleton teardowns run only in the browser. */
export interface UnmountPlan {
	/** Whether to run the registered teardowns. False when the unmount
	 *  runs during SSR (the registered teardowns touch `document`,
	 *  which is undefined in SSR). */
	readonly runTeardowns: boolean;
	/** The next lifecycle state. Always `{ phase: 'unmounted' }`;
	 *  included as a field so the reactive shell can assign the result
	 *  directly to its `$state` without a second `reduce` call. */
	readonly nextState: PageLifecycleState;
}

/** Plan an unmount. Pure: the reactive shell's `unmount` method calls
 *  this with the `browser` flag from `$app/environment` and applies
 *  the result. This is the SSR-safe single teardown path. `onDestroy`
 *  is NOT used for html-singleton removal (memory:
 *  `svelte-ondestroy-runs-in-ssr`); instead the teardown work is gated
 *  on `isBrowser`, so it stays correct even if the caller runs during
 *  SSR. In Cycle 5a the only callers are the controller's `unmount`
 *  method and the unit suite; in Cycle 5b the controller's `unmount`
 *  is wired into a Svelte lifecycle hook, and the `isBrowser` gate
 *  makes that SSR-safe. */
export function planUnmount(state: PageLifecycleState, isBrowser: boolean): UnmountPlan {
	return {
		runTeardowns: isBrowser,
		nextState: reduce(state, 'unmount')
	};
}
