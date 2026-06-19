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

// Unit-contract regression (RV07 C05 r2 audit A4 - CRITICAL): readUpdatedAt
// must be EPOCH SECONDS, matching what passthrough writes via
// Math.floor(Date.now()/1000). A prior version wrote epoch MILLISECONDS
// (~1.78e12), which made nowSec - readUpdatedAtMs hugely negative so 'read'
// never expired and the 30-day TTL silently never fired. These cases use
// realistic-magnitude epoch-seconds anchors (~1.8e9, today-ish) so a unit
// regression (writing ms) would itself push the value far above ~2e9.
const NOW_SEC_REALISTIC = 1_800_000_000; // epoch seconds, mid-2026-ish

test('isReadStale (unit contract): fresh read at now-seconds => not stale', () => {
	expect(isReadStale(NOW_SEC_REALISTIC, NOW_SEC_REALISTIC, READ_RETENTION_DAYS)).toBe(false);
});

test('isReadStale (unit contract): read 31 days older => stale', () => {
	const readUpdatedAt = NOW_SEC_REALISTIC - 31 * DAY;
	expect(isReadStale(readUpdatedAt, NOW_SEC_REALISTIC, READ_RETENTION_DAYS)).toBe(true);
});

test('isReadStale (unit contract): read exactly 30 days older => stale (boundary, >=)', () => {
	const readUpdatedAt = NOW_SEC_REALISTIC - 30 * DAY;
	expect(isReadStale(readUpdatedAt, NOW_SEC_REALISTIC, READ_RETENTION_DAYS)).toBe(true);
});

test('isReadStale (unit contract): read 29 days older => not stale', () => {
	const readUpdatedAt = NOW_SEC_REALISTIC - 29 * DAY;
	expect(isReadStale(readUpdatedAt, NOW_SEC_REALISTIC, READ_RETENTION_DAYS)).toBe(false);
});

test('isReadStale (unit contract): epoch-ms magnitude (~1.78e12) does not parse as seconds', () => {
	// If passthrough regressed to writing Date.now() (ms), the stored value
	// would be ~1.78e12 - far in the future when read as seconds, so
	// nowSec - readUpdatedAt is hugely negative => "not stale" forever. This
	// pins the contract: any value > ~2e9 is out-of-band for a seconds field,
	// and isReadStale MUST return false on it (so a regression is visible as
	// a permanently-fresh read rather than silently corrupting the TTL).
	const msValue = 1_780_000_000_000; // epoch ms for mid-2026
	expect(isReadStale(msValue, NOW_SEC_REALISTIC, READ_RETENTION_DAYS)).toBe(false);
});
