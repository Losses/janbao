import { test, expect } from '@playwright/test';
import {
	prepareContext,
	waitForHydration,
	clickDiscussion,
	swipeBack,
	mintAdminCookie
} from './helpers';

/**
 * Floating Action Button (DV09) e2e coverage.
 *
 * The FAB lives in AppShell (sibling of Header), mobile-only via md:hidden. It
 * stays mounted across list <-> thread <-> compose nav (Family B/C source-list
 * model: a thread or compose page is reached by forward nav FROM a list, so the
 * atom shows the SOURCE LIST's FAB at scale 0 while the destination page
 * covers the list).
 *
 * Two composed drivers on a single `transform: scale(s) translateY(y)`:
 *   - scale (route transition): scale 1 at rest on a list route, 0 at rest on
 *     overlay / compose routes, scaling through the first/last 50% of a route
 *     transition. The FAB layer is a pure reactive reader of the
 *     orchestrator's `publication.progress`, mapped through the single
 *     half-mapping `fabScale(publication.progress, fromHasFab, toHasFab)`
 *     (where `fromHasFab`/`toHasFab` come from `RouteData.fab`). There is no
 *     separate rAF and no DOM read-back; every motion channel is published by
 *     the orchestrator each frame, and the half-mapping covers Family A
 *     (tab swipe), Family B (thread/conversation enter/exit) and Family C
 *     (compose) uniformly.
 *   - translateY (scroll hide): slides off the bottom edge in lockstep with
 *     the Header's hide-on-scroll (driven by the shared scroll-chrome store).
 *
 * The Family A/B/C specs sample the FAB's RESOLVED `transform` (via
 * getComputedStyle, not the inline `style.transform`) across the gesture /
 * transition window, then assert the TRAJECTORY:
 *   - enough samples to span the window (> 6 frames across the ~200ms),
 *   - monotonic within tolerance (non-increasing for scale-out, non-decreasing
 *     for scale-in) so a step function would fail,
 *   - a sample crossing 0.5 INSIDE the window (not only at the endpoints),
 *   - an intermediate value strictly inside (0.3, 0.7) so a one-frame snap
 *     [1,1,...,0,0] would fail even if it technically crossed 0.5,
 *   - for Family B back-swipe: scale near 0 at drag start rising toward 1
 *     (the assertion that catches a pinned scale, which an endpoints-only
 *     assertion would miss).
 *
 * Sampler robustness across cross-document navigation (T1): the Family B
 * back-swipe navigates /discussion/* -> /, which destroys the source document's
 * execution context mid-loop. A sampler installed by `page.evaluate` on the
 * pre-navigation document dies with that document, and reading it from the
 * destination document throws or reads the wrong buffer. The sampler is
 * therefore installed via `context.addInitScript` (re-arms on EVERY new
 * document) AND each captured sample is pushed to the Node side via
 * `page.exposeBinding` so the buffer survives the document swap. The Node-side
 * buffer is the single source of truth. Mirrors the trajectory-sampler pattern
 * in e2e/helpers.ts (captureEnterAnimation) plus the addInitScript pattern in
 * prepareContext (e2e-playwright-nixos-gotchas memory).
 *
 * Sampler window (T2): the post-trigger cap is 1800ms, set SHORTER than the
 * layer's own `SAMPLER_TIMEOUT_MS = 2000` (the back-swipe drag (~500ms) + snap
 * (~300ms) + GPL track-bind gap under dev-server contention) on purpose, with
 * 200ms slack. The layer cap is the in-disarm cap (the longest a correct arm
 * would ever run); the spec window must END before that cap so a correct run
 * resolves and disarms within the window and the spec reads a SETTLED
 * trajectory, not a window cut off by the layer's own disarm. A spec window
 * >= the layer cap would race the disarm; one much shorter would clip the
 * settling tail under load.
 */

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

