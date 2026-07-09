// src/lib/utils/page-lifecycle-logic.test.ts
/**
 * Unit suite for the pure half of the PageLifecycle module.
 *
 * Coverage:
 *  - Lifecycle reducer totality (every transition defined; idempotency;
 *    out-of-sequence no-ops; full cycle; re-activation cycle).
 *  - Refcount microtask deferral (pure acquire/release/settle; live
 *    controller with stub applier + stub scheduler; real queueMicrotask
 *    via `await Promise.resolve()`; same-tick remove+add does not
 *    flicker; release-below-1 schedules; release-above-1 does not).
 *  - SSR unmount guard (`planUnmount` returns `runTeardowns: false`
 *    when isBrowser is false but the phase still transitions).
 *
 * The lifecycle's pure half is unit-testable under `bun:test` with no
 * real DOM. The reactive shell (`page-lifecycle.svelte.ts`) uses
 * `$state` and is not loaded here (memory: `bun-test-no-runes-loader`);
 * the shell's logic is covered by the pure helpers it delegates to.
 */

import { describe, test, expect } from 'bun:test';
import {
	HtmlSingletonClassController,
	acquireRef,
	defaultHtmlClassApplier,
	defaultMicrotaskScheduler,
	initialLifecycleState,
	initialRefcountState,
	planUnmount,
	reduce,
	releaseRef,
	settleRefcountRemoval,
	type PageLifecycleState
} from './page-lifecycle-logic';
import type { VoidHandler } from '$lib/types/handlers';

// ---------------------------------------------------------------------------
// Stub applier + scheduler for the live controller tests. Mirrors the
// shape of `HtmlClassApplier` / `MicrotaskScheduler` so the controller
// can be constructed with deterministic doubles.

class StubApplier {
	readonly addCalls: string[] = [];
	readonly removeCalls: string[] = [];
	addClass(cls: string): void {
		this.addCalls.push(cls);
	}
	removeClass(cls: string): void {
		this.removeCalls.push(cls);
	}
}

class StubScheduler {
	readonly queued: VoidHandler[] = [];
	queueMicrotask(fn: VoidHandler): void {
		this.queued.push(fn);
	}
	runNext(): void {
		const fn = this.queued.shift();
		if (fn) fn();
	}
	runAll(): void {
		while (this.queued.length > 0) this.runNext();
	}
}

// ---------------------------------------------------------------------------
// Lifecycle reducer.

describe('PageLifecycle reducer: totality', () => {
	test('initial state is unmounted', () => {
		expect(initialLifecycleState().phase).toBe('unmounted');
	});

	test('mount: unmounted -> mounted', () => {
		const next = reduce({ phase: 'unmounted' }, 'mount');
		expect(next.phase).toBe('mounted');
	});

	test('activate: mounted -> active', () => {
		const next = reduce({ phase: 'mounted' }, 'activate');
		expect(next.phase).toBe('active');
	});

	test('activate: inactive -> active (re-activation)', () => {
		const next = reduce({ phase: 'inactive' }, 'activate');
		expect(next.phase).toBe('active');
	});

	test('deactivate: active -> inactive', () => {
		const next = reduce({ phase: 'active' }, 'deactivate');
		expect(next.phase).toBe('inactive');
	});

	test('unmount: mounted -> unmounted', () => {
		const next = reduce({ phase: 'mounted' }, 'unmount');
		expect(next.phase).toBe('unmounted');
	});

	test('unmount: active -> unmounted', () => {
		const next = reduce({ phase: 'active' }, 'unmount');
		expect(next.phase).toBe('unmounted');
	});

	test('unmount: inactive -> unmounted', () => {
		const next = reduce({ phase: 'inactive' }, 'unmount');
		expect(next.phase).toBe('unmounted');
	});
});

describe('PageLifecycle reducer: idempotency', () => {
	test('mount is a no-op on mounted state', () => {
		const next = reduce({ phase: 'mounted' }, 'mount');
		expect(next.phase).toBe('mounted');
	});

	test('mount is a no-op on active state', () => {
		const next = reduce({ phase: 'active' }, 'mount');
		expect(next.phase).toBe('active');
	});

	test('mount is a no-op on inactive state', () => {
		const next = reduce({ phase: 'inactive' }, 'mount');
		expect(next.phase).toBe('inactive');
	});

	test('activate is a no-op on active state', () => {
		const next = reduce({ phase: 'active' }, 'activate');
		expect(next.phase).toBe('active');
	});

	test('deactivate is a no-op on inactive state', () => {
		const next = reduce({ phase: 'inactive' }, 'deactivate');
		expect(next.phase).toBe('inactive');
	});

	test('unmount is idempotent on unmounted state', () => {
		const next = reduce({ phase: 'unmounted' }, 'unmount');
		expect(next.phase).toBe('unmounted');
	});
});

