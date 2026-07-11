// src/lib/utils/nav-resolvers.test.ts
/**
 * Unit suite for the Layer 3 resolvers (nav-resolvers.ts). Each pair
 * gets a suite covering (intent, stack, from, to, direction) -> plan.
 * The resolvers are pure functions so the suite runs under `bun:test`
 * with no Svelte runes loader.
 *
 * Coverage focus:
 *   - The dispatch table selects the right resolver for every
 *     (from-tag, to-tag) pair (both orders of each bidirectional pair).
 *   - The {tab, tab} axis is spatial (toTabIndex > fromTabIndex -> left).
 *   - Cross-tag axes follow direction (forward -> left, backward -> right).
 *   - The {search, search} resolver is reserved (distance 0).
 *   - progressDirection follows intent.micro (committed / cancelled).
 *   - The resolvers omit `fab` / `header` (the pilot drives those
 *     layers through the pager store, not through the plan).
 */

import { describe, test, expect } from 'bun:test';
import {
	__test,
	detailDetailResolver,
	detailSearchResolver,
	resolve,
	resolve as _resolve,
	searchSearchResolver,
	selectResolver,
	tabDetailResolver,
	tabSearchResolver,
	tabTabResolver,
	type ResolverInput,
	type RouteStack
} from './nav-resolvers';
import { initialIntentState } from './nav-intent';
import type { RouteData } from './route-data';

// ---------------------------------------------------------------------------
// Helpers for constructing route data + stacks.

interface RouteDataInput {
	tag: RouteData['tag'];
	fab: boolean;
}

function routeData(input: RouteDataInput): RouteData {
	return { tag: input.tag, snapshotCapture: false, fab: input.fab };
}

function stackWith(entries: RouteStack['entries']): RouteStack {
	return { entries };
}

const TAB: RouteData = routeData({ tag: 'tab', fab: false });
const DETAIL: RouteData = routeData({ tag: 'detail', fab: false });
const SEARCH: RouteData = routeData({ tag: 'search', fab: false });

function baseInput(overrides: Partial<ResolverInput> = {}): ResolverInput {
	return {
		intent: initialIntentState(),
		stack: stackWith([
			{ pathname: '/from', tag: 'tab' },
			{ pathname: '/to', tag: 'tab' }
		]),
		from: TAB,
		to: TAB,
		direction: 'forward',
		fromPathname: '/from',
		toPathname: '/to',
		fromTabIndex: 0,
		toTabIndex: 1,
		viewportWidth: 375,
		reducedMotion: false,
		...overrides
	};
}

describe('dispatch table: selectResolver', () => {
	test('every (from-tag, to-tag) pair selects a resolver', () => {
		const tags = ['tab', 'detail', 'search'] as const;
		for (const from of tags) {
			for (const to of tags) {
				const resolver = selectResolver(from, to);
				expect(typeof resolver).toBe('function');
			}
		}
	});

	test('bidirectional pairs share one resolver', () => {
		expect(selectResolver('tab', 'detail')).toBe(selectResolver('detail', 'tab'));
		expect(selectResolver('tab', 'search')).toBe(selectResolver('search', 'tab'));
		expect(selectResolver('detail', 'search')).toBe(selectResolver('search', 'detail'));
	});

	test('the dispatch returns the six registered resolvers', () => {
		expect(selectResolver('tab', 'tab')).toBe(tabTabResolver);
		expect(selectResolver('detail', 'detail')).toBe(detailDetailResolver);
		expect(selectResolver('search', 'search')).toBe(searchSearchResolver);
		expect(selectResolver('tab', 'detail')).toBe(tabDetailResolver);
		expect(selectResolver('tab', 'search')).toBe(tabSearchResolver);
		expect(selectResolver('detail', 'search')).toBe(detailSearchResolver);
	});

	test('pairKey is order-independent', () => {
		expect(__test.pairKey('tab', 'detail')).toBe(__test.pairKey('detail', 'tab'));
		expect(__test.pairKey('search', 'tab')).toBe(__test.pairKey('tab', 'search'));
	});
});

describe('tabTabResolver: spatial axis', () => {
	test('toTabIndex > fromTabIndex -> axis left (forward spatial)', () => {
		const plan = tabTabResolver(baseInput({ fromTabIndex: 0, toTabIndex: 1 }));
		expect(plan.pageTrack.axis).toBe('left');
		expect(plan.pageTrack.distance).toBe(375);
	});

	test('toTabIndex < fromTabIndex -> axis right (backward spatial)', () => {
		const plan = tabTabResolver(baseInput({ fromTabIndex: 2, toTabIndex: 1 }));
		expect(plan.pageTrack.axis).toBe('right');
	});

	test('commitPhysics is momentum when motion is allowed', () => {
		const plan = tabTabResolver(baseInput({ reducedMotion: false }));
		expect(plan.commitPhysics).toBe('momentum');
	});

	test('commitPhysics is snap when reduced motion is requested', () => {
		const plan = tabTabResolver(baseInput({ reducedMotion: true }));
		expect(plan.commitPhysics).toBe('snap');
	});
});

