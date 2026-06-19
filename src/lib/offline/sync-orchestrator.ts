import { getOfflineDB } from './idb';
import { applyEviction, expireReadReasons } from './evict';
import { flushPendingReadState } from './read-state';
import { computeCachedRanges, computeTotalPages } from './manifest';
import { recomputeManifestForDiscussion } from './manifest-recompute';
import { readOfflinePrefs, type OfflinePrefs, type OfflineReplyDepth } from './prefs';
import { prefsSignatureOf, shouldRefreshCurated, type PrefsSignature } from './refresh-policy';
import { REASON_ORDER } from './types';
import type {
	CachedDiscussion,
	CachedRange,
	CuratedSyncMetaMap,
	CuratedSyncMetaRecord,
	Reason,
	SyncMetaValue,
	SyncResult
} from './types';
import type {
	CuratedDiscussionIdSets,
	SyncContentResponse,
	SyncCursors,
	SyncUserDTO
} from '$lib/types/api';

const PAGE_LIMIT = 100;
// Cap pages per run so a single reconnect never loops unboundedly through a huge
// back-history. The cursor persists between runs, so a capped run simply resumes
// next time.
const MAX_PAGES = 20;

const EMPTY_RESULT: SyncResult = { discussions: 0, replies: 0, tombstones: 0 };

let inflight: Promise<SyncResult> | null = null;

interface CategoryReasonBinding {
	category: keyof CuratedDiscussionIdSets;
	reason: Reason;
}

// Prior front/bookmark id snapshots read ONCE at doSync start, before the
// page loop overwrites syncMeta.{frontPageSnapshot,bookmarksSnapshot}. The
// remove-delta for these two reasons must diff against the value that was
// present BEFORE this sync ran; reading inside the loop would always see the
// current sync's value (prior === current → empty remove-delta → stale
// reasons never cleared). Mirrors the curated:* prior-mirror pattern.
interface PriorFrontBookmark {
	front: number[];
	bookmarks: number[];
}

function asNumberArray(value: SyncMetaValue | undefined): number[] {
	return Array.isArray(value) ? (value.filter((v) => typeof v === 'number') as number[]) : [];
}

// Map each curated category toggle to its reason enum. Order is fixed so the
// syncMeta mirror stays deterministic for diffing (C05).
const CATEGORY_BINDINGS: readonly CategoryReasonBinding[] = [
	{ category: 'latest', reason: 'latest' },
	{ category: 'mostViewed', reason: 'mostViewed' },
	{ category: 'mostReplied', reason: 'mostReplied' }
];

interface EnabledCategories {
	enabled: CategoryReasonBinding[];
	csv: string;
}

// Resolve prefs to the curated categories + query string. When the feature is
// off OR no categories are toggled on, returns the empty set so the request is
// byte-identical to DV06 (categories=, depth=firstLast). INV-7: the server is
// stateless re: prefs - everything it learns about curation arrives via query
// params.
function resolveEnabledCategories(prefs: OfflinePrefs): EnabledCategories {
	if (!prefs.enabled) return { enabled: [], csv: '' };
	const enabled: CategoryReasonBinding[] = [];
	for (const b of CATEGORY_BINDINGS) {
		if (prefs.categories[b.category]) enabled.push(b);
	}
	if (enabled.length === 0) return { enabled: [], csv: '' };
	return { enabled, csv: enabled.map((b) => b.category).join(',') };
}

function resolveDepth(prefs: OfflinePrefs): OfflineReplyDepth {
	// !enabled OR no selected categories ⇒ DV06 wire shape (firstLast).
	// Otherwise the user's chosen depth applies.
	if (!prefs.enabled) return 'firstLast';
	const anyCategory =
		prefs.categories.latest || prefs.categories.mostViewed || prefs.categories.mostReplied;
	return anyCategory ? prefs.depth : 'firstLast';
}

/** Run one delta-sync pass. Coalesces concurrent calls into a single in-flight run. */
export async function runSync(): Promise<SyncResult> {
	if (typeof navigator !== 'undefined' && !navigator.onLine) return EMPTY_RESULT;
	if (inflight) return inflight;
	inflight = doSync().finally(() => {
		inflight = null;
	});
	return inflight;
}

