// Pure-function unit tests for the DV07 C05 curated-refresh throttle +
// read-reason TTL decisions. No Dexie harness (matches manifest.ts /
// gap-placement.ts test pattern): the IDB-touching half of these decisions
// is exercised via the integration audit (RV07-C05-*).
import { test, expect } from 'bun:test';
import {
	isReadStale,
	prefsSignature,
	prefsSignatureOf,
	READ_RETENTION_DAYS,
	shouldRefreshCurated
} from './refresh-policy';
import { DEFAULT_OFFLINE_PREFS } from './prefs';

const DAY = 86400;
const NOW = 10_000_000_000; // arbitrary fixed epoch-seconds anchor

function baseInput(overrides: Partial<Parameters<typeof shouldRefreshCurated>[0]> = {}) {
	return {
		nowSec: NOW,
		lastCuratedRefreshAtSec: undefined,
		intervalDays: 1 as const,
		prefsSignature: prefsSignatureOf({ ...DEFAULT_OFFLINE_PREFS, enabled: true }),
		storedSignature: undefined,
		enabled: true,
		hasAnyCategory: true,
		...overrides
	};
}

test('shouldRefreshCurated: !enabled => never', () => {
	expect(shouldRefreshCurated(baseInput({ enabled: false }))).toBe(false);
});

test('shouldRefreshCurated: no categories => never', () => {
	expect(shouldRefreshCurated(baseInput({ hasAnyCategory: false }))).toBe(false);
});

test('shouldRefreshCurated: first run (no lastRefreshAt) => force', () => {
	expect(shouldRefreshCurated(baseInput({ lastCuratedRefreshAtSec: undefined }))).toBe(true);
});

test('shouldRefreshCurated: signature mismatch => force even within window', () => {
	// 0s elapsed (well inside a 1-day window) but signature changed:
	expect(
		shouldRefreshCurated(
			baseInput({
				lastCuratedRefreshAtSec: NOW,
				intervalDays: 1,
				prefsSignature: 'new-sig',
				storedSignature: 'old-sig'
			})
		)
	).toBe(true);
});

test('shouldRefreshCurated: signature match + just-under interval => skip', () => {
	const interval = 1;
	const elapsed = interval * DAY - 1; // one second short
	expect(
		shouldRefreshCurated(
			baseInput({
				lastCuratedRefreshAtSec: NOW - elapsed,
				intervalDays: interval,
				prefsSignature: 'sig',
				storedSignature: 'sig'
			})
		)
	).toBe(false);
});

test('shouldRefreshCurated: signature match + exactly at interval => refresh (>=)', () => {
	const interval = 3;
	const elapsed = interval * DAY;
	expect(
		shouldRefreshCurated(
			baseInput({
				lastCuratedRefreshAtSec: NOW - elapsed,
				intervalDays: interval,
				prefsSignature: 'sig',
				storedSignature: 'sig'
			})
		)
	).toBe(true);
});

test('shouldRefreshCurated: signature match + over interval => refresh', () => {
	const interval = 7;
	const elapsed = interval * DAY + 1000;
	expect(
		shouldRefreshCurated(
			baseInput({
				lastCuratedRefreshAtSec: NOW - elapsed,
				intervalDays: interval,
				prefsSignature: 'sig',
				storedSignature: 'sig'
			})
		)
	).toBe(true);
});

test('prefsSignature: changes when enabled flips', () => {
	const off = prefsSignatureOf(DEFAULT_OFFLINE_PREFS);
	const on = prefsSignatureOf({ ...DEFAULT_OFFLINE_PREFS, enabled: true });
	expect(off).not.toBe(on);
});

test('prefsSignature: stable across refreshIntervalDays / passthrough changes', () => {
	// Interval + passthrough are intentionally NOT part of the signature -
	// they affect cadence / read-path, not the cached content set.
	const a = prefsSignatureOf({ ...DEFAULT_OFFLINE_PREFS, refreshIntervalDays: 1 });
	const b = prefsSignatureOf({ ...DEFAULT_OFFLINE_PREFS, refreshIntervalDays: 7 });
	expect(a).toBe(b);
	const c = prefsSignatureOf({ ...DEFAULT_OFFLINE_PREFS, passthrough: true });
	const d = prefsSignatureOf({ ...DEFAULT_OFFLINE_PREFS, passthrough: false });
	expect(c).toBe(d);
});

test('prefsSignature: deterministic shape (5 colon-separated fields)', () => {
	const sig = prefsSignature({
		enabled: true,
		latest: false,
		mostViewed: true,
		mostReplied: false,
		depth: 'all'
	});
	expect(sig).toBe('1:0:1:0:all');
});

test('isReadStale: exactly 30 days => stale (>=)', () => {
	expect(isReadStale(NOW - READ_RETENTION_DAYS * DAY, NOW, READ_RETENTION_DAYS)).toBe(true);
});

test('isReadStale: just under 30 days => kept', () => {
	expect(isReadStale(NOW - READ_RETENTION_DAYS * DAY + 1, NOW, READ_RETENTION_DAYS)).toBe(false);
});

test('isReadStale: undefined readUpdatedAt => not stale (legacy row, leave to applyEviction)', () => {
	expect(isReadStale(undefined, NOW, READ_RETENTION_DAYS)).toBe(false);
});

test('isReadStale: far-future readUpdatedAt => not stale', () => {
	expect(isReadStale(NOW + DAY, NOW, READ_RETENTION_DAYS)).toBe(false);
});
