// src/lib/stores/nav-executor.svelte.ts
/**
 * Layer 5 reactive shell around the pure executor logic in
 * `nav-executor-logic.ts`. Owns the single rAF loop, the `$state`
 * record, the SSR `browser` gate, and the binding to a
 * `NavDomDriver`. Every per-frame decision (commit integration,
 * visual building, interruption) delegates to the pure module so the
 * logic is unit-tested under `bun:test` with no Svelte runes loader.
 *
 * Per `docs/DV20-Plan.md` §5 + the C04 spec:
 *
 *   - The rAF loop runs only during the committing phase. During the
 *     live drag phase, each pointermove event publishes a frame
 *     directly (the orchestrator's phase decides which path is
 *     active; only one writer owns the visual at any instant).
 *   - The commit duration is velocity-matched, not hardcoded; the
 *     pure module's `startCommit` solves the duration from the
 *     release velocity and the remaining distance.
 *   - Reduced motion snaps: the wrapper queries the driver once at
 *     commit start, passes the flag to `startCommit`, and skips the
 *     rAF when the snap path runs.
 *   - Interruption cancels the rAF; the wrapper's `onInterrupt`
 *     boundary method preserves the executor's current progress so
 *     the next drag event hands off with no jump.
 *   - SSR safety: the `browser` flag from `$app/environment` gates
 *     the rAF scheduler; the rAF never runs during SSR.
 *
 * In Cycle 4 shadow mode the boundary methods (`onDragStart`,
 * `onDragMove`, `onCommit`, `onCancel`, `onInterrupt`, `onLand`) have
 * no production caller. The orchestrator (Cycle 5) wires them to the
 * state-machine events. The shell is exercised by the unit suite for
 * the pure half; the shell itself is not unit-tested under `bun:test`
 * (it uses `$state`).
 */

import { browser } from '$app/environment';
import {
	applyDrag,
	initialExecutorState,
	interrupt,
	publishFrame,
	sampleFrame,
	startCommit,
	type ExecutorState
} from '$lib/utils/nav-executor-logic';
import type { NavDomDriver } from '$lib/utils/nav-dom-driver';
import type { TransitionPlan } from '$lib/utils/nav-resolvers';

/** A clock function for the rAF timeline. Injectable so a future
 *  Cycle 5 integration test can drive the rAF deterministically. The
 *  default is `performance.now()` in the browser (a
 *  `DOMHighResTimeStamp` relative to navigation start, NOT Unix epoch)
 *  and `Date.now()` as an SSR fallback that never executes (the rAF is
 *  browser-gated, so only the `performance.now()` branch runs). The two
 *  have different reference points; Cycle 5 should pick one shared time
 *  base across the rAF and the intent classifier (journal carried
 *  item). */
export type NavExecutorClockFn = () => number;

/** Constructor options for `NavExecutor`. */
export interface NavExecutorOptions {
	/** The driver the executor writes through. In Cycle 4 shadow mode
	 *  the only implementation is `MockNavDomDriver`; Cycle 5 supplies
	 *  a real driver that proxies through to the live DOM. */
	readonly driver: NavDomDriver;
	/** Optional clock override for deterministic tests. */
	readonly now?: NavExecutorClockFn;
}

/** Internal alias kept for the private field type. */
type ClockFn = NavExecutorClockFn;

/** The default clock. Returns `performance.now()` (a
 *  `DOMHighResTimeStamp`, high-resolution and monotonic) in every
 *  runtime this project ships - `performance` is defined in Bun, Node,
 *  Cloudflare Workers, and workerd, so the `Date.now()` branch below is
 *  dead code retained only as a fallback for a runtime without
 *  `performance`. The rAF is browser-gated regardless, so this clock
 *  only runs in the browser. The intent classifier (`nav-intent.ts`)
 *  accepts a caller-supplied clock; Cycle 5 wiring will choose a single
 *  source so the executor and the classifier share the same time base. */
function defaultNow(): number {
	if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
		return performance.now();
	}
	return Date.now();
}

/** The Layer 5 executor reactive shell. Holds the executor's
 *  `$state<ExecutorState>` and drives it from the orchestrator's
 *  phase events through the boundary methods. */
export class NavExecutor {
	#state = $state<ExecutorState>(initialExecutorState());
	#plan = $state<TransitionPlan | null>(null);
	readonly #driver: NavDomDriver;
	readonly #now: ClockFn;
	#rafId: number | null = null;

	constructor(opts: NavExecutorOptions) {
		this.#driver = opts.driver;
		this.#now = opts.now ?? defaultNow;
	}

	/** Reactive read of the executor state record. Consumers read
	 *  fields off this in a `$derived` to register as dependents. */
	get state(): ExecutorState {
		return this.#state;
	}

