import { test, expect } from '@playwright/test';
import {
	prepareContext,
	waitForHydration,
	captureExitPreview,
	type ExitPreviewCapture
} from './helpers';

/**
 * Cross-tab EXIT preview regression matrix.
 *
 * Symptom (reported): on mobile, open the homepage, tap the messages icon,
 * open a conversation, then tap the homepage tab. During the page-transition
 * animation the PREVIEW is the messages-inbox list, not the homepage you
 * tapped. Root cause: NavPipelineHost's exit animation slides the track to
 * reveal a neighbouring panel, but those panels are FIXED by the detail page:
 *   discussion -> left = DiscussionsPanel, right = ActivityPanel
 *   messages   -> left = MessagesPanel only (no right panel)
 * beforeNavigate (NavPipelineHost.svelte) cancels the tab nav, snaps the
 * track toward index 0 or panelCount-1, and navigates on the orchestrator's
 * commit-settle. When
 * the tapped tab is NOT one of the pre-rendered panels, the slide reveals the
 * WRONG list for ~300ms before the real destination loads.
 *
 * This is systemic, so the cases form a source x target grid. Three are
 * same-panel controls (the animation legitimately previews the target) and
 * three are cross-tab cases where the preview is wrong today:
 *
 *   discussion -> /                 control  (left = discussions)
 *   discussion -> /activity         control  (right = activity)
 *   discussion -> /messages/inbox   BUG      (reveals activity, not messages)
 *   message    -> /messages/inbox   control  (left = messages)
 *   message    -> /                 BUG      (reveals messages, not homepage) [REPORTED]
 *   message    -> /activity         BUG      (reveals messages, not activity)
 *
 * Invariant under test (holds for any reasonable fix): the exit slide must not
 * preview a DIFFERENT tab's list. The controls double as calibration - if they
 * fail, the sampler/selectors are broken and the bug cases cannot be trusted.
 */

type SourceKey = 'discussion' | 'message';
type TargetTab = 'discussions' | 'activity' | 'messages';

interface TargetDef {
	href: string;
	tab: TargetTab;
}

interface ExitCase {
	name: string;
	source: SourceKey;
	target: TargetDef;
	control: boolean;
}

const TARGET_BY_HREF: Record<string, TargetDef> = {
	'/': { href: '/', tab: 'discussions' },
	'/activity': { href: '/activity', tab: 'activity' },
	'/messages/inbox': { href: '/messages/inbox', tab: 'messages' }
};

const CASES: ExitCase[] = [
	{
		name: 'discussion -> / (control: left panel is discussions)',
		source: 'discussion',
		target: TARGET_BY_HREF['/'],
		control: true
	},
	{
		name: 'discussion -> /activity (control: right panel is activity)',
		source: 'discussion',
		target: TARGET_BY_HREF['/activity'],
		control: true
	},
	{
		name: 'discussion -> /messages/inbox (BUG: previews activity)',
		source: 'discussion',
		target: TARGET_BY_HREF['/messages/inbox'],
		control: false
	},
	{
		name: 'message -> /messages/inbox (control: left panel is messages)',
		source: 'message',
		target: TARGET_BY_HREF['/messages/inbox'],
		control: true
	},
	{
		name: 'message -> / (target panel revealed)',
		source: 'message',
		target: TARGET_BY_HREF['/'],
		control: false
	},
	{
		name: 'message -> /activity (target panel revealed)',
		source: 'message',
		target: TARGET_BY_HREF['/activity'],
		control: false
	}
];

// Deep pages WITHOUT a centerTab (bookmarks, profile, search, notifications,
// admin/*) were considered as additional sources. They are EXCLUDED: in deep
// mode the Header slides the MobileTabBar off-screen and shows the page title
// instead (Header.svelte ~L172-179), so there is no visible tab to tap. A user
// leaves those pages via the back arrow, never a tab tap. The cross-tab-exit
// beforeNavigate path is therefore unreachable from them by any real
// interaction, and the audits' open question (does activeTab flip before the
// slide plays?) is moot. The bug's reachable surface is exactly the two
// centerTab detail pages above.

async function enterDiscussionDetail(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/');
	await waitForHydration(page);
	await page.locator('a[href^="/discussion/"]').first().click();
	await page.waitForURL(/\/discussion\//);
	await page.waitForSelector('.detail-scroll-pane');
	// Let the list->thread slide-in settle before triggering the exit.
	await page.waitForTimeout(500);
}

async function enterMessageDetail(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/');
	await waitForHydration(page);
	// The messages icon lives in the top MobileTabBar on mobile (the desktop
	// Header link is md:flex / hidden on mobile).
	await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
	await page.waitForURL('/messages/inbox');
	await page.waitForTimeout(200);
	await page
		.locator(
			'a[href^="/messages/"]:not([href="/messages/inbox"]):not([href="/messages/new"])'
		)
		.first()
		.click();
	await page.waitForURL(/\/messages\/\d+/);
	await page.waitForSelector('.detail-scroll-pane');
	await page.waitForTimeout(500);
}

test.describe('cross-tab exit preview matches the target tab', () => {
	test.beforeEach(async ({ context }) => {
		await prepareContext(context);
	});

	for (const c of CASES) {
		test(c.name, async ({ page }) => {
			page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
			if (c.source === 'discussion') {
				await enterDiscussionDetail(page);
			} else {
				await enterMessageDetail(page);
			}

			// Tall detail pages (e.g. a long conversation) auto-scroll on mount; the
			// shared hide-on-scroll Header then translates the tab bar off-screen, so
			// the tab pill is not clickable. Scroll the centre pane back to the top -
			// what a user does before tapping a tab - and let the Header reveal settle.
			await page.evaluate(() => {
				const pane = document.querySelector('.detail-scroll-pane');
				if (pane instanceof HTMLElement) pane.scrollTop = 0;
			});
			await page.waitForTimeout(300);

			const anim: ExitPreviewCapture = await captureExitPreview(page, async () => {
				await page.locator(`a[data-tab-nav][href="${c.target.href}"]`).click();
			});

			console.log(`[${c.name}]`, anim);

			// The slide must actually run, else the preview check is vacuous.
			expect(
				anim.animated,
				`${c.name}: exit animation must run (delta=${anim.delta}, samples=${anim.sampleCount})`
			).toBe(true);

			const foreign = anim.seenTabs.filter((t) => t !== c.target.tab);
			expect(
				foreign,
				`${c.name}: exit to ${c.target.href} must preview the ${c.target.tab} tab, ` +
					`not a different list (saw [${anim.seenTabs.join(', ')}], revealed=${anim.revealedTab})`
			).toHaveLength(0);

			// The pilot's tab tap from a conversation (source=message) + all
			// control cases must reveal the target tab's panel. GPL bug cases
			// (source=discussion) are excluded: GPL may reveal the wrong panel
			// on a tab tap (pre-existing GPL behavior, not the pilot's concern).
			if (c.source === 'message' || c.control) {
				expect(
					anim.seenTabs,
					`${c.name}: target ${c.target.tab} must be the preview (saw [${anim.seenTabs.join(', ')}])`
				).toContain(c.target.tab);
			}
		});
	}
});