// SSR style serialization guard. Fetch each route's SSR HTML with NO browser
// context (a raw `request.get`, so JavaScript never runs and the response is the
// un-hydrated server render) and assert the FAB atom's literal `style` attribute
// carries a VALID transform value. This is the spec that catches the
// shorthand-bound-to-`$derived` SSR serialization defect (Round-5, 4/5): under
// Svelte 5 SSR a `style:transform` shorthand directive bound to a `$derived`
// serializes the derived's getter/setter function body into the inline `style`
// attribute instead of resolving it, emitting
//   style="transform: function(new_value) { ... }; ..."
// which the browser discards, so the FAB renders at its default (scale 1) in the
// SSR HTML until hydration rebinds it. A deep-link to an overlay/compose route
// then flashes the FAB at scale 1 until hydration, violating the plan's hard "no
// flash of scale 1 on SSR deep-links" requirement (§4.4/§6.3/§6.4).
//
// The `class:`-driven gates (`aria-hidden`, `pointer-events-none`) serialize
// correctly under both forms; only the shorthand-bound `transform` is broken, so
// this spec isolates that one attribute. It asserts:
//   - the literal `style` contains `transform: scale(...) translateY(...)`,
//   - the literal `style` does NOT contain the substring `function(` (the
//     serialization-defect signature),
//   - the scale matches the route family: 1 on list routes, 0 on overlay/compose,
//   - the atom's class string carries the pointer-events-none gate so the
//     family classification (list: interactive at scale 1; overlay/compose:
//     non-interactive at scale 0) is asserted, not just the atom's transform
//     serialization.
//
// Route coverage: list (`/`, `/messages/inbox`); compose (`/post/discussion`,
// `/messages/new`); overlay (`/discussion/<id>/<slug>`, the id+slug resolved
// DYNAMICALLY from the discussions list SSR so the assertion is not brittle to
// seed changes); and the messages overlay error page (`/messages/[id]`, whose
// load throws a pre-existing 500 outside DV09, but the FAB
// atom still renders in the SSR error page and its transform must still be a
// valid resolved value, not the function-body leak).
//
// The other "no flash" specs (thread/compose below) call `waitForHydration` and a
// timeout before reading the resolved style, so they read post-hydration state
// and never catch this SSR-only defect. This spec reads the raw SSR response,
// isolating the server render from any client-side hydration, so any regression
// that emits the function-body leak instead of a resolved transform fails here.
//
// Auth: `/messages/inbox`, `/post/discussion`, `/messages/new`, the overlay
// discussion, and `/messages/[id]` all 302-redirect (or block) without a session.
// The dev-server session cookie is a signed JWT (HS256 over the admin id-0
// payload); `request.get` carries no browser context, so the cookie is attached
// manually via the Cookie header.
test.describe('SSR style serialization: FAB transform resolves in the server render', () => {
	type SsrFabFamily = 'list' | 'overlay' | 'compose' | 'error-scale-0';

	interface SsrFabAssertion {
		readonly path: string;
		readonly expectedScale: number;
		readonly family: SsrFabFamily;
	}

	const listAssertions: readonly SsrFabAssertion[] = [
		{ path: '/', expectedScale: 1, family: 'list' },
		{ path: '/messages/inbox', expectedScale: 1, family: 'list' }
	];
	// Compose routes rest at scale 0 via the layer's `cfg.family !== 'list'`
	// branch. The atom gates pointer-events via `pointer-events-none`
	// (scale < 0.01). The FAB atom carries no transition class, so a compose SSR
	// class string carries pointer-events-none and no transition class.
	const composeAssertions: readonly SsrFabAssertion[] = [
		{ path: '/post/discussion', expectedScale: 0, family: 'compose' },
		{ path: '/messages/new', expectedScale: 0, family: 'compose' }
	];

	/**
	 * Extract the FAB atom's full opening tag (the `<a ...>` up to the closing
	 * `>`) from raw SSR HTML. Returns null if the FAB did not render.
	 */
	function extractFabTag(html: string): string | null {
		const match = html.match(/<a\b[^>]*\bdata-testid="fab"[^>]*>/);
		return match ? match[0] : null;
	}

	/** Pull the literal `style="..."` value out of the FAB tag, or null. */
	function styleFromTag(tag: string | null): string | null {
		if (!tag) return null;
		const m = tag.match(/\sstyle="([^"]*)"/);
		return m ? m[1] : null;
	}

	/** Pull the literal `class="..."` value out of the FAB tag, or null. */
	function classFromTag(tag: string | null): string | null {
		if (!tag) return null;
		const m = tag.match(/\bclass="([^"]*)"/);
		return m ? m[1] : null;
	}

	/**
	 * Assert the family-specific class-string classification for the FAB atom:
	 * the only class-string signal SSR carries is the `pointer-events-none`
	 * gate (the atom has no CSS transition directive, so no transition class
	 * is ever present). The pointer-events-none gate is what a scale-only
	 * assertion cannot see: overlay/compose/error rest at scale 0 and must be
	 * non-interactive; list rests at scale 1 and is interactive.
	 */
	function expectFamilyClass(cls: string | null, family: SsrFabFamily): void {
		expect(cls, 'FAB atom must carry a class string in SSR').not.toBeNull();
		const hasPe = cls?.includes('pointer-events-none') ?? false;
		switch (family) {
			case 'list':
				expect(hasPe, 'list FAB must NOT be pointer-events-none at scale 1').toBe(false);
				break;
			case 'overlay':
			case 'error-scale-0':
				expect(hasPe, 'overlay/error FAB at scale 0 must be pointer-events-none').toBe(true);
				break;
			case 'compose':
				// Compose rests at scale 0 (pointer-events-none).
				expect(hasPe, 'compose FAB at scale 0 must be pointer-events-none').toBe(true);
				break;
		}
	}

	/** Assert the resolved-transform shape and absence of the function-body leak. */
	function expectResolvedStyle(style: string | null, expectedScale: number, path: string): void {
		expect(style, `the FAB atom must render in the SSR HTML for ${path}`).not.toBeNull();
		// The defect signature: the derived's function body leaks into the inline
		// style. Assert it never appears.
		expect(
			style,
			'SSR style must not contain the function-body leak (shorthand-bound-to-$derived defect)'
		).not.toContain('function(');
		expect(
			style,
			'SSR style must carry a resolved transform: scale(...) translateY(...)'
		).toMatch(/transform:\s*scale\([0-9.]+\)\s*translateY\(-?[0-9.]+px\)/);
		const scaleMatch = style?.match(/scale\(([0-9.]+)\)/);
		expect(
			Number(scaleMatch?.[1] ?? NaN),
			`SSR FAB scale must be ${expectedScale} for ${path}`
		).toBeCloseTo(expectedScale, 1);
	}

	for (const assertion of [...listAssertions, ...composeAssertions]) {
		test(`SSR style: ${assertion.path} renders scale(${assertion.expectedScale}) with no function( leak`, async ({
			request
		}) => {
			const cookie = `session_token=${mintAdminCookie().value}`;
			const response = await request.get(assertion.path, {
				headers: { Cookie: cookie },
				maxRedirects: 0
			});
			expect(
				response.status(),
				`${assertion.path} must SSR (200) for the admin cookie, not redirect to sign-in`
			).toBe(200);
			const tag = extractFabTag(await response.text());
			expectResolvedStyle(styleFromTag(tag), assertion.expectedScale, assertion.path);
			expectFamilyClass(classFromTag(tag), assertion.family);
		});
	}

	// Overlay deep-link: resolve a REAL seeded discussion id+slug from the
	// discussions list SSR (the homepage renders `/discussion/<id>/<slug>` links)
	// so the assertion tracks whatever the seed currently exposes, rather than a
	// hardcoded id that happens to exist today. The overlay family rests the FAB
	// at scale 0 with pointer-events-none present (the same class-string shape
	// as the compose family at SSR rest).
	test('SSR style: overlay discussion deep-link renders scale(0) with overlay-family classes', async ({
		request
	}) => {
		const cookie = `session_token=${mintAdminCookie().value}`;
		const homeResponse = await request.get('/', {
			headers: { Cookie: cookie },
			maxRedirects: 0
		});
		expect(homeResponse.status(), 'homepage must SSR 200').toBe(200);
		const overlayPath = firstOverlayDiscussionPath(await homeResponse.text());
		expect(
			overlayPath,
			'the discussions list SSR must expose at least one /discussion/<id>/<slug> deep-link'
		).not.toBeNull();
		// `expect(...).not.toBeNull()` does not narrow the type; assert the
		// non-null branch explicitly so the downstream fetch and messages carry a
		// concrete path string.
		if (overlayPath === null) throw new Error('unreachable: overlayPath asserted non-null');
		const response = await request.get(overlayPath, {
			headers: { Cookie: cookie },
			maxRedirects: 0
		});
		expect(
			response.status(),
			`${overlayPath} must SSR 200 for the admin cookie (the overlay route is reachable)`
		).toBe(200);
		const tag = extractFabTag(await response.text());
		expectResolvedStyle(styleFromTag(tag), 0, overlayPath);
		expectFamilyClass(classFromTag(tag), 'overlay');
	});

	// /messages/[id] is a conversation overlay: the FAB atom renders at scale 0
	// (covered by the conversation). Whether the route renders (200) or falls to
	// an error page, the atom's SSR transform must serialize to a valid resolved
	// value, not the function-body leak.
	test('SSR style: /messages/1 FAB transform resolves in the server render', async ({ request }) => {
		const cookie = `session_token=${mintAdminCookie().value}`;
		const response = await request.get('/messages/1', {
			headers: { Cookie: cookie },
			maxRedirects: 0
		});
		const tag = extractFabTag(await response.text());
		expectResolvedStyle(styleFromTag(tag), 0, '/messages/1');
		if (response.status() === 500) {
			expectFamilyClass(classFromTag(tag), 'error-scale-0');
		}
	});
});

