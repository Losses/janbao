import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration, captureExitPreview } from './helpers';

/**
 * Forward deep-to-deep pipeline slide.
 *
 * A forward navigation between two deep pages (e.g. /profile ->
 * /profile/settings, both `tag: 'detail'`) is intercepted by the source
 * route's orchestrator in `onSvelteKitBeforeNavigate` and played as a
 * pipeline slide via the `{detail, detail}` resolver, instead of passing
 * through as plain SvelteKit nav with no source-side slide.
 *
 * The 2-panel NavPipelineHost has no panel to the right of centre, so the
 * slide reveals the left panel (overridden to render the destination
 * skeleton via `forwardDeepTarget`). On settle the orchestrator dispatches
 * the navigation; the destination mounts at rest with its real content.
 *
 * This spec asserts the behavioural signal that the pipeline drove the
 * slide: the NavPipelineHost track translates across the viewport during
 * the transition (the exit-preview sampler records a non-trivial m41
 * delta), and the destination route lands.
 */
test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

test.setTimeout(60_000);

test('forward /profile -> /profile/settings plays a pipeline slide (detail -> detail)', async ({
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

	// Sample the NavPipelineHost track across the forward nav. The
	// source-side interception cancels the nav, slides the track, then
	// dispatches on settle; the sampler captures the slide before the
	// source host unmounts.
	const capture = await captureExitPreview(page, async () => {
		await page.evaluate(
			(h: string) =>
				(window as unknown as { __e2eGoto?: (h: string) => Promise<void> }).__e2eGoto!(h),
			'/profile/settings'
		);
	});

	// The destination must land.
	await page.waitForFunction(() => location.pathname === '/profile/settings', { timeout: 6000 });

	// The pipeline drove a slide: the track translated a non-trivial
	// distance (the skeleton-revealing slide on the source host). A plain
	// SvelteKit passthrough (the pre-fix behaviour) records no movement.
	expect(
		capture.animated,
		`forward deep-to-deep played a pipeline slide (track delta=${capture.delta}px, samples=${capture.sampleCount})`
	).toBe(true);
	expect(capture.delta, 'track translated across the viewport').toBeGreaterThan(50);
});
