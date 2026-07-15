// src/lib/utils/nav-resolvers.ts
/**
 * Layer 3 of the DV20 mobile-navigation pipeline: the resolver dispatch
 * and the six tag-pair resolvers.
 *
 * Per `docs/DV20-Plan.md` §4: a pure function
 * `resolve(input: ResolverInput) -> TransitionPlan` (the spec's
 * conceptual `(intent, stack, route-data)` is bundled into
 * `ResolverInput`). The orchestrator (Layer 1) selects the resolver by
 * the (from-tag, to-tag) pair of the current transition. Each pair has
 * one resolver because the two directions of a pair share one animation
 * played forward or in reverse. In the integrated pipeline the dispatch
 * is exercised by the unit suite and wired into the live pipeline by the
 * orchestrator.
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
 * Each resolver produces a page-track plan (axis + distance). The
 * `TransitionPlan` also carries OPTIONAL `fab` / `header` per-frame
 * functions a consumer may bind; the pipeline hosts omit them (the
 * FAB / Header react through their own layers reading the pager
 * store). The plan is resolved ONCE per gesture (FROM and TO locked
 * at gesture start); the live offset streams separately to the
 * executor.
 *
 * Pure (runes-free). The orchestrator imports the `TransitionPlan` and
 * `TransitionDirection` types from this module (the wrapper imports
 * both; the reducer imports `TransitionPlan`); the dispatch itself is
 * exercised by this module's own unit suite. No DOM reads or writes.
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

/** Structural page-track plan: which way to slide, and how far (px).
 *
 *  `restingTranslate` is the track's translateX (px) at progress=0. Most
 *  plans leave it at 0 (a single-panel track where progress=0 means
 *  translateX=0). The multi-panel tab host sets it to
 *  `-viewportWidth` so the centre panel (the right half of the 2*W
 *  track) fills the viewport at rest and the left panel sits
 *  off-screen. */
export interface PageTrackPlan {
	readonly axis: PageTrackAxis;
	readonly distance: number;
	/** The track's translateX at progress=0. Defaults to 0 when omitted;
	 *  the executor's `buildVisual` reads it via `?? 0`. */
	readonly restingTranslate?: number;
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

/** The plan a resolver produces. §4's binding shape. The `fab` and
 *  `header` fields are OPTIONAL: a resolver supplies them only when a
 *  consumer is bound to drive that visual through the executor. The
 *  pipeline hosts pass `fab: null, header: null` element refs to
 *  the driver, so the resolvers omit these fields and the
 *  FAB / Header react through their own layers reading the pager
 *  store. A future consumer that binds a FAB / Header element would
 *  receive the per-frame writes the plan's fns produce. */
export interface TransitionPlan {
	readonly pageTrack: PageTrackPlan;
	readonly fab?: FabPlanFn;
	readonly header?: HeaderPlanFn;
	readonly progressDirection: ProgressDirection;
	readonly commitPhysics: CommitPhysics;
}

// ---------------------------------------------------------------------------
// Route stack. Carried on `ResolverInput`. The back-target derivation
// lives in the caller: it precomputes `direction` from the stack and
// passes it (§6: "the back-target is always the route stack's previous
// entry"). The resolvers consume `direction` and do not read `stack`.

/** A single entry in the route stack. `tag` is carried alongside the
 *  pathname so the caller does not need to re-classify. */
export interface RouteStackEntry {
	readonly pathname: string;
	readonly search?: string;
	readonly tag: RouteTag;
}

/** The flat route stack. The last entry is the current route; the
 *  entry at `length - 2` is the back-target. The orchestrator builds
 *  the live stack from the navigation history; the resolvers do not
 *  read it directly (they read `direction`, which the caller
 *  precomputes from the stack). */
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
 *  reduced-motion flag. The `stack` field is carried on the input (see
 *  above); the resolvers currently consume `direction` instead. All
 *  fields are locked at gesture start; the live offset streams to the
 *  executor directly (a plan that supplies optional `fab` / `header`
 *  fns receives it as their second argument). */
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

/** Page-track axis for a cross-tag transition. Forward pushes slide
 *  the track left (the new page enters from the right edge); backward
 *  pops slide the track right (the previous page enters from the
 *  left edge). */
function crossTagAxis(direction: TransitionDirection): PageTrackAxis {
	return direction === 'forward' ? 'left' : 'right';
}

/** progressDirection: 0 when the gesture will land on TO (commit); 1
 *  when the gesture was cancelled (snap back to FROM). Reads
 *  `intent.micro`; a cancelled intent yields the retract plan. In
 *  integration this is exercised only by the unit suite. */
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
// fromTabIndex) slides the track left; backward slides it right. The
// FAB / Header react through their own layers reading the pager store
// (the plan carries no `fab` / `header` fns).

export const tabTabResolver: Resolver = (input: ResolverInput): TransitionPlan => {
	const axis: PageTrackAxis = input.toTabIndex > input.fromTabIndex ? 'left' : 'right';
	return {
		pageTrack: { axis, distance: input.viewportWidth },
		progressDirection: progressDirectionFor(input.intent),
		commitPhysics: commitPhysicsFor(input.reducedMotion)
	};
};

// ---------------------------------------------------------------------------
// Resolver 2: {detail, detail}.
//
// Deep-to-deep (thread to profile, settings to sub-settings). Axis
// follows intent + stack (forward push left, backward pop right).
// Both endpoints are detail routes; the FAB / Header layers read the
// pager store for their per-frame state.

export const detailDetailResolver: Resolver = (input: ResolverInput): TransitionPlan => {
	const axis = crossTagAxis(input.direction);
	return {
		pageTrack: { axis, distance: input.viewportWidth },
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
	return {
		pageTrack: { axis: 'left', distance: 0 },
		progressDirection: progressDirectionFor(input.intent),
		commitPhysics: commitPhysicsFor(input.reducedMotion)
	};
};

// ---------------------------------------------------------------------------
// Resolver 4: {tab, detail}.
//
// List-to-detail enter slide and detail-to-list back slide. Axis
// follows intent + stack. The FAB / Header react through their own
// layers reading the pager store.

export const tabDetailResolver: Resolver = (input: ResolverInput): TransitionPlan => {
	const axis = crossTagAxis(input.direction);
	return {
		pageTrack: { axis, distance: input.viewportWidth },
		progressDirection: progressDirectionFor(input.intent),
		commitPhysics: commitPhysicsFor(input.reducedMotion)
	};
};

// ---------------------------------------------------------------------------
// Resolver 5: {tab, search}.
//
// Root-to-search and search-to-root. Track slides like a cross-tag
// pair. The DV17 Header scrub morph is driven by the Header layer
// reading the pager store, not by this plan.

export const tabSearchResolver: Resolver = (input: ResolverInput): TransitionPlan => {
	const axis = crossTagAxis(input.direction);
	return {
		pageTrack: { axis, distance: input.viewportWidth },
		progressDirection: progressDirectionFor(input.intent),
		commitPhysics: commitPhysicsFor(input.reducedMotion)
	};
};

// ---------------------------------------------------------------------------
// Resolver 6: {detail, search}.
//
// Thread/profile to search and back. Both endpoints are non-tab. Track
// slides like a cross-tag pair; the Header layer chooses its mode by
// the to-tag through the pager store.

export const detailSearchResolver: Resolver = (input: ResolverInput): TransitionPlan => {
	const axis = crossTagAxis(input.direction);
	return {
		pageTrack: { axis, distance: input.viewportWidth },
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
// Internal helpers exported for unit tests.

export const __test = {
	crossTagAxis,
	progressDirectionFor,
	commitPhysicsFor,
	pairKey
};