async function doSync(): Promise<SyncResult> {
	const db = getOfflineDB();
	const prefs = readOfflinePrefs();
	const enabledCats = resolveEnabledCategories(prefs);
	const depth = resolveDepth(prefs);

	// DV07 C05 trigger-line split: decide whether the CURATED refresh path runs
	// this sync. The delta path (cursors + front/bookmark + read-state outbox
	// flush) always runs below unthrottled - that preserves the DV06 reconnect
	// contract. The curated path (categories= + depth= + curated reason-set
	// recompute + curated manifest merge) is throttled by the refresh interval,
	// forced when the prefs signature (enabled + categories + depth) changed
	// since the last refresh, and NEVER run when the feature is off or no
	// category is toggled on (DV06 wire shape). 'read' passthrough is owned by
	// C04 and runs on every browse regardless of this decision.
	const refreshNow = await decideRefreshCurated(prefs);

	// What the server sees this run: when NOT refreshing curated, send the
	// DV06 wire shape (categories=, depth=firstLast) so the response is
	// byte-identical to DV06 (no curatedDiscussionIds keys beyond what was
	// requested = none; firstLast backfill for the front/bookmark union). When
	// refreshing, send the user's chosen categories + depth.
	const requestCategoriesCsv = refreshNow ? enabledCats.csv : '';
	const requestDepth: OfflineReplyDepth = refreshNow ? depth : 'firstLast';

	const meta = await db.syncMeta.get('cursors');
	const stored = meta?.value as SyncCursors | null;
	let discussionsCursor = stored?.discussions;
	let repliesCursor = stored?.replies;
	let discussionTombstoneCursor = stored?.discussionTombstoneCursor;
	let replyTombstoneCursor = stored?.replyTombstoneCursor;

	// Capture the prior front/bookmark id snapshots ONCE before the page loop
	// writes them. applyReasonSets needs the pre-sync value to compute the
	// remove-delta; reading inside the loop would observe the freshly-written
	// current value (prior === current → empty remove-delta → stale reasons).
	const priorFrontRow = await db.syncMeta.get('frontPageSnapshot');
	const priorBookmarksRow = await db.syncMeta.get('bookmarksSnapshot');
	const priorFrontBookmark: PriorFrontBookmark = {
		front: asNumberArray(priorFrontRow?.value),
		bookmarks: asNumberArray(priorBookmarksRow?.value)
	};

	let totalDisc = 0;
	let totalRep = 0;
	let totalTomb = 0;

	// Curated id sets + front/bookmark ids seen on the final page; reasons are
	// applied once at the end so a multi-page sync reflects the latest server
	// snapshot (the server ships the same curated/front/bookmark sets on every
	// page - they are snapshots, not deltas).
	let latestCurated: CuratedDiscussionIdSets = {};
	let latestFront: number[] = [];
	let latestBookmarks: number[] = [];
	let latestReplyPageSize = 0;

	for (let page = 0; page < MAX_PAGES; page++) {
		const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
		if (discussionsCursor) params.set('discussionsCursor', discussionsCursor);
		if (repliesCursor) params.set('repliesCursor', repliesCursor);
		if (discussionTombstoneCursor)
			params.set('discussionTombstoneCursor', discussionTombstoneCursor);
		if (replyTombstoneCursor) params.set('replyTombstoneCursor', replyTombstoneCursor);
		// DV07 prefs surface as query params. The empty-categories path matches
		// DV06 exactly (no curated sets returned, firstLast depth).
		params.set('categories', requestCategoriesCsv);
		params.set('depth', requestDepth);

		const res = await fetch(`/api/sync/content?${params.toString()}`);
		if (!res.ok) throw new Error(`content sync failed: ${res.status}`);
		const data: SyncContentResponse = await res.json();
		const now = Date.now();

		// Apply this page atomically: upsert new/edited, delete tombstones.
		// Existing rows keep their `reasons` / `readUpdatedAt` (the upsert below
		// only refreshes content + cachedAt); reason recompute happens once at
		// the end via applyReasonSets so a tombstone that wipes a row mid-loop
		// can't leave a dangling reason on the survivor.
		await db.transaction('rw', db.discussions, db.replies, db.users, db.activities, async () => {
			if (data.discussions.length) {
				// Carry forward the row's existing reasons/readUpdatedAt across
				// the content upsert. The category/front/bookmark reasons are
				// recomputed authoritatively after the loop; 'read' is owned by
				// the passthrough layer (C04) and is never touched here.
				const incomingIds = data.discussions.map((d) => d.id);
				const existingById = new Map<number, CachedDiscussion>();
				const existingRows = await db.discussions.bulkGet(incomingIds);
				for (const ex of existingRows) {
					if (ex) existingById.set(ex.id, ex);
				}
				const merged: CachedDiscussion[] = data.discussions.map((d) =>
					mergeDiscussionUpsert(d, existingById.get(d.id), now)
				);
				await db.discussions.bulkPut(merged);
			}
			if (data.replies.length) {
				await db.replies.bulkPut(data.replies.map((r) => ({ ...r, cachedAt: now })));
			}
			if (data.users.length) {
				await db.users.bulkPut(data.users.map((u) => ({ ...u, cachedAt: now })));
			}
			for (const t of data.discussionTombstones) await db.discussions.delete(t.id);
			for (const t of data.replyTombstones) await db.replies.delete(t.id);
			if (data.backfillReplies.length) {
				await db.replies.bulkPut(data.backfillReplies.map((r) => ({ ...r, cachedAt: now })));
			}
			// Activities are a first-page snapshot: clear + repopulate so rows that
			// scrolled off the feed don't linger. Idempotent across sync pages.
			await db.activities.clear();
			if (data.activities.length) {
				await db.activities.bulkPut(data.activities.map((a) => ({ ...a, cachedAt: now })));
			}
		});

		totalDisc += data.discussions.length;
		totalRep += data.replies.length;
		totalTomb += data.discussionTombstones.length + data.replyTombstones.length;

		latestCurated = data.curatedDiscussionIds;
		latestFront = data.frontPageDiscussionIds;
		latestBookmarks = data.bookmarkedDiscussionIds;
		latestReplyPageSize = data.replyPageSize;

		// Persist advanced cursors + server-echoed snapshots before continuing, so a
		// mid-sync abort retries the same page (cursors only move after a 200).
		const cursors: SyncCursors = data.cursors;
		discussionsCursor = cursors.discussions;
		repliesCursor = cursors.replies;
		discussionTombstoneCursor = cursors.discussionTombstoneCursor;
		replyTombstoneCursor = cursors.replyTombstoneCursor;
		await db.syncMeta.bulkPut([
			{ key: 'cursors', value: cursors },
			{ key: 'retentionDays', value: data.retentionDays },
			{ key: 'serverTimeSkew', value: data.serverTimeSeconds - Math.floor(now / 1000) },
			{ key: 'frontPageSnapshot', value: data.frontPageDiscussionIds },
			{ key: 'bookmarksSnapshot', value: data.bookmarkedDiscussionIds },
			{ key: 'lastSyncAt', value: now }
		]);

		const more = data.hasMore.discussions || data.hasMore.replies || data.hasMore.tombstones;
		if (!more) break;
	}

	// DV07: apply reason sets + populate reply-cache manifest now that the final
	// server snapshot is known. The curated branch runs ONLY when refreshNow is
	// true (C05 throttle); the front/bookmark branch always runs (delta path).
	// Reads back the upserted discussions so reasons reflect their actual
	// content (a backfilled curated entrant has commentCount populated; the
	// manifest needs it for totalPages).
	await applyReasonSets(
		latestCurated,
		latestFront,
		latestBookmarks,
		enabledCats.enabled,
		priorFrontBookmark,
		refreshNow
	);
	// DV07 C04: merge the depth-policy page ranges into each curated/front/
	// bookmark discussion's manifest. This is the AUTHORITATIVE manifest update
	// path for sync — it unions the depth-derived ranges into whatever the
	// manifest already holds (which may include passthrough-cached pages from
	// C04), so no lost updates. The replies-store read inside the helper drops
	// ranges whose backing replies were since evicted. Curated ids are only
	// included when refreshNow is true (otherwise their manifest is left as the
	// last refresh left it; front/bookmark always update).
	await mergeDepthRangesIntoManifests(
		refreshNow ? latestCurated : {},
		latestFront,
		latestBookmarks,
		depth,
		latestReplyPageSize
	);

	// C05: persist the curated-refresh watermark + prefs signature only when
	// we actually refreshed. When skipped, the prior values stay so the next
	// sync's throttle comparison remains monotone against the LAST refresh.
	if (refreshNow) {
		const signature = prefsSignatureOf(prefs);
		await db.syncMeta.bulkPut([
			{ key: 'lastCuratedRefreshAt', value: Math.floor(Date.now() / 1000) },
			{ key: 'lastCuratedPrefsSignature', value: signature }
		]);
	}

	// C05: read-reason 30-day TTL step. Drops 'read' from discussions whose
	// readUpdatedAt is older than READ_RETENTION_DAYS; cascade-deletes the row
	// if no other reason survives. NEVER touches readStatePending. Runs before
	// applyEviction so the two phases don't fight over the same row.
	await expireReadReasons();
	await applyEviction();
	await flushPendingReadState();
	await backfillMissingUsers();

	return { discussions: totalDisc, replies: totalRep, tombstones: totalTomb };
}

