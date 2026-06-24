/**
 * Backfill users the original crawl never fetched.
 *
 * The original crawler only discovered users that appeared on category /
 * discussion pages (posters + commenters on crawled threads). janbao.net issues
 * near-continuous user IDs up to ~57541, so every non-poster (~54k IDs) was
 * never crawled: their profile + avatar are absent, and they render as
 * placeholders / "unknown" wherever referenced. This script fills that gap.
 *
 * Three modes:
 *
 *   crawl  Fetch every missing user's profile page + avatar into the SHARED
 *          data dir (profiles/<id>/profile.html, profile-avatars/<id>-<sha>.<ext>),
 *          checkpointed to profile-recrawl.jsonl. Idempotent + resumable: re-scan
 *          on-disk state each run, skip ids already done / known-deleted.
 *          Never touches any DB.
 *
 *   sql    Parse the recrawled profiles, upload their avatars to pCloud, and
 *          emit recrawl-profiles.sql (INSERT OR IGNORE for new users, guarded
 *          UPDATE for placeholders / avatar gaps). The local .local.db is read
 *          ONLY to classify INSERT-vs-UPDATE; the .sql is applied to prod.
 *
 *   avatars  Convert (cwebp/gif2webp) + upload EVERY crawled user's avatar to
 *          pCloud /avatars/<id>, mirroring import-data §4.7. Idempotent (lists
 *          pCloud /avatars first, skips what's there). Safe to run in PARALLEL
 *          with a `crawl` (own log file) and to re-run after it for new avatars.
 *
 * Usage:
 *   JANBAO_COOKIE='Talk=...; Talk-tk=...; ...' \
 *     bun run scripts/recrawl-missing-profiles.ts crawl /home/losses/Downloads/data
 *   bun run scripts/recrawl-missing-profiles.ts sql  /home/losses/Downloads/data
 *   bun run scripts/recrawl-missing-profiles.ts avatars /home/losses/Downloads/data
 *
 * Env (crawl): JANBAO_MAX_ID (default 57541), JANBAO_PROBE_AHEAD (default 1000),
 *   JANBAO_CONCURRENCY (4), JANBAO_DELAY (500), JANBAO_DRY=1, JANBAO_NO_AVATARS=1,
 *   JANBAO_PROFILE_PATH (default '/profile/{id}/activities'), JANBAO_SANITY_LIVE_ID (default 9),
 *   JANBAO_LIMIT (0 = no cap; cap targets to first N, for test slices).
 * Env (sql):   LOCAL_DB_PATH (default .local.db) + PCLOUD_* (uploads; skip if unset).
 */
import {
	readdirSync,
	existsSync,
	readFileSync,
	writeFileSync,
	appendFileSync,
	mkdirSync,
	copyFileSync
} from 'fs';
import { join } from 'path';
import { createHash, randomUUID } from 'crypto';
import { createClient } from '@libsql/client';
import {
	parseProfileHtml,
	convertToWebp,
	ensureWebpTools,
	mapPool,
	getErrorMessage,
	type PoolTask
} from './import-shared';
import { resolvePcloudConfig, pcloudUploadBytes, pcloudListFolder } from '../src/lib/server/pcloud';

const BASE = 'https://janbao.net';
// Separate log per mode so a parallel `avatars` run can't interleave with a
// concurrent `crawl` run's append to the same file.
const LOG_FILE = process.argv[2] === 'avatars' ? 'recrawl-avatars.log' : 'recrawl-profiles.log';
const RECRAWL_JSONL = 'profile-recrawl.jsonl';
const DELETED_JSONL = 'profile-deleted.jsonl';
const OUT_SQL = 'recrawl-profiles.sql';
// sha256 of the noicon default GIF (5789 bytes). The source noicon.png is no
// longer downloadable after caching, so noicon users reuse this canonical file
// (same content in data/avatars/user-*-a6f84d6e5a8823a2.png and profile-avatars/).
const NOICON_SHA = '2d85ab290cc96cb52aa148daf82b808c632f92f7887ac3f4dff8993d419ed653';
// One timestamp for the whole run (records carry a checkedAt).
const RUN_TIMESTAMP = new Date().toISOString();

interface RecrawlRecord {
	userId: number;
	status: 'fetched' | 'avatar-only' | 'noicon' | 'deleted' | 'unexpected-200' | 'error';
	slug: string | null;
	username: string | null;
	// sha256 when a real avatar was saved; 'noicon' for the default; null otherwise.
	avatarSha: string | null;
	httpStatus: number;
	error: string | null;
	fetchedAt: string;
}

interface FetchResult {
	ok: boolean;
	status: number;
	body: string;
	finalUrl: string;
	error?: string;
}