describe('cross-tag axis resolution', () => {
	test('forward direction -> axis left (new page enters from right)', () => {
		expect(__test.crossTagAxis('forward')).toBe('left');
	});

	test('backward direction -> axis right (previous page enters from left)', () => {
		expect(__test.crossTagAxis('backward')).toBe('right');
	});

	test('detailDetailResolver uses the cross-tag axis', () => {
		const fwd = detailDetailResolver(baseInput({ direction: 'forward' }));
		const bwd = detailDetailResolver(baseInput({ direction: 'backward' }));
		expect(fwd.pageTrack.axis).toBe('left');
		expect(bwd.pageTrack.axis).toBe('right');
	});

	test('tabDetailResolver uses the cross-tag axis in both directions', () => {
		const fwd = tabDetailResolver(baseInput({ from: TAB, to: DETAIL, direction: 'forward' }));
		const bwd = tabDetailResolver(baseInput({ from: DETAIL, to: TAB, direction: 'backward' }));
		expect(fwd.pageTrack.axis).toBe('left');
		expect(bwd.pageTrack.axis).toBe('right');
	});

	test('tabSearchResolver uses the cross-tag axis', () => {
		const fwd = tabSearchResolver(baseInput({ from: TAB, to: SEARCH, direction: 'forward' }));
		expect(fwd.pageTrack.axis).toBe('left');
	});

	test('detailSearchResolver uses the cross-tag axis', () => {
		const fwd = detailSearchResolver(baseInput({ from: DETAIL, to: SEARCH, direction: 'forward' }));
		expect(fwd.pageTrack.axis).toBe('left');
	});
});

describe('searchSearchResolver: reserved pair', () => {
	test('distance is 0 (no track motion)', () => {
		const plan = searchSearchResolver(baseInput({ from: SEARCH, to: SEARCH }));
		expect(plan.pageTrack.distance).toBe(0);
	});
});

describe('progressDirection', () => {
	test('progressDirection is 0 for a committed gesture', () => {
		const intent = { ...initialIntentState(), micro: 'committed' as const };
		const plan = tabTabResolver(baseInput({ intent }));
		expect(plan.progressDirection).toBe(0);
	});

	test('progressDirection is 1 for a cancelled gesture', () => {
		const intent = { ...initialIntentState(), micro: 'cancelled' as const };
		const plan = tabTabResolver(baseInput({ intent }));
		expect(plan.progressDirection).toBe(1);
	});
});

describe('resolve wrapper', () => {
	test('resolve applies the dispatch table and returns the page-track plan', () => {
		const plan = _resolve(
			baseInput({ from: TAB, to: DETAIL, fromTabIndex: -1, direction: 'forward' })
		);
		expect(plan.pageTrack.axis).toBe('left');
	});

	test('resolve throws on an unregistered pair is unreachable (typed tags)', () => {
		// The static table covers all 3x3 combinations; this asserts the
		// table is total by exercising every combination through resolve.
		const tags = ['tab', 'detail', 'search'] as const;
		for (const from of tags) {
			for (const to of tags) {
				const input = baseInput({
					from: routeData({ tag: from, fab: false }),
					to: routeData({ tag: to, fab: false })
				});
				expect(() => resolve(input)).not.toThrow();
			}
		}
	});
});

describe('plan shape: fab / header are omitted', () => {
	test('every resolver returns a plan without fab / header fns', () => {
		const cases = [
			{ name: 'tabTab', plan: tabTabResolver(baseInput()) },
			{ name: 'detailDetail', plan: detailDetailResolver(baseInput({ from: DETAIL, to: DETAIL })) },
			{ name: 'searchSearch', plan: searchSearchResolver(baseInput({ from: SEARCH, to: SEARCH })) },
			{ name: 'tabDetail', plan: tabDetailResolver(baseInput({ from: TAB, to: DETAIL })) },
			{ name: 'tabSearch', plan: tabSearchResolver(baseInput({ from: TAB, to: SEARCH })) },
			{ name: 'detailSearch', plan: detailSearchResolver(baseInput({ from: DETAIL, to: SEARCH })) }
		];
		for (const { name, plan } of cases) {
			expect(plan.fab, `${name}.fab should be undefined`).toBeUndefined();
			expect(plan.header, `${name}.header should be undefined`).toBeUndefined();
		}
	});
});
