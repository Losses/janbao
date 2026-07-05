// src/lib/utils/nav-resolvers.ts
/**
 * Layer 3 of the DV20 mobile-navigation pipeline: the resolver dispatch
 * and the six tag-pair resolvers.
 *
 * Per `docs/DV20-Plan.md` §4: a pure function
 * `resolve(intent, stack, route-data) -> TransitionPlan`. The
 * orchestrator (Layer 1) selects the resolver by the (from-tag, to-tag)
 * pair of the current transition. Each pair has one resolver because
 * the two directions of a pair share one animation played forward or
 * in reverse.
 *
 * Six pairs for three tags (`tab`, `detail`, `search`):
 *
 *   - `{tab, tab}`        tabTabResolver        spatial axis by tab position
 *   - `{detail, detail}`  detailDetailResolver  deep-to-deep, title crossfade
 *   - `{search, search}`  searchSearchResolver  reserved (no top-level transition)
 *   - `{tab, detail}`     tabDetailResolver     list<->detail enter/exit slide
 *   - `{tab, search}`     tabSearchResolver     root<->search, DV17 scrub morph
 *   - `{detail, search}`  detailSearchResolver  thread<->search
 *
 * The bidirectional pairs share one resolver: `{tab,detail}` and
 * `{detail,tab}` both select `tabDetailResolver`. The resolver reads
 * `direction: 'forward' | 'backward'` from the input and the
 * `progressDirection` field encodes which way the plan plays.
 *
 * Each resolver produces per-consumer animation plans (page-track,
 * FAB, Header) as functions of `(progress, liveOffset)`. The plan is
 * resolved ONCE per gesture (FROM and TO locked at gesture start); the
 * live offset streams separately to the executor (Cycle 4).
 *
 * Pure (runes-free). Imported by the orchestrator and by its own unit
 * suite. No DOM reads or writes.
 */

import type { RouteData, RouteTag } from './route-data';
import type { IntentState } from './nav-intent';

// ---------------------------------------------------------------------------
// Plan types. The `TransitionPlan` interface matches §4 exactly. The
// consumer-visual types are defined here as named interfaces (the
// project lint gate bans inline object type literals).

/** Direction the page track slides. 'left' = the track translates
 *  leftward (a neighbour from the right enters); 'right' = the track
 *  translates rightward (a neighbour from the left enters). */
export type PageTrackAxis = 'left' | 'right';

/** Structural page-track plan: which way to slide, and how far (px). */
export interface PageTrackPlan {
	readonly axis: PageTrackAxis;
	readonly distance: number;
}

/** The FAB's per-frame visual state, returned by a plan's FAB function. */
export interface FabVisual {
	readonly scale: number;
	readonly translateY: number;
	readonly visible: boolean;
}

/** The Header's per-frame visual state, returned by a plan's Header
 *  function. `morph` is the back-arrow / mode-morph progress (0 = root
 *  mode, 1 = deep or search mode). `titleCrossfade` is the title-swap
 *  progress (0 = old title, 1 = new title). */
export interface HeaderVisual {
	readonly morph: number;
	readonly titleCrossfade: number;
	readonly translateY: number;
}

/** Per-frame FAB plan function. Takes the gesture progress (0..1,
 *  where 0 = FROM visible, 1 = TO visible) and the live finger offset
 *  (px, signed). Returns the FAB's visual for that frame. */
export type FabPlanFn = (progress: number, liveOffset: number) => FabVisual;

/** Per-frame Header plan function. Same inputs as the FAB plan. */
export type HeaderPlanFn = (progress: number, liveOffset: number) => HeaderVisual;

/** Commit-physics selector. 'momentum' uses the release velocity
 *  integral; 'snap' is the reduced-motion instant translate. */
export type CommitPhysics = 'momentum' | 'snap';

/** Whether the plan plays 0 -> 1 (enter, lands on TO) or 1 -> 0 (exit,
 *  cancelled gesture snapping back to FROM). §4. */
export type ProgressDirection = 0 | 1;

/** The plan a resolver produces. §4's binding shape. */
export interface TransitionPlan {
	readonly pageTrack: PageTrackPlan;
	readonly fab: FabPlanFn;
	readonly header: HeaderPlanFn;
	readonly progressDirection: ProgressDirection;
	readonly commitPhysics: CommitPhysics;
}

// ---------------------------------------------------------------------------
// Route stack. Carried on `ResolverInput` for Cycle 5, when resolvers
// may read the back-target directly. In Cycle 3 the back-target
// derivation lives in the caller: it precomputes `direction` from the
// stack and passes it (§6: "the back-target is always the route stack's
// previous entry"). The Cycle-3 resolvers consume `direction` and do
// not read `stack`.