interface DownloadResult {
	ok: boolean;
	bytes: Uint8Array;
	contentType: string | null;
	reason: string | null;
}

interface DbUserRow {
	email: string;
	avatarFileId: string | null;
}

function log(line: string): void {
	console.log(line);
	appendFileSync(LOG_FILE, line + '\n', 'utf-8');
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function buildHeaders(cookie: string): Record<string, string> {
	return {
		'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:151.0) Gecko/20100101 Firefox/151.0',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		'Sec-GPC': '1',
		Connection: 'keep-alive',
		Cookie: cookie,
		'Upgrade-Insecure-Requests': '1',
		'Sec-Fetch-Dest': 'document',
		'Sec-Fetch-Mode': 'navigate',
		'Sec-Fetch-Site': 'same-origin',
		'Sec-Fetch-User': '?1',
		DNT: '1',
		Pragma: 'no-cache',
		'Cache-Control': 'no-cache'
	};
}

/**
 * URL for a user's profile page. Vanilla resolves by the numeric ID and ignores
 * the slug segment, so '/profile/{id}/activities' works for every user without
 * needing the username slug (the slugless '/profile/{id}' 404s on this fork).
 */
function profileUrl(userId: number): string {
	const tpl = process.env.JANBAO_PROFILE_PATH ?? `/profile/{id}/activities`;
	return `${BASE}${tpl.replace('{id}', String(userId))}`;
}

/** Fetch the profile page following the slug redirect. */
async function fetchProfile(userId: number, cookie: string): Promise<FetchResult> {
	const url = profileUrl(userId);
	try {
		const res = await fetch(url, { headers: buildHeaders(cookie), redirect: 'follow' });
		const body = await res.text();
		return { ok: res.ok, status: res.status, body, finalUrl: res.url || url };
	} catch (e: unknown) {
		return {
			ok: false,
			status: 0,
			body: '',
			finalUrl: url,
			error: e instanceof Error ? e.message : String(e)
		};
	}
}

/** A fetched body is a real profile page if it carries the About panel chrome. */
function looksLikeProfile(body: string): boolean {
	return (
		body.includes('class="About"') ||
		body.includes('class="ProfilePhoto"') ||
		body.includes('itemprop="name"') ||
		/<dd class="Name"/.test(body)
	);
}

/** Is this body the Vanilla sign-in page (cookie expired / invalid)? */
function looksLikeSignIn(body: string): boolean {
	return /entry\/signin|name="SignIn"|class="SignIn"/i.test(body);
}

/**
 * Confirm the profile URL pattern + cookie actually return a profile for a
 * known-live user before crawling ~54k IDs. A wrong URL pattern (or bad cookie)
 * would otherwise mark every ID as deleted/gone. Aborts loudly on failure.
 */
async function sanityCheck(cookie: string, delayMs: number): Promise<void> {
	const liveId = Number(process.env.JANBAO_SANITY_LIVE_ID ?? 9);
	const res = await fetchProfile(liveId, cookie);
	await sleep(delayMs);
	if (looksLikeSignIn(res.body)) {
		log(
			`SANITY FAILED: ${profileUrl(liveId)} returned the sign-in page - JANBAO_COOKIE is invalid/expired. Aborting.`
		);
		process.exit(1);
	}
	if (!looksLikeProfile(res.body)) {
		log(
			`SANITY FAILED: ${profileUrl(liveId)} did not return a profile (status ${res.status}, ${res.error ?? 'not a profile page'}). ` +
				`The slugless URL may not resolve on this Vanilla fork, or the cookie is bad. ` +
				`Try JANBAO_PROFILE_PATH='/profile/{id}/activities' (or supply slugs) and re-run. Aborting before the crawl.`
		);
		process.exit(1);
	}
	log(`sanity OK: ${profileUrl(liveId)} → status ${res.status}, final ${res.finalUrl}`);
}

/**
 * The profile OWNER's avatar is the single "ProfilePhotoLarge" <img> in the
 * page header (PhotoWrapLarge). The "ProfilePhoto ProfilePhotoMedium" img is the
 * LOGGED-IN user (alt = our cookie's user, always noicon) - NOT the owner.
 * Returns the owner's avatar src, or null when they have no custom avatar
 * (noicon) - callers then leave avatar_file_id NULL so the app's unified
 * noicon fallback (the a6f84d6e5a8823a file) applies. Noicon.png is never
 * downloaded (the source stops serving it once cached).
 */
function extractProfilePhoto(html: string): string | null {
	const imgRe = /<img\b[^>]*>/gi;
	let m: RegExpExecArray | null;
	while ((m = imgRe.exec(html)) !== null) {
		const tag = m[0];
		const clsMatch = tag.match(/class="([^"]*)"/i);
		const cls = clsMatch ? clsMatch[1] : '';
		const classes = cls.split(/\s+/);
		if (!classes.includes('ProfilePhotoLarge')) continue;
		const srcMatch = tag.match(/src="([^"]+)"/i);
		if (!srcMatch) continue;
		const src = srcMatch[1];
		if (/noicon\.png/i.test(src)) return null; // no custom avatar → fallback applies
		return src;
	}
	return null;
}

