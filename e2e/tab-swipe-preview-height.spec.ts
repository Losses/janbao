import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

// MobileTabPager sizes its viewport to the ACTIVE panel's measured height
// (`viewportHeight = panelHeights[activeIndex]`) and clips it with
// `overflow-hidden`. `activeIndex` only changes on commit (swipeEnd →
// switchTo), so DURING a drag the viewport is pinned to the SOURCE panel's
// height while a neighbour of a DIFFERENT height is being revealed:
//   - forward  activity(tall) -> messages(short): the revealed column is the
//     source's tall height, so the preview is TALLER than the real landed
//     messages page will be (blank gap under the shorter messages content).
//   - back     messages(short) -> activity(tall): the taller activity neighbour
//     is clipped at the source's short viewport height, so its bottom content
//     (composer + lower feed items) is cut off - "preview shorter than the real
//     Activity page, extra content all clipped".
//
// detectSwipe rejects pointerType 'mouse', so the gesture is driven via CDP
// Input.dispatchTouchEvent (the same path helpers.swipeHorizontal uses). The
// swipe is PAUSED mid-drag (no touchEnd yet) so the preview state is stable for
// measurement; release() then completes the gesture.

interface PanelMetrics {
	vpHeight: number;
	vpRect: { top: number; bottom: number; height: number } | null;
	trackTx: number;
	panels: Record<'discussions' | 'activity' | 'messages', { offH: number; bottom: number }>;
}

async function capturePagerMetrics(page: import('@playwright/test').Page): Promise<PanelMetrics> {
	return page.evaluate(() => {
		const vp = document.querySelector('.mobile-tab-pager-viewport') as HTMLElement | null;
		const track = vp ? (vp.firstElementChild as HTMLElement | null) : null;
		const rectOf = (el: Element | null) => {
			if (!el) return null;
			const r = (el as HTMLElement).getBoundingClientRect();
			return { top: r.top, bottom: r.bottom, height: r.height };
		};
		const panel = (key: string) => {
			const el = document.querySelector(`section[data-tab-panel="${key}"]`) as HTMLElement | null;
			return el ? { offH: el.offsetHeight, bottom: el.getBoundingClientRect().bottom } : { offH: -1, bottom: -1 };
		};
		let tx = 0;
		try {
			tx = track ? new DOMMatrix(getComputedStyle(track).transform).m41 : 0;
		} catch {
			tx = 0;
		}
		return {
			vpHeight: vp ? vp.clientHeight : -1,
			vpRect: rectOf(vp),
			trackTx: Math.round(tx),
			panels: {
				discussions: panel('discussions'),
				activity: panel('activity'),
				messages: panel('messages')
			}
		};
	});
}

interface HeldSwipe {
	release: () => Promise<void>;
}

/** Drive a horizontal touch swipe via CDP but STOP after the last touchMove so
 * the caller can measure the mid-drag preview state, then await release(). */
async function holdSwipeMidDrag(
	page: import('@playwright/test').Page,
	direction: 'forward' | 'back'
): Promise<HeldSwipe> {
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const height = page.viewportSize()?.height ?? 851;
	// forward (-> next/right tab): leftward dx<0, start on the right half.
	// back (-> prev/left tab): rightward dx>0, start on the left half.
	const startX = direction === 'forward' ? Math.round(width * 0.7) : Math.round(width * 0.3);
	const endX = direction === 'forward' ? startX - 220 : startX + 220;
	const y = Math.round(height * 0.5);

	const dispatch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string
	): Promise<unknown> =>
		client.send('Input.dispatchTouchEvent', {
			type,
			// CDP needs each touch point's state; playwright's TouchPoint type
			// omits it, so cast past the mismatch (same trick as helpers.ts).
			touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});

	// DEAD_ZONE(10) + HORIZONTAL_RATIO(1.6) gate detection; 10 purely-horizontal
	// steps of 22px each clear both and keep |dx| > |dy|*1.6.
	await dispatch('touchStart', startX, 'touchPressed');
	const steps = 10;
	for (let i = 1; i <= steps; i++) {
		const x = Math.round(startX + (endX - startX) * (i / steps));
		await dispatch('touchMove', x, 'touchMoved');
	}

	return {
		async release() {
			await dispatch('touchEnd', endX, 'touchReleased');
			await client.detach();
		}
	};
}