	/** Reactive read of the active plan. Null until `onDragStart`
	 *  supplies one; cleared by `onLand` and by `stop`. */
	get activePlan(): TransitionPlan | null {
		return this.#plan;
	}

	/** Convenience reactive read of the current progress. Consumers
	 *  that only care about progress read this in a `$derived`. */
	get progress(): number {
		return this.#state.progress;
	}

	/** A gesture starts. Locks the plan and publishes the first live
	 *  frame. Cycle 5 wiring: the orchestrator's drag-start event
	 *  calls this with the resolved plan and the initial (progress,
	 *  liveOffset) computed from the live intent. */
	onDragStart(plan: TransitionPlan, progress: number, liveOffset: number): void {
		this.#plan = plan;
		this.#state = applyDrag(this.#state, { progress, liveOffset });
		this.#publish();
		// During the live phase the rAF is not needed: each pointermove
		// publishes directly via onDragMove.
		this.#stopRaf();
	}

	/** A live drag moved. Updates the progress / liveOffset and
	 *  publishes one frame synchronously. */
	onDragMove(progress: number, liveOffset: number): void {
		if (this.#plan === null) return;
		this.#state = applyDrag(this.#state, { progress, liveOffset });
		this.#publish();
	}

	/** The drag released past the threshold. Solves the commit
	 *  duration from the release velocity, publishes the first commit
	 *  frame, and (for the momentum path) schedules the rAF. For
	 *  reduced motion the snap path runs and the rAF is not
	 *  scheduled. */
	onCommit(releaseVelocityPxPerMs: number): void {
		if (this.#plan === null) return;
		const plan = this.#plan;
		const reducedMotion = this.#driver.prefersReducedMotion();
		const next = startCommit(this.#state, {
			releaseVelocityPxPerMs,
			plan,
			reducedMotion,
			now: this.#now()
		});
		this.#state = next;
		this.#publish();
		if (next.phase === 'committing') {
			this.#ensureRaf();
		} else {
			// Snap path (reduced motion): no rAF needed.
			this.#stopRaf();
		}
	}

	/** The drag released below the threshold. The plan's
	 *  `progressDirection` carries the cancel-vs-commit distinction
	 *  (a cancel plan plays the same momentum integral toward target
	 *  0 instead of target 1), so this delegates to `onCommit`. */
	onCancel(releaseVelocityPxPerMs: number): void {
		this.onCommit(releaseVelocityPxPerMs);
	}

	/** A new intent arrived mid-commit (§5 interruption). Cancels the
	 *  rAF, preserves the executor's current progress as the handoff
	 *  point, and publishes one frame so the visual at the moment of
	 *  interrupt is authoritative. The next `onDragStart` /
	 *  `onDragMove` continues from this state with no jump. */
	onInterrupt(): void {
		this.#state = interrupt(this.#state);
		this.#publish();
		this.#stopRaf();
	}

	/** The navigation landed. Stops the rAF, clears the plan, and
	 *  resets the executor state. Idempotent: calling on an already-
	 *  idle executor is a no-op. */
	onLand(): void {
		this.#stopRaf();
		this.#plan = null;
		this.#state = initialExecutorState();
	}

	/** Force-stop the rAF and clear the plan without resetting state.
	 *  Cycle 5 may call this when the user navigates away from the
	 *  gesture surface mid-commit (e.g. an OS back-button press that
	 *  the orchestrator routes around the executor). */
	stop(): void {
		this.#stopRaf();
		this.#plan = null;
	}

	// -----------------------------------------------------------------------
	// Internal: rAF scheduling + publish.

	/** Schedule the rAF if we are in the browser. The SSR gate is the
	 *  `browser` flag from `$app/environment`; the rAF never runs
	 *  during SSR. */
	#ensureRaf(): void {
		if (!browser) return;
		if (this.#rafId !== null) return;
		this.#rafId = requestAnimationFrame(this.#tick);
	}

	/** Cancel any in-flight rAF. */
	#stopRaf(): void {
		if (this.#rafId !== null) {
			cancelAnimationFrame(this.#rafId);
			this.#rafId = null;
		}
	}

	/** The single rAF callback. Samples one commit frame, publishes
	 *  it, and either reschedules or stops. */
	#tick = (): void => {
		this.#rafId = null;
		const plan = this.#plan;
		if (plan === null) return;
		if (this.#state.phase !== 'committing') return;
		const sample = sampleFrame(this.#state, plan, this.#now());
		this.#state = sample.state;
		this.#publish();
		if (!sample.done) {
			this.#ensureRaf();
		}
	};

	/** Build the visual from the current state and write it through
	 *  the driver. The driver is the only DOM touchpoint; the shell
	 *  does not read the DOM back. */
	#publish(): void {
		const plan = this.#plan;
		if (plan === null) return;
		publishFrame(this.#state, plan, this.#driver);
	}
}