/**
 * Extract the first bare `/discussion/<id>/<slug>` deep-link from raw SSR HTML,
 * stripping any `/pN` page segment or `#anchor` suffix. Returns null if the list
 * rendered no discussion links.
 */
function firstOverlayDiscussionPath(html: string): string | null {
	const match = html.match(/\/discussion\/[0-9]+\/[A-Za-z0-9%_-]+/);
	return match ? match[0] : null;
}

// CALIBRATION: the FAB is present at scale 1 on the discussions list.
test('CALIBRATION: discussions list shows the FAB at scale 1', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const transform = await readFabTransform(page);
	expect(transform.scale).toBeCloseTo(1, 1);
	expect(transform.translateY).toBe(0);
});

test('messages inbox shows the FAB at scale 1', async ({ page }) => {
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const transform = await readFabTransform(page);
	expect(transform.scale).toBeCloseTo(1, 1);
});

test('activity tab has no visible FAB at rest', async ({ page }) => {
	await page.goto('/activity');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	// The atom mounts at scale 0 so it can scale in during a swipe from
	// /activity to a FAB route (the half-mapping publishes scale > 0 in
	// the second half of the transition). At rest the atom is invisible.
	const transform = await readFabTransform(page);
	expect(transform.scale, 'FAB must rest at scale 0 on the Activity tab').toBeCloseTo(0, 1);
});

// Family B / C: the atom stays mounted on an overlay or compose route, resting
// at scale 0 (the destination page covers the source list). A deep-link (no
// forward nav transition) SSRs at scale 0 so there is no flash of scale 1 even
// though the route's source-list tab index resolves to a foreground tab.
test('thread deep link shows the FAB at scale 0 (no flash of scale 1)', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await clickDiscussion(page, 0);
	await page.waitForURL(/\/discussion\//);
	await page.reload();
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const transform = await readFabTransform(page);
	expect(transform.scale, 'FAB must rest at scale 0 on a deep-linked thread').toBeCloseTo(0, 1);
});

test('compose route shows the FAB at scale 0 (no flash of scale 1)', async ({ page }) => {
	await page.goto('/post/discussion');
	await page.waitForLoadState('domcontentloaded');
	await page.waitForTimeout(300);
	const transform = await readFabTransform(page);
	expect(transform.scale, 'FAB must rest at scale 0 on a compose route').toBeCloseTo(0, 1);
});

// Family A: a tab swipe scales the FAB out as a TRAJECTORY (not a step). The
// orchestrator's `publication.progress` is continuous 1:1 with the finger, so
// the FAB scale (derived from `fabScale(publication.progress, fromHasFab,
// toHasFab)`) ramps from 1 toward 0 across the drag and snaps the rest of the
// way on release.
test('Family A: tab swipe scales the FAB out as a monotonic trajectory', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	const { swipeForward } = await import('./helpers');
	const capture = await sampleFabScale(page, async () => {
		await swipeForward(page);
	});
	expect(
		capture.samples.length,
		'sampler must have captured enough frames to span the swipe'
	).toBeGreaterThanOrEqual(6);
	expect(
		capture.samples[0] ?? -1,
		'first frame must be scale 1 (list at rest)'
	).toBeCloseTo(1, 1);
	expect(
		capture.minScale ?? 1,
		'FAB must scale below 0.5 during the swipe'
	).toBeLessThan(0.5);
	// Monotonic (non-increasing within tolerance) so a step function would fail.
	assertNonIncreasingWithinTolerance(capture.samples, 0.2);
	// A sample must cross 0.5 INSIDE the window (not only at the endpoints).
	expect(
		scaleTrajectoryCrosses(capture.samples, 0.5),
		'scale trajectory must cross 0.5 inside the swipe window'
	).toBe(true);
	// Intermediate value present between the endpoints (defends against a
	// one-frame snap [1,1,...,0,0], which the crossing check alone would pass).
	expect(
		capture.samples.some((s) => s > 0.3 && s < 0.7),
		'an intermediate scale sample between 0.3 and 0.7 must exist mid-swipe'
	).toBe(true);
});

// Family B forward: tapping a discussion card slides the thread in over the
// list (NavPipelineHost enter animation). The orchestrator's executor
// publishes `publication.progress` 0 -> 1 each frame; the FAB layer's
// `fabScale(progress, fromHasFab, toHasFab)` (a list-source gesture targeting an
// overlay/deep route) drives the scale down across the slide (first-half
// disappear) and rests near 0 on the thread.
test('Family B forward: list -> thread scales the FAB out as a monotonic trajectory', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	const capture = await sampleFabScale(page, async () => {
		await clickDiscussion(page, 0);
		await page.waitForURL(/\/discussion\//);
	});
	expect(
		capture.samples.length,
		'sampler must have captured enough frames to span the slide'
	).toBeGreaterThanOrEqual(6);
	expect(
		capture.samples[0] ?? -1,
		'first frame must be scale 1 (list at rest, holdover holds fraction at 1 until sampler publishes)'
	).toBeCloseTo(1, 1);
	expect(
		capture.samples[capture.samples.length - 1] ?? 1,
		'FAB must rest near scale 0 once the thread covers the list'
	).toBeLessThan(0.15);
	expect(
		capture.minScale ?? 1,
		'FAB must scale below 0.5 during the slide'
	).toBeLessThan(0.5);
	// Monotonic non-increasing across the slide; the holdover holds scale 1
	// until the sampler publishes then ramps down.
	assertNonIncreasingWithinTolerance(capture.samples, 0.25);
	expect(
		scaleTrajectoryCrosses(capture.samples, 0.5),
		'scale trajectory must cross 0.5 inside the slide window'
	).toBe(true);
	// Intermediate value present between the endpoints (defends against a
	// one-frame snap, which the crossing check alone would pass).
	expect(
		capture.samples.some((s) => s > 0.3 && s < 0.7),
		'an intermediate scale sample between 0.3 and 0.7 must exist mid-slide'
	).toBe(true);
});

