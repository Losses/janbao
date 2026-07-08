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
 *   - Reduced motion snaps: the wrapper reads `plan.commitPhysics` at
 *     commit start (resolved from the driver's reduced-motion state at
 *     gesture start), passes the flag to `startCommit`, and skips the
 *     rAF when the snap path runs.
 *   - Interruption: a mid-commit drag-start calls `onDragStart` for the
 *     new plan, which stops the rAF and resets the state inline. The
 *     orchestrator reads the executor's current progress to compute the
 *     new plan's start position (no jump, no DOM read-back).
 *   - SSR safety: the `browser` flag from `$app/environment` gates
 *     the rAF scheduler; the rAF never runs during SSR.
 *
 * The boundary methods (`onDragStart`, `onDragMove`, `onCommit`,
 * `onCancel`, `onLand`) are called by the orchestrator (Cycle 5b1),
 * which drives them from the state-machine events. The shell is
 * exercised by the unit suite for the pure half; the shell itself is
 * not unit-tested under `bun:test` (it uses `$state`).
 */

import { browser } from '$app/environment';
import {
	applyDrag,
	initialExecutorState,
	publishFrame,
	sampleFrame,
	shouldScheduleRaf,
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
 *  have different reference points; the orchestrator passes one shared
 *  clock to both the executor and the intent classifier. */
export type NavExecutorClockFn = () => number;

/** Called once when a commit rAF reaches its target. The Cycle 5b1
 *  orchestrator registers a callback here to dispatch the SvelteKit
 *  navigation on a commit (or to land on FROM on a cancel). The callback
 *  receives the plan's `progressDirection` (0 = commit, lands on TO;
 *  1 = cancel, snaps back to FROM) so the orchestrator can dispatch
 *  the right post-settle action. */
export type NavExecutorSettleFn = (progressDirection: 0 | 1) => void;

/** Per-commit-frame callback. The executor fires this after each
 *  commit rAF sample so the orchestrator can publish progress to
 *  downstream consumers (the pager store, which the FAB / Header /
 *  fractionalIndex layers read). Without this callback the
 *  orchestrator's publication would freeze during the commit slide
 *  (the live-drag path publishes via the orchestrator's
 *  `#interpretIntent`, but the commit rAF is internal to the
 *  executor). */
export type NavExecutorTickFn = (progress: number, liveOffset: number) => void;

/** Constructor options for `NavExecutor`. */
export interface NavExecutorOptions {
	/** The driver the executor writes through. The 5b1 orchestrator
	 *  supplies a `LiveNavDomDriver`; unit tests use a `MockNavDomDriver`. */
	readonly driver: NavDomDriver;
	/** Optional clock override for deterministic tests. */
	readonly now?: NavExecutorClockFn;
	/** Optional settle callback invoked once when a commit rAF reaches
	 *  its target. The 5b1 orchestrator wires this to dispatch the
	 *  post-commit SvelteKit navigation. */
	readonly onSettle?: NavExecutorSettleFn;
	/** Optional per-frame callback fired after each commit rAF sample
	 *  so the orchestrator can publish progress to its downstream
	 *  consumers during the commit slide. */
	readonly onTick?: NavExecutorTickFn;
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
 *  accepts a caller-supplied clock; the orchestrator passes one shared
 *  clock to both so they share the same time base. */
function defaultNow(): number {
	if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
		return performance.now();
	}
	return Date.now();
}

/** The Layer 5 executor reactive shell. Holds the executor's
 *  `$state<ExecutorState>`. The orchestrator (5b1) drives it through
 *  the boundary methods. */
export class NavExecutor {
	#state = $state<ExecutorState>(initialExecutorState());
	#plan = $state<TransitionPlan | null>(null);
	readonly #driver: NavDomDriver;
	readonly #now: ClockFn;
	readonly #onSettle: NavExecutorSettleFn | null;
	readonly #onTick: NavExecutorTickFn | null;
	#rafId: number | null = null;
	#settled = false;

	constructor(opts: NavExecutorOptions) {
		this.#driver = opts.driver;
		this.#now = opts.now ?? defaultNow;
		this.#onSettle = opts.onSettle ?? null;
		this.#onTick = opts.onTick ?? null;
	}

	/** Reactive read of the executor state record. The orchestrator
	 *  reads `progress` and `commitStart` off this. */
	get state(): ExecutorState {
		return this.#state;
	}

	/** Reactive read of the active plan. Null until `onDragStart`
	 *  supplies one; cleared by `onLand` and by `stop`. */
	get activePlan(): TransitionPlan | null {
		return this.#plan;
	}

	/** Convenience reactive read of the current progress. The
	 *  orchestrator reads this via `#startProgressFromCurrentVisual`. */
	get progress(): number {
		return this.#state.progress;
	}

	/** A gesture starts. Locks the plan and publishes the first live
	 *  frame. The orchestrator's drag-start event calls this with the
	 *  resolved plan and the initial (progress, liveOffset) computed
	 *  from the live intent. */
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
	 *  scheduled. Resets the settle flag so the next settle fires
	 *  exactly once per commit.
	 *
	 *  `durationOverrideMs` (optional): skip the velocity-matched
	 *  solver and use the supplied duration directly. Cycle 5b1's
	 *  orchestrator uses this for tab-click exits so the slide matches
	 *  the non-pilot routes' 200ms CSS duration; gesture commits leave
	 *  it undefined so the velocity-matched solver runs. */
	onCommit(releaseVelocityPxPerMs: number, durationOverrideMs?: number): void {
		if (this.#plan === null) return;
		this.#settled = false;
		const plan = this.#plan;
		// The plan is the authority (§13.5: consumers read the plan, not
		// the DOM/driver). `commitPhysics` was resolved at gesture start
		// from the driver's reduced-motion state; 'snap' is the reduced-
		// motion instant translate.
		const reducedMotion = plan.commitPhysics === 'snap';
		const next = startCommit(this.#state, {
			releaseVelocityPxPerMs,
			plan,
			reducedMotion,
			now: this.#now(),
			durationOverrideMs
		});
		this.#state = next;
		this.#publish();
		// Fire onTick so the orchestrator's publication (pager store,
		// FAB / Header consumers) transitions seamlessly from the live
		// drag phase to the commit phase at the same progress.
		this.#onTick?.(next.progress, next.liveOffset);
		if (next.phase === 'committing') {
			this.#ensureRaf();
		} else {
			// Snap path (reduced motion): the settle fires immediately;
			// the rAF is not needed.
			this.#stopRaf();
			this.#fireSettle(plan.progressDirection);
		}
	}

	/** The drag released below the commit threshold OR detectSwipe's
	 *  rebound-based `reversed` fired (peak minus final >= 25, no
	 *  forward fling). Overrides the plan's `progressDirection` to 1 so
	 *  the commit integrator targets FROM (progress 0, snap back)
	 *  instead of TO (progress 1, commit). The plan was locked at
	 *  gesture-start with the commit intent; the orchestrator's release
	 *  gate (SWIPE_COMMIT + the rebound-based reversed forwarded from
	 *  detectSwipe) decides whether to call `onCommit` (target TO) or
	 *  `onCancel` (target FROM). */
	onCancel(releaseVelocityPxPerMs: number): void {
		if (this.#plan === null) return;
		this.#plan = { ...this.#plan, progressDirection: 1 };
		this.onCommit(releaseVelocityPxPerMs);
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

	/** Schedule the rAF when `shouldScheduleRaf` permits. The SSR gate
	 *  (the `browser` flag from `$app/environment`) and the single-flight
	 *  guard live in that pure helper so they have unit coverage. */
	#ensureRaf(): void {
		if (!shouldScheduleRaf(browser, this.#rafId !== null)) return;
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
	 *  it, fires `onTick` so the orchestrator can re-publish to its
	 *  downstream consumers, and either reschedules or stops. Fires
	 *  the settle callback exactly once when the integrator reaches
	 *  the target. */
	#tick = (): void => {
		this.#rafId = null;
		const plan = this.#plan;
		if (plan === null) return;
		if (this.#state.phase !== 'committing') return;
		const sample = sampleFrame(this.#state, plan, this.#now());
		this.#state = sample.state;
		this.#publish();
		this.#onTick?.(sample.state.progress, sample.state.liveOffset);
		if (sample.done) {
			this.#fireSettle(plan.progressDirection);
		} else {
			this.#ensureRaf();
		}
	};

	/** Fire the settle callback exactly once per commit. The `#settled`
	 *  guard prevents double-firing if a second commit fires while the
	 *  first's microtask settle is still pending; an interrupt also
	 *  clears the rAF without firing settle (the cancel path lands via
	 *  the orchestrator's `onCancel`). */
	#fireSettle(progressDirection: 0 | 1): void {
		if (this.#settled) return;
		this.#settled = true;
		this.#onSettle?.(progressDirection);
	}

	/** Build the visual from the current state and write it through
	 *  the driver. The driver is the only DOM touchpoint; the shell
	 *  does not read the DOM back. */
	#publish(): void {
		const plan = this.#plan;
		if (plan === null) return;
		publishFrame(this.#state, plan, this.#driver);
	}
}