function extForContentType(ct: string | null): string {
	if (!ct) return 'jpg';
	const t = ct.toLowerCase();
	if (t.includes('png')) return 'png';
	if (t.includes('gif')) return 'gif';
	if (t.includes('webp')) return 'webp';
	if (t.includes('bmp')) return 'bmp';
	if (t.includes('svg')) return 'svg';
	return 'jpg';
}

/** Download bytes with a non-browser UA (image hosts 403 browser UAs), http→https fallback. */
async function downloadImage(url: string): Promise<DownloadResult> {
	const candidates = url.startsWith('http://') ? [url, 'https' + url.slice(4)] : [url];
	let lastReason: string | null = null;
	for (const candidate of candidates) {
		try {
			const res = await fetch(candidate, {
				headers: { 'User-Agent': 'curl/8.7.1' },
				redirect: 'follow'
			});
			if (!res.ok) {
				lastReason = `HTTP ${res.status}`;
				continue;
			}
			const buf = new Uint8Array(await res.arrayBuffer());
			if (buf.length === 0) {
				lastReason = 'empty body';
				continue;
			}
			return { ok: true, bytes: buf, contentType: res.headers.get('content-type'), reason: null };
		} catch (e: unknown) {
			lastReason = e instanceof Error ? e.message : String(e);
		}
	}
	return { ok: false, bytes: new Uint8Array(), contentType: null, reason: lastReason };
}

/** Load known-gone (410) user IDs from profile-deleted.jsonl. */
function loadDeleted(dataDir: string): Set<number> {
	const set = new Set<number>();
	const path = join(dataDir, DELETED_JSONL);
	if (!existsSync(path)) return set;
	for (const line of readFileSync(path, 'utf-8').split('\n')) {
		const t = line.trim();
		if (!t) continue;
		try {
			const rec = JSON.parse(t) as { userId?: unknown };
			const id = Number(rec.userId);
			if (Number.isFinite(id)) set.add(id);
		} catch {
			// skip malformed
		}
	}
	return set;
}

/** Existing per-user avatar file in profile-avatars/, or null. */
function avatarFileFor(dataDir: string, userId: number): string | null {
	const dir = join(dataDir, 'profile-avatars');
	if (!existsSync(dir)) return null;
	const prefix = `${userId}-`;
	for (const f of readdirSync(dir)) {
		if (f.startsWith(prefix)) return join(dir, f);
	}
	return null;
}

/** Parse the sha out of a profile-avatars/<id>-<sha>.<ext> filename. */
function shaFromAvatarFile(fname: string): string | null {
	const base = fname.split('/').pop() ?? fname;
	const m = base.match(/^\d+-(.+)\.[^.]+$/);
	return m ? m[1] : null;
}

function slugFromUrl(finalUrl: string, userId: number): string | null {
	const m = finalUrl.match(new RegExp(`/profile/${userId}/([^"'/?#]+)`));
	return m ? decodeURIComponent(m[1]) : null;
}

// ===== crawl mode =====

interface CrawlState {
	dataDir: string;
	cookie: string;
	delayMs: number;
	noAvatars: boolean;
	/** Canonical noicon file (data/avatars) reused for users with no custom avatar. */
	noiconCanonical: string;
}

/**
 * Resolve the canonical noicon default file. The source noicon.png is no longer
 * downloadable, so noicon users reuse this one (data/avatars/user-0-…a6f84d6e5a8823a2.png,
 * which is the same 5789-byte GIF as the profile-avatars noicon). Returns the
 * primary path even if missing so the caller can warn + fall back to NULL.
 */
function resolveNoiconCanonical(dataDir: string): string {
	const primary = join(dataDir, 'avatars', 'user-0-a6f84d6e5a8823a2.png');
	if (existsSync(primary)) return primary;
	// Fallback: any crawled profile-avatars file already carrying the noicon sha.
	const pa = join(dataDir, 'profile-avatars');
	if (existsSync(pa)) {
		for (const f of readdirSync(pa)) {
			if (f.includes(NOICON_SHA.slice(0, 16))) return join(pa, f);
		}
	}
	return primary;
}