describe('PageLifecycle reducer: out-of-sequence no-ops', () => {
	test('activate on unmounted is a no-op (must mount first)', () => {
		const next = reduce({ phase: 'unmounted' }, 'activate');
		expect(next.phase).toBe('unmounted');
	});

	test('deactivate on unmounted is a no-op', () => {
		const next = reduce({ phase: 'unmounted' }, 'deactivate');
		expect(next.phase).toBe('unmounted');
	});

	test('deactivate on mounted is a no-op (must activate first)', () => {
		const next = reduce({ phase: 'mounted' }, 'deactivate');
		expect(next.phase).toBe('mounted');
	});
});

describe('PageLifecycle reducer: full cycles', () => {
	test('full cycle: unmounted -> mounted -> active -> inactive -> unmounted', () => {
		let state: PageLifecycleState = initialLifecycleState();
		state = reduce(state, 'mount');
		expect(state.phase).toBe('mounted');
		state = reduce(state, 'activate');
		expect(state.phase).toBe('active');
		state = reduce(state, 'deactivate');
		expect(state.phase).toBe('inactive');
		state = reduce(state, 'unmount');
		expect(state.phase).toBe('unmounted');
	});

	test('re-activation cycle: inactive -> active -> inactive -> active', () => {
		let state: PageLifecycleState = { phase: 'inactive' };
		state = reduce(state, 'activate');
		expect(state.phase).toBe('active');
		state = reduce(state, 'deactivate');
		expect(state.phase).toBe('inactive');
		state = reduce(state, 'activate');
		expect(state.phase).toBe('active');
	});

	test('mount -> activate -> unmount skips deactivate but still lands on unmounted', () => {
		let state: PageLifecycleState = initialLifecycleState();
		state = reduce(state, 'mount');
		state = reduce(state, 'activate');
		state = reduce(state, 'unmount');
		expect(state.phase).toBe('unmounted');
	});
});

// ---------------------------------------------------------------------------
// Refcount microtask deferral (pure helpers).

