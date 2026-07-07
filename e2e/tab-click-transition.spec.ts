import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

interface AnimState {
	samples: number[];
	done: boolean;
}

interface AnimWindow extends Window {
	__exitAnim?: AnimState;
}

export interface ExitAnimCapture {
	animated: boolean;
	delta: number;
	sampleCount: number;
	samples: number[];
}

/**
 * Capture the exit transition animation from a detail page to a tab root.
 * Samples the computed translateX of the track element during the navigation.
 */
async function captureExitAnimation(
	page: import('@playwright/test').Page,
	trigger: () => Promise<void>
): Promise<ExitAnimCapture> {
	await page.evaluate(() => {
		const w = window as unknown as AnimWindow;
		const state: AnimState = { samples: [], done: false };
		w.__exitAnim = state;
		let startT: number | null = null;
		let track: HTMLElement | null = null;

		const findTrack = (): HTMLElement | null => {
			const centre = document.querySelector('.detail-scroll-pane');
			return centre ? (centre.parentElement as HTMLElement) : null;
		};

		const tick = (): void => {
			if (track === null) {
				track = findTrack();
				if (track !== null) {
					startT = performance.now();
				}
			}
			if (track !== null && startT !== null) {
				const elapsed = performance.now() - startT;
				
				// If the element has been unmounted, stop sampling
				if (!track.isConnected) {
					state.done = true;
					return;
				}

				let tx = 0;
				const style = getComputedStyle(track);
				if (style.transform && style.transform !== 'none') {
					try {
						tx = new DOMMatrix(style.transform).m41;
					} catch {
						tx = 0;
					}
				}
				state.samples.push(Math.round(tx));
				if (elapsed > 700) {
					state.done = true;
					return;
				}
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});

	await trigger();

	// Wait up to 1.5 seconds for the animation/navigation to finish
	try {
		await page.waitForFunction(
			() => (window as unknown as AnimWindow).__exitAnim?.done === true,
			{ timeout: 1500 }
		);
	} catch {
		// Expected if page navigates
	}

	return await page.evaluate(() => {
		const a = (window as unknown as AnimWindow).__exitAnim!;
		const samples = a.samples;
		const delta = samples.length > 0 ? Math.max(...samples) - Math.min(...samples) : 0;
		// Direction-reversal count: a clean single-slide has 0
		// reversals (the translateX moves in one direction for the
		// whole transition). A transition that plays more than once
		// produces at least 1 reversal.
		let reversals = 0;
		for (let i = 2; i < samples.length; i++) {
			const d1 = samples[i - 1] - samples[i - 2];
			const d2 = samples[i] - samples[i - 1];
			if (d1 !== 0 && d2 !== 0 && Math.sign(d1) !== Math.sign(d2)) {
				reversals++;
			}
		}
		return {
			animated: delta > 50, // Let's use a 50px threshold for animation
			delta,
			reversals,
			sampleCount: samples.length,
			samples
		};
	});
}

test.describe('Tab Click Exit Transitions', () => {
	test.beforeEach(async ({ context }) => {
		await prepareContext(context);
	});

	test('clicking top tab bar item (Discussions) from a thread page should slide out', async ({ page }) => {
		page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
		await page.goto('/');
		await waitForHydration(page);

		// Click the first discussion to enter thread detail
		await page.locator('a[href^="/discussion/"]').first().click();
		await page.waitForURL(/\/discussion\//);
		await page.waitForSelector('.detail-scroll-pane');
		
		// Wait for the enter animation to settle completely
		await page.waitForTimeout(500);

		// Click the Discussions tab in the header and capture the exit animation
		const anim = await captureExitAnimation(page, async () => {
			await page.locator('a[data-tab-nav][href="/"]').click();
		});

		await page.waitForURL('/');
		console.log('Discussions tab click animation result:', anim);
		expect(anim.animated, `Exit transition to discussions tab should be animated, but got delta=${anim.delta} (samples: ${anim.samples.join(',')})`).toBe(true);
	});

	test('clicking top tab bar item (Activity) from a thread page should slide out', async ({ page }) => {
		page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
		await page.goto('/');
		await waitForHydration(page);

		// Click the first discussion to enter thread detail
		await page.locator('a[href^="/discussion/"]').first().click();
		await page.waitForURL(/\/discussion\//);
		await page.waitForSelector('.detail-scroll-pane');
		
		// Wait for the enter animation to settle completely
		await page.waitForTimeout(500);

		// Click the Activity tab in the header and capture the exit animation
		const anim = await captureExitAnimation(page, async () => {
			await page.locator('a[data-tab-nav][href="/activity"]').click();
		});

		await page.waitForURL('/activity');
		console.log('Activity tab click animation result:', anim);
		expect(anim.animated, `Exit transition to activity tab should be animated, but got delta=${anim.delta} (samples: ${anim.samples.join(',')})`).toBe(true);
	});

	test('clicking top tab bar item (Messages) from a message details page should slide out', async ({ page }) => {
		page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
		await page.goto('/messages/inbox');
		await waitForHydration(page);

		// Click the first message to enter message detail
		await page.locator('a[href^="/messages/"]:not([href="/messages/inbox"]):not([href="/messages/new"])').first().click();
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForSelector('.detail-scroll-pane');
		
		// Wait for the enter animation to settle completely
		await page.waitForTimeout(500);

		// Click the Messages tab in the header and capture the exit animation
		const anim = await captureExitAnimation(page, async () => {
			await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		});

		await page.waitForURL('/messages/inbox');
		console.log('Messages tab click animation result:', anim);
		expect(
			anim.animated,
			`Exit transition to messages tab should be animated, but got delta=${anim.delta} (samples: ${anim.samples.join(',')})`
		).toBe(true);
		// The pilot's exit slide must play exactly once. The pipeline
		// drives the slide via the executor + driver and dispatches the
		// SvelteKit nav on settle; the assertion guards against any
		// failure mode that plays the slide more than once (which
		// would surface as 1+ direction reversals in the trajectory).
		expect(
			anim.reversals,
			`Pilot exit slide must play exactly once (reversals=${anim.reversals}; samples: ${anim.samples.join(',')})`
		).toBe(0);
	});
});