/** Process one user ID: ensure profile.html + (if a real avatar) an avatar file exist. */
async function processId(userId: number, st: CrawlState): Promise<RecrawlRecord> {
	const profileDir = join(st.dataDir, 'profiles', String(userId));
	const profilePath = join(profileDir, 'profile.html');
	const base: RecrawlRecord = {
		userId,
		status: 'fetched',
		slug: null,
		username: null,
		avatarSha: null,
		httpStatus: 0,
		error: null,
		fetchedAt: RUN_TIMESTAMP
	};

	let html: string;
	if (existsSync(profilePath)) {
		// Profile already on disk (avatar-gap user): just (re)derive the avatar.
		html = readFileSync(profilePath, 'utf-8');
	} else {
		const res = await fetchProfile(userId, st.cookie);
		await sleep(st.delayMs);
		base.httpStatus = res.status;
		if (looksLikeSignIn(res.body)) {
			base.status = 'error';
			base.error = 'sign-in page returned (JANBAO_COOKIE invalid/expired)';
			return base;
		}
		// Vanilla returns 410 + redirects to /dashboard/home/deleted for gone users.
		const goneRedirect = /\/dashboard\/home\/deleted|\/deleted\b/.test(res.finalUrl);
		if (
			!res.ok ||
			res.status === 410 ||
			res.status === 404 ||
			goneRedirect ||
			!looksLikeProfile(res.body)
		) {
			if (res.status === 410 || res.status === 404 || goneRedirect) {
				base.status = 'deleted';
			} else {
				// 200 but not a profile (unexpected) - do NOT mark deleted; surface it.
				base.status = 'unexpected-200';
				base.error = res.error ?? `status ${res.status}, not a profile page`;
			}
			return base;
		}
		html = res.body;
		base.slug = slugFromUrl(res.finalUrl, userId);
		if (!existsSync(profileDir)) mkdirSync(profileDir, { recursive: true });
		writeFileSync(profilePath, html, 'utf-8');
		base.status = 'fetched';
	}

	// Username (best-effort, for the log/jsonl) from the About Name field.
	const nameMatch = html.match(/<dd class="Name"[^>]*>([\s\S]+?)<\/dd>/);
	base.username = nameMatch ? nameMatch[1].replace(/<[^>]+>/g, '').trim() : null;

	if (st.noAvatars) return base;

	// Avatar: if already on disk, done. Else extract + download.
	if (avatarFileFor(st.dataDir, userId)) {
		base.avatarSha = shaFromAvatarFile(avatarFileFor(st.dataDir, userId)!) ?? 'present';
		return base;
	}
	const src = extractProfilePhoto(html);
	if (!src) {
		// No custom avatar: reuse the canonical noicon file (the source noicon.png
		// is no longer downloadable) so the user gets avatar_file_id='1' + the
		// noicon on pCloud, matching existing imported noicon users. Falls back to
		// NULL (letter fallback) only if the canonical noicon is somehow missing.
		if (existsSync(st.noiconCanonical)) {
			const avatarsDir = join(st.dataDir, 'profile-avatars');
			if (!existsSync(avatarsDir)) mkdirSync(avatarsDir, { recursive: true });
			copyFileSync(st.noiconCanonical, join(avatarsDir, `${userId}-${NOICON_SHA}.png`));
			base.avatarSha = NOICON_SHA;
			if (base.status !== 'fetched') base.status = 'avatar-only';
		} else {
			base.avatarSha = 'noicon';
		}
		return base;
	}
	const dl = await downloadImage(src);
	await sleep(st.delayMs);
	if (!dl.ok || dl.bytes.length === 0) {
		base.status = base.status === 'fetched' ? 'fetched' : 'error';
		base.error = `avatar download failed: ${dl.reason ?? 'unknown'}`;
		return base;
	}
	const sha = createHash('sha256').update(dl.bytes).digest('hex');
	const ext = extForContentType(dl.contentType);
	const avatarsDir = join(st.dataDir, 'profile-avatars');
	if (!existsSync(avatarsDir)) mkdirSync(avatarsDir, { recursive: true });
	writeFileSync(join(avatarsDir, `${userId}-${sha}.${ext}`), dl.bytes);
	base.avatarSha = sha;
	// Distinguish "created profile this run" from "only added an avatar".
	if (base.status !== 'fetched') base.status = 'avatar-only';
	return base;
}

function appendRecords(dataDir: string, recs: RecrawlRecord[]): void {
	const lines = recs.map((r) => JSON.stringify(r)).join('\n');
	if (lines) appendFileSync(join(dataDir, RECRAWL_JSONL), lines + '\n', 'utf-8');
}

