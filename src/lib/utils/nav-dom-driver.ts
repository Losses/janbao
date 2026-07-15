// src/lib/utils/nav-dom-driver.ts
/**
 * The DOM-driver interface for the Layer 5 executor. The executor
 * (`nav-executor-logic.ts` + `nav-executor.svelte.ts`) computes a
 * per-frame visual record and hands it to a driver; the driver is the
 * only component that touches the DOM.
 *
 * Per `docs/DV20-Plan.md` §5 + §13.5: the executor publishes
 * authoritative state. There is NO driver method to read the DOM back.
 * The executor tracks its own `(progress, liveOffset)` and the driver
 * is write-only (plus a `prefersReducedMotion()` query for the
 * reduced-motion snap, which is a media-query read, not a read of the
 * gesture surface's own state).
 *
 * Implementations: `MockNavDomDriver` (unit tests) and
 * `LiveNavDomDriver` (production, constructed by the orchestrator).
 */

/** The page-track write. `translateX` is the CSS pixel translate applied
 *  to the gesture surface; the sign is determined by the plan's
 *  `pageTrack.axis` ('left' -> negative, 'right' -> positive). The
 *  executor computes this; the driver just applies it. */
export interface PageTrackWrite {
	readonly translateX: number;
}

/** The FAB write. Mirrors `FabVisual` from `nav-resolvers.ts`. */
export interface FabWrite {
	readonly scale: number;
	readonly translateY: number;
	readonly visible: boolean;
}

/** The Header write. Mirrors `HeaderVisual` from `nav-resolvers.ts`. */
export interface HeaderWrite {
	readonly morph: number;
	readonly titleCrossfade: number;
	readonly translateY: number;
}

/** A single per-frame visual write. The executor computes one of these
 *  per frame (during drag events and during the commit rAF loop) and
 *  hands it to `NavDomDriver.write`. The `fab` / `header` fields are
 *  optional: when a plan supplies no per-frame fn for a consumer (the
 *  pipeline hosts omit both), `buildVisual` sets the field to
 *  `undefined` and the driver skips that write branch. */
export interface NavVisualWrite {
	readonly pageTrack: PageTrackWrite;
	readonly fab?: FabWrite;
	readonly header?: HeaderWrite;
}

/** The DOM abstraction the executor writes through. Implementations:
 *
 *  - `MockNavDomDriver` (this file): records every write so the unit
 *    suite can assert the per-frame sequence; `prefersReducedMotion`
 *    is configurable per-test.
 *  - `LiveNavDomDriver` (`nav-dom-driver-live.ts`): proxies through to
 *    the live track / FAB / Header elements.
 *
 *  The driver does NOT expose a read-back method. The executor holds
 *  the authoritative `(progress, liveOffset)` in its own state record;
 *  interruption handoff (§5) reads from that record, not from the
 *  DOM.
 */
export interface NavDomDriver {
	/** Apply one per-frame visual record. Idempotent for the same
	 *  input; the executor calls this once per frame. */
	write(visual: NavVisualWrite): void;
	/** Whether `matchMedia('(prefers-reduced-motion: reduce)')` matches.
	 *  Queried once at commit start by the executor; the result
	 *  selects snap (true) vs momentum integration (false). The mock
	 *  returns a configurable value; `LiveNavDomDriver` reads
	 *  the live media query. */
	prefersReducedMotion(): boolean;
}

/** Options for `MockNavDomDriver`. The reduced-motion flag is
 *  configurable so the unit suite can exercise both the snap path and
 *  the momentum path against the same driver instance shape. */
export interface MockNavDomDriverOptions {
	readonly reducedMotion?: boolean;
}

/** Test-only mock driver. Records every `write` in `writes` (in order)
 *  so the unit suite can assert the per-frame sequence, and exposes
 *  `lastWrite` for the common single-frame assertion. The
 *  `prefersReducedMotion` flag is mutable via `setReducedMotion` so a
 *  single test can flip the flag and re-run. */
export class MockNavDomDriver implements NavDomDriver {
	readonly writes: NavVisualWrite[] = [];
	#reducedMotion: boolean;

	constructor(opts: MockNavDomDriverOptions = {}) {
		this.#reducedMotion = opts.reducedMotion ?? false;
	}

	write(visual: NavVisualWrite): void {
		this.writes.push(visual);
	}

	prefersReducedMotion(): boolean {
		return this.#reducedMotion;
	}

	/** Flip the reduced-motion flag mid-test. The mock-driver suite
	 *  uses this to assert the flag flips; the executor-logic suite
	 *  instead constructs a separate driver per test with the flag
	 *  preset (no test flips the flag mid-run). `LiveNavDomDriver` reads
	 *  the live media query instead. */
	setReducedMotion(value: boolean): void {
		this.#reducedMotion = value;
	}

	/** The most recent write, or `undefined` if no write has occurred.
	 *  Convenience for the common single-frame assertion. */
	get lastWrite(): NavVisualWrite | undefined {
		return this.writes[this.writes.length - 1];
	}

	/** Drop the recorded writes; leave the reduced-motion flag
	 *  unchanged. The mock-driver suite uses this to assert that reset
	 *  behavior (write count drops to zero, flag survives). No test
	 *  reuses a driver across sub-tests; each constructs a fresh
	 *  driver. */
	clear(): void {
		this.writes.length = 0;
	}
}