// DV07 C05 throttle decision wrapper. Reads the persisted refresh watermark +
// prefs signature from syncMeta once, then delegates to the pure
// shouldRefreshCurated helper. Kept as a named function (not inlined) so the
// I/O boundary is testable separately from the pure decision.
async function decideRefreshCurated(prefs: OfflinePrefs): Promise<boolean> {
	const db = getOfflineDB();
	const hasAnyCategory =
		prefs.categories.latest || prefs.categories.mostViewed || prefs.categories.mostReplied;
	const lastRefreshRow = await db.syncMeta.get('lastCuratedRefreshAt');
	const lastSignatureRow = await db.syncMeta.get('lastCuratedPrefsSignature');
	const lastRefreshAt =
		typeof lastRefreshRow?.value === 'number' ? lastRefreshRow.value : undefined;
	const lastSignature =
		typeof lastSignatureRow?.value === 'string' ? lastSignatureRow.value : undefined;
	return shouldRefreshCurated({
		nowSec: Math.floor(Date.now() / 1000),
		lastCuratedRefreshAtSec: lastRefreshAt,
		intervalDays: prefs.refreshIntervalDays,
		prefsSignature: prefsSignatureOf(prefs),
		storedSignature: lastSignature as PrefsSignature | undefined,
		enabled: prefs.enabled,
		hasAnyCategory
	});
}

