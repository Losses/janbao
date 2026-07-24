// src/lib/stores/nav-state-machine-logic.test.ts
/**
 * Unit suite for the Layer 1 orchestrator reducer
 * (nav-state-machine-logic.ts). Covers the macro phase transitions the
 * reducer actually produces (at-rest -> intent -> transitioning ->
 * landing); `'resolving'` is in `MacroPhaseKind` but reserved for Cycle
 * 5, so no Cycle-3 event produces it and this suite never traverses it.
 * Also covers interruption, cancellation, landing, and reset. The
 * reducer is total; the suite also asserts that out-of-sequence events
 * are no-ops.
 *
 * The reducer is pure so the suite runs under `bun:test` with no
 * Svelte runes loader.
 */

import { describe, test, expect } from 'bun:test';
import {
	atRestOnFor,
	initialOrchestratorState,
	reduce,
	type OrchestratorEvent
} from './nav-state-machine-logic';
import { initialIntentState } from '$lib/utils/nav-intent';
import type { TransitionPlan } from '$lib/utils/nav-resolvers';

const noopPlan: TransitionPlan = {
	pageTrack: { axis: 'left', distance: 375 },
	progressDirection: 0,
	commitPhysics: 'momentum'
};

function intentEvent(): OrchestratorEvent {
	return {
		type: 'intent',
		intent: { ...initialIntentState(), micro: 'drag-right', direction: 'right' },
		from: '/from',
		fromTag: 'detail'
	};
}

function resolvedEvent(): OrchestratorEvent {
	return {
		type: 'resolved',
		plan: noopPlan,
		from: '/from',
		to: '/to',
		fromTag: 'detail',
		toTag: 'tab',
		direction: 'backward'
	};
}

describe('reducer: at-rest -> intent -> resolved', () => {
	test('initial state is at-rest', () => {
		const s = initialOrchestratorState('tab');
		expect(s.macro.kind).toBe('at-rest');
		expect(s.macro.on).toBe('tab');
	});

	test('intent from at-rest enters the intent phase and records from', () => {
		const s0 = initialOrchestratorState('deep');
		const s1 = reduce(s0, intentEvent());
		expect(s1.macro.kind).toBe('intent');
		expect(s1.fromPathname).toBe('/from');
		expect(s1.fromTag).toBe('detail');
	});

	test('resolved locks the plan and from/to', () => {
		const s0 = initialOrchestratorState('deep');
		const s1 = reduce(s0, intentEvent());
		const s2 = reduce(s1, resolvedEvent());
		expect(s2.macro.kind).toBe('transitioning');
		expect(s2.macro.sub).toBe('dragging');
		expect(s2.macro.plan).toBe(noopPlan);
		expect(s2.fromPathname).toBe('/from');
		expect(s2.toPathname).toBe('/to');
		expect(s2.direction).toBe('backward');
	});

	test('intent from at-rest on a search route is allowed', () => {
		const s0 = initialOrchestratorState('search');
		const s1 = reduce(s0, intentEvent());
		expect(s1.macro.kind).toBe('intent');
	});

	test('intent while transitioning is a no-op (use interrupt)', () => {
		const s0 = initialOrchestratorState('deep');
		const s1 = reduce(s0, intentEvent());
		const s2 = reduce(s1, resolvedEvent());
		const s3 = reduce(s2, intentEvent());
		expect(s3).toBe(s2);
	});
});

describe('reducer: dragging -> committing -> cancelling', () => {
	test('commit from dragging enters committing', () => {
		const s0 = initialOrchestratorState('deep');
		const s1 = reduce(s0, intentEvent());
		const s2 = reduce(s1, resolvedEvent());
		const s3 = reduce(s2, { type: 'commit' });
		expect(s3.macro.kind).toBe('transitioning');
		expect(s3.macro.sub).toBe('committing');
	});

	test('cancel from dragging enters cancelling', () => {
		const s0 = initialOrchestratorState('deep');
		const s1 = reduce(s0, intentEvent());
		const s2 = reduce(s1, resolvedEvent());
		const s3 = reduce(s2, { type: 'cancel' });
		expect(s3.macro.sub).toBe('cancelling');
		// §13.5: the plan's progressDirection flips to 1 (cancel) to match the
		// executor's onCancel, so the state machine stays the sole authority.
		expect(s3.macro.plan?.progressDirection).toBe(1);
	});

	test('commit from at-rest is a no-op', () => {
		const s0 = initialOrchestratorState('tab');
		const s1 = reduce(s0, { type: 'commit' });
		expect(s1).toBe(s0);
	});

	test('cancel from at-rest is a no-op', () => {
		const s0 = initialOrchestratorState('tab');
		const s1 = reduce(s0, { type: 'cancel' });
		expect(s1).toBe(s0);
	});

	test('drag-move while dragging leaves the macro phase unchanged', () => {
		const s0 = initialOrchestratorState('deep');
		const s1 = reduce(s0, intentEvent());
		const s2 = reduce(s1, resolvedEvent());
		const newIntent = { ...initialIntentState(), micro: 'drag-right' as const, offset: 50 };
		const s3 = reduce(s2, { type: 'drag-move', intent: newIntent });
		expect(s3.macro.kind).toBe('transitioning');
		expect(s3.macro.sub).toBe('dragging');
		expect(s3).toBe(s2);
	});

	test('drag-move during committing is a no-op (no live updates mid-commit)', () => {
		const s0 = initialOrchestratorState('deep');
		const s1 = reduce(s0, intentEvent());
		const s2 = reduce(s1, resolvedEvent());
		const s3 = reduce(s2, { type: 'commit' });
		const s4 = reduce(s3, {
			type: 'drag-move',
			intent: { ...initialIntentState(), offset: 99 }
		});
		expect(s4).toBe(s3);
	});
});