test.describe('Tab-swipe preview height mismatch (activity <-> messages)', () => {
	test.beforeEach(async ({ context }) => {
		await prepareContext(context);
	});

	test('forward preview is taller than the landed page; back preview clips the taller neighbour', async ({
		page
	}) => {
		// 1. Land on /activity (mobile tab index 1).
		await page.goto('/activity');
		await waitForHydration(page);
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(400);

		const restActivity = await capturePagerMetrics(page);
		console.log('REST on /activity:', restActivity);
		// Precondition: the activity panel is taller than the messages panel
		// (composer + feed vs a conversation list). This is what makes the
		// source-pinned viewport visibly wrong in BOTH swipe directions.
		const heightDelta = restActivity.panels.activity.offH - restActivity.panels.messages.offH;
		console.log(
			`activity.offH=${restActivity.panels.activity.offH} messages.offH=${restActivity.panels.messages.offH} delta=${heightDelta}`
		);

		// 2. FORWARD swipe activity -> messages, paused mid-drag.
		const forward = await holdSwipeMidDrag(page, 'forward');
		await page.waitForTimeout(200); // let detectSwipe classify + the track translate settle
		const duringForward = await capturePagerMetrics(page);
		console.log('DURING forward swipe (active still = activity):', duringForward);
		await forward.release();

		// 3. Land on /messages/inbox and measure the real viewport height.
		await page.waitForURL('**/messages/inbox', { timeout: 5000 });
		await page.waitForTimeout(400);
		const landedMessages = await capturePagerMetrics(page);
		console.log('LANDED on /messages/inbox:', landedMessages);

		// 4. BACK swipe messages -> activity, paused mid-drag.
		const back = await holdSwipeMidDrag(page, 'back');
		await page.waitForTimeout(200);
		const duringBack = await capturePagerMetrics(page);
		console.log('DURING back swipe (active still = messages):', duringBack);
		await back.release();

		// 5. Land back on /activity and measure the real viewport height.
		await page.waitForURL('**/activity', { timeout: 5000 });
		await page.waitForTimeout(400);
		const landedActivity = await capturePagerMetrics(page);
		console.log('LANDED on /activity:', landedActivity);

		// Record the clip magnitude for the report (activity neighbour extends
		// this far below the viewport's bottom edge during the back swipe).
		const backClipPx = Math.round(
			duringBack.panels.activity.bottom - (duringBack.vpRect?.bottom ?? 0)
		);
		console.log(
			`forward preview=${duringForward.vpHeight} landedMessages=${landedMessages.vpHeight} | ` +
				`back preview=${duringBack.vpHeight} landedActivity=${landedActivity.vpHeight} ` +
				`activity.clipBelowVp=${backClipPx}px`
		);

		// The preview during a swipe should faithfully match the page the user
		// will land on. Both assertions FAIL today (the bug): the viewport is
		// pinned to the SOURCE panel's height instead of accommodating the
		// destination being revealed.
		expect(
			duringForward.vpHeight,
			'forward: the messages preview should match the landed messages page, not the taller activity source'
		).toBe(landedMessages.vpHeight);

		expect(
			duringBack.vpHeight,
			'back: the activity preview should match the landed activity page, not the shorter messages source'
		).toBe(landedActivity.vpHeight);

		// The taller activity neighbour must be fully visible while revealed -
		// its bottom edge must not drop below the viewport (content cut off).
		expect(
			duringBack.panels.activity.bottom,
			'back: the activity neighbour must not be clipped below the viewport'
		).toBeLessThanOrEqual((duringBack.vpRect?.bottom ?? 0) + 1);
	});
});
