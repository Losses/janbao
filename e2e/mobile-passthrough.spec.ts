import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

// DV07 C04 regression guard. The (tabs) layout renders NavPipelineTabHost on
// its `{#if isMobile}` branch and does NOT call `{@render children()}` there,
// so the route's own `+page.svelte` (whose `runPassthrough` covers desktop)
// never mounts on mobile. The mobile-side write lives in NavPipelineTabHost.
// This spec pins that behaviour: viewing the discussions list on a mobile
// viewport writes the rows into the offline IndexedDB store tagged with the
// 'read' reason. Without the mobile call site the store stays empty and the
// expect.poll times out.

const OFFLINE_PREFS_KEY = 'janbao:offline-prefs:v1';
const OFFLINE_DB_NAME = 'forum-offline';

test.describe('mobile discussions-list passthrough', () => {
	test('viewing the discussions list on mobile writes rows to IDB tagged "read"', async ({
		page,
		context
	}) => {
		// Seed offline prefs before first paint so `readOfflinePrefs()` sees
		// enabled+passthrough on the very first `runPassthrough` call.
		// `addInitScript` re-runs on every navigation, so the value survives
		// any cross-document swap.
		await context.addInitScript((prefsKey) => {
			localStorage.setItem(
				prefsKey,
				JSON.stringify({
					enabled: true,
					categories: { latest: false, mostViewed: false, mostReplied: false },
					depth: 'firstLast',
					refreshIntervalDays: 1,
					passthrough: true
				})
			);
		}, OFFLINE_PREFS_KEY);
		await prepareContext(context);

		await page.goto('/');
		await waitForHydration(page);

		// Prove the discussions list actually rendered (data reached the host)
		// before asserting on its IDB side-effect.
		await expect(
			page.locator('[data-tab-panel="discussions"] a[href^="/discussion/"]').first()
		).toBeVisible({ timeout: 8000 });

		// `runPassthrough` is best-effort async; poll IDB until the write lands.
		// Opening at the current version (no version arg) coexists with Dexie's
		// own connection - we never request an upgrade, so there is no blocked
		// state.
		await expect
			.poll(
				async () => {
					return await page.evaluate(async (dbName) => {
						return await new Promise<number>((resolve) => {
							const req = indexedDB.open(dbName);
							req.onsuccess = () => {
								const db = req.result;
								try {
									if (!db.objectStoreNames.contains('discussions')) {
										resolve(0);
										return;
									}
									const tx = db.transaction('discussions', 'readonly');
									const countReq = tx.objectStore('discussions').count();
									countReq.onsuccess = () => resolve(countReq.result);
									countReq.onerror = () => resolve(0);
								} finally {
									db.close();
								}
							};
							req.onerror = () => resolve(0);
						});
					}, OFFLINE_DB_NAME);
				},
				{ timeout: 10_000, intervals: [250, 500, 1000] }
			)
			.toBeGreaterThan(0);

		// Confirm the rows carry the passthrough signature (reason 'read').
		const readTaggedCount = await page.evaluate(async (dbName) => {
			return await new Promise<number>((resolve) => {
				const req = indexedDB.open(dbName);
				req.onsuccess = () => {
					const db = req.result;
					try {
						const tx = db.transaction('discussions', 'readonly');
						const getAllReq = tx.objectStore('discussions').getAll();
						getAllReq.onsuccess = () => {
							const rows = getAllReq.result as Array<{ reasons?: string[] }>;
							resolve(rows.filter((r) => r.reasons?.includes('read')).length);
						};
						getAllReq.onerror = () => resolve(0);
					} finally {
						db.close();
					}
				};
				req.onerror = () => resolve(0);
			});
		}, OFFLINE_DB_NAME);
		expect(readTaggedCount, 'rows are tagged with reason "read"').toBeGreaterThan(0);
	});
});