describe('reducer: interruption', () => {
	test('interrupt during committing cancels the commit and re-enters intent', () => {
		const s0 = initialOrchestratorState('deep');
		const s1 = reduce(s0, intentEvent());
		const s2 = reduce(s1, resolvedEvent());
		const s3 = reduce(s2, { type: 'commit' });
		const s4 = reduce(s3, {
			type: 'interrupt',
			intent: { ...initialIntentState(), micro: 'drag-left', direction: 'left' }
		});
		expect(s4.macro.kind).toBe('intent');
		expect(s4.macro.plan).toBeNull();
	});

	test('interrupt from at-rest is a no-op', () => {
		const s0 = initialOrchestratorState('tab');
		const s1 = reduce(s0, { type: 'interrupt', intent: initialIntentState() });
		expect(s1).toBe(s0);
	});

	test('interrupt clears the abandoned to-fields (no stale destination)', () => {
		const s0 = initialOrchestratorState('deep');
		const s1 = reduce(s0, intentEvent());
		const s2 = reduce(s1, resolvedEvent());
		const s3 = reduce(s2, { type: 'commit' });
		const s4 = reduce(s3, { type: 'interrupt', intent: initialIntentState() });
		expect(s4.macro.kind).toBe('intent');
		expect(s4.toPathname).toBeNull();
		expect(s4.toTag).toBeNull();
		expect(s4.direction).toBeNull();
		// FROM survives: the user is still on the FROM page after a re-grab.
		expect(s4.fromPathname).toBe('/from');
		expect(s4.fromTag).toBe('detail');
	});

	test('re-grab after commit re-enters dragging (interrupt clears committing)', () => {
		// A mid-commit re-grab: interrupt clears the committing sub to
		// intent, then resolved for the new gesture sets sub 'dragging'
		// (the preserve-committing branch fires only from transitioning,
		// not from intent).
		const s0 = initialOrchestratorState('deep');
		const s1 = reduce(s0, intentEvent());
		const s2 = reduce(s1, resolvedEvent());
		const s3 = reduce(s2, { type: 'commit' });
		expect(s3.macro.sub).toBe('committing');
		const s4 = reduce(s3, { type: 'interrupt', intent: initialIntentState() });
		expect(s4.macro.kind).toBe('intent');
		const s5 = reduce(s4, resolvedEvent());
		expect(s5.macro.kind).toBe('transitioning');
		expect(s5.macro.sub).toBe('dragging');
	});
});