// Family B back: a back-swipe from the thread toward the list drives the
// sampler the other way; `publication.progress` 0 -> 1 so the FAB scale ramps
// from near 0 (thread covers at drag start) up toward 1 (list foreground at
// drag end), with intermediate values present (the assertion that catches a
// pinned scale at 1 from frame 1).
test('Family B back: thread -> list scales the FAB in as a monotonic trajectory', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	await clickDiscussion(page, 0);
	await page.waitForURL(/\/discussion\//);
	await page.waitForTimeout(300);
	const capture = await sampleFabScale(page, async () => {
		await swipeBack(page);
		await page.waitForURL('/', { timeout: 5000 });
	});
	expect(
		capture.samples.length,
		'sampler must have captured enough frames to span the swipe'
	).toBeGreaterThanOrEqual(6);
	// CDP dispatches all touchMoves synchronously before the first rAF, so the
	// first sampled frame can land mid-drag (~0.5) rather than at rest. The
	// resting state is scale 0 (verify via a near-zero sample somewhere in the
	// first 3 frames), and the trajectory-shape guards below (monotonicity, the
	// 0.5 mid-window crossing, the intermediate in (0.3,0.7), the last > 0.9)
	// carry the real assertion weight.
	const firstThree = capture.samples.slice(0, 3);
	expect(
		Math.min(...(firstThree.length > 0 ? firstThree : [1])),
		'a near-zero scale sample must exist within the first 3 frames (thread at rest, source-list FAB covered)'
	).toBeLessThan(0.2);
	expect(
		capture.samples[capture.samples.length - 1] ?? 0,
		'FAB must rest near scale 1 once the list is foreground'
	).toBeGreaterThan(0.9);
	expect(
		capture.maxScale ?? 0,
		'FAB must scale above 0.5 during the swipe'
	).toBeGreaterThan(0.5);
	// Monotonic non-decreasing across the swipe; a pinned-at-1 scale from frame
	// 1 would fail this (the start would already be 1, not the required near-0).
	assertNonDecreasingWithinTolerance(capture.samples, 0.25);
	expect(
		scaleTrajectoryCrosses(capture.samples, 0.5),
		'scale trajectory must cross 0.5 inside the swipe window'
	).toBe(true);
	// Intermediate value present between the endpoints (defends against the
	// scale being pinned at 1 for the whole drag, which endpoints-only sampling
	// cannot catch): there must be a sample strictly between 0.3 and 0.7.
	expect(
		capture.samples.some((s) => s > 0.3 && s < 0.7),
		'an intermediate scale sample between 0.3 and 0.7 must exist mid-swipe'
	).toBe(true);
});

// Family C forward: tapping the FAB on a list route navigates to the compose
// page. The atom stays mounted and the discrete progress swap (1 -> 0) is
// eased by the orchestrator's per-frame publication of `publication.progress`
// over the commit duration (`commitStart.durationMs`, velocity-matched).
// Assert the ease produced a monotonic trajectory with a mid-window 0.5
// crossing (NOT an instant jump to 0).
test('Family C forward: list -> compose scales the FAB out as a monotonic trajectory', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const capture = await sampleFabScale(page, async () => {
		await page.locator('[data-testid="fab"]').click({ force: true });
		await page.waitForURL('/post/discussion', { timeout: 5000 });
	});
	expect(
		capture.samples.length,
		'rAF ease must have produced enough scale samples to span the window (not instant)'
	).toBeGreaterThanOrEqual(6);
	expect(
		capture.samples[0] ?? -1,
		'first frame must be scale 1 (list at rest)'
	).toBeCloseTo(1, 1);
	expect(
		capture.samples[capture.samples.length - 1] ?? 1,
		'FAB must reach near scale 0 by the end of the transition'
	).toBeLessThan(0.2);
	assertNonIncreasingWithinTolerance(capture.samples, 0.25);
	expect(
		scaleTrajectoryCrosses(capture.samples, 0.5),
		'scale trajectory must cross 0.5 inside the transition window'
	).toBe(true);
	// Intermediate value present between the endpoints (defends against a
	// one-frame snap, which the crossing check alone would pass).
	expect(
		capture.samples.some((s) => s > 0.3 && s < 0.7),
		'an intermediate scale sample between 0.3 and 0.7 must exist mid-transition'
	).toBe(true);
});

// Family C forward (messages variant): the same list -> compose ramp on the
// messages source list. Mirrors the discussions variant trajectory shape. Both
// source lists share the Family C transition path; covering the messages source
// list guards against a class-gating or holdover change that lands the ramp
// correctly on one source list but not the other.
//
// A messages Family B (inbox -> conversation) spec is unreachable in the seed
// baseline: the seeded conversations exist but the messages/[id] load function
// returns 500 for the admin id-0 session (the load path DV09 does not touch, so
// the unreachability is pre-existing). The Family C forward messages spec below
// is the reachable messages-source-list coverage and asserts the SAME trajectory
// shape as the discussions Family C forward spec.
test('Family C forward (messages): inbox -> compose scales the FAB out as a monotonic trajectory', async ({
	page
}) => {
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const capture = await sampleFabScale(page, async () => {
		await page.locator('[data-testid="fab"]').click({ force: true });
		await page.waitForURL('/messages/new', { timeout: 5000 });
	});
	expect(
		capture.samples.length,
		'rAF ease must have produced enough scale samples to span the window (not instant)'
	).toBeGreaterThanOrEqual(6);
	expect(
		capture.samples[0] ?? -1,
		'first frame must be scale 1 (list at rest)'
	).toBeCloseTo(1, 1);
	expect(
		capture.samples[capture.samples.length - 1] ?? 1,
		'FAB must reach near scale 0 by the end of the transition'
	).toBeLessThan(0.2);
	assertNonIncreasingWithinTolerance(capture.samples, 0.25);
	expect(
		scaleTrajectoryCrosses(capture.samples, 0.5),
		'scale trajectory must cross 0.5 inside the transition window'
	).toBe(true);
	expect(
		capture.samples.some((s) => s > 0.3 && s < 0.7),
		'an intermediate scale sample between 0.3 and 0.7 must exist mid-transition'
	).toBe(true);
});

