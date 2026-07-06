// src/lib/stores/page-lifecycle.svelte.ts
/**
 * Reactive shell around the pure reducer in
 * `src/lib/utils/page-lifecycle-logic.ts`. Per `docs/DV20-Plan.md` §8
 * + the C05a spec: owns the four-phase page lifecycle contract
 * (`mount` / `activate` / `deactivate` / `unmount`) for a single
 * layout that mounts a gesture surface, registers html-singleton
 * teardowns (so `unmount` is the single SSR-safe teardown path), and
 * exposes the current phase reactively. In the integrated pipeline
 * consumers read that phase in a `$derived`; in Cycle 5a shadow mode
 * the controller is not constructed (no layout wires it), so no
 * consumer reads it.
 *
 * The shell is a thin `$state` wrapper: every transition delegates to
 * the pure reducer so the totality (every transition defined; out-of-
 * sequence calls are no-ops) has unit coverage under `bun:test` even
 * though this file uses `$state` (per the `bun-test-no-runes-loader`
 * memory the runes loader is unavailable there, mirroring the
 * Cycle 2/3/4 split).
 *
 * In Cycle 5a shadow mode no Svelte component constructs this
 * controller and no lifecycle-adjacent store registers a teardown;
 * the unit suite covers the pure half directly. Cycle 5b wires this
 * controller into the gesture components and migrates the
 * lifecycle-adjacent stores (`viewport-lock`, `scroll-chrome`,
 * `active-gesture-track`, `page-scroll`) to register their
 * html-singleton releases via `registerTeardown`.
 */

import { browser } from '$app/environment';
import {
	initialLifecycleState,
	planUnmount,
	reduce,
	type PageLifecycleState,
	type PagePhase
} from '$lib/utils/page-lifecycle-logic';
import type { VoidHandler } from '$lib/types/handlers';

/** Per-instance controller for the four-phase page lifecycle.
 *
 *  Holds the lifecycle state as `$state` so a `$derived` reader
 *  registers as a dependent and re-runs when the phase changes. Holds
 *  the registered html-singleton teardowns and runs them inside
 *  `unmount` only when the `browser` flag is true, so `unmount` is
 *  safe to wire to Svelte's `onDestroy` in 5b without re-introducing
 *  the SSR trap (memory: `svelte-ondestroy-runs-in-ssr`).
 *
 *  In Cycle 5a shadow mode no Svelte component constructs this; the
 *  unit suite covers the pure `reduce` and `planUnmount` directly. */
export class PageLifecycleController {
	#state = $state<PageLifecycleState>(initialLifecycleState());
	/** Teardowns registered by the lifecycle-adjacent stores. Each is
	 *  typically a release callback for an html-singleton refcount
	 *  (e.g. `() => htmlSingleton.release()`). In Cycle 5a shadow mode
	 *  this list stays empty (no store registers); the unit suite
	 *  exercises `planUnmount` directly. */
	#teardowns: VoidHandler[] = [];
	/** The `browser` flag from `$app/environment`, captured at
	 *  construction. Injectable so a future integration test can drive
	 *  the SSR branch; the unit suite covers the pure `planUnmount`
	 *  instead. In Cycle 5a shadow mode no caller constructs the
	 *  controller, so this field is exercised by nothing; the integrated
	 *  pipeline (Cycle 5b) will exercise it. */
	readonly #isBrowser: boolean;

	constructor(isBrowser: boolean = browser) {
		this.#isBrowser = isBrowser;
	}

	/** Reactive read of the current phase. In the integrated pipeline
	 *  consumers read this in a `$derived` to register as dependents.
	 *  In Cycle 5a shadow mode no consumer reads it. */
	get phase(): PagePhase {
		return this.#state.phase;
	}

	/** Mount: SSR + hydrate done; no listeners, no store writes. The
	 *  first transition a layout runs. Idempotent if the layout
	 *  somehow double-fires mount (the reducer no-ops the second). */
	mount(): void {
		this.#state = reduce(this.#state, 'mount');
	}

	/** Activate: DOM bound; acquire locks, publish the gesture track,
	 *  register the scroll source. Re-entrant from `inactive` (a
	 *  deactivate that did not unmount can re-activate). */
	activate(): void {
		this.#state = reduce(this.#state, 'activate');
	}

	/** Deactivate: navigation away committed; stop publishing; hold
	 *  locks through the swap. The layout stays mounted; re-activate
	 *  or unmount follows. */
	deactivate(): void {
		this.#state = reduce(this.#state, 'deactivate');
	}

	/** Unmount: the SINGLE SSR-safe teardown path. Runs the registered
	 *  teardowns in the browser (skips them in SSR), clears the
	 *  teardown list, and transitions to `'unmounted'`. Idempotent:
	 *  calling on an already-unmounted controller is a no-op (the
	 *  reducer returns the unchanged state and the cleared teardown
	 *  list means there is nothing to run anyway). */
	unmount(): void {
		const plan = planUnmount(this.#state, this.#isBrowser);
		if (plan.runTeardowns) {
			for (const fn of this.#teardowns) {
				fn();
			}
		}
		this.#teardowns = [];
		this.#state = plan.nextState;
	}

	/** Register a teardown callback that runs when `unmount` fires in
	 *  the browser. The teardown is gated on the `browser` flag, so a
	 *  teardown registered here is SSR-safe without a per-call
	 *  `if (!browser)` guard (memory: `svelte-ondestroy-runs-in-ssr`).
	 *  In Cycle 5b the lifecycle-adjacent stores (`viewport-lock`,
	 *  `scroll-chrome`, `active-gesture-track`, `page-scroll`) will
	 *  each register their html-singleton release here; in Cycle 5a
	 *  shadow mode no caller registers. */
	registerTeardown(fn: VoidHandler): void {
		this.#teardowns.push(fn);
	}
}