function appendDeleted(dataDir: string, recs: RecrawlRecord[]): void {
	const lines = recs
		.filter((r) => r.status === 'deleted')
		.map((r) =>
			JSON.stringify({
				userId: String(r.userId),
				profileUrl: `${BASE}/profile/${r.userId}`,
				status: 410,
				source: 'recrawl-missing-profiles',
				checkedAt: r.fetchedAt
			})
		)
		.join('\n');
	if (lines) appendFileSync(join(dataDir, DELETED_JSONL), lines + '\n', 'utf-8');
}

async function runCrawl(dataDir: string, cookie: string): Promise<void> {
	const maxId = Number(process.env.JANBAO_MAX_ID ?? 57541);
	const probeAhead = Number(process.env.JANBAO_PROBE_AHEAD ?? 1000);
	const concurrency = Number(process.env.JANBAO_CONCURRENCY ?? 4);
	const delayMs = Number(process.env.JANBAO_DELAY ?? 500);
	const dry = !!process.env.JANBAO_DRY;
	const noAvatars = !!process.env.JANBAO_NO_AVATARS;
	const limit = Number(process.env.JANBAO_LIMIT ?? 0);
	const ceiling = maxId + probeAhead;

	// Resume sets: already-processed (this tool) + known-gone (original + prior runs).
	const doneIds = loadRecrawlIds(dataDir);
	const deleted = loadDeleted(dataDir);
	// On-disk completeness: profile.html + avatar file both present.
	const profileIds = scanProfileIds(dataDir);
	const avatarIds = scanAvatarIds(dataDir);

	const targets: number[] = [];
	for (let id = 1; id <= ceiling; id++) {
		if (doneIds.has(id) || deleted.has(id)) continue;
		if (profileIds.has(id) && avatarIds.has(id)) continue; // already complete
		targets.push(id);
	}
	if (limit > 0 && targets.length > limit) targets.length = limit;
	log(
		`crawl: ${targets.length} target IDs (range 1..${ceiling}, concurrency ${concurrency}, ` +
			`delay ${delayMs}ms, avatars ${noAvatars ? 'OFF' : 'on'})` +
			`${limit > 0 ? ` (capped by JANBAO_LIMIT=${limit})` : ''}. ` +
			`Already done ${doneIds.size}, deleted ${deleted.size}, complete-on-disk skipped.`
	);

	if (dry) {
		log('  [dry] first 20 targets: ' + targets.slice(0, 20).join(','));
		log(`  [dry] would fetch ~${targets.length} profile pages. JANBAO_DRY set → fetching nothing.`);
		return;
	}

	// Guard against a catastrophic mis-crawl: if the profile URL pattern doesn't
	// resolve on this Vanilla fork (or the cookie is bad), every ID would be
	// recorded as deleted. Confirm one known-live profile returns first.
	await sanityCheck(cookie, delayMs);

	const noiconCanonical = resolveNoiconCanonical(dataDir);
	if (!existsSync(noiconCanonical)) {
		log(
			'  WARNING: canonical noicon file not found - noicon users will get no avatar (letter fallback).'
		);
	} else {
		log(`  noicon canonical: ${noiconCanonical}`);
	}

	const st: CrawlState = { dataDir, cookie, delayMs, noAvatars, noiconCanonical };
	let processed = 0;
	const counts: Record<string, number> = {};
	for (let i = 0; i < targets.length; i += concurrency) {
		const batch = targets.slice(i, i + concurrency);
		const recs = await Promise.all(
			batch.map((id) =>
				processId(id, st).catch(
					(e): RecrawlRecord => ({
						userId: id,
						status: 'error',
						slug: null,
						username: null,
						avatarSha: null,
						httpStatus: 0,
						error: getErrorMessage(e),
						fetchedAt: RUN_TIMESTAMP
					})
				)
			)
		);
		appendDeleted(dataDir, recs);
		appendRecords(dataDir, recs);
		for (const r of recs) counts[r.status] = (counts[r.status] ?? 0) + 1;
		processed += recs.length;
		if (processed % 200 < concurrency) {
			log(`  crawl ${processed}/${targets.length} - ${summary(counts)}`);
		}
	}
	log(`crawl done. ${summary(counts)}`);
}

function summary(counts: Record<string, number>): string {
	return Object.entries(counts)
		.map(([k, v]) => `${k}=${v}`)
		.join(' ');
}

function scanProfileIds(dataDir: string): Set<number> {
	const set = new Set<number>();
	const dir = join(dataDir, 'profiles');
	if (!existsSync(dir)) return set;
	for (const d of readdirSync(dir)) {
		if (/^\d+$/.test(d) && existsSync(join(dir, d, 'profile.html'))) set.add(Number(d));
	}
	return set;
}