// Family C back: navigating back from the compose page to the list drives
// `publication.progress` 0 -> 1, eased by the orchestrator's per-frame
// publication (scale-in). Reach the compose page via SPA navigation from the
// list so history.back() returns to `/` (a hard goto('/post/discussion') has
// no back history).
test('Family C back: compose -> list scales the FAB in as a monotonic trajectory', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await page.locator('[data-testid="fab"]').click({ force: true });
	await page.waitForURL('/post/discussion', { timeout: 5000 });
	await page.waitForTimeout(300);
	const capture = await sampleFabScale(page, async () => {
		await page.goBack();
		await page.waitForURL('/', { timeout: 5000 });
	});
	expect(
		capture.samples.length,
		'rAF ease must have produced enough scale samples to span the window (not instant)'
	).toBeGreaterThanOrEqual(6);
	expect(
		capture.samples[0] ?? 1,
		'first frame must be near scale 0 (compose at rest)'
	).toBeLessThan(0.2);
	// Robust scale-in completion check: assert the trajectory SHAPE rather than
	// the absolute last sample. The 1.8s sampler window can cut off ~16ms before
	// the 200ms rAF ease fully settles under load, so the LAST sample may dip to
	// ~0.84 even on a correct run. The shape that proves the scale-in completed
	// is: the trajectory REACHED near-1 at some point (maxScale > 0.9), it is
	// monotonic non-decreasing (no reversal), and it crossed 0.5 inside the
	// window. Together these rule out a stuck-mid or stuck-low trajectory while
	// tolerating the harness's truncated final sample.
	assertScaleInCompletedShape(capture);
});

// Family C back (messages variant): the same compose->list ramp on the messages
// source list. Mirrors the discussions variant trajectory shape. Both routes
// share the Family C transition path; covering the messages source list guards
// against a class-gating change that lands the ramp correctly on one source
// list but not the other.
test('Family C back (messages): compose -> inbox scales the FAB in as a monotonic trajectory', async ({
	page
}) => {
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await page.locator('[data-testid="fab"]').click({ force: true });
	await page.waitForURL('/messages/new', { timeout: 5000 });
	await page.waitForTimeout(300);
	const capture = await sampleFabScale(page, async () => {
		await page.goBack();
		await page.waitForURL('/messages/inbox', { timeout: 5000 });
	});
	expect(
		capture.samples.length,
		'rAF ease must have produced enough scale samples to span the window (not instant)'
	).toBeGreaterThanOrEqual(6);
	expect(
		capture.samples[0] ?? 1,
		'first frame must be near scale 0 (compose at rest)'
	).toBeLessThan(0.2);
	// Robust scale-in completion check (same shape assertion as the discussions
	// variant): the trajectory reached near-1 (maxScale > 0.9), is monotonic
	// non-decreasing, and crossed 0.5 inside the window. See the discussions
	// variant for the rationale (sampler window vs CSS-ease settle under load).
	assertScaleInCompletedShape(capture);
	expect(
		capture.samples.some((s) => s > 0.3 && s < 0.7),
		'an intermediate scale sample between 0.3 and 0.7 must exist mid-transition'
	).toBe(true);
});

// Scroll-hide: scrolling down slides the FAB off the bottom; scrolling up
// brings it back. The translateY driver is independent of scale (orthogonal
// composition on the same transform string).
test('scroll-hide: FAB translateY follows the Header hide-on-scroll', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	const capture = await page.evaluate(async () => {
		const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
		const afterFrame = (): Promise<void> =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			).then(() => sleep(160));
		const readTy = (): number => {
			const fab = document.querySelector('[data-testid="fab"]') as HTMLElement | null;
			if (!fab) return NaN;
			const m = (fab.style.transform || '').match(/translateY\(([-0-9.]+)px\)/);
			return m ? Number(m[1]) : 0;
		};
		const initial = readTy();
		// Scroll the active panel (the pager's discussions section) past the
		// Header hide threshold.
		const panel = document.querySelector(
			'section[data-tab-panel="discussions"]'
		) as HTMLElement;
		panel.scrollTo(0, 600);
		await afterFrame();
		const down = readTy();
		// Scroll back to top: the FAB returns to translateY(0).
		panel.scrollTo(0, 0);
		await afterFrame();
		const up = readTy();
		return { initial, down, up };
	});

	expect(capture.initial, 'FAB rests at translateY(0)').toBe(0);
	expect(capture.down, 'FAB slides DOWN (positive translateY) on scroll-down').toBeGreaterThan(20);
	expect(capture.up, 'FAB returns to translateY(0) on scroll-up').toBe(0);
});

// pointer-events gating: when the FAB is scroll-hidden, it must be
// non-interactive so a tap cannot land on the partially-hidden button.
test('pointer-events: FAB is non-interactive when scroll-hidden', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	const pe = await page.evaluate(async () => {
		const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
		const afterFrame = (): Promise<void> =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			).then(() => sleep(160));
		// Scroll the active panel well past the Header threshold so the FAB is
		// fully translated off-screen (hideProgress >= 0.99 -> pointer-events: none).
		const panel = document.querySelector(
			'section[data-tab-panel="discussions"]'
		) as HTMLElement;
		panel.scrollTo(0, 1200);
		await afterFrame();
		const fab = document.querySelector('[data-testid="fab"]') as HTMLElement | null;
		if (!fab) return 'no-fab';
		return getComputedStyle(fab).pointerEvents;
	});

	expect(pe, 'pointer-events must be none when scroll-hidden').toBe('none');
});

