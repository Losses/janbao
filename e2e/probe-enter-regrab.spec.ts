import { test, expect } from '@playwright/test';
import {
	prepareContext,
	waitForHydration,
	installMultiSignalSampler,
	waitForMultiSignalDone,
	readMultiSignalFrames,
	type MultiSignalFrame
} from './helpers';

function maxFrameJumps(
	frames: MultiSignalFrame[],
	getter: (f: MultiSignalFrame) => number | null
): { max: number; maxAt: number } {
	let max = 0;
	let maxAt = 0;
	let prev: number | null = null;
	for (const f of frames) {
		const v = getter(f);
		if (v === null) {
			prev = null;
			continue;
		}
		if (prev !== null) {
			const d = Math.abs(v - prev);
			if (d > max) {
				max = d;
				maxAt = f.t;
			}
		}
		prev = v;
	}
	return { max, maxAt };
}

test('PROBE: re-grab mid-enter on /search - orchestrator state', async ({ page, context }) => {
	await prepareContext(context);
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	// Install a probe that snapshots orchestrator state per frame.
	await page.evaluate(() => {
		const w = window as any;
		w.__probe = { frames: [] as any[], done: false };
		const start = performance.now();
		const tick = (): void => {
			if (performance.now() - start > 3500) {
				w.__probe.done = true;
				return;
			}
			// Read orchestrator state via the global pager store published values
			const pp = w.__primaryPager;
			// Inspect the FAB atom
			const fab = document.querySelector('[data-testid="fab"]') as HTMLElement | null;
			let fabScale: number | null = null;
			if (fab) {
				const m = getComputedStyle(fab).transform.match(/matrix\(([^)]+)\)/);
				fabScale = m ? Number(m[1].split(',')[0]) : 1;
			}
			w.__probe.frames.push({
				t: Math.round(performance.now() - start),
				path: location.pathname,
				fabScale,
				pp: pp ? { ...pp } : null
			});
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});

	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, state: string) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});

	// Phase 1: forward-swipe from /messages/inbox -> /search.
	const startX = Math.round(width * 0.7);
	const endX = startX - Math.round(width * 0.7);
	await touch('touchStart', startX, 'touchPressed');
	for (let i = 1; i <= 14; i++) {
		await touch('touchMove', startX + Math.round(((endX - startX) * i) / 14), 'touchMoved');
	}
	await touch('touchEnd', endX, 'touchReleased');

	try {
		await page.waitForURL('**/search', { timeout: 1500 });
	} catch (e) {
		console.log('URL did not reach /search within 1500ms');
	}
	await page.waitForTimeout(30);

	// Inspect orchestrator state right before re-grab
	const beforeRegrab = await page.evaluate(() => {
		const pp = (window as any).__primaryPager;
		return pp ? { ...pp } : null;
	});
	console.log('PROBE: pager state right before re-grab:', beforeRegrab);

	// Phase 2: back-swipe (rightward) from /search toward /messages/inbox.
	const start2 = Math.round(width * 0.3);
	const end2 = start2 + 240;
	await touch('touchStart', start2, 'touchPressed');
	for (let i = 1; i <= 10; i++) {
		await touch('touchMove', start2 + Math.round(((end2 - start2) * i) / 10), 'touchMoved');
	}
	await touch('touchEnd', end2, 'touchReleased');

	await client.detach();
	await page.waitForFunction(() => (window as any).__probe?.done === true, { timeout: 10_000 });
	const probe = await page.evaluate(() => (window as any).__probe);

	// Find the re-grab moment: where path switches from /search back toward /messages/inbox
	// Look at the FAB trajectory around the time when the second swipe began
	const fabJumps = maxFrameJumps(probe.frames, (f: any) => f.fabScale);
	console.log('PROBE re-grab mid-enter fabScale jumps:', {
		fabJumps,
		finalPath: new URL(page.url()).pathname
	});
	// Print the FAB + pp trajectory around the max jump
	const aroundMax = probe.frames
		.filter((f: any) => Math.abs(f.t - fabJumps.maxAt) < 250)
		.map((f: any) => ({
			t: f.t,
			fab: f.fabScale,
			path: f.path,
			bm: f.pp?.backMorph,
			tt: f.pp?.transitionTarget,
			fi: f.pp?.fractionalIndex
		}));
	console.log('aroundMax:', JSON.stringify(aroundMax, null, 2));
});