// Merge incoming discussion content with the row's existing DV07 bookkeeping
// (reasons / readUpdatedAt). bulkPut can't run an async mapper per row, so the
// caller awaits these in a separate pass before bulkPut. We avoid that pattern
// here by doing the merge eagerly: read-then-write would race under multi-tab
// HMR; instead we upsert the merged snapshot, carrying forward any prior
// reasons/readUpdatedAt untouched (the reason recompute below is authoritative
// for category/front/bookmark reasons; 'read' is owned by the passthrough layer).
function mergeDiscussionUpsert(
	incoming: SyncContentResponse['discussions'][number],
	existing: CachedDiscussion | undefined,
	now: number
): CachedDiscussion {
	const merged: CachedDiscussion = { ...incoming, cachedAt: now };
	if (existing?.reasons) merged.reasons = existing.reasons;
	if (existing?.readUpdatedAt !== undefined) merged.readUpdatedAt = existing.readUpdatedAt;
	return merged;
}

interface ReasonDelta {
	add: Set<number>;
	remove: Set<number>;
}

// Recompute the curated/front/bookmark reasons across the cache:
//   - For every enabled category, union that category's reason onto every id
//     in the freshly-fetched set; remove it from ids no longer in the set.
//   - Front + bookmark are mirrored into reasons the same way (unifying DV06's
//     exemption into the reason set so eviction by empty-reasons covers them).
//   - 'read' is never touched here - passthrough (C04) owns it.
//
// The curated.{cat} records are mirrored into syncMeta so C05 can diff the
// next sync's sets against them. fetchAt is the sync's wall-clock start so
// the diff is monotone even across reconnects within the same second.
async function applyReasonSets(
	curated: CuratedDiscussionIdSets,
	front: number[],
	bookmarks: number[],
	enabledCats: CategoryReasonBinding[],
	priorFrontBookmark: PriorFrontBookmark,
	curatedRefresh: boolean
): Promise<void> {
	const db = getOfflineDB();
	const fetchedAt = Date.now();

	// Build per-reason add/remove maps from the new snapshots.
	const addByReason = new Map<Reason, Set<number>>();
	const removeByReason = new Map<Reason, Set<number>>();

	function ensure(reason: Reason): ReasonDelta {
		let add = addByReason.get(reason);
		let remove = removeByReason.get(reason);
		if (!add) {
			add = new Set<number>();
			addByReason.set(reason, add);
		}
		if (!remove) {
			remove = new Set<number>();
			removeByReason.set(reason, remove);
		}
		return { add, remove };
	}

	// Curated reasons only apply to enabled categories AND only when the C05
	// throttle allowed a curated refresh this run. When curatedRefresh is false,
	// the curated branch is skipped entirely: the server was asked
	// categories=empty so `curated` is empty, AND we must NOT re-derive the
	// curated reasons from the prior syncMeta mirror — the last refresh's
	// curated reasons must persist untouched until the next refresh window.
	// (Re-deriving here against an empty `curated` set would shed every
	// curated reason, the exact failure the throttle is meant to prevent.)
	//
	// A category the user toggled off mid-session must shed its reason so the
	// row drops out on the next empty-reasons eviction - hence on a refresh we
	// always compute remove from the ids that USED to carry it.
	const curatedMap: CuratedSyncMetaMap = {};
	if (curatedRefresh) {
		for (const b of CATEGORY_BINDINGS) {
			const priorRow = await db.syncMeta.get(`curated:${b.category}`);
			const prior =
				typeof priorRow?.value === 'object' && priorRow?.value !== null
					? (priorRow.value as CuratedSyncMetaRecord)
					: undefined;
			const priorIds = prior?.ids ?? [];
			const isActive = enabledCats.some((e) => e.category === b.category);
			const nextIds = isActive ? (curated[b.category] ?? []) : [];

			const delta = ensure(b.reason);
			for (const id of nextIds) delta.add.add(id);
			for (const id of priorIds) {
				if (!nextIds.includes(id)) delta.remove.add(id);
			}

			// Mirror for C05 diffing. Always written (even when inactive) so the
			// next sync sees an empty set rather than a stale prior snapshot.
			curatedMap[b.category] = { ids: nextIds, fetchedAt };
		}
	}

	// Front + bookmark reasons. The server echoes the full snapshot on every
	// page, so the latest one is authoritative. The remove-delta uses the PRIOR
	// snapshot captured at doSync start (before the loop overwrote the syncMeta
	// row); reading syncMeta here would return the current sync's value and
	// produce an empty remove-delta (the round-1 bug).
	const frontDelta = ensure('front');
	for (const id of front) frontDelta.add.add(id);
	for (const id of priorFrontBookmark.front) {
		if (!front.includes(id)) frontDelta.remove.add(id);
	}

	const bookmarkDelta = ensure('bookmark');
	for (const id of bookmarks) bookmarkDelta.add.add(id);
	for (const id of priorFrontBookmark.bookmarks) {
		if (!bookmarks.includes(id)) bookmarkDelta.remove.add(id);
	}

	// Apply the delta to every affected row. We touch only rows whose reason
	// set actually changes so a no-op sync doesn't churn the discussion store.
	const affectedIds = new Set<number>();
	for (const set of [...addByReason.values(), ...removeByReason.values()]) {
		for (const id of set) affectedIds.add(id);
	}
	if (affectedIds.size === 0) {
		if (curatedRefresh) await persistCuratedMeta(curatedMap);
		return;
	}

	const rows = await db.discussions.bulkGet([...affectedIds]);
	const updates: CachedDiscussion[] = [];
	for (const row of rows) {
		if (!row) continue;
		const nextReasons = recomputeReasons(row, addByReason, removeByReason);
		// 'read' is preserved across curated/front/bookmark recompute - only
		// passthrough (C04) / TTL (C05) may touch it.
		updates.push({ ...row, reasons: nextReasons });
	}
	if (updates.length) await db.discussions.bulkPut(updates);
	if (curatedRefresh) await persistCuratedMeta(curatedMap);
}