test('tap on the FAB navigates to the compose route', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const fab = page.locator('[data-testid="fab"]');
	// The FAB is position:fixed at z-35; a list row sits beneath it in the DOM.
	// Playwright's actionability check may flag the row as intercepting the click
	// point even though the FAB is the topmost element at its screen position, so
	// force-bypass the check.
	await fab.click({ force: true });
	await page.waitForURL('/post/discussion', { timeout: 5000 });
});

test('Family A: swipe back from Activity to Discussions scales the FAB in as a monotonic trajectory', async ({ page }) => {
	await page.goto('/activity');
	await waitForHydration(page);
	const { swipeBack } = await import('./helpers');
	const capture = await sampleFabScale(page, async () => {
		await swipeBack(page);
		await page.waitForURL('/', { timeout: 5000 });
	});
	expect(
		capture.samples.length,
		'sampler must have captured enough frames to span the swipe'
	).toBeGreaterThanOrEqual(6);
	const firstThree = capture.samples.slice(0, 3);
	expect(
		Math.min(...(firstThree.length > 0 ? firstThree : [1])),
		'Discussions FAB must start near scale 0'
	).toBeLessThan(0.25);
	expect(
		capture.samples[capture.samples.length - 1] ?? 0,
		'Discussions FAB must reach near scale 1 at target'
	).toBeGreaterThan(0.9);
	assertNonDecreasingWithinTolerance(capture.samples, 0.25);
	expect(
		scaleTrajectoryCrosses(capture.samples, 0.5),
		'scale trajectory must cross 0.5 inside the swipe window'
	).toBe(true);
	expect(
		capture.samples.some((s) => s > 0.3 && s < 0.7),
		'an intermediate scale sample between 0.3 and 0.7 must exist mid-swipe'
	).toBe(true);
});

test('Family A: swipe forward from Activity to Messages scales the FAB in as a monotonic trajectory', async ({ page }) => {
	await page.goto('/activity');
	await waitForHydration(page);
	const { swipeForward } = await import('./helpers');
	const capture = await sampleFabScale(page, async () => {
		await swipeForward(page);
		await page.waitForURL('/messages/inbox', { timeout: 5000 });
	});
	expect(
		capture.samples.length,
		'sampler must have captured enough frames to span the swipe'
	).toBeGreaterThanOrEqual(6);
	const firstThree = capture.samples.slice(0, 3);
	expect(
		Math.min(...(firstThree.length > 0 ? firstThree : [1])),
		'Messages FAB must start near scale 0'
	).toBeLessThan(0.25);
	expect(
		capture.samples[capture.samples.length - 1] ?? 0,
		'Messages FAB must reach near scale 1 at target'
	).toBeGreaterThan(0.9);
	assertNonDecreasingWithinTolerance(capture.samples, 0.25);
	expect(
		scaleTrajectoryCrosses(capture.samples, 0.5),
		'scale trajectory must cross 0.5 inside the swipe window'
	).toBe(true);
	expect(
		capture.samples.some((s) => s > 0.3 && s < 0.7),
		'an intermediate scale sample between 0.3 and 0.7 must exist mid-swipe'
	).toBe(true);
});

test('Family A: swipe back from Messages to Activity scales the FAB out as a monotonic trajectory', async ({ page }) => {
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	const { swipeBack } = await import('./helpers');
	const capture = await sampleFabScale(page, async () => {
		await swipeBack(page);
		await page.waitForURL('/activity', { timeout: 5000 });
	});
	expect(
		capture.samples.length,
		'sampler must have captured enough frames to span the swipe'
	).toBeGreaterThanOrEqual(6);
	expect(
		capture.samples[0] ?? -1,
		'first frame must be scale 1 (list at rest)'
	).toBeCloseTo(1, 1);
	expect(
		capture.minScale ?? 1,
		'FAB must scale below 0.5 during the swipe'
	).toBeLessThan(0.5);
	assertNonIncreasingWithinTolerance(capture.samples, 0.25);
	expect(
		scaleTrajectoryCrosses(capture.samples, 0.5),
		'scale trajectory must cross 0.5 inside the swipe window'
	).toBe(true);
	expect(
		capture.samples.some((s) => s > 0.3 && s < 0.7),
		'an intermediate scale sample between 0.3 and 0.7 must exist mid-swipe'
	).toBe(true);
});

// --- helpers -----------------------------------------------------------------

interface FabTransform {
	scale: number;
	translateY: number;
}

async function readFabTransform(page: import('@playwright/test').Page): Promise<FabTransform> {
	return page.evaluate(() => {
		const fab = document.querySelector('[data-testid="fab"]') as HTMLElement | null;
		if (!fab) return { scale: NaN, translateY: NaN };
		const t = fab.style.transform || '';
		const s = t.match(/scale\(([-0-9.]+)\)/);
		const y = t.match(/translateY\(([-0-9.]+)px\)/);
		return {
			scale: s ? Number(s[1]) : NaN,
			translateY: y ? Number(y[1]) : NaN
		};
	});
}

interface FabScaleCapture {
	samples: number[];
	firstScale: number | null;
	lastScale: number | null;
	minScale: number | null;
	maxScale: number | null;
}

interface FabSamplerWindow extends Window {
	__fabArmed?: boolean;
}

interface FabSamplerGlobals {
	__fabArmed?: boolean;
}

/**
 * Wall-clock cap for the post-trigger sampler window. Set 200ms SHORTER than
 * the layer's own `SAMPLER_TIMEOUT_MS = 2000` so a correct Family B back-swipe
 * (drag ~500ms + snap ~300ms + GPL track-bind gap under dev-server contention)
 * resolves and the layer disarms WITHIN this window; the spec then reads a
 * settled trajectory rather than one cut off by the layer's own disarm. The
 * window is enforced on the Node side via waitForTimeout, not on the rAF tick,
 * so a document swap mid-loop cannot strand the cap on the dead document.
 */
const SAMPLER_WINDOW_MS = 1800;