describe('reducer: landing and reset', () => {
	test('land clears the active plan and enters landing', () => {
		const s0 = initialOrchestratorState('deep');
		const s1 = reduce(s0, intentEvent());
		const s2 = reduce(s1, resolvedEvent());
		const s3 = reduce(s2, { type: 'commit' });
		const s4 = reduce(s3, { type: 'land', on: 'tab' });
		expect(s4.macro.kind).toBe('landing');
		expect(s4.macro.on).toBe('tab');
		expect(s4.macro.plan).toBeNull();
	});

	test('reset returns to at-rest and clears from/to', () => {
		const s0 = initialOrchestratorState('deep');
		const s1 = reduce(s0, intentEvent());
		const s2 = reduce(s1, resolvedEvent());
		// 'transitioning' is NOT force-cleared by reset (the finish-then-new
		// queued-nav replay may have dispatched synchronously into
		// 'transitioning' before the landing microtask's reset drains). Reset
		// from 'landing' (the normal reset path) does clear.
		const sLanding = reduce(s2, { type: 'land', on: 'tab' });
		expect(sLanding.macro.kind).toBe('landing');
		const s3 = reduce(sLanding, { type: 'reset', on: 'tab' });
		expect(s3.macro.kind).toBe('at-rest');
		expect(s3.fromPathname).toBeNull();
		expect(s3.toPathname).toBeNull();
		expect(s3.macro.plan).toBeNull();
	});

	test('reset from transitioning is a no-op (protects the queued-nav replay)', () => {
		const s0 = reduce(initialOrchestratorState('deep'), intentEvent());
		const s1 = reduce(s0, resolvedEvent());
		expect(s1.macro.kind).toBe('transitioning');
		const s2 = reduce(s1, { type: 'reset', on: 'tab' });
		expect(s2).toBe(s1);
	});

	test('reset from intent is a no-op (protects the landing-microtask race)', () => {
		// land -> landing; a new intent arrives before the microtask;
		// the stale microtask then fires reset. The new intent must
		// survive (reset is a no-op from `intent`).
		const s0 = initialOrchestratorState('deep');
		const s1 = reduce(s0, intentEvent());
		const s2 = reduce(s1, resolvedEvent());
		const s3 = reduce(s2, { type: 'commit' });
		const s4 = reduce(s3, { type: 'land', on: 'tab' });
		const s5 = reduce(s4, intentEvent());
		expect(s5.macro.kind).toBe('intent');
		const s6 = reduce(s5, { type: 'reset', on: 'tab' });
		expect(s6.macro.kind).toBe('intent');
		expect(s6.toPathname).toBeNull();
	});

	test('atRestOnFor maps tags correctly', () => {
		expect(atRestOnFor('tab')).toBe('tab');
		expect(atRestOnFor('search')).toBe('search');
		expect(atRestOnFor('detail')).toBe('deep');
	});

	test('land from at-rest enters landing (first-load path)', () => {
		const s0 = initialOrchestratorState('tab');
		const s1 = reduce(s0, { type: 'land', on: 'tab' });
		expect(s1.macro.kind).toBe('landing');
		expect(s1.macro.on).toBe('tab');
		expect(s1.macro.plan).toBeNull();
	});

	test('land then reset reaches at-rest (the wrapper microtask flow)', () => {
		const s0 = initialOrchestratorState('deep');
		const s1 = reduce(s0, intentEvent());
		const s2 = reduce(s1, resolvedEvent());
		const s3 = reduce(s2, { type: 'commit' });
		const s4 = reduce(s3, { type: 'land', on: 'tab' });
		expect(s4.macro.kind).toBe('landing');
		const s5 = reduce(s4, { type: 'reset', on: 'tab' });
		expect(s5.macro.kind).toBe('at-rest');
		expect(s5.macro.on).toBe('tab');
		expect(s5.macro.plan).toBeNull();
	});

	test('resolved from transitioning/committing preserves committing sub', () => {
		const s0 = initialOrchestratorState('deep');
		const s1 = reduce(s0, intentEvent());
		const s2 = reduce(s1, resolvedEvent());
		const s3 = reduce(s2, { type: 'commit' });
		expect(s3.macro.kind).toBe('transitioning');
		expect(s3.macro.sub).toBe('committing');
		const s4 = reduce(s3, resolvedEvent());
		expect(s4.macro.kind).toBe('transitioning');
		expect(s4.macro.sub).toBe('committing');
	});
});

describe('reducer: totality (out-of-sequence events are no-ops)', () => {
	test('resolved from at-rest is a no-op', () => {
		const s0 = initialOrchestratorState('tab');
		const s1 = reduce(s0, resolvedEvent());
		expect(s1).toBe(s0);
	});

	test('commit during cancelling is a no-op', () => {
		const s0 = initialOrchestratorState('deep');
		const s1 = reduce(s0, intentEvent());
		const s2 = reduce(s1, resolvedEvent());
		const s3 = reduce(s2, { type: 'cancel' });
		const s4 = reduce(s3, { type: 'commit' });
		expect(s4).toBe(s3);
	});

	test('every transitioning sub keeps the macro kind as transitioning', () => {
		// The transitioning subs are dragging, committing, and cancelling.
		const s0 = initialOrchestratorState('deep');
		const s1 = reduce(s0, intentEvent());
		const s2 = reduce(s1, resolvedEvent());
		expect(s2.macro.sub).toBe('dragging');
		expect(s2.macro.kind).toBe('transitioning');
		const s3 = reduce(s2, { type: 'commit' });
		expect(s3.macro.sub).toBe('committing');
		expect(s3.macro.kind).toBe('transitioning');
		// cancelling is reached by cancel-from-dragging (cancel from
		// committing is a no-op, so branch from s2, not s3).
		const s4 = reduce(s2, { type: 'cancel' });
		expect(s4.macro.sub).toBe('cancelling');
		expect(s4.macro.kind).toBe('transitioning');
	});
});

describe('reducer: plan carry-through', () => {
	test('the plan set on resolved is preserved through commit', () => {
		const s0 = initialOrchestratorState('deep');
		const s1 = reduce(s0, intentEvent());
		const s2 = reduce(s1, resolvedEvent());
		expect(s2.macro.plan).toBe(noopPlan);
		// Even after committing, the plan stays on the macro record:
		const s3 = reduce(s2, { type: 'commit' });
		expect(s3.macro.plan).toBe(noopPlan);
	});
});
