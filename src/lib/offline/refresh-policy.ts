// DV07 C05 - pure helpers for the curated-refresh throttle + the read-reason
// TTL. Extracted from the orchestrator so the boundary decisions are unit-
// testable without a Dexie harness (matches the pattern of manifest.ts /
// gap-placement.ts): the IDB-touching half is exercised via the integration
// audit, the pure decision functions are pinned here.
//
// INVARIANT (Plan §Trigger lines are distinct):
//   - Delta sync (cursors + front/bookmark + read-state outbox flush) runs
//     unthrottled on every reconnect/mount.
//   - Curated refresh (categories= + depth= + curated reason-set recompute +
//     curated manifest merge) is gated by these helpers.
//   - Read passthrough (C04) writes on every browse regardless of throttle.
//
// All clocks here are EPOCH SECONDS (client wall clock). The orchestrator
// converts from ms at the call site so the helpers are unit-agnostic about
// Date.now() units.

import type { OfflinePrefs, OfflineRefreshIntervalDays } from './prefs';

// Client-side TTL for the 'read' reason. Distinct from the server's
// OFFLINE_RETENTION_DAYS (=14, legacy fallback for rows lacking a reasons
// array). A read-cached discussion whose readUpdatedAt is older than this is
// treated as stale: the 'read' reason is dropped (and the row is
// cascade-deleted if no other reason survives). Re-entering the thread online
// (passthrough) refreshes readUpdatedAt so active reads never expire.
export const READ_RETENTION_DAYS = 30;

const DAY_SECONDS = 86400;

// A normalized string form of the prefs fields that govern cached content.
// Used to detect "the user changed something that should force an immediate
// curated refresh this run, even if the throttle window hasn't elapsed". Any
// change to enable / categories / depth invalidates the stored signature and
// forces a refresh; refreshIntervalDays + passthrough are intentionally NOT
// part of the signature (they affect cadence / read-path only, not the set
// of rows that should be cached).
export type PrefsSignature = string;

interface PrefsSignatureInput {
	enabled: boolean;
	latest: boolean;
	mostViewed: boolean;
	mostReplied: boolean;
	depth: string;
}

export function prefsSignature(input: PrefsSignatureInput): PrefsSignature {
	return [
		input.enabled ? 1 : 0,
		input.latest ? 1 : 0,
		input.mostViewed ? 1 : 0,
		input.mostReplied ? 1 : 0,
		input.depth
	].join(':');
}

export function prefsSignatureOf(prefs: OfflinePrefs): PrefsSignature {
	return prefsSignature({
		enabled: prefs.enabled,
		latest: prefs.categories.latest,
		mostViewed: prefs.categories.mostViewed,
		mostReplied: prefs.categories.mostReplied,
		depth: prefs.depth
	});
}

// Whether the curated refresh should run this sync. Pure decision: the
// orchestrator reads the persisted state (lastCuratedRefreshAt epoch seconds,
// lastCuratedPrefsSignature) once and passes them in. Rules (deliverable 2):
//   - !enabled OR no categories toggled on  -> NEVER (DV06 path; curated
//     reasons are not touched at all, since they were never set).
//   - prefs signature changed since last refresh -> FORCE (covers C03's
//     "sync after pref change" nicety + any category toggle, without an
//     explicit signal from the settings UI).
//   - else: throttle - refresh iff now - lastCuratedRefreshAt >= interval*86400.
//
// `lastCuratedRefreshAt` may be undefined on the first ever run, in which
// case the elapsed comparison falls through to "force" (no prior refresh
// exists, so the interval is treated as already elapsed).
export interface ShouldRefreshCuratedInput {
	nowSec: number;
	lastCuratedRefreshAtSec: number | undefined;
	intervalDays: OfflineRefreshIntervalDays;
	prefsSignature: PrefsSignature;
	storedSignature: PrefsSignature | undefined;
	enabled: boolean;
	hasAnyCategory: boolean;
}

export function shouldRefreshCurated(input: ShouldRefreshCuratedInput): boolean {
	if (!input.enabled || !input.hasAnyCategory) return false;
	if (input.storedSignature !== input.prefsSignature) return true;
	const last = input.lastCuratedRefreshAtSec;
	if (last === undefined) return true;
	return input.nowSec - last >= input.intervalDays * DAY_SECONDS;
}

// Pure decision for the read-reason TTL step. True iff the 'read' reason on
// a discussion with this readUpdatedAt (epoch seconds) is stale enough to be
// dropped this run. Exactly 30 days elapsed => stale (>=, not >).
export function isReadStale(
	readUpdatedAtSec: number | undefined,
	nowSec: number,
	retentionDays: number
): boolean {
	if (readUpdatedAtSec === undefined) return false;
	return nowSec - readUpdatedAtSec >= retentionDays * DAY_SECONDS;
}