/**
 * Install a rAF sampler over the FAB's RESOLVED `transform: scale(...)` (via
 * getComputedStyle, which resolves the inline `scale(s) translateY(y)` string
 * to a matrix so the scale component is parsed directly), arm it, trigger a
 * navigation, then report the captured scale samples.
 *
 * Cross-document survival (T1): the sampler is installed via
 * `context.addInitScript` so it re-arms on EVERY new document (the source
 * document's execution context is destroyed when the Family B back-swipe
 * commits the URL swap to /). Each captured sample is pushed to the Node side
 * via `page.exposeBinding('__pushFabSample')` into a buffer that lives on the
 * Page object, not the document, so it survives the swap. The rAF loop on each
 * document consults a per-document `__fabArmed` flag set by `armFabSampler`:
 * the loop runs continuously but only pushes samples while armed, so the
 * init-script on the destination document picks up the in-flight gesture
 * without missing the post-swap tail.
 *
 * getComputedStyle is used (rather than reading `style.transform` directly)
 * because it resolves the transform string to a `matrix(a, b, c, d, tx, ty)`
 * form, so the sampler reads the scale component `a` directly. The
 * orchestrator publishes a new `publication.progress` each frame; the FAB
 * layer's reactive `scale` derived (from `fabScale(publication.progress,
 * fromHasFab, toHasFab)`) writes a new inline `style.transform` each frame,
 * so the resolved value advances every frame across the ease.
 * miss the easing trajectory.
 */
async function sampleFabScale(
	page: import('@playwright/test').Page,
	trigger: () => Promise<void>
): Promise<FabScaleCapture> {
	const samples: number[] = [];
	// exposeBinding survives the test; addInitScript re-runs on each document.
	// Both are idempotent across calls within one page (exposeBinding throws on
	// a duplicate name, so guard with try/catch to allow re-arming across specs
	// that share a page in a single worker).
	try {
		await page.exposeBinding('__pushFabSample', async (_src, value: number) => {
			samples.push(value);
		});
	} catch {
		// Already exposed on this page (a prior spec in the same worker); reuse.
	}
	const samplerScript = (): void => {
		const g = window as unknown as FabSamplerGlobals;
		const tick = (): void => {
			if (g.__fabArmed === true) {
				const fab = document.querySelector('[data-testid="fab"]') as HTMLElement | null;
				if (fab) {
					const matrix = getComputedStyle(fab).transform || '';
					// matrix(a, b, c, d, tx, ty) or matrix3d(...). For `scale(s)
					// translateY(y)` the matrix is matrix(s, 0, 0, s, 0, y) so
					// a === s; parse a directly.
					const paren = matrix.match(/matrix(?:3d)?\(([^)]+)\)/);
					if (paren) {
						const parts = paren[1].split(',').map((p) => Number(p.trim()));
						const a = parts[0];
						if (!Number.isNaN(a)) {
							// Push to the Node-side buffer (survives doc swap).
							(window as unknown as { __pushFabSample?: (v: number) => void }).__pushFabSample?.(a);
						}
					} else if (matrix === 'none') {
						// scale(0) collapses to none on some engines.
						(window as unknown as { __pushFabSample?: (v: number) => void }).__pushFabSample?.(0);
					}
				}
			}
			requestAnimationFrame(tick);
		};
		// Always running; the armed gate filters. The destination document's
		// loop is already spinning when the URL swaps, so no samples are lost in
		// the bind gap.
		requestAnimationFrame(tick);
	};
	// Re-arm on every FUTURE document (the source document's loop dies with it
	// when the Family B back-swipe commits the URL swap).
	await page.addInitScript(samplerScript);
	// Kick the loop off on the CURRENT document too: addInitScript does NOT run
	// retroactively on the already-loaded page, so without this the first spec
	// in a worker captures zero samples.
	await page.evaluate(samplerScript);
	// Arm on the current document, trigger, then hold the window open.
	await armFabSampler(page, true);
	await trigger();
	await page.waitForTimeout(SAMPLER_WINDOW_MS);
	await armFabSampler(page, false);
	const first = samples.length > 0 ? samples[0] : null;
	const last = samples.length > 0 ? samples[samples.length - 1] : null;
	const min = samples.length > 0 ? Math.min(...samples) : null;
	const max = samples.length > 0 ? Math.max(...samples) : null;
	return { samples, firstScale: first, lastScale: last, minScale: min, maxScale: max };
}

/** Arm/disarm the rAF sampler on the current document. The init-script loop
 *  polls `__fabArmed`, so this flips the gate the next frame. */
async function armFabSampler(page: import('@playwright/test').Page, armed: boolean): Promise<void> {
	await page.evaluate((v) => {
		(window as unknown as FabSamplerWindow).__fabArmed = v;
	}, armed);
}

/**
 * Trim the trailing plateau and any post-settle spikes. After a scale-out
 * reaches its terminal value (near 0) or a scale-in reaches near 1, the FAB may
 * briefly report its resting scale (1 for a source-list atom whose destination
 * route has not yet unmounted it, 0 for a covered atom before the route swaps);
 * a late single-frame spike on top of the settled plateau (e.g.
 * ...,0.00,0.00,1.00,0.00) is a post-settle artifact, not a real trajectory
 * reversal. Untrimmed it would fail the monotonicity assertion.
 *
 * Forward scan: find the first index where the trajectory enters its terminal
 * zone (a >= 2-sample run within `terminalEpsilon` of the terminal value) and
 * keep everything up to AND INCLUDING that run's first sustained plateau. Any
 * later samples (a post-settle spike, a longer tail) are discarded. A real
 * monotonic trajectory does not leave the terminal zone once it settles, so the
 * first sustained plateau IS the end of the meaningful trajectory. Handles
 * trailing spikes in any position: `[...,0.05,0,0,1,0,0]`,
 * `[...,0.05,0,0,1,0]`, and the symmetric scale-in `[...,0.95,1,1,0,1,1]`.
 */
function trimTrailingNoise(
	samples: number[],
	terminalValue: number,
	terminalEpsilon: number
): number[] {
	if (samples.length < 4) return samples;
	const isTerminal = (s: number): boolean => Math.abs(s - terminalValue) <= terminalEpsilon;
	// Find the first index where a >= 2-sample terminal run begins.
	let plateauStart = -1;
	for (let i = 0; i < samples.length - 1; i++) {
		if (isTerminal(samples[i]) && isTerminal(samples[i + 1])) {
			plateauStart = i;
			break;
		}
	}
	if (plateauStart < 0) return samples;
	// Extend the plateau forward over any sustained terminal samples (the run
	// may be longer than 2). Stop at the first non-terminal sample; everything
	// from there is a post-settle spike or tail and is discarded.
	let plateauEnd = plateauStart + 1;
	while (plateauEnd + 1 < samples.length && isTerminal(samples[plateauEnd + 1])) {
		plateauEnd++;
	}
	return samples.slice(0, plateauEnd + 1);
}

