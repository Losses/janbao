/**
 * Re-crawl discussion pages that the original crawl missed.
 *
 * Two kinds of gap:
 *   1. Discussions whose page-1 file actually contains a later page (crawler
 *      started at page 2+) → real page 1 (OP + early replies) was never fetched.
 *      Detected by the pager's Highlight marker disagreeing with the filename.
 *   2. Discussions with NO page files at all but referenced from a profile's
 *      discussions-page JSON (e.g. 29585) → every page is missing.
 *
 * For each gap, fetch the page from janbao.net using credentials in
 * $JANBAO_COOKIE, and save it as the next page-NNNNNN.html in that discussion's
 * directory (appended, never overwriting). The import finds the OP by lowest
 * item-position and dedups comments by id, so appended files are picked up
 * cleanly regardless of filename.
 *
 * Usage:
 *   JANBAO_COOKIE='Talk=...; Talk-tk=...; Talk-Volatile=...; Talk-Vv=...' \
 *   bun run scripts/recrawl-missing-pages.ts /home/losses/Downloads/data
 *
 * Options (env):
 *   JANBAO_DELAY   milliseconds between requests (default 5000)
 *   JANBAO_DRY=1   list what would be fetched, fetch nothing
 *
 * The slug is auto-extracted from an existing crawled page (when one exists) so
 * the canonical /discussion/{id}/{slug}/p{N} URL is used. Slug-less discussions
 * fall back to /discussion/{id}/.
 */
import { readdirSync, readFileSync, existsSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

interface DiscussionGap {
	discussionId: number;
	discDir: string;
	missingRealPages: number[];
	slug: string | null;
}

interface PageScan {
	realPagesCovered: Set<number>;
	hasPager: boolean;
	maxPage: number;
	sampleHtml: string;
}

const BASE = 'https://janbao.net';
const LOG_FILE = 'recrawl.log';
// One timestamp for the whole run (dead-link records carry a checkedAt).
const HARVEST_TIMESTAMP = new Date().toISOString();

function log(line: string): void {
	console.log(line);
	appendFileSync(LOG_FILE, line + '\n', 'utf-8');
}

/** Read the pager's Highlight marker to learn which real page this HTML is. */
function detectRealPage(html: string): number | null {
	const pagerMatch = html.match(/<span[^>]*class="Pager NumberedPager"[^>]*>([\s\S]*?)<\/span>/);
	if (!pagerMatch) return null;
	const pager = pagerMatch[1];
	const hiElem = pager.match(/<(?:a|span)[^>]*class="[^"]*\bHighlight\b[^"]*"[^>]*>/);
	if (hiElem) {
		const pn = hiElem[0].match(/\bp-(\d+)\b/);
		if (pn) return parseInt(pn[1], 10);
		const inner = pager.slice(pager.indexOf(hiElem[0]));
		const num = inner.match(/>(\d+)</);
		if (num) return parseInt(num[1], 10);
	}
	return null;
}

/** Extract the URL slug from an existing crawled page (stub is the same on every page). */
function extractSlug(html: string, discussionId: number): string | null {
	const re = new RegExp(`/discussion/${discussionId}/([^"?#\\s/]+)`, 'g');
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) !== null) {
		if (m[1] && m[1] !== 'bookmark' && m[1] !== 'comment') return m[1];
	}
	return null;
}

/** Scan one discussion's page files: which real pages are covered, plus a slug source. */
function scanDiscussion(discDir: string): PageScan | null {
	if (!existsSync(discDir)) return null;
	const files = readdirSync(discDir)
		.filter((f) => /^page-\d+\.html$/.test(f))
		.sort();
	if (files.length === 0) return null;
	const realPagesCovered = new Set<number>();
	let hasPager = false;
	let maxPage = 1;
	let sampleHtml = '';
	for (const f of files) {
		const html = readFileSync(join(discDir, f), 'utf-8');
		if (!sampleHtml) sampleHtml = html;
		const rp = detectRealPage(html);
		if (rp !== null) {
			hasPager = true;
			realPagesCovered.add(rp);
			if (rp > maxPage) maxPage = rp;
		} else {
			// Single-page discussion (no pager) → covers page 1.
			realPagesCovered.add(1);
		}
	}
	return { realPagesCovered, hasPager, maxPage, sampleHtml };
}