function scanAvatarIds(dataDir: string): Set<number> {
	const set = new Set<number>();
	const dir = join(dataDir, 'profile-avatars');
	if (!existsSync(dir)) return set;
	for (const f of readdirSync(dir)) {
		const m = f.match(/^(\d+)-/);
		if (m) set.add(Number(m[1]));
	}
	return set;
}

function loadRecrawlIds(dataDir: string): Set<number> {
	const set = new Set<number>();
	const path = join(dataDir, RECRAWL_JSONL);
	if (!existsSync(path)) return set;
	for (const line of readFileSync(path, 'utf-8').split('\n')) {
		const t = line.trim();
		if (!t) continue;
		try {
			const rec = JSON.parse(t) as { userId?: unknown; status?: unknown };
			if (rec.status === 'error') continue; // retry errors
			const id = Number(rec.userId);
			if (Number.isFinite(id)) set.add(id);
		} catch {
			// skip malformed
		}
	}
	return set;
}

// ===== sql mode =====

/** Quote/escape a value for a SQLite SQL literal. */
function sqlVal(v: string | number | null): string {
	if (v === null || v === undefined) return 'NULL';
	if (typeof v === 'number') return String(v);
	return "'" + String(v).replace(/'/g, "''") + "'";
}

function toEpoch(d: Date | null, fallback: number): number {
	return d ? Math.floor(d.getTime() / 1000) : fallback;
}

interface SqlEmit {
	statements: string[];
	inserts: number;
	updates: number;
}

/**
 * Emit SQL for one recrawled user. New users (holes) get an INSERT OR IGNORE.
 * Existing users get guarded UPDATEs that ONLY fill gaps and never touch a
 * complete profile:
 *   - the WHERE fires only when the user is incomplete (missing bio, placeholder
 *     email, or missing avatar);
 *   - each SET field is a CASE that preserves any value already present.
 * So whether to update is decided by the prod row itself at apply time, not by
 * the (stale) local snapshot - a complete prod user is never modified. Username
 * is isolated in its own OR IGNORE statement so a rare UNIQUE collision (a
 * popular name since taken by a newer sign-up) can't block the bio/avatar fill.
 */
function emitForUser(
	userId: number,
	profile: ReturnType<typeof parseProfileHtml>,
	hasAvatar: boolean,
	dbUser: DbUserRow | undefined,
	nowEpoch: number,
	out: SqlEmit
): void {
	const username = profile.username || `user_${userId}`;
	const displayName = profile.displayName || profile.username || `User ${userId}`;
	const bio = profile.bio;
	const signup = toEpoch(profile.signupTime, nowEpoch);
	const lastActive = toEpoch(profile.lastActiveTime, signup);
	const views = profile.viewCount ?? 0;
	const avatarFid = hasAvatar ? "'1'" : 'NULL';
	const avatarCt = hasAvatar ? "'image/webp'" : 'NULL';
	const placeholderEmail = `email LIKE '%@placeholder.janbao.net'`;
	const incomplete = `(bio IS NULL OR bio = '' OR ${placeholderEmail} OR avatar_file_id IS NULL OR avatar_file_id = '')`;

	if (!dbUser) {
		// New user (a hole). email placeholder by design; rss_token is NOT NULL with
		// no DB default → supply a UUID.
		const email = profile.email || `${userId}@placeholder.janbao.net`;
		const showEmail = profile.email ? 1 : 0;
		out.statements.push(
			'INSERT OR IGNORE INTO users ' +
				'(id, username, email, password_hash, display_name, bio, group_slug, ' +
				'signup_time, last_active_time, rss_token, avatar_file_id, avatar_content_type, ' +
				'view_count, show_email) VALUES ' +
				`(${userId}, ${sqlVal(username)}, ${sqlVal(email)}, 'NO_PASSWORD', ${sqlVal(displayName)}, ` +
				`${sqlVal(bio)}, 'member', ${signup}, ${lastActive}, ${sqlVal(randomUUID())}, ${avatarFid}, ` +
				`${avatarCt}, ${views}, ${showEmail});`
		);
		out.inserts++;
		return;
	}

	// (1) username - UNIQUE, so OR IGNORE: a collision skips just the username,
	// not the backfill below. Only for placeholders (real users keep their name).
	out.statements.push(
		`UPDATE OR IGNORE users SET username = ${sqlVal(username)} WHERE id = ${userId} AND ${placeholderEmail};`
	);
	// (2) remaining fields - no UNIQUE column, so this never aborts. CASE keeps any
	// value already set; the WHERE skips users that are already complete.
	out.statements.push(
		'UPDATE users SET ' +
			`display_name = CASE WHEN ${placeholderEmail} THEN ${sqlVal(displayName)} ELSE display_name END, ` +
			`signup_time = CASE WHEN ${placeholderEmail} THEN ${signup} ELSE signup_time END, ` +
			`last_active_time = CASE WHEN ${placeholderEmail} THEN ${lastActive} ELSE last_active_time END, ` +
			`view_count = CASE WHEN ${placeholderEmail} THEN ${views} ELSE view_count END, ` +
			`bio = CASE WHEN bio IS NULL OR bio = '' THEN ${sqlVal(bio)} ELSE bio END, ` +
			`avatar_file_id = CASE WHEN avatar_file_id IS NULL OR avatar_file_id = '' THEN ${avatarFid} ELSE avatar_file_id END, ` +
			`avatar_content_type = CASE WHEN avatar_file_id IS NULL OR avatar_file_id = '' THEN ${avatarCt} ELSE avatar_content_type END ` +
			`WHERE id = ${userId} AND ${incomplete};`
	);
	out.updates++;
}

async function runSql(dataDir: string): Promise<void> {
	ensureWebpTools();

	// Local DB as a prod proxy: which ids exist, and are they placeholder / avatar-less.
	const dbPath = process.env.LOCAL_DB_PATH ?? '.local.db';
	const db = createClient({ url: `file:${dbPath}` });
	const dbRows = (await db.execute('SELECT id, email, avatar_file_id FROM users')).rows;
	const dbUsers = new Map<number, DbUserRow>();
	for (const r of dbRows) {
		dbUsers.set(Number(r.id), {
			email: String(r.email ?? ''),
			avatarFileId: r.avatar_file_id == null ? null : String(r.avatar_file_id)
		});
	}

	// Scope: ids this tool actually processed (holes + gaps), deduped, last record wins.
	const recIds = loadRecrawlIds(dataDir);
	log(`sql: ${recIds.size} recrawled ids to emit SQL for; local DB has ${dbUsers.size} users.`);

	// pCloud avatar upload (skip cleanly if not configured).
	const cfg = resolvePcloudConfig(process.env as Record<string, string>);
	const pcloudOn = cfg.username.length > 0 && cfg.password.length > 0;
	const onCloud = pcloudOn ? await pcloudListFolder(cfg, '/avatars') : new Set<string>();
	if (!pcloudOn)
		log('sql: PCLOUD_* not set → skipping avatar upload (SQL still references /avatars/<id>).');
	const uploadList: number[] = [];

	const out: SqlEmit = { statements: [], inserts: 0, updates: 0 };
	const nowEpoch = Math.floor(Date.now() / 1000);

	for (const userId of [...recIds].sort((a, b) => a - b)) {
		const profilePath = join(dataDir, 'profiles', String(userId), 'profile.html');
		if (!existsSync(profilePath)) continue; // deleted/unexpected - no SQL
		const html = readFileSync(profilePath, 'utf-8');
		const profile = parseProfileHtml(html);
		const avFile = avatarFileFor(dataDir, userId);
		const hasAvatar = !!avFile;
		if (hasAvatar && pcloudOn && !onCloud.has(String(userId))) uploadList.push(userId);
		emitForUser(userId, profile, hasAvatar, dbUsers.get(userId), nowEpoch, out);
	}

	// Upload new avatars (32-way). Idempotent via the onCloud set.
	if (uploadList.length > 0 && pcloudOn) {
		log(`sql: uploading ${uploadList.length} avatars to pCloud /avatars (32-way)...`);
		let uploaded = 0;
		await mapPool(uploadList, 32, async (userId) => {
			const avFile = avatarFileFor(dataDir, userId);
			if (!avFile) return;
			try {
				const webp = convertToWebp(avFile);
				await pcloudUploadBytes(cfg, '/avatars', String(userId), webp);
				onCloud.add(String(userId));
			} catch (e: unknown) {
				log(`  [avatar-upload-fail] user ${userId}: ${getErrorMessage(e)}`);
			}
			uploaded++;
			if (uploaded % 200 === 0) log(`  avatars uploaded: ${uploaded}/${uploadList.length}`);
		});
		log(`sql: avatar upload complete (${uploaded ? uploaded : 0}).`);
	}

	const header =
		`-- recrawl-profiles.sql (generated ${RUN_TIMESTAMP})\n` +
		`-- Source: ${dataDir}\n` +
		`-- INSERT (new users): ${out.inserts} | conditional UPDATE (existing, gap-fill only): ${out.updates}\n` +
		`-- UPDATEs only fire on incomplete users (missing bio OR placeholder email OR missing\n` +
		`-- avatar) and each field is CASE-guarded to never overwrite an existing value.\n` +
		`-- Idempotent + complete-user-safe. Safe to re-run.\n` +
		`BEGIN;\n`;
	const footer = 'COMMIT;\n';
	writeFileSync(OUT_SQL, header + out.statements.join('\n') + '\n' + footer, 'utf-8');
	log(
		`sql: wrote ${OUT_SQL} - ${out.statements.length} statements ` +
			`(inserts ${out.inserts}, conditional-updates ${out.updates}).`
	);
}

/**
 * Continuous concurrency pool: N workers each pull the next item, so a slow item
 * only blocks its own worker - unlike mapPool's per-batch barrier, where one
 * slow item (e.g. a pCloud PUT waiting on a socket-close) stalls the whole batch.
 * Use this when per-item latency varies a lot.
 */
async function runPool<T>(items: T[], concurrency: number, fn: PoolTask<T>): Promise<void> {
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const i = next++;
			await fn(items[i]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

/**
 * Convert + upload EVERY crawled user's avatar to pCloud /avatars/<id> (webp),
 * mirroring import-data §4.7: read the profile-avatars/ files, cwebp/gif2webp
 * each, PUT to WebDAV, 32-way. Idempotent via a pCloud /avatars listing (skip
 * what's already there), so it's safe to run in parallel with a `crawl` and to
 * re-run after the crawl to pick up newly-fetched avatars. Logs to its own file
 * (recrawl-avatars.log) to avoid interleaving with a concurrent crawl's log.
 */
async function runAvatars(dataDir: string): Promise<void> {
	ensureWebpTools();
	const cfg = resolvePcloudConfig(process.env as Record<string, string>);
	if (!cfg.username || !cfg.password) {
		log('avatars: PCLOUD_* not set - cannot upload. Aborting.');
		process.exit(1);
	}
	log(`avatars: listing pCloud ${cfg.basePath}/avatars (to skip already-uploaded)...`);
	const onCloud = await pcloudListFolder(cfg, '/avatars');
	const avIds = [...scanAvatarIds(dataDir)].sort((a, b) => a - b);
	const uploadList = avIds.filter((id) => !onCloud.has(String(id)));
	log(
		`avatars: ${avIds.length} crawled users with an avatar file; ${onCloud.size} already on cloud; ` +
			`${uploadList.length} to convert+upload (32-way).`
	);
	if (uploadList.length === 0) {
		log('avatars: nothing to do.');
		return;
	}
	let done = 0;
	let failed = 0;
	const concurrency = Number(process.env.JANBAO_AVATAR_CONCURRENCY ?? 32);
	await runPool(uploadList, concurrency, async (userId) => {
		const avFile = avatarFileFor(dataDir, userId);
		if (!avFile) return;
		try {
			const webp = convertToWebp(avFile);
			// pCloud WebDAV closes sockets under concurrent PUT load; retry the
			// (transient) upload failures so a burst of 4xx/socket-close doesn't
			// leave a user avatarless.
			for (let attempt = 1; attempt <= 3; attempt++) {
				try {
					await pcloudUploadBytes(cfg, '/avatars', String(userId), webp);
					onCloud.add(String(userId));
					break;
				} catch (e: unknown) {
					if (attempt === 3) throw e;
					await sleep(400 * attempt);
				}
			}
		} catch (e: unknown) {
			failed++;
			log(`  [avatar-fail] user ${userId}: ${getErrorMessage(e)}`);
		}
		done++;
		if (done % 200 === 0)
			log(`  avatars: ${done}/${uploadList.length} uploaded${failed ? `, ${failed} failed` : ''}`);
	});
	log(`avatars: done - ${done} processed, ${failed} failed.`);
}

async function main(): Promise<void> {
	const mode = process.argv[2];
	const dataDir = process.argv[3];
	if (!mode || !dataDir || !existsSync(dataDir) || !['crawl', 'sql', 'avatars'].includes(mode)) {
		console.error(
			'Usage: bun run scripts/recrawl-missing-profiles.ts <crawl|sql|avatars> <data-dir>'
		);
		process.exit(1);
	}
	if (mode === 'crawl') {
		const cookie = process.env.JANBAO_COOKIE;
		if (!cookie || !cookie.includes('Talk=')) {
			console.error(
				'Set JANBAO_COOKIE to your full Cookie header (Talk=...; Talk-tk=...; Talk-Volatile=...; Talk-Vv=...).'
			);
			process.exit(1);
		}
		await runCrawl(dataDir, cookie);
	} else if (mode === 'avatars') {
		await runAvatars(dataDir);
	} else {
		await runSql(dataDir);
	}
}

main().catch((err) => {
	console.error('Error:', err);
	process.exit(1);
});