function recomputeReasons(
	row: CachedDiscussion,
	addByReason: Map<Reason, Set<number>>,
	removeByReason: Map<Reason, Set<number>>
): Reason[] {
	const set = new Set<Reason>(row.reasons ?? []);
	for (const [reason, ids] of addByReason) {
		if (ids.has(row.id)) set.add(reason);
	}
	for (const [reason, ids] of removeByReason) {
		if (ids.has(row.id)) set.delete(reason);
	}
	// Deterministic order so the row's reasons array is stable across syncs
	// (avoids spurious diff noise in C05 / displays).
	return REASON_ORDER.filter((r) => set.has(r));
}

async function persistCuratedMeta(map: CuratedSyncMetaMap): Promise<void> {
	const db = getOfflineDB();
	const rows = [
		{ key: 'curated:latest', value: map.latest ?? { ids: [], fetchedAt: Date.now() } },
		{ key: 'curated:mostViewed', value: map.mostViewed ?? { ids: [], fetchedAt: Date.now() } },
		{ key: 'curated:mostReplied', value: map.mostReplied ?? { ids: [], fetchedAt: Date.now() } }
	];
	await db.syncMeta.bulkPut(rows);
}

// For each curated + front + bookmark discussion, merge the depth-policy page
// ranges into the manifest. This is the AUTHORITATIVE manifest update path for
// sync: it unions the depth-derived ranges (e.g. firstLast = [1,1] + [last,last])
// into whatever the manifest already holds (which may include passthrough-cached
// pages from C04). The replies-store read inside the helper drops ranges whose
// backing replies were since evicted, so the manifest can never claim a page
// that isn't actually cached.
async function mergeDepthRangesIntoManifests(
	curated: CuratedDiscussionIdSets,
	front: number[],
	bookmarks: number[],
	depth: OfflineReplyDepth,
	pageSize: number
): Promise<void> {
	if (pageSize <= 0) return;
	const db = getOfflineDB();
	const ids = new Set<number>([...front, ...bookmarks]);
	for (const cat of CATEGORY_BINDINGS) {
		for (const id of curated[cat.category] ?? []) ids.add(id);
	}
	if (ids.size === 0) return;
	const rows = await db.discussions.bulkGet([...ids]);
	for (const row of rows) {
		if (!row) continue;
		// commentCount includes the OP; the paginated reply stream excludes it
		// (thread route derives totalPages the same way). Shared helper keeps the
		// orchestrator honest vs recomputeManifestForDiscussion + the renderer.
		const totalPages = computeTotalPages(row.commentCount, pageSize);
		const ranges: CachedRange[] = computeCachedRanges(
			depth,
			totalPages,
			pageSize,
			row.commentCount
		);
		for (const range of ranges) {
			await recomputeManifestForDiscussion(db, row.id, row.commentCount, pageSize, range);
		}
	}
}