/** A single entry in the route stack. `tag` is carried alongside the
 *  pathname so the caller does not need to re-classify. */
export interface RouteStackEntry {
	readonly pathname: string;
	readonly search?: string;
	readonly tag: RouteTag;
}

/** The flat route stack. The last entry is the current route; the
 *  entry at `length - 2` is the back-target. In Cycle 3 this type is
 *  defined but no live stack is built (the wrapper is not yet wired to
 *  SvelteKit); test fixtures construct sample stacks. Cycle 5 wires it
 *  to the live navigation history and may have resolvers read it
 *  directly. */
export interface RouteStack {
	readonly entries: readonly RouteStackEntry[];
}

// ---------------------------------------------------------------------------
// Resolver input.

/** The direction of the transition. 'forward' = a push (a new entry
 *  lands on top of the stack); 'backward' = a pop (the current entry
 *  leaves, the previous entry is revealed). The caller precomputes this
 *  from the route stack; the resolvers read it instead of the stack. */
export type TransitionDirection = 'forward' | 'backward';

/** Input every resolver reads. The from/to route data, the from/to
 *  pathnames and tab indices, the gesture-start intent, the
 *  caller-precomputed direction, the viewport width, and the
 *  reduced-motion flag. The `stack` field is carried for Cycle 5 (see
 *  above); Cycle-3 resolvers do not read it. All fields are locked at
 *  gesture start; the live parameters stream through the plan's
 *  `fab`/`header` functions. */
export interface ResolverInput {
	readonly intent: IntentState;
	readonly stack: RouteStack;
	readonly from: RouteData;
	readonly to: RouteData;
	readonly direction: TransitionDirection;
	readonly fromPathname: string;
	readonly toPathname: string;
	/** Index of the FROM route in the spatial tab order, or -1 when
	 *  FROM is not a tab root. The {tab, tab} resolver reads this. */
	readonly fromTabIndex: number;
	/** Index of the TO route in the spatial tab order, or -1 when TO
	 *  is not a tab root. */
	readonly toTabIndex: number;
	readonly viewportWidth: number;
	readonly reducedMotion: boolean;
}

/** A resolver. Pure: given the input, returns a plan. */
export type Resolver = (input: ResolverInput) => TransitionPlan;

// ---------------------------------------------------------------------------
// Pure helpers shared by the resolvers.

/** Clamp a value to [lo, hi]. */
function clamp(value: number, lo: number, hi: number): number {
	if (value < lo) return lo;
	if (value > hi) return hi;
	return value;
}

/** Foreground-fraction to FAB scale, mirroring `fab-scale.ts`'s
 *  `scaleFromFraction` shape: the FAB disappears over the first half
 *  of foregroundFraction and appears over the second half. */
function fabScaleFromFraction(foregroundFraction: number): number {
	return clamp(2 * foregroundFraction - 1, 0, 1);
}

/** Build the FAB plan from the from/to fab booleans. Returns a function
 *  of (progress) where progress=0 means FROM is visible and progress=1
 *  means TO is visible. */
function buildFabPlan(fromFab: boolean, toFab: boolean): FabPlanFn {
	if (fromFab && toFab) {
		// Both routes show a FAB. The source FAB leaves in the first
		// half (scale 1 -> 0 over progress 0 -> 0.5), the destination
		// FAB appears in the second half (scale 0 -> 1 over progress
		// 0.5 -> 1). The FAB layer swaps which list-kind it renders at
		// the midpoint; the resolver drives only the scale.
		return (progress: number): FabVisual => {
			const scale = Math.abs(1 - 2 * progress);
			return { scale, translateY: 0, visible: scale > 0 };
		};
	}
	if (fromFab && !toFab) {
		// Forward: source FAB hides by midpoint.
		return (progress: number): FabVisual => {
			const scale = fabScaleFromFraction(1 - progress);
			return { scale, translateY: 0, visible: scale > 0 };
		};
	}
	if (!fromFab && toFab) {
		// Backward: destination FAB appears in the second half.
		return (progress: number): FabVisual => {
			const scale = fabScaleFromFraction(progress);
			return { scale, translateY: 0, visible: scale > 0 };
		};
	}
	// Neither route shows a FAB.
	return (): FabVisual => ({ scale: 0, translateY: 0, visible: false });
}

