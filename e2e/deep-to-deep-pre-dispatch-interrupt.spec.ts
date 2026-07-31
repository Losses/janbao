import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

/**
 * Deep-to-deep commit interrupted by a non-deep-to-deep pipeline nav in the
 * pre-dispatch window.
 *
 * The deep-to-deep handshake (`#lastDispatchWasDeepToDeep`) is set the instant
 * `onSvelteKitBeforeNavigate` intercepts a detail -> detail nav, and is read
 * by the DESTINATION host's `shouldEnter` to suppress `playEnterAnimation`
 * (the orchestrator already animated the slide on the source host).
 *
 * The pre-dispatch window is the ~300ms gap between `navigation.cancel()`
 * (which arms the source-host slide) and the commit rAF's `#onExecutorSettle`
 * firing `#dispatchNav` (which sets `#navDispatchInFlight = true`). During
 * this window `#navDispatchInFlight` is false, so the supersede branch in
 * `onSvelteKitBeforeNavigate` does NOT run, and a non-deep-to-deep pipeline
 * nav (e.g. `/profile` -> `/search`, both pipeline routes but `/search` has
 * tag 'search' not 'detail') takes the `(!isTabRootPath(to) && !isDeepToDeep)`
 * early-return block. Without the explicit clear in that block the flag stays
 * true; SvelteKit proceeds, the `/profile` host destroys (`releaseInputs`
 * does not clear the flag), and `/search` host mounts reading
 * `publication.lastDispatchWasDeepToDeep === true` -> `shouldEnter` returns
 * false -> no forward-enter slide -> hard cut.
 *
 * The fix clears the flag in that early-return block. This spec samples the
 * NavPipelineHost track across the interrupt and asserts the `/search`
 * destination phase shows slide-grade movement (the forward-enter ran).
 */
test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

test.setTimeout(60_000);

interface PhaseCapture {
	phaseCount: number;
	phases: { maxDelta: number; firstM41: number; samples: number }[];
}

async function captureSlidePhases(
	page: import('@playwright/test').Page,
	trigger: () => Promise<void>
): Promise<PhaseCapture> {
	await page.evaluate(() => {
		const w = window as unknown as {
			__slidePhases?: {
				phases: { m41s: number[] }[];
				done: boolean;
			};
		};
		w.__slidePhases = { phases: [], done: false };
		let prevTrack: Element | null = null;
		let current: { m41s: number[] } | null = null;
		const start = performance.now();
		const tick = (): void => {
			const track = document.querySelector('[data-testid="nav-pipeline-track"]');
			// A host swap installs a new track element; begin a fresh phase
			// so the source-host slide and the destination-host enter are
			// counted independently. Skip null frames (the gap between
			// unmount and mount) without starting a phase.
			if (track !== null && track !== prevTrack) {
				current = { m41s: [] };
				w.__slidePhases!.phases.push(current);
			}
			prevTrack = track;
			if (track !== null && current !== null) {
				let m41 = 0;
				try {
					m41 = new DOMMatrix(getComputedStyle(track).transform).m41;
				} catch {
					m41 = 0;
				}
				current.m41s.push(Math.round(m41));
			}
			if (performance.now() - start > 1800) {
				w.__slidePhases!.done = true;
				return;
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});

	await trigger();

	try {
		await page.waitForFunction(
			() =>
				(
					window as unknown as { __slidePhases?: { done: boolean } }
				).__slidePhases?.done === true,
			{ timeout: 5000 }
		);
	} catch {
		/* sampler window ended after the destination mounted */
	}

	return page.evaluate(() => {
		const s = (
			window as unknown as {
				__slidePhases?: { phases: { m41s: number[] }[] };
			}
		).__slidePhases!;
		const phases = s.phases.map((p) => {
			const m41s = p.m41s;
			const min = m41s.length > 0 ? Math.min(...m41s) : 0;
			const max = m41s.length > 0 ? Math.max(...m41s) : 0;
			return {
				maxDelta: max - min,
				firstM41: m41s[0] ?? 0,
				samples: m41s.length
			};
		});
		const phaseCount = phases.filter((p) => p.maxDelta > 50).length;
		return { phaseCount, phases };
	});
}

test('interrupting a deep-to-deep commit with `/profile` -> `/search` plays `/search` forward-enter (no hard cut)', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	// Land on /profile (a deep page whose back-target is '/').
	await page.evaluate(
		(h: string) =>
			(window as unknown as { __e2eGoto?: (h: string) => Promise<void> }).__e2eGoto!(h),
		'/profile'
	);
	await page.waitForFunction(() => location.pathname === '/profile', { timeout: 5000 });
	await page.waitForTimeout(300);

	// Start the sampler BEFORE the deep-to-deep intercept so the source-host
	// slide AND the destination-host (/search) enter are both captured as
	// separate phases (the host swap installs a fresh track element).
	const capture = await captureSlidePhases(page, async () => {
		// Fire the deep-to-deep nav. The orchestrator cancels it and arms
		// the source-host slide; goto's promise resolves on cancel so the
		// next line runs in the same microtask as the cancel, well inside
		// the pre-dispatch window (commit duration ~300ms).
		await page.evaluate(
			(h: string) =>
				(window as unknown as { __e2eGoto?: (h: string) => Promise<void> }).__e2eGoto!(h),
			'/profile/settings'
		);
		// Immediately interrupt with `/search` (a pipeline route whose tag
		// is 'search', so `isDeepToDeep` is false and the `(!isTabRootPath(to)
		// && !isDeepToDeep)` early-return block fires). The fix clears
		// `#lastDispatchWasDeepToDeep` in that block; without it the stale
		// true suppresses `/search`'s `playEnterAnimation`.
		await page.evaluate(
			(h: string) =>
				(window as unknown as { __e2eGoto?: (h: string) => Promise<void> }).__e2eGoto!(h),
			'/search'
		);
	});

	// The destination must land.
	await page.waitForFunction(() => location.pathname === '/search', { timeout: 6000 });

	// The host swap must produce a second phase (the `/search` host's own
	// track element). Without this guard the assertion below could pass on
	// an empty / single-phase capture when the sampler missed `/search`.
	expect(
		capture.phases.length,
		`host swap captured (phases=${JSON.stringify(capture.phases)})`
	).toBeGreaterThanOrEqual(2);

	// The handshake clear in the early-return block lets the `/search`
	// host's `shouldEnter` read `lastDispatchWasDeepToDeep === false` and
	// run `playEnterAnimation`, which seeds the track at translateX(0) and
	// slides it to the at-rest `translateX(-viewportWidth)`. A stale true
	// leaves the `/search` host at its at-rest position with no slide, so
	// the last phase's maxDelta is 0.
	//
	// Note: the LAST phase (not phaseCount >= 2) is the durable signal.
	// Phase 1 (the source-host deep-to-deep slide) is timing-dependent:
	// when `/search` lands before the source-host slide's first rAF tick,
	// phase 1 captures only the at-rest position with maxDelta=0, so an
	// `>= 2 slide-grade phases` assertion flakes between the slow- and
	// fast-`/search`-landing timing regimes. Phase 2's slide is invariant:
	// `playEnterAnimation` runs synchronously in the `/search` host's
	// onMount, so its rAF always ticks before the host can be unmounted.
	const lastPhase = capture.phases[capture.phases.length - 1];
	expect(
		lastPhase.maxDelta,
		`/search enter phase translated across the viewport (last phase maxDelta=${lastPhase.maxDelta}, samples=${lastPhase.samples})`
	).toBeGreaterThan(50);
});
