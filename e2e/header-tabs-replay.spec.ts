import { test, expect, type Page } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

interface HeaderFrame {
	t: number;
	path: string;
	rootTransform: string;
	titleTransform: string;
}

interface HeaderSamplerState {
	frames: HeaderFrame[];
	done: boolean;
}

interface HeaderSamplerWindow extends Window {
	__headerLog?: HeaderSamplerState;
}

const SAMPLE_WINDOW_MS = 1600;

async function installHeaderSampler(page: Page): Promise<void> {
	await page.evaluate(
		(windowMs) => {
			const w = window as unknown as HeaderSamplerWindow;
			const state: HeaderSamplerState = { frames: [], done: false };
			w.__headerLog = state;
			const start = performance.now();
			const tick = (): void => {
				const nodes = Array.from(
					document.querySelectorAll('header div.relative.h-10.flex-1 > div')
				) as HTMLElement[];
				const rootTransform = nodes[0] ? nodes[0].style.transform.trim() : '';
				const titleTransform = nodes[1] ? nodes[1].style.transform.trim() : '';

				state.frames.push({
					t: Math.round(performance.now()),
					path: location.pathname,
					rootTransform,
					titleTransform
				});

				if (performance.now() - start > windowMs) {
					state.done = true;
					return;
				}
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		},
		SAMPLE_WINDOW_MS
	);
}

async function readHeaderLog(page: Page): Promise<HeaderFrame[]> {
	return page.evaluate(() => {
		const s = (window as unknown as HeaderSamplerWindow).__headerLog;
		return s ? s.frames : [];
	});
}

async function swipeBackHalf(page: Page): Promise<void> {
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const y = 400;
	const startX = Math.round(width * 0.3);
	const endX = startX + Math.round(width * 0.5); // drag halfway
	const steps = 14;
	const dispatch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string
	): Promise<unknown> =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});

	await dispatch('touchStart', startX, 'touchPressed');
	for (let i = 1; i <= steps; i++) {
		const x = Math.round(startX + (endX - startX) * (i / steps));
		await dispatch('touchMove', x, 'touchMoved');
		await page.waitForTimeout(16);
	}
	await dispatch('touchEnd', endX, 'touchReleased');
	await client.detach();
}

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