/** Page-track axis for a cross-tag transition. Forward pushes slide
 *  the track left (the new page enters from the right edge); backward
 *  pops slide the track right (the previous page enters from the
 *  left edge). */
function crossTagAxis(direction: TransitionDirection): PageTrackAxis {
	return direction === 'forward' ? 'left' : 'right';
}

/** progressDirection: 0 when the gesture will land on TO (commit); 1
 *  when the gesture was cancelled (snap back to FROM). The resolver
 *  reads `intent.micro` at gesture start; the orchestrator may pass a
 *  cancelled intent through to produce the retract plan. */
function progressDirectionFor(intent: IntentState): ProgressDirection {
	return intent.micro === 'cancelled' ? 1 : 0;
}

function commitPhysicsFor(reducedMotion: boolean): CommitPhysics {
	return reducedMotion ? 'snap' : 'momentum';
}

// ---------------------------------------------------------------------------
// Resolver 1: {tab, tab}.
//
// Spatial axis resolved by tab position. Forward (toTabIndex >
// fromTabIndex) slides the track left; backward slides it right. FAB
// plan follows the from/to fab booleans (a / <-> /messages/inbox swipe
// is the both-fab handoff case). Header stays in root mode: no morph,
// no title crossfade.

export const tabTabResolver: Resolver = (input: ResolverInput): TransitionPlan => {
	const axis: PageTrackAxis = input.toTabIndex > input.fromTabIndex ? 'left' : 'right';
	const fab = buildFabPlan(input.from.fab, input.to.fab);
	const header: HeaderPlanFn = (): HeaderVisual => ({
		morph: 0,
		titleCrossfade: 0,
		translateY: 0
	});
	return {
		pageTrack: { axis, distance: input.viewportWidth },
		fab,
		header,
		progressDirection: progressDirectionFor(input.intent),
		commitPhysics: commitPhysicsFor(input.reducedMotion)
	};
};

// ---------------------------------------------------------------------------
// Resolver 2: {detail, detail}.
//
// Deep-to-deep (thread to profile, settings to sub-settings). Axis
// follows intent + stack (forward push left, backward pop right).
// Header stays in deep mode (morph = 1 throughout) with a title
// crossfade = progress. FAB stays hidden (both detail routes have
// fab: false).

export const detailDetailResolver: Resolver = (input: ResolverInput): TransitionPlan => {
	const axis = crossTagAxis(input.direction);
	const fab = buildFabPlan(input.from.fab, input.to.fab);
	const header: HeaderPlanFn = (progress: number): HeaderVisual => ({
		morph: 1,
		titleCrossfade: clamp(progress, 0, 1),
		translateY: 0
	});
	return {
		pageTrack: { axis, distance: input.viewportWidth },
		fab,
		header,
		progressDirection: progressDirectionFor(input.intent),
		commitPhysics: commitPhysicsFor(input.reducedMotion)
	};
};

// ---------------------------------------------------------------------------
// Resolver 3: {search, search}.
//
// Per §4 this pair is reserved: search has no top-level search-to-
// search navigation. The SearchScopePager's internal scope switch is
// a nested sub-pager, not a top-level pair. The resolver still exists
// for dispatch-table symmetry and returns a degenerate no-op plan so
// an accidental dispatch cannot move the track.

export const searchSearchResolver: Resolver = (input: ResolverInput): TransitionPlan => {
	const fab = buildFabPlan(input.from.fab, input.to.fab);
	const header: HeaderPlanFn = (): HeaderVisual => ({
		morph: 1,
		titleCrossfade: 0,
		translateY: 0
	});
	return {
		pageTrack: { axis: 'left', distance: 0 },
		fab,
		header,
		progressDirection: progressDirectionFor(input.intent),
		commitPhysics: commitPhysicsFor(input.reducedMotion)
	};
};

// ---------------------------------------------------------------------------
// Resolver 4: {tab, detail}.
//
// List-to-detail enter slide and detail-to-list back slide. Axis
// follows intent + stack. FAB scales 1 -> 0 across the slide when the
// source is a fab route (e.g. / -> /discussion/123). Header morphs
// from root (morph = 0) to deep (morph = 1) on enter, with a title
// crossfade so the deep title appears with the morph.

