import { test, expect } from '@playwright/test';
import {
	prepareContext,
	waitForHydration,
	swipeBack,
	installMultiSignalSampler,
	waitForMultiSignalDone,
	readMultiSignalFrames,
	type MultiSignalFrame
} from './helpers';

// DV21 R5 F1 continuity guard: the offline LIST mirror route `/offline` is
// a NavPipelineHost route whose `leftHref` pill-maps to the discussions tab
// (`TAB_BAR_CONFIG` maps `/offline` -> discussions), so a back-swipe
// `/offline` -> `/` is a non-bidirectional tab-to-tab transition. The
// orchestrator's publication rule nulls `backMorph` for any tab-to-tab
// swipe on ANY host (`(fromIdx >= 0 && toIdx >= 0)` in `#republishToPager`),
// so the drag morph stays at the static at-rest value (hamburger mode) end
// to end. The settle arm's `dragMorphWasStatic` derivation
// (`targetIsSearch || (isTabToTab && !isCenterTabRoute)`) matches that
// publication rule: a non-centerTab tab-to-tab shape captures
// `startMorph = atRestMorph(outgoingHasTabs)` and the settle holds the
// morph at that value across the release. (A centerTab tab-to-tab shape
// such as `/messages/<id>` -> `/messages/inbox` publishes a live
// `backMorph` via `#republishToPager`'s centerTab branch, so its drag morph
// is NOT static; the settle arm captures
// `startMorph = #dragMorphAtAnchorOrRaw(outgoingHasTabs, raw)`, i.e.
// `1 - raw` at the release instant, to mirror the drag's terminal value.)
// A regression that splits the publication rule from the settle's
// static-morph classification (e.g. by dropping the `!isCenterTabRoute`
// qualifier here) snaps the morph in one rAF frame at release: the drag
// stays at `currentHasTabs ? 1 : 0 = 1` while the settle collapses to a
// non-static `startMorph` and the icon rotates toward the back-arrow
// (a snap of ~119deg / ~26px at this viewport's header height).

test.describe('DV21 R4 F1: /offline -> / back-swipe morph continuity', () => {
	test.beforeEach(async ({ context }) => {
		await prepareContext(context);
	});

	test('/offline back-swipe keeps the vertical morph continuous across the release handoff', async ({
		page
	}) => {
		await page.goto('/offline');
		await waitForHydration(page);
		// Wait for NavPipelineHost to mount; without the host's configure()
		// call the orchestrator has no `#mountInputs` and a gesture falls
		// through to the no-op path.
		await page.waitForSelector('.detail-scroll-pane');
		await page.waitForTimeout(300);

		await installMultiSignalSampler(page, 2200);
		await swipeBack(page);
		await waitForMultiSignalDone(page);
		const frames = await readMultiSignalFrames(page);

		const rootJumps = maxFrameJumps(frames, (f) => f.rootLayerTy);
		const burgerJumps = maxFrameJumps(frames, (f) => f.burgerRot);
		console.log('/offline -> / continuity:', {
			rootJumps,
			burgerJumps,
			finalPath: new URL(page.url()).pathname
		});

		expect(page.url(), 'back-swipe must land on /').toMatch(/\/$/);

		// The threshold allows one rAF of regular progress (~12px / ~22deg
		// at this viewport's header height); the R4-audit snap was
		// ~26.46px / ~119deg.
		expect(
			rootJumps.max,
			`rootLayerTy must not snap at release (max jump ${rootJumps.max.toFixed(2)}px at t=${rootJumps.maxAt}ms)`
		).toBeLessThan(15);
		expect(
			burgerJumps.max,
			`burgerRot must not snap at release (max jump ${burgerJumps.max.toFixed(2)}deg at t=${burgerJumps.maxAt}ms)`
		).toBeLessThan(35);
	});
});

/** Compute the max frame-to-frame absolute jump of a sampled signal across
 *  the multi-signal frame series, plus the timestamp of that max jump. Null
 *  samples (signal absent in that frame) are skipped. Used by the no-snap
 *  guards to assert the morph stays continuous across the drag-to-settle
 *  release boundary (a snap shows up as one frame's delta dwarfing the
 *  regular per-rAF cadence). */
function maxFrameJumps(
	frames: MultiSignalFrame[],
	pick: (f: MultiSignalFrame) => number | null
): { max: number; maxAt: number } {
	let max = 0;
	let maxAt = 0;
	let prev: number | null = null;
	for (const f of frames) {
		const v = pick(f);
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