test('REGRESSION: header tabs and title must not snap back and replay during back-swipe from settings to messages', async ({
	page
}) => {
	// 1. Go to messages inbox
	await page.goto('/messages/inbox');
	await waitForHydration(page);

	// 2. Open sidebar drawer
	const menuBtn = page.locator('header button').first();
	await expect(menuBtn).toBeVisible();
	await menuBtn.click();
	await page.waitForTimeout(300);

	// 3. Click settings link inside mobile drawer
	const settingsLink = page.locator('a[href="/profile/settings"]').filter({ visible: true }).first();
	await expect(settingsLink).toBeVisible();
	await settingsLink.click();
	await page.waitForURL('/profile/settings');
	await page.waitForTimeout(400); // Wait for transition to fully settle

	// 4. Install sampler and perform back-swipe
	await installHeaderSampler(page);
	await swipeBackHalf(page);

	// 5. Wait to land back on /messages/inbox
	await page.waitForURL('/messages/inbox', { timeout: 5000 });
	await page.waitForTimeout(800); // Allow all transitions to fully settle

	// 6. Analyze logs
	const log = await readHeaderLog(page);
	expect(log.length, 'Sampler must have captured frames').toBeGreaterThan(20);

	const rootSequence: number[] = [];
	const titleSequence: number[] = [];
	
	for (const frame of log) {
		const rootTyMatch = frame.rootTransform.match(/translateY\((-?\d+(?:\.\d+)?)(%|px)\)/);
		const titleTyMatch = frame.titleTransform.match(/translateY\((-?\d+(?:\.\d+)?)(%|px)\)/);
		if (rootTyMatch) rootSequence.push(parseFloat(rootTyMatch[1]));
		if (titleTyMatch) titleSequence.push(parseFloat(titleTyMatch[1]));
	}

	console.log('Root translateY sequence:', rootSequence.map(v => Math.round(v)).join(' -> '));
	console.log('Title translateY sequence:', titleSequence.map(v => Math.round(v)).join(' -> '));

	let hasCapturedDrag = false;
	for (const frame of log) {
		const rootTyMatch = frame.rootTransform.match(/translateY\((-?\d+(?:\.\d+)?)(%|px)\)/);
		const titleTyMatch = frame.titleTransform.match(/translateY\((-?\d+(?:\.\d+)?)(%|px)\)/);
		const rootTy = rootTyMatch ? parseFloat(rootTyMatch[1]) : 0;
		const titleTy = titleTyMatch ? parseFloat(titleTyMatch[1]) : 0;
		if (frame.path === '/profile/settings' && rootTy > -90 && rootTy < -10 && titleTy > 10 && titleTy < 90) {
			hasCapturedDrag = true;
		}
	}

	expect(hasCapturedDrag, 'Test must capture the mid-drag frame state').toBe(true);

	// Let's perform a precise analysis of the cycles.
	// For the root transform (tabs layer):
	// Expected: starts at -100%, moves to ~-50% during drag, then settles smoothly to 0%.
	// Bug: starts at -100%, moves to ~-50% during drag, snaps to -100% upon release, then transitions to 0%.
	// That is, the translateY value goes: -100 -> -50 -> -100 -> 0.
	// For the title transform (title layer):
	// Expected: starts at 0%, moves to ~50% during drag, then settles smoothly to 100%.
	// Bug: starts at 0%, moves to ~50% during drag, snaps to 0% upon release, then transitions to 100%.
	// That is, the translateY value goes: 0 -> 50 -> 0 -> 100.

	// Let's check if the bug occurs by looking at the minimum and maximum translateY values in the transition sequence.
	// Let's extract the sequence of translateY values during the transition.


	// We count the number of direction changes / reversals in these sequences.
	// Or simply detect if after a drag has reached > -80 (closer to 0) for root, it goes back below -95 (snaps to -100%)
	// and then later goes back to 0.
	let dragMaxRoot = -100;
	let snappedAfterDragRoot = false;
	let settledToZeroRoot = false;

	for (const ty of rootSequence) {
		if (ty > -90 && ty < -10) {
			if (ty > dragMaxRoot) dragMaxRoot = ty;
		}
		if (dragMaxRoot > -80) {
			if (ty <= -95) {
				snappedAfterDragRoot = true;
			}
			if (snappedAfterDragRoot && ty >= -5) {
				settledToZeroRoot = true;
			}
		}
	}

	let dragMinTitle = 0;
	let snappedAfterDragTitle = false;
	let settledToOneHundredTitle = false;

	for (const ty of titleSequence) {
		if (ty > 10 && ty < 90) {
			if (ty > dragMinTitle) dragMinTitle = ty;
		}
		if (dragMinTitle > 20) {
			if (ty <= 5) {
				snappedAfterDragTitle = true;
			}
			if (snappedAfterDragTitle && ty >= 95) {
				settledToOneHundredTitle = true;
			}
		}
	}

	// Assert no snap and replay.
	// If snappedAfterDragRoot and settledToZeroRoot are both true, the root layer replayed!
	expect(
		snappedAfterDragRoot && settledToZeroRoot,
		`Root (tabs) layer snapped back to -100% and replayed to 0%! Root translateY sequence: ${rootSequence.map(v => Math.round(v)).join(' -> ')}`
	).toBe(false);

	expect(
		snappedAfterDragTitle && settledToOneHundredTitle,
		`Title layer snapped back to 0% and replayed to 100%! Title translateY sequence: ${titleSequence.map(v => Math.round(v)).join(' -> ')}`
	).toBe(false);
});
