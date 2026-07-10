// src/lib/utils/nav-coordinator.ts
/**
 * Layer 4 of the DV20 mobile-navigation pipeline: the coordinator.
 *
 * Per `docs/DV20-Plan.md` §2 Layer 4: given the plan's FROM and TO,
 * consults the unified `PageCacheStore`. If the TO is cached, the plan
 * is a direct slide. If not, the plan becomes a chip-exit with
 * preload.
 *
 * Pure. The cache lookup is injected as a `cacheHas` predicate so this
 * module is runes-free and unit-testable without the reactive store.
 * The orchestrator (Layer 1) wires the live `PageCacheStore.get` into
 * the predicate and calls `coordinate` once per gesture start.
 *
 * Responsibilities (§7 + §9):
 *
 *   - Decide direct-slide vs chip-exit given the FROM/TO and the cache
 *     state.
 *   - When chip-exit, choose the preload pathname (the TO) so the
 *     orchestrator can call `PageCacheStore.ensure(pathname, subKey)`.
 *   - When the TO is a snapshot-capturing route whose own snippet is
 *     cached, allow the slide to overlay it (`useDeepPreview`).
 *
 * Out of scope for this module: the actual rAF driving the slide, the
 * snippet rendering during the slide, and the SvelteKit
 * `beforeNavigate.cancel()` call. The coordinator decides; the
 * orchestrator acts.
 */

/** Predicate the orchestrator supplies. Returns true when the cache
 *  holds an entry for `(pathname, subKey)`. Wraps
 *  `PageCacheStore.get(...) !== null`. */
export type CacheHasFn = (pathname: string, subKey?: string) => boolean;

/** Inputs to the coordinator. `coordinate()` reads `toPathname`,
 *  `toSubKey`, `toSnapshotCapture`, `cacheHas`, and `hasToSnippet`;
 *  `fromPathname` is carried on the input but not read by the
 *  coordinator (the decision depends on the TO and the cache state).
 *  The `toSnapshotCapture` field comes from
 *  `RouteData.snapshotCapture`; the `cacheHas` predicate is the live
 *  cache check. */
export interface CoordinatorInput {
	readonly fromPathname: string;
	readonly toPathname: string;
	readonly toSubKey: string | undefined;
	readonly toSnapshotCapture: boolean;
	readonly cacheHas: CacheHasFn;
	/** True when the cache holds a snippet for the TO route
	 *  specifically (not just any snippet). The coordinator uses this
	 *  to enable the deep-preview overlay path for snapshot-capturing
	 *  routes whose own rendered content is cached. */
	readonly hasToSnippet: boolean;
}

/** The strategy the orchestrator should follow. */
export type CoordinatorStrategy = 'direct-slide' | 'chip-exit';

/** The coordinator's decision. Pure data; the orchestrator acts on it. */
export interface CoordinatorDecision {
	readonly strategy: CoordinatorStrategy;
	/** Pathname the orchestrator should preload via
	 *  `PageCacheStore.ensure(pathname, subKey)`. `null` for a
	 *  direct-slide (no preload needed). */
	readonly preloadPathname: string | null;
	readonly preloadSubKey: string | undefined;
	/** When true, the executor should overlay the cached snippet
	 *  during the slide. False for chip-exit and for direct-slide on
	 *  non-snapshot routes. */
	readonly useDeepPreview: boolean;
}

/**
 * Decide direct-slide vs chip-exit.
 *
 *   - If `cacheHas(toPathname, toSubKey)` returns true, the TO is
 *     cached: direct-slide. The slide plays without waiting on a
 *     preload.
 *   - If the TO is not cached, but the TO is a snapshot-capturing
 *     route AND a snippet exists in the cache, the slide can still be
 *     a direct-slide with a deep-preview overlay (the snippet is the
 *     stale-but-useful render of where the user is going).
 *   - Otherwise, chip-exit: the orchestrator slides in the TO's real
 *     panel (when its data is cached) or a layout-matched skeleton.
 *
 * The decision is pure. The orchestrator calls it once at gesture
 * start (FROM and TO are locked); the unit suite also exercises it
 * directly.
 */
export function coordinate(input: CoordinatorInput): CoordinatorDecision {
	if (input.cacheHas(input.toPathname, input.toSubKey)) {
		return {
			strategy: 'direct-slide',
			preloadPathname: null,
			preloadSubKey: undefined,
			useDeepPreview: false
		};
	}
	if (input.toSnapshotCapture && input.hasToSnippet) {
		return {
			strategy: 'direct-slide',
			preloadPathname: null,
			preloadSubKey: undefined,
			useDeepPreview: true
		};
	}
	return {
		strategy: 'chip-exit',
		preloadPathname: input.toPathname,
		preloadSubKey: input.toSubKey,
		useDeepPreview: false
	};
}

/** Convenience: does this decision need a preload step? */
export function needsPreload(decision: CoordinatorDecision): boolean {
	return decision.strategy === 'chip-exit' && decision.preloadPathname !== null;
}
