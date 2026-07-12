import { test, expect, type Page } from '@playwright/test';
import { prepareContext, swipeBack, openSidebarAndGoto, waitForHydration } from './helpers';

/**
 * Deep-page back-swipe → top tab pill collapse/re-expand regression.
 *
 * Sibling of backtarget.spec.ts "Bug3" (which proves the pill EXPANDS gradually
 * DURING the drag). This file covers the moment Bug3 stops sampling: AFTER the
 * finger lifts. On a back-swipe from a deep page (/bookmarks - a page with no
 * tab of its own, NavPipelineHost fallbackRoute="/") back to a tab root (/),
 * the top Discussions pill must HOLD active+expanded through the handoff to the
 * homepage pager. Pre-fix it collapsed and lost its highlight, then re-expanded
 * - a visible flicker.
 *
 * Root cause: NavPipelineHost's pager-driving $effect has a "true rest" branch
 * that resets the pager to `fractionalIndex = fromIdx` (-1 on a deep page) +
 * `active:false`. That branch fires in the window `onTrackTransitionEnd` opens:
 * it clears `pendingNav` and dispatches history.back()/goto(), but the route
 * hasn't swapped yet, so the effect briefly sees an "idle" state and resets,
 * collapsing the pill (closeness→0, round(-1)≠0 → inactive). Once the route
 * swaps, the homepage MobileTabPager sets active:true and the pill re-expands.
 *
 * Faithfulness: the back-swipe is a real CDP touch gesture (detectSwipe rejects
 * mouse), and /bookmarks is reached via the dev __e2eGoto hook - the same
 * beforeNavigate the drawer's "Bookmarks" link ultimately fires - so the backTarget
 * precondition matches a real user opening the sidebar → "Bookmarks" → swiping back.
 */

interface PillSample {
	t: number;
	active: boolean;
	path: string;
}
interface PillFlickerWindow extends Window {
	__pillLog?: PillSample[];
}

/**
 * Sample the Discussions pill's active state every animation frame (re-querying
 * the node each frame, so a MobileTabBar re-render across the navigation can't
 * lose it). rAF granularity (~16ms) reliably catches the reset window, which on
 * the dev server is ~80-270ms wide.
 */
async function installPillSampler(page: Page): Promise<void> {
	await page.evaluate(() => {
		const w = window as unknown as PillFlickerWindow;
		const log: PillSample[] = [];
		w.__pillLog = log;
		const isActive = (el: Element | null): boolean => {
			if (!el) return false;
			const cls = el.getAttribute('class') ?? '';
			return /bg-neutral-content\/15/.test(cls) && /text-accent\b/.test(cls);
		};
		const tick = (): void => {
			const pill = document.querySelector('a[data-tab-nav][href="/"]');
			log.push({
				t: Math.round(performance.now()),
				active: isActive(pill),
				path: location.pathname
			});
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
}

async function readPillLog(page: Page): Promise<PillSample[]> {
	return page.evaluate(() => (window as unknown as PillFlickerWindow).__pillLog ?? []);
}

/**
 * Count active→inactive→active "V" dips in the timeline. A V-dip is an inactive
 * run flanked by active runs - exactly the collapse-re-expand flicker. It is
 * immune to drag-phase churn (a mid-drag active run just merges into the commit
 * run) and to the final landing state. Pre-fix: ≥1. Post-fix: 0.
 */
function countCollapseVDrps(samples: PillSample[]): number {
	const seq: boolean[] = [];
	for (const s of samples) {
		if (seq.length === 0 || seq[seq.length - 1] !== s.active) seq.push(s.active);
	}
	let dips = 0;
	for (let i = 1; i < seq.length - 1; i++) {
		if (!seq[i] && seq[i - 1] && seq[i + 1]) dips++;
	}
	return dips;
}

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

// CALIBRATION: prove the harness reaches /bookmarks, the gesture commits, and we
// land on /. If this fails the regression assertion below is meaningless. (We
// gate on the landing URL + the pill reaching active, not a console log - the
// old "swipe activated!" log was removed in the Log-removal pass.)
test('CALIBRATION: /bookmarks back-swipe commits and lands on /', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await openSidebarAndGoto(page, '/bookmarks');
	expect(new URL(page.url()).pathname).toBe('/bookmarks');

	await installPillSampler(page);
	await swipeBack(page);
	await page.waitForURL('/', { timeout: 5000 });
	expect(new URL(page.url()).pathname).toBe('/');

	const log = await readPillLog(page);
	expect(log.some((s) => s.active), 'pill never became active - the swipe did not commit').toBe(
		true
	);
});

// REGRESSION: the Discussions pill must stay active from commit through the
// homepage handoff - no collapse/re-expand flicker. Pre-fix this fails with a
// single V-dip (active at commit → inactive at the pager reset → active on landing).
test('REGRESSION: deep-page back-swipe holds the Discussions pill active (no collapse/re-expand)', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	await openSidebarAndGoto(page, '/bookmarks');
	await page.waitForTimeout(300);

	await installPillSampler(page);
	await swipeBack(page);
	await page.waitForURL('/', { timeout: 5000 });
	// Capture through the transitionend reset and the homepage-pager handoff.
	await page.waitForTimeout(900);

	const log = await readPillLog(page);
	expect(log.length, 'sampler must have captured frames').toBeGreaterThan(10);

	// The gesture must have committed: the pill reached active at some point.
	const everActive = log.some((s) => s.active);
	expect(everActive, 'pill never became active - the swipe did not commit').toBe(true);

	// And it must end active on the homepage.
	expect(log[log.length - 1].active, 'pill must end active on /').toBe(true);
	expect(log[log.length - 1].path, 'must have landed on /').toBe('/');

	const dips = countCollapseVDrps(log);
	expect(
		dips,
		`pill collapsed/re-expanded after commit (active→inactive→active). transitions: ${JSON.stringify(
			log
				.filter((s, i) => i === 0 || log[i - 1].active !== s.active)
				.map((s) => `${s.active ? 'ON' : 'OFF'}@${s.path}`)
		)}`
	).toBe(0);
});