describe('Refcount deferral: pure helpers', () => {
	test('acquireRef: 0 -> 1 returns immediate add', () => {
		const result = acquireRef(initialRefcountState());
		expect(result.state.count).toBe(1);
		expect(result.state.pendingRemoval).toBe(false);
		expect(result.immediate).toBe('add');
		expect(result.scheduleMicrotask).toBe(false);
	});

	test('acquireRef: 1 -> 2 returns no immediate effect', () => {
		const result = acquireRef({ count: 1, pendingRemoval: false });
		expect(result.state.count).toBe(2);
		expect(result.state.pendingRemoval).toBe(false);
		expect(result.immediate).toBe('none');
		expect(result.scheduleMicrotask).toBe(false);
	});

	test('acquireRef: with pending removal cancels the removal and does NOT re-add', () => {
		// count = 0 but class still on the element (removal microtask has
		// not fired). The acquire must cancel the pending removal but not
		// re-add the class.
		const result = acquireRef({ count: 0, pendingRemoval: true });
		expect(result.state.count).toBe(1);
		expect(result.state.pendingRemoval).toBe(false);
		expect(result.immediate).toBe('none');
		expect(result.scheduleMicrotask).toBe(false);
	});

	test('releaseRef: 1 -> 0 schedules a microtask and does NOT remove immediately', () => {
		const result = releaseRef({ count: 1, pendingRemoval: false });
		expect(result.state.count).toBe(0);
		expect(result.state.pendingRemoval).toBe(true);
		expect(result.immediate).toBe('none');
		expect(result.scheduleMicrotask).toBe(true);
	});

	test('releaseRef: 2 -> 1 is a no-op transition (no microtask scheduled)', () => {
		const result = releaseRef({ count: 2, pendingRemoval: false });
		expect(result.state.count).toBe(1);
		expect(result.state.pendingRemoval).toBe(false);
		expect(result.immediate).toBe('none');
		expect(result.scheduleMicrotask).toBe(false);
	});

	test('releaseRef: count = 0 is idempotent', () => {
		const result = releaseRef({ count: 0, pendingRemoval: false });
		expect(result.state.count).toBe(0);
		expect(result.state.pendingRemoval).toBe(false);
		expect(result.immediate).toBe('none');
		expect(result.scheduleMicrotask).toBe(false);
	});

	test('settleRefcountRemoval: count = 0 and pending removes the class', () => {
		const result = settleRefcountRemoval({ count: 0, pendingRemoval: true });
		expect(result.effect).toBe('remove');
		expect(result.state.count).toBe(0);
		expect(result.state.pendingRemoval).toBe(false);
	});

	test('settleRefcountRemoval: count > 0 and pending cancels the removal', () => {
		const result = settleRefcountRemoval({ count: 1, pendingRemoval: true });
		expect(result.effect).toBe('none');
		expect(result.state.count).toBe(1);
		expect(result.state.pendingRemoval).toBe(false);
	});

	test('settleRefcountRemoval: no pending removal is a no-op', () => {
		const result = settleRefcountRemoval({ count: 0, pendingRemoval: false });
		expect(result.effect).toBe('none');
		expect(result.state.count).toBe(0);
		expect(result.state.pendingRemoval).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Refcount microtask deferral (live controller with stubs).

describe('HtmlSingletonClassController: deferral with stub scheduler', () => {
	test('first acquire adds the class', () => {
		const applier = new StubApplier();
		const scheduler = new StubScheduler();
		const controller = new HtmlSingletonClassController('foo', applier, scheduler);
		controller.acquire();
		expect(applier.addCalls).toEqual(['foo']);
		expect(applier.removeCalls).toEqual([]);
		expect(controller.count).toBe(1);
		expect(controller.pendingRemoval).toBe(false);
	});

	test('second acquire does NOT re-add', () => {
		const applier = new StubApplier();
		const scheduler = new StubScheduler();
		const controller = new HtmlSingletonClassController('foo', applier, scheduler);
		controller.acquire();
		controller.acquire();
		expect(applier.addCalls).toEqual(['foo']);
		expect(controller.count).toBe(2);
	});

	test('release below 1 schedules a microtask but does not remove', () => {
		const applier = new StubApplier();
		const scheduler = new StubScheduler();
		const controller = new HtmlSingletonClassController('foo', applier, scheduler);
		controller.acquire();
		controller.release();
		expect(scheduler.queued.length).toBe(1);
		expect(applier.removeCalls).toEqual([]);
		expect(controller.count).toBe(0);
		expect(controller.pendingRemoval).toBe(true);
	});

	test('microtask fires the removal at count = 0', () => {
		const applier = new StubApplier();
		const scheduler = new StubScheduler();
		const controller = new HtmlSingletonClassController('foo', applier, scheduler);
		controller.acquire();
		controller.release();
		scheduler.runNext();
		expect(applier.removeCalls).toEqual(['foo']);
		expect(controller.pendingRemoval).toBe(false);
	});

	test('same-tick acquire + release + acquire does NOT flicker', () => {
		const applier = new StubApplier();
		const scheduler = new StubScheduler();
		const controller = new HtmlSingletonClassController('foo', applier, scheduler);
		controller.acquire();
		expect(applier.addCalls).toEqual(['foo']);
		controller.release();
		expect(applier.removeCalls).toEqual([]); // Removal deferred.
		controller.acquire(); // Same-tick re-acquire.
		expect(applier.addCalls).toEqual(['foo']); // No re-add.
		scheduler.runAll();
		expect(applier.removeCalls).toEqual([]); // Cancelled.
		expect(controller.count).toBe(1);
		expect(controller.pendingRemoval).toBe(false);
	});

	test('release with count > 1 does not schedule', () => {
		const applier = new StubApplier();
		const scheduler = new StubScheduler();
		const controller = new HtmlSingletonClassController('foo', applier, scheduler);
		controller.acquire();
		controller.acquire();
		controller.release();
		expect(scheduler.queued.length).toBe(0);
		expect(applier.removeCalls).toEqual([]);
		expect(controller.count).toBe(1);
	});

	test('release with count = 0 is a no-op', () => {
		const applier = new StubApplier();
		const scheduler = new StubScheduler();
		const controller = new HtmlSingletonClassController('foo', applier, scheduler);
		controller.release();
		expect(scheduler.queued.length).toBe(0);
		expect(applier.removeCalls).toEqual([]);
		expect(controller.count).toBe(0);
	});

	test('acquire after a pending release cancels the removal (no re-add)', () => {
		const applier = new StubApplier();
		const scheduler = new StubScheduler();
		const controller = new HtmlSingletonClassController('foo', applier, scheduler);
		controller.acquire();
		controller.release(); // Schedules microtask.
		controller.acquire(); // Cancels via the pending-removal branch.
		expect(applier.addCalls).toEqual(['foo']); // Still one add.
		scheduler.runAll();
		expect(applier.removeCalls).toEqual([]);
		expect(controller.count).toBe(1);
	});
});

describe('HtmlSingletonClassController: real queueMicrotask', () => {
	test('default scheduler removes the class after a microtask flush', async () => {
		const applier = new StubApplier();
		// Default scheduler: real queueMicrotask.
		const controller = new HtmlSingletonClassController('foo', applier);
		controller.acquire();
		controller.release();
		// Synchronous read: removal has not fired yet.
		expect(applier.removeCalls).toEqual([]);
		expect(controller.pendingRemoval).toBe(true);
		// Flush the microtask queue.
		await Promise.resolve();
		expect(applier.removeCalls).toEqual(['foo']);
		expect(controller.pendingRemoval).toBe(false);
	});

	test('default scheduler: same-tick re-acquire does not flicker', async () => {
		const applier = new StubApplier();
		const controller = new HtmlSingletonClassController('foo', applier);
		controller.acquire();
		controller.release();
		controller.acquire();
		await Promise.resolve();
		expect(applier.addCalls).toEqual(['foo']);
		expect(applier.removeCalls).toEqual([]);
		expect(controller.count).toBe(1);
	});
});

describe('HtmlSingletonClassController: default applier / scheduler sanity', () => {
	test('default applier is callable without a document (SSR safety)', () => {
		// bun:test runs without `document`, so this exercises the
		// `typeof document === 'undefined'` guard in the default applier.
		expect(() => defaultHtmlClassApplier.addClass('foo')).not.toThrow();
		expect(() => defaultHtmlClassApplier.removeClass('foo')).not.toThrow();
	});

	test('default scheduler queueMicrotask is callable and fires', async () => {
		let ran = false;
		defaultMicrotaskScheduler.queueMicrotask(() => {
			ran = true;
		});
		await Promise.resolve();
		expect(ran).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// SSR-safe unmount planner.

describe('planUnmount: SSR guard', () => {
	test('browser: runTeardowns = true, phase transitions to unmounted', () => {
		const plan = planUnmount({ phase: 'active' }, true);
		expect(plan.runTeardowns).toBe(true);
		expect(plan.nextState.phase).toBe('unmounted');
	});

	test('SSR: runTeardowns = false, phase STILL transitions to unmounted', () => {
		// The teardowns touch `document`; in SSR they must not run. The
		// phase transition is unconditional so the controller's `$state`
		// is correct on the server too.
		const plan = planUnmount({ phase: 'active' }, false);
		expect(plan.runTeardowns).toBe(false);
		expect(plan.nextState.phase).toBe('unmounted');
	});

	test('SSR: from inactive, runTeardowns = false, phase -> unmounted', () => {
		const plan = planUnmount({ phase: 'inactive' }, false);
		expect(plan.runTeardowns).toBe(false);
		expect(plan.nextState.phase).toBe('unmounted');
	});

	test('browser: from inactive, runTeardowns = true', () => {
		const plan = planUnmount({ phase: 'inactive' }, true);
		expect(plan.runTeardowns).toBe(true);
		expect(plan.nextState.phase).toBe('unmounted');
	});

	test('idempotent on unmounted state in browser', () => {
		const plan = planUnmount({ phase: 'unmounted' }, true);
		expect(plan.runTeardowns).toBe(true);
		expect(plan.nextState.phase).toBe('unmounted');
	});

	test('idempotent on unmounted state in SSR', () => {
		const plan = planUnmount({ phase: 'unmounted' }, false);
		expect(plan.runTeardowns).toBe(false);
		expect(plan.nextState.phase).toBe('unmounted');
	});

	test('SSR plan never reports runTeardowns = true regardless of phase', () => {
		const phases: ReadonlyArray<PageLifecycleState['phase']> = ['mounted', 'active', 'inactive'];
		for (const phase of phases) {
			expect(planUnmount({ phase }, false).runTeardowns).toBe(false);
		}
	});
});
