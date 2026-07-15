import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

/**
 * Intra-tree forward deep-to-deep: a single slide, not two.
 *
 * A forward nav between two sibling deep pages under the same parent
 * (e.g. /profile/settings -> /profile/password) is intercepted by the
 * source host's orchestrator (the `isDeepToDeep` branch of
 * `onSvelteKitBeforeNavigate`), which cancels the nav, plays the slide on
 * the SOURCE host's track, then dispatches on settle.
 *
 * Without the `#lastDispatchWasDeepToDeep` handshake the DESTINATION host
 * also plays a forward-enter slide: the destination's back-target is the
 * source page, so the generic `shouldEnter` heuristic
 * (`stack[length-2].pathname === leftHref`) is true and
 * `playEnterAnimation` fires a second slide on the destination track.
 *
 * This spec samples the NavPipelineHost track across the transition,
 * partitioning samples by the DOM track element so the source-host slide
 * and the destination-host mount land in separate phases, and asserts
 * exactly ONE phase shows slide-grade movement. A double-slide regression
 * produces two movement phases.
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
			// so the source-host slide and the destination-host enter (if
			// any) are counted independently. Skip null frames (the gap
			// between unmount and mount) without starting a phase.
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
			if (performance.now() - start > 1500) {
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
		// A slide-grade movement is a phase whose track translated > 50px
		// (the pipeline slide covers the full viewport width). A host-swap
		// phase where the destination lands at rest (no enter animation)
		// stays under the threshold.
		const phaseCount = phases.filter((p) => p.maxDelta > 50).length;
		return { phaseCount, phases };
	});
}

test('forward /profile/settings -> /profile/password plays a single slide', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	// Land on /profile/settings (a deep page whose back-target is /profile).
	await page.evaluate(
		(h: string) =>
			(window as unknown as { __e2eGoto?: (h: string) => Promise<void> }).__e2eGoto!(h),
		'/profile/settings'
	);
	await page.waitForFunction(() => location.pathname === '/profile/settings', { timeout: 5000 });
	await page.waitForTimeout(300);

	// Sample the track across the forward nav to /profile/password. The
	// source-host interception slide is phase 1. With the handshake fix,
	// the destination host lands at rest (no enter animation) so it does
	// NOT produce a second movement phase.
	const capture = await captureSlidePhases(page, async () => {
		await page.evaluate(
			(h: string) =>
				(window as unknown as { __e2eGoto?: (h: string) => Promise<void> }).__e2eGoto!(h),
			'/profile/password'
		);
	});

	// The destination must land.
	await page.waitForFunction(() => location.pathname === '/profile/password', { timeout: 6000 });

	expect(
		capture.phaseCount,
		`exactly one slide phase (phases=${JSON.stringify(capture.phases)})`
	).toBe(1);
});