/** Next available page-NNNNNN.html number in a discussion dir. */
function nextFileNumber(discDir: string): number {
	if (!existsSync(discDir)) return 1;
	const nums = readdirSync(discDir)
		.map((f) => {
			const m = f.match(/^page-(\d+)\.html$/);
			return m ? parseInt(m[1], 10) : 0;
		})
		.filter((n) => n > 0);
	return nums.length ? Math.max(...nums) + 1 : 1;
}

function pageUrl(discussionId: number, slug: string | null, page: number): string {
	// Always request the explicit /pN segment, including /p1. The bare URL
	// (/discussion/{id}/{slug}) jumps to the logged-in user's last-read page on
	// multi-page discussions, so it does NOT reliably return page 1.
	const path = slug
		? `${BASE}/discussion/${discussionId}/${slug}`
		: `${BASE}/discussion/${discussionId}`;
	return `${path}/p${page}`;
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

interface FetchResult {
	ok: boolean;
	status: number;
	body: string;
	error?: string;
}

async function fetchPage(url: string, cookie: string): Promise<FetchResult> {
	try {
		const res = await fetch(url, {
			headers: buildHeaders(cookie),
			redirect: 'follow'
		});
		const body = await res.text();
		return { ok: res.ok, status: res.status, body };
	} catch (e: unknown) {
		return { ok: false, status: 0, body: '', error: e instanceof Error ? e.message : String(e) };
	}
}

/** A fetched body is a real discussion page if it carries the discussion chrome. */
function looksLikeDiscussionPage(body: string): boolean {
	return (
		body.includes('class="MessageList') ||
		body.includes('id="Item_0"') ||
		/id="Discussion_\d+"/.test(body) ||
		/id="Comment_\d+"/.test(body)
	);
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// ===== Image harvesting (keeps data/images + images.json consistent) =====

interface ImageRef {
	file: string;
	discussionId: string;
	page: number;
}

interface ImageIndex {
	byUrl: Record<string, ImageIndexEntry>;
	byHash: Record<string, ImageHashEntry>;
}
interface ImageIndexEntry {
	url: string;
	sha256?: string;
	file?: string;
	bytes?: number;
	contentType?: string;
	error?: string;
	refs?: ImageRef[];
}
interface ImageHashEntry {
	sha256: string;
	file: string;
	bytes: number;
	contentType: string;
	urls: string[];
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

/**
 * Content-image URLs from a page. The original crawl only harvested images
 * inside <div class="Message"> bodies (post/comment content) - avatars
 * (<img class="ProfilePhoto">) and the default noicon.png are page chrome, not
 * content, and are absent from images.json. Restrict to Message bodies and drop
 * the avatar/noicon/emoji classes so we match that set.
 */
function extractImageSrcs(html: string): string[] {
	const out: string[] = [];
	// Isolate only Message-body slices: everything the import's converter would see.
	const messageRe = /<div\s+class="Message">([\s\S]*?)<\/div>\s*<div\s+class="Reactions"/g;
	const imgRe = /<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi;
	let msg: RegExpExecArray | null;
	while ((msg = messageRe.exec(html)) !== null) {
		const body = msg[1];
		let m: RegExpExecArray | null;
		while ((m = imgRe.exec(body)) !== null) {
			const tag = m[0];
			let src = m[1];
			if (/\bemoji\b|\bProfilePhoto\b|\bPhotoWrap\b/.test(tag)) continue;
			if (/noicon\.png/.test(src)) continue; // default avatar
			if (src.startsWith('data:')) continue;
			// Drop analytics/tracking pixels (piwik/matomo rec=1 beacons).
			if (/[?&]rec=1\b|piwik\.|\/pixel\b/i.test(src)) continue;
			// Normalize the URL. Protocol-relative (//host) → https://host (NOT
			// joined to janbao.net, which would mangle youtube/thumb URLs). Absolute
			// site path (/foo) → https://janbao.net/foo.
			if (src.startsWith('//')) {
				src = 'https:' + src;
			} else if (src.startsWith('/')) {
				src = BASE + src;
			} else if (!/^https?:\/\//i.test(src)) {
				continue;
			}
			out.push(src);
		}
	}
	return out;
}

/** Load (or create) images.json. */
function loadImageIndex(dataDir: string): ImageIndex {
	const path = join(dataDir, 'images.json');
	if (existsSync(path)) {
		try {
			const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ImageIndex>;
			return { byUrl: raw.byUrl ?? {}, byHash: raw.byHash ?? {} };
		} catch {
			// corrupt - start fresh
		}
	}
	return { byUrl: {}, byHash: {} };
}

function saveImageIndex(dataDir: string, idx: ImageIndex): void {
	writeFileSync(join(dataDir, 'images.json'), JSON.stringify(idx), 'utf-8');
}

/** Load existing dead-link URLs from image-deadlinks.jsonl (so we don't refetch). */
function loadDeadUrls(dataDir: string): Set<string> {
	const set = new Set<string>();
	const path = join(dataDir, 'image-deadlinks.jsonl');
	if (!existsSync(path)) return set;
	for (const line of readFileSync(path, 'utf-8').split('\n')) {
		const t = line.trim();
		if (!t) continue;
		try {
			const rec = JSON.parse(t) as { url?: unknown };
			if (typeof rec.url === 'string') set.add(rec.url);
		} catch {
			// skip malformed
		}
	}
	return set;
}

/** Append buffered dead-link JSONL lines (newline-delimited) to the file. */
function flushDeadlines(dataDir: string, buffer: string[]): void {
	if (buffer.length === 0) return;
	appendFileSync(join(dataDir, 'image-deadlinks.jsonl'), buffer.join('\n') + '\n', 'utf-8');
}

interface DownloadResult {
	ok: boolean;
	bytes: Uint8Array;
	contentType: string | null;
	// Why it failed (http status or short error) when ok=false, for logging.
	reason: string | null;
}

async function downloadImage(url: string): Promise<DownloadResult> {
	// Image hosts (notably sinaimg.cn, the main image host here) 403 requests
	// that carry a browser User-Agent (anti-scrape), but serve the image fine to
	// a plain curl-style UA. Download images with a non-browser UA. Also try the
	// https upgrade as a fallback (some http endpoints 403 under any UA).
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
			// try next candidate
		}
	}
	return { ok: false, bytes: new Uint8Array(), contentType: null, reason: lastReason };
}

interface HarvestStats {
	downloaded: number;
	skipped: number;
	failed: number;
}

/**
 * Download every not-yet-indexed image referenced by a fetched page, save it as
 * data/images/{sha256}.{ext}, and update images.json (byUrl + byHash) so the
 * import resolves it as live. Already-known/dead URLs are skipped.
 */
async function harvestImages(
	dataDir: string,
	html: string,
	discussionId: number,
	page: number,
	pageFileRel: string,
	idx: ImageIndex,
	deadUrls: Set<string>,
	deadlinesBuffer: string[],
	stats: HarvestStats,
	delayMs: number
): Promise<void> {
	const ref = { file: pageFileRel, discussionId: String(discussionId), page };
	// extractImageSrcs returns fully-normalized absolute URLs (http(s)://...,
	// protocol-relative resolved, site paths joined to BASE).
	for (const src of extractImageSrcs(html)) {
		const existing = idx.byUrl[src];
		// Already recorded dead (in image-deadlinks.jsonl, or in the index without
		// a sha256) → skip entirely. These URLs have no live index entry, so don't
		// touch `existing` here.
		const knownDead = deadUrls.has(src) || (existing !== undefined && !existing.sha256);
		if (knownDead) {
			stats.skipped++;
			continue;
		}
		// Known-live with its file on disk → just record this ref. A
		// live-but-missing-file entry (e.g. a prior run crashed mid-write) falls
		// through and is re-downloaded.
		const filePresent = existing?.file
			? existsSync(join(dataDir, existing.file.slice('data/'.length)))
			: false;
		if (existing && filePresent) {
			existing.refs = existing.refs ?? [];
			existing.refs.push(ref);
			stats.skipped++;
			continue;
		}

		const dl = await downloadImage(src);
		await sleep(delayMs);
		if (!dl.ok || dl.bytes.length === 0) {
			// Record as dead in image-deadlinks.jsonl (matches the existing crawl's
			// convention). The import reads that file into its deadUrls set, so the
			// post renders a dead-image node instead of a live attachment.
			stats.failed++;
			deadUrls.add(src);
			const reason = dl.reason ?? (dl.ok ? 'empty body' : 'fetch failed');
			log(`    [imgfail] ${reason}  ${src}`);
			deadlinesBuffer.push(
				JSON.stringify({
					url: src,
					reason,
					ref,
					checkedAt: HARVEST_TIMESTAMP
				})
			);
			continue;
		}
		const sha256 = createHash('sha256').update(dl.bytes).digest('hex');
		const ext = extForContentType(dl.contentType);
		const rel = `data/images/${sha256}.${ext}`;
		// rel already includes the leading "data/" prefix; strip it and join onto
		// dataDir (NOT imagesDir, which would double the images/ segment).
		writeFileSync(join(dataDir, rel.slice('data/'.length)), dl.bytes);
		stats.downloaded++;

		idx.byUrl[src] = {
			url: src,
			sha256,
			file: rel,
			bytes: dl.bytes.length,
			contentType: dl.contentType ?? `image/${ext}`,
			refs: [ref]
		};
		// Merge into byHash: the same image may be reachable from several URLs;
		// append the URL rather than clobbering an existing entry.
		const prev = idx.byHash[sha256];
		if (prev) {
			if (!prev.urls.includes(src)) prev.urls.push(src);
		} else {
			idx.byHash[sha256] = {
				sha256,
				file: rel,
				bytes: dl.bytes.length,
				contentType: dl.contentType ?? `image/${ext}`,
				urls: [src]
			};
		}
	}
}

/**
 * Sweep every crawled page file and download any image whose file is missing
 * on disk (e.g. a prior run crashed after writing the page but before saving
 * its images). Idempotent: harvestImages re-checks the disk, so pages whose
 * images are all present are cheap no-ops.
 *
 * Set `onlyDiscussionId` to limit the sweep to one discussion (used right after
 * a page is fetched, we don't need to re-scan everything).
 */
async function backfillImages(
	dataDir: string,
	idx: ImageIndex,
	deadUrls: Set<string>,
	deadlinesBuffer: string[],
	stats: HarvestStats,
	delayMs: number,
	onlyDiscussionId?: number
): Promise<void> {
	const discussionsDir = join(dataDir, 'discussions');
	if (!existsSync(discussionsDir)) return;
	const dirs = onlyDiscussionId
		? [String(onlyDiscussionId)]
		: readdirSync(discussionsDir).filter((d) => /^\d+$/.test(d));
	const total = dirs.length;
	log(`  backfill scanning ${total} discussions...`);
	let processed = 0;
	let sinceDl = stats.downloaded;
	let sinceFail = stats.failed;
	for (const d of dirs) {
		const discDir = join(discussionsDir, d);
		let files: string[];
		try {
			files = readdirSync(discDir).filter((f) => /^page-\d+\.html$/.test(f));
		} catch {
			continue;
		}
		for (const f of files) {
			const html = readFileSync(join(discDir, f), 'utf-8');
			const pageMatch = f.match(/^page-(\d+)\.html$/);
			const page = pageMatch ? parseInt(pageMatch[1], 10) : 1;
			await harvestImages(
				dataDir,
				html,
				Number(d),
				page,
				`data/discussions/${d}/${f}`,
				idx,
				deadUrls,
				deadlinesBuffer,
				stats,
				delayMs
			);
		}
		processed++;
		// Progress every 500 dirs (or whenever a new image lands) so the sweep
		// never looks frozen. Most pages have no missing images → sparse output.
		if (processed % 500 === 0 || stats.downloaded > sinceDl || stats.failed > sinceFail) {
			log(
				`    backfill ${processed}/${total} dirs, ` +
					`+${stats.downloaded - sinceDl} imgs, ${stats.failed - sinceFail} failed so far`
			);
			sinceDl = stats.downloaded;
			sinceFail = stats.failed;
		}
	}
}

/**
 * Discover discussions that need re-crawling.
 *   - 531 known page-1 gaps (from the audit; re-confirmed live so it's resumable)
 *   - plus any discussion referenced only from a profile discussions-page with
 *     no page files at all (the 29585 case)
 */
async function findGaps(dataDir: string): Promise<DiscussionGap[]> {
	const gaps: DiscussionGap[] = [];
	const discussionsDir = join(dataDir, 'discussions');
	const seen = new Set<number>();

	// (a) Scan every discussion dir for a missing real page 1..max.
	if (existsSync(discussionsDir)) {
		const allDirs = readdirSync(discussionsDir).filter((d) => /^\d+$/.test(d));
		log(`Scanning ${allDirs.length} discussion dirs for gaps...`);
		let scanned = 0;
		for (const d of allDirs) {
			const id = Number(d);
			const discDir = join(discussionsDir, d);
			const scan = scanDiscussion(discDir);
			scanned++;
			if (scanned % 2000 === 0) log(`  scanned ${scanned}/${allDirs.length}...`);
			if (!scan || !scan.hasPager) continue;
			const missing: number[] = [];
			for (let p = 1; p <= scan.maxPage; p++) {
				if (!scan.realPagesCovered.has(p)) missing.push(p);
			}
			if (missing.length === 0) continue;
			seen.add(id);
			gaps.push({
				discussionId: id,
				discDir,
				missingRealPages: missing,
				slug: extractSlug(scan.sampleHtml, id)
			});
		}
	}

	// (b) Discussions referenced from a profile discussions-page but with no dir.
	//     These have no pages at all; fetch page 1 only (we don't know the page
	//     count until we see it).
	const profilesDir = join(dataDir, 'profiles');
	if (existsSync(profilesDir)) {
		const referenced = new Set<number>();
		for (const prof of readdirSync(profilesDir)) {
			const pdir = join(profilesDir, prof);
			let entries: string[];
			try {
				entries = readdirSync(pdir);
			} catch {
				continue;
			}
			for (const f of entries.filter((x) => x.startsWith('discussions-page-'))) {
				let html: string;
				try {
					const j = JSON.parse(readFileSync(join(pdir, f), 'utf-8'));
					html = Buffer.from(j.Data, 'base64').toString('utf-8');
				} catch {
					continue;
				}
				for (const m of html.matchAll(/Discussion_(\d+)/g)) {
					referenced.add(Number(m[1]));
				}
			}
		}
		for (const id of referenced) {
			if (seen.has(id)) continue;
			if (existsSync(join(discussionsDir, String(id)))) continue;
			gaps.push({
				discussionId: id,
				discDir: join(discussionsDir, String(id)),
				missingRealPages: [1],
				slug: null
			});
		}
	}

	return gaps;
}

async function main() {
	const dataDir = process.argv[2];
	if (!dataDir || !existsSync(dataDir)) {
		console.error('Usage: bun run scripts/recrawl-missing-pages.ts <data-dir>');
		process.exit(1);
	}
	const cookie = process.env.JANBAO_COOKIE;
	if (!cookie || !cookie.includes('Talk=')) {
		console.error(
			'Set JANBAO_COOKIE to your full Cookie header (Talk=...; Talk-tk=...; Talk-Volatile=...; Talk-Vv=...).'
		);
		process.exit(1);
	}
	const delayMs = Number(process.env.JANBAO_DELAY ?? 5000);
	const dryRun = !!process.env.JANBAO_DRY;

	const gaps = await findGaps(dataDir);
	const totalPages = gaps.reduce((n, g) => n + g.missingRealPages.length, 0);
	log(
		`${gaps.length} discussions with gaps, ${totalPages} pages to fetch` +
			` (delay ${delayMs}ms, est. ${Math.ceil((totalPages * delayMs) / 60000)} min)`
	);

	if (dryRun) {
		for (const g of gaps) {
			log(
				`  [dry] disc ${g.discussionId} pages ${g.missingRealPages.join(',')} slug=${g.slug ?? '(none)'}`
			);
		}
		return;
	}

	let done = 0;
	let failed = 0;
	const imgIdx = loadImageIndex(dataDir);
	const deadUrls = loadDeadUrls(dataDir);
	const deadlinesBuffer: string[] = [];
	const imgStats = { downloaded: 0, skipped: 0, failed: 0 };

	// Optional pre-pass: re-download images missing from disk on already-crawled
	// pages (e.g. a prior run crashed after writing a page but before its images).
	// Enable with JANBAO_BACKFILL_IMAGES=1. Idempotent - pages whose images are all
	// present are skipped via the on-disk check in harvestImages.
	if (process.env.JANBAO_BACKFILL_IMAGES) {
		log('Backfilling missing images across all crawled pages...');
		await backfillImages(dataDir, imgIdx, deadUrls, deadlinesBuffer, imgStats, delayMs);
		saveImageIndex(dataDir, imgIdx);
		flushDeadlines(dataDir, deadlinesBuffer);
		deadlinesBuffer.length = 0;
		log(
			`  backfill: ${imgStats.downloaded} downloaded, ${imgStats.failed} failed, ${imgStats.skipped} already present`
		);
	}

	for (const g of gaps) {
		for (const p of g.missingRealPages) {
			// Re-check live: another run (or a page we just saved) may have
			// already covered this real page. Never create a duplicate.
			const liveScan = scanDiscussion(g.discDir);
			if (liveScan && liveScan.realPagesCovered.has(p)) {
				log(`  [skip] disc ${g.discussionId} p${p} already present`);
				continue;
			}
			const url = pageUrl(g.discussionId, g.slug, p);
			const res = await fetchPage(url, cookie);
			if (!res.ok || !looksLikeDiscussionPage(res.body)) {
				log(
					`  [FAIL] disc ${g.discussionId} p${p} status=${res.status} ${
						res.error ?? (looksLikeDiscussionPage(res.body) ? '' : '(not a discussion page)')
					}`
				);
				failed++;
				await sleep(delayMs);
				continue;
			}
			const gotReal = detectRealPage(res.body);
			// Verify the fetched page is actually the one we asked for. Vanilla can
			// redirect a bare/last-read request to a different page; if we got the
			// wrong real page (or one already on disk), don't save a junk file.
			const fetchedReal = gotReal ?? p; // page 1 may report null → trust the URL
			if (gotReal !== null && gotReal !== p) {
				log(
					`  [skip] disc ${g.discussionId} p${p} fetched realPage=${gotReal} (mismatch, not saving)`
				);
				await sleep(delayMs);
				continue;
			}
			if (liveScan && liveScan.realPagesCovered.has(fetchedReal)) {
				log(`  [skip] disc ${g.discussionId} p${fetchedReal} already present (fetched dup)`);
				await sleep(delayMs);
				continue;
			}
			if (!existsSync(g.discDir)) {
				const { mkdirSync } = await import('fs');
				mkdirSync(g.discDir, { recursive: true });
			}
			const fname = `page-${String(nextFileNumber(g.discDir)).padStart(6, '0')}.html`;
			writeFileSync(join(g.discDir, fname), res.body, 'utf-8');
			// Harvest content images from the freshly fetched page into
			// data/images + images.json (live) or image-deadlinks.jsonl (dead).
			const beforeDl = imgStats.downloaded;
			const beforeFail = imgStats.failed;
			const pageFileRel = `data/discussions/${g.discussionId}/${fname}`;
			await harvestImages(
				dataDir,
				res.body,
				g.discussionId,
				p,
				pageFileRel,
				imgIdx,
				deadUrls,
				deadlinesBuffer,
				imgStats,
				delayMs
			);
			log(
				`  [${done + 1}/${totalPages}] disc ${g.discussionId} p${p} → ${fname}` +
					` (realP=${gotReal ?? '?'}, imgs +${imgStats.downloaded - beforeDl}/${imgStats.failed - beforeFail}f)`
			);
			done++;
			// Flush dead-link records + image index periodically so a crash doesn't
			// lose the whole run's bookkeeping.
			if (deadlinesBuffer.length >= 50) {
				flushDeadlines(dataDir, deadlinesBuffer);
				deadlinesBuffer.length = 0;
				saveImageIndex(dataDir, imgIdx);
			}
			await sleep(delayMs);
		}
	}
	// Persist the updated image index + dead links once everything is fetched.
	saveImageIndex(dataDir, imgIdx);
	flushDeadlines(dataDir, deadlinesBuffer);
	log(
		`Done. Fetched ${done} pages, failed ${failed}.` +
			` Images: ${imgStats.downloaded} downloaded, ${imgStats.failed} failed. See ${LOG_FILE}.`
	);
}

main().catch((err) => {
	console.error('Error:', err);
	process.exit(1);
});