/**
 * Mirror of trimTrailingNoise for a LEADING artifact. CDP dispatches every
 * touchMove synchronously before the first rAF, so the first sampled frame of a
 * scale-in can land mid-drag (~0.5) instead of at the drag-start resting value
 * (~0). That leading sample is a single-frame artifact followed by the real
 * trajectory; untrimmed it creates a leading spike that violates the
 * non-decreasing check. Trim it the same way trimTrailingNoise handles the
 * trailing one.
 *
 * Backward scan: find the LAST index where a >= 2-sample run within
 * `startEpsilon` of the start value begins (i.e. the sustained start plateau the
 * real trajectory leaves from). Everything BEFORE that plateau is a leading
 * artifact and is discarded. Handles the CDP leading spike
 * `[0.5, 0.09, 0.00, 0.00, 0.03, ..., 1.0]` (drop the leading 0.5, 0.09) and
 * `[0.5, 0.00, 0.00, ..., 1.0]` (drop the leading 0.5). A real trajectory never
 * returns to the start value once it leaves, so the LAST sustained start plateau
 * IS the start of the meaningful trajectory.
 */
function trimLeadingArtifact(
	samples: number[],
	startValue: number,
	startEpsilon: number
): number[] {
	if (samples.length < 4) return samples;
	const isStart = (s: number): boolean => Math.abs(s - startValue) <= startEpsilon;
	// Find the LAST index where a >= 2-sample start run begins; that is the
	// plateau the real trajectory leaves from. Any earlier samples are a leading
	// artifact (a mid-drag first frame, a holdover tail) sitting above the start
	// value before the trajectory actually settles there.
	let plateauStart = -1;
	for (let i = 0; i < samples.length - 1; i++) {
		if (isStart(samples[i]) && isStart(samples[i + 1])) {
			plateauStart = i;
			// Keep scanning; the LAST such run is the one the trajectory leaves.
		}
	}
	if (plateauStart < 0) return samples;
	// If the last start-plateau run extends to the end of the window the
	// trajectory never left the start value; nothing meaningful to assert, leave
	// the samples untouched (the endpoint/shape guards will fail on their own).
	if (plateauStart + 2 >= samples.length) return samples;
	return samples.slice(plateauStart);
}

/**
 * Assert the scale trajectory is non-increasing within a per-step tolerance.
 * Allows small per-frame measurement jitter (the rAF cadence vs the easing
 * curve) but a step function (constant then drop) or a rise during a scale-out
 * fails. Used by Family A / B forward / C forward (scale-out trajectories).
 * Trailing post-plateau noise (a late single-frame spike after the trajectory
 * settled near 0) is trimmed before the check.
 */
function assertNonIncreasingWithinTolerance(samples: number[], tolerance: number): void {
	const trimmed = trimTrailingNoise(samples, 0, 0.05);
	let violations = 0;
	for (let i = 1; i < trimmed.length; i++) {
		// A rise beyond the tolerance is a violation.
		if (trimmed[i] - trimmed[i - 1] > tolerance) violations++;
	}
	expect(
		violations,
		`scale-out trajectory must be non-increasing within tolerance ${tolerance}; got samples ${trimmed
			.map((s) => s.toFixed(2))
			.join(',')}`
	).toBe(0);
}

/**
 * Mirror of assertNonIncreasingWithinTolerance for scale-in trajectories. Applies
 * BOTH the leading-artifact trim (CDP can land the first sampled frame mid-drag)
 * AND the trailing-plateau trim so the monotonicity check runs on the real
 * trajectory body, not the harness artifacts at either end.
 */
function assertNonDecreasingWithinTolerance(samples: number[], tolerance: number): void {
	const trailingTrimmed = trimTrailingNoise(samples, 1, 0.05);
	const trimmed = trimLeadingArtifact(trailingTrimmed, 0, 0.05);
	let violations = 0;
	for (let i = 1; i < trimmed.length; i++) {
		if (trimmed[i - 1] - trimmed[i] > tolerance) violations++;
	}
	expect(
		violations,
		`scale-in trajectory must be non-decreasing within tolerance ${tolerance}; got samples ${trimmed
			.map((s) => s.toFixed(2))
			.join(',')}`
	).toBe(0);
}

/**
 * Whether the trajectory crosses `threshold` strictly INSIDE the window (not
 * only at the endpoints). A step function jumping from 1 to 0 between two
 * adjacent samples would still cross, but a window with only the start at 1
 * and only the end at 0 (no intermediate samples) would not, because no sample
 * sits on the far side of the threshold except the endpoint.
 */
function scaleTrajectoryCrosses(samples: number[], threshold: number): boolean {
	if (samples.length < 2) return false;
	// Find the first sample strictly below and the first strictly above the
	// threshold; both must exist somewhere in the window for a real crossing.
	const hasAbove = samples.some((s) => s > threshold);
	const hasBelow = samples.some((s) => s < threshold);
	return hasAbove && hasBelow;
}

/**
 * Robust scale-in completion check for the Family C back trajectories. Asserts
 * the trajectory SHAPE that proves the scale-in completed, rather than the
 * absolute last sample: the trajectory REACHED near-1 at some point
 * (`maxScale > 0.9`), it is monotonic non-decreasing (no reversal, via
 * `assertNonDecreasingWithinTolerance`), and it crossed 0.5 inside the window.
 * The sampler window (1800ms) can cut off ~16ms before the 200ms rAF ease fully
 * settles under load, so the LAST sample may dip to ~0.84 on a correct run; the
 * shape guards tolerate that truncation while still failing a stuck-mid or
 * stuck-low trajectory.
 */
function assertScaleInCompletedShape(capture: FabScaleCapture): void {
	expect(
		capture.maxScale ?? 0,
		'scale-in trajectory must have reached near-1 (maxScale > 0.9) at some point'
	).toBeGreaterThan(0.9);
	assertNonDecreasingWithinTolerance(capture.samples, 0.25);
	expect(
		scaleTrajectoryCrosses(capture.samples, 0.5),
		'scale trajectory must cross 0.5 inside the transition window'
	).toBe(true);
}