async function backfillMissingUsers(): Promise<void> {
	const db = getOfflineDB();
	const allDisc = await db.discussions.toArray();
	const allRep = await db.replies.toArray();
	const authorIds = new Set<number>();
	for (const d of allDisc) authorIds.add(d.authorId);
	for (const r of allRep) {
		authorIds.add(r.authorId);
		if (r.editedBy) authorIds.add(r.editedBy);
	}
	const cachedUserIds = new Set((await db.users.toArray()).map((u) => u.id));
	const missing = [...authorIds].filter(
		(id) => !cachedUserIds.has(id) && Number.isFinite(id) && id > 0
	);
	if (missing.length === 0) return;

	const BATCH = 500;
	for (let i = 0; i < missing.length; i += BATCH) {
		const batch = missing.slice(i, i + BATCH);
		const res = await fetch(`/api/sync/content?backfillUserIds=${batch.join(',')}`);
		if (!res.ok) return;
		const data = (await res.json()) as BackfillUsersResponse;
		if (data.users?.length) {
			const now = Date.now();
			await db.users.bulkPut(
				data.users.map((u) => ({
					id: u.id,
					displayName: u.displayName,
					username: u.username,
					avatarFileId: u.avatarFileId,
					avatarContentType: u.avatarContentType ?? null,
					cachedAt: now
				}))
			);
		}
	}
}

interface BackfillUsersResponse {
	users?: SyncUserDTO[];
}
