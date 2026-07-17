// src/lib/utils/nav-dom-driver-live.ts
/**
 * The real `NavDomDriver` for the Layer 5 executor. Implements the
 * `NavDomDriver` interface (`write(NavVisualWrite)` +
 * `prefersReducedMotion()`), proxying the live page-track / FAB /
 * Header element refs and reading
 * `matchMedia('(prefers-reduced-motion: reduce)')`.
 *
 * The driver is the only component that touches the DOM. It does not
 * read the gesture surface's own state back; the executor publishes
 * authoritative `progress` and the driver is write-only
 * (plus the media-query read for the reduced-motion snap, which is not
 * a read of the gesture surface's own state).
 *
 * Testability: the driver takes an injectable `resolveElements`
 * callback (called each `write` so a fresh `bind:this` reference is
 * picked up automatically) and an injectable `matchMedia`. The unit
 * suite drives both with stubs; no real DOM is required. The element
 * type is structural (`DriverElement` with a `style` exposing
 * `setProperty`), so the same driver accepts a real `HTMLElement` in
 * production and a capturing stub in tests.
 *
 * The orchestrator constructs this driver lazily inside
 * `configure()` (the `if (this.#driver === null)` first-call guard)
 * and hands it to the `NavExecutor`, which writes through it every
 * frame. Under `bun:test` the reactive shell (`nav-executor.svelte.ts`)
 * is not constructed (it uses `$state`); the pure-logic half
 * (`nav-executor-logic.ts`) is exercised with a `MockNavDomDriver`.
 */

import type { NavDomDriver, NavVisualWrite } from './nav-dom-driver';

/** The structural subset of `CSSStyleDeclaration` the driver writes.
 *  Every write goes through `setProperty` so the test stub is a
 *  single-method capture (no need to intercept direct named-property
 *  writes). `HTMLElement` satisfies this structurally in production;
 *  the test stub satisfies it with a capturing class. */
export interface DriverElementStyle {
	setProperty(key: string, value: string): void;
}

/** The structural subset of an element the driver holds. Mirrors the
 *  LexicalEditor structural-type pattern (project note in `CLAUDE.md`)
 *  so a real DOM element and a capturing test stub both satisfy the
 *  interface. */
export interface DriverElement {
	readonly style: DriverElementStyle;
}

/** The element refs the driver writes to. Each field may be null when
 *  the corresponding element is not bound yet (e.g. a Header that has
 *  not mounted); the driver skips null fields without throwing. */
export interface LiveDriverElements {
	readonly pageTrack: DriverElement | null;
	readonly fab: DriverElement | null;
	readonly header: DriverElement | null;
}

/** Resolver called each `write`. Returning a fresh record per call
 *  lets the driver pick up a re-bound `bind:this` reference (a
 *  re-mount, a tab swap) automatically, with no `setElements` API
 *  surface. */
export type LiveDriverElementResolver = () => LiveDriverElements;

/** The result of `matchMedia(query)`. The structural subset the
 *  driver reads. */
export interface LiveDriverMatchMediaResult {
	readonly matches: boolean;
}

/** The media-query function. The default wraps
 *  `window.matchMedia`; tests inject a stub. */
export type LiveDriverMatchMedia = (query: string) => LiveDriverMatchMediaResult;

/** Constructor options for `LiveNavDomDriver`. */
export interface LiveNavDomDriverOptions {
	/** Callback that returns the current element refs. Called once per
	 *  `write` so a re-bound reference is picked up automatically. */
	readonly resolveElements: LiveDriverElementResolver;
	/** Optional `matchMedia` override. The default wraps
	 *  `window.matchMedia` and returns `{ matches: false }` when
	 *  `window` is undefined (SSR). */
	readonly matchMedia?: LiveDriverMatchMedia;
}

/** The reduced-motion media query the executor reads at commit start
 *  to select the snap path. Constant so the test suite can assert the
 *  exact query string passed to `matchMedia`. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Default `matchMedia`. Wraps `window.matchMedia`; returns
 *  `{ matches: false }` when `window` or `window.matchMedia` is
 *  undefined (SSR, or a non-browser runtime). This path is exercised
 *  by the unit suite because the bun runtime does not define
 *  `window`. */
function defaultMatchMedia(query: string): LiveDriverMatchMediaResult {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
		return { matches: false };
	}
	return window.matchMedia(query);
}

/** The live `NavDomDriver`. Applies a `NavVisualWrite` to the resolved
 *  page-track / FAB / Header elements each frame and reads the
 *  reduced-motion media query.
 *
 *  The orchestrator constructs this driver and hands it to the
 *  executor, which writes through it every frame. */
export class LiveNavDomDriver implements NavDomDriver {
	readonly #resolveElements: LiveDriverElementResolver;
	readonly #matchMedia: LiveDriverMatchMedia;

	constructor(opts: LiveNavDomDriverOptions) {
		this.#resolveElements = opts.resolveElements;
		this.#matchMedia = opts.matchMedia ?? defaultMatchMedia;
	}

	write(visual: NavVisualWrite): void {
		const els = this.#resolveElements();
		const pageTrack = els.pageTrack;
		if (pageTrack) {
			// Sign and magnitude come from the executor's `buildVisual`:
			// axis='left' -> negative translateX; axis='right' -> positive.
			// The driver applies the value as given; it does not recompute
			// the sign.
			pageTrack.style.setProperty('transform', `translateX(${visual.pageTrack.translateX}px)`);
		}
		const fab = els.fab;
		if (fab && visual.fab) {
			const f = visual.fab;
			fab.style.setProperty('transform', `scale(${f.scale}) translateY(${f.translateY}px)`);
			fab.style.setProperty('visibility', f.visible ? 'visible' : 'hidden');
		}
		const header = els.header;
		if (header && visual.header) {
			const h = visual.header;
			header.style.setProperty('transform', `translateY(${h.translateY}px)`);
			// CSS custom properties for a Header consumer that reads them
			// via `var(--header-morph)` / `var(--header-title-crossfade)`.
			// The pipeline host passes `header: null` in resolveElements AND the
			// pipeline host's plan omits the `header` fn (so `visual.header` is
			// undefined); either condition skips this block. A consumer
			// that binds a header element AND supplies a plan `header` fn
			// receives these writes.
			header.style.setProperty('--header-morph', String(h.morph));
			header.style.setProperty('--header-title-crossfade', String(h.titleCrossfade));
		}
	}

	prefersReducedMotion(): boolean {
		return this.#matchMedia(REDUCED_MOTION_QUERY).matches;
	}
}