export const tabDetailResolver: Resolver = (input: ResolverInput): TransitionPlan => {
	const axis = crossTagAxis(input.direction);
	const fab = buildFabPlan(input.from.fab, input.to.fab);
	const header: HeaderPlanFn = (progress: number): HeaderVisual => {
		// progress = 0 -> FROM visible; progress = 1 -> TO visible.
		// When FROM is tab and TO is detail (forward), morph goes 0 -> 1.
		// When FROM is detail and TO is tab (backward), morph goes 1 -> 0.
		const morph = input.direction === 'forward' ? clamp(progress, 0, 1) : clamp(1 - progress, 0, 1);
		return { morph, titleCrossfade: clamp(progress, 0, 1), translateY: 0 };
	};
	return {
		pageTrack: { axis, distance: input.viewportWidth },
		fab,
		header,
		progressDirection: progressDirectionFor(input.intent),
		commitPhysics: commitPhysicsFor(input.reducedMotion)
	};
};

// ---------------------------------------------------------------------------
// Resolver 5: {tab, search}.
//
// Root-to-search and search-to-root. Owns the DV17 Header scrub morph:
// the tab-bar gives way to the search layer as morph goes 0 -> 1 (or
// 1 -> 0 on the back direction). Track slides like a cross-tag pair.

export const tabSearchResolver: Resolver = (input: ResolverInput): TransitionPlan => {
	const axis = crossTagAxis(input.direction);
	const fab = buildFabPlan(input.from.fab, input.to.fab);
	const header: HeaderPlanFn = (progress: number): HeaderVisual => {
		const morph = input.direction === 'forward' ? clamp(progress, 0, 1) : clamp(1 - progress, 0, 1);
		return { morph, titleCrossfade: 0, translateY: 0 };
	};
	return {
		pageTrack: { axis, distance: input.viewportWidth },
		fab,
		header,
		progressDirection: progressDirectionFor(input.intent),
		commitPhysics: commitPhysicsFor(input.reducedMotion)
	};
};

// ---------------------------------------------------------------------------
// Resolver 6: {detail, search}.
//
// Thread/profile to search and back. Both endpoints are non-tab; morph
// goes between deep (1) and search (1 with a different mode), so we
// keep morph at 1 and let the Header consumer choose the layer by the
// to-tag. Track slides like a cross-tag pair.

export const detailSearchResolver: Resolver = (input: ResolverInput): TransitionPlan => {
	const axis = crossTagAxis(input.direction);
	const fab = buildFabPlan(input.from.fab, input.to.fab);
	const header: HeaderPlanFn = (progress: number): HeaderVisual => ({
		morph: 1,
		titleCrossfade: clamp(progress, 0, 1),
		translateY: 0
	});
	return {
		pageTrack: { axis, distance: input.viewportWidth },
		fab,
		header,
		progressDirection: progressDirectionFor(input.intent),
		commitPhysics: commitPhysicsFor(input.reducedMotion)
	};
};

// ---------------------------------------------------------------------------
// Dispatch.
//
// Selects the resolver by the unordered (from-tag, to-tag) pair. §4:
// "A bidirectional pair shares one resolver." The dispatch accepts
// either order of the pair and returns the same resolver.

/** Lookup key for the dispatch table. The unordered pair encoded as a
 *  sorted `${a}-${b}` string. */
function pairKey(a: RouteTag, b: RouteTag): string {
	return a <= b ? `${a}-${b}` : `${b}-${a}`;
}

const RESOLVER_TABLE: Readonly<Record<string, Resolver>> = {
	'tab-tab': tabTabResolver,
	'detail-detail': detailDetailResolver,
	'search-search': searchSearchResolver,
	'detail-tab': tabDetailResolver,
	'search-tab': tabSearchResolver,
	'detail-search': detailSearchResolver
};

/** Select the resolver for the (from-tag, to-tag) pair. Returns the
 *  pair's resolver; the caller passes the resolved `direction` so the
 *  same resolver handles both directions of the pair. */
export function selectResolver(fromTag: RouteTag, toTag: RouteTag): Resolver {
	const key = pairKey(fromTag, toTag);
	const resolver = RESOLVER_TABLE[key];
	if (!resolver) {
		throw new Error(`No resolver registered for pair (${fromTag}, ${toTag})`);
	}
	return resolver;
}

/** Resolve a transition. Convenience wrapper: selects the resolver and
 *  applies it. Pure. */
export function resolve(input: ResolverInput): TransitionPlan {
	const resolver = selectResolver(input.from.tag, input.to.tag);
	return resolver(input);
}

// ---------------------------------------------------------------------------
// Internal helpers exported for unit tests (so the suite can assert
// the FAB plan shape without re-implementing the math).

export const __test = {
	fabScaleFromFraction,
	buildFabPlan,
	crossTagAxis,
	progressDirectionFor,
	commitPhysicsFor,
	pairKey
};
