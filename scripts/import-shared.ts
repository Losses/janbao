/**
 * Pure helpers shared by the data-import tooling (import-data.ts) and the
 * profile-recrawl tooling (recrawl-missing-profiles.ts).
 *
 * These were extracted verbatim from import-data.ts so both scripts resolve
 * against one definition (avoids similarity-ts type duplicates and keeps the
 * Vanilla-HTML parsing logic in one place). Nothing here performs DB or network
 * I/O except the libwebp conversion (convertToWebp), which shells out to cwebp /
 * gif2webp; callers own all fetch + persistence.
 */
import { readFileSync, unlinkSync, openSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { detectImageFormat } from '../src/lib/server/image';
import { GHOST_USER_ID } from '../src/lib/server/constants';

// A crawled Vanilla profile (the About panel of /profile/<id>/<slug>). Every
// field is nullable because the source page may omit it.
export interface ParsedProfile {
	username: string | null;
	displayName: string | null;
	// One-line personal blurb from <div id="Status" itemprop="description">.
	// Truncated to the app's 100-char bio cap; null when the profile has none.
	bio: string | null;
	email: string | null;
	signupTime: Date | null;
	lastActiveTime: Date | null;
	viewCount: number | null;
	// The user who invited this profile (from <dd class="Invited">). null when the
	// profile shows no inviter.
	inviterId: number | null;
}

// HTML Entity decoder
export function decodeHtmlEntities(str: string): string {
	return (
		str
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&nbsp;/g, ' ')
			// Numeric entities - Vanilla emits apostrophes as &#039; (with a leading
			// zero) and other chars as &#8230; etc., which the literal replacements
			// above miss. Guard against out-of-range codes so malformed input can't
			// throw inside String.fromCodePoint.
			.replace(/&#(\d+);/g, (_, code) => {
				const n = Number(code);
				return n <= 0x10ffff ? String.fromCodePoint(n) : '';
			})
			.replace(/&#x([0-9a-f]+);/gi, (_, code) => {
				const n = parseInt(code, 16);
				return n <= 0x10ffff ? String.fromCodePoint(n) : '';
			})
	);
}

// Robust Email obfuscation decoder
export function parseEmail(html: string): string | null {
	const match = html.match(/<dd class="Email"[^>]*>([\s\S]+?)<\/dd>/);
	if (!match) return null;
	const emailSpan = match[1];
	const spanRegex = /<span style="([^"]+)">([^<]+)<\/span>/g;
	let m;
	let email = '';
	while ((m = spanRegex.exec(emailSpan)) !== null) {
		const style = m[1].replace(/\s+/g, '');
		const text = m[2];
		if (style.includes('display:none;display:inline')) {
			email += text;
		}
	}
	return email || null;
}

// Parse user details from profile.html
export function parseProfileHtml(html: string): ParsedProfile {
	const usernameMatch =
		html.match(/<dd class="Name"[^>]*itemprop="name"[^>]*>([\s\S]+?)<\/dd>/) ||
		html.match(/<dt class="Name">用户名<\/dt>\s*<dd class="Name"[^>]*>([\s\S]+?)<\/dd>/);
	const username = usernameMatch
		? decodeHtmlEntities(usernameMatch[1].replace(/<[^>]+>/g, '')).trim()
		: null;

	const h1Match = html.match(/<h1 class="H">([\s\S]+?)(?:<span|$)/);
	const displayName = h1Match
		? decodeHtmlEntities(h1Match[1].replace(/<[^>]+>/g, '')).trim()
		: null;

	// Bio: <div id="Status" itemprop="description"><span>…</span></div>.
	// Capped at 100 chars to match the edit API invariant.
	const statusMatch = html.match(/<div id="Status"[^>]*>([\s\S]*?)<\/div>/);
	const statusText = statusMatch
		? decodeHtmlEntities(statusMatch[1].replace(/<[^>]+>/g, '')).trim()
		: '';
	const bio = statusText ? statusText.slice(0, 100) : null;

	const email = parseEmail(html);

	const joinedMatch =
		html.match(/<dt class="Joined">加入<\/dt>\s*<dd class="Joined">[\s\S]*?datetime="([^"]+)"/) ||
		html.match(/<dd class="Joined">[\s\S]*?datetime="([^"]+)"/);
	const signupTime = joinedMatch ? new Date(joinedMatch[1]) : null;

	const activeMatch =
		html.match(
			/<dt class="LastActive">上次在线<\/dt>\s*<dd class="LastActive">[\s\S]*?datetime="([^"]+)"/
		) || html.match(/<dd class="LastActive">[\s\S]*?datetime="([^"]+)"/);
	const lastActiveTime = activeMatch ? new Date(activeMatch[1]) : null;

	const visitsMatch = html.match(
		/<dt class="Visits">访问<\/dt>\s*<dd class="Visits">([\d,]+)<\/dd>/
	);
	const viewCount = visitsMatch ? parseInt(visitsMatch[1].replace(/,/g, '')) : null;

	// Inviter: <dt class="Invited">Invited</dt><dd class="Invited"><a href="/profile/ID/slug">…</a></dd>
	const inviterMatch = html.match(/<dd class="Invited">[\s\S]*?<a\s+href="\/profile\/(\d+)\//);
	const inviterId = inviterMatch ? Number(inviterMatch[1]) : null;

	return {
		username,
		displayName,
		bio,
		email,
		signupTime,
		lastActiveTime,
		viewCount,
		inviterId
	};
}

// Convert parsed comment date strings to Date object
export function parseCommentTime(timeText: string): Date {
	const now = new Date();
	timeText = timeText.trim();

	const ymdMatch = timeText.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
	if (ymdMatch) {
		return new Date(parseInt(ymdMatch[1]), parseInt(ymdMatch[2]) - 1, parseInt(ymdMatch[3]));
	}

	const mdMatch = timeText.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
	if (mdMatch) {
		const month = parseInt(mdMatch[1]) - 1;
		const day = parseInt(mdMatch[2]);
		// Default to 2026 since data saves are around June 2026.
		const date = new Date(2026, month, day);
		// If constructed date is in the future relative to the crawl date (June 2026), it belongs to previous year.
		if (date.getTime() > new Date('2026-06-13').getTime()) {
			date.setFullYear(2025);
		}
		return date;
	}

	const dashMatch = timeText.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
	if (dashMatch) {
		return new Date(parseInt(dashMatch[1]), parseInt(dashMatch[2]) - 1, parseInt(dashMatch[3]));
	}

	if (timeText.includes(':') && timeText.length <= 5) {
		const [h, m] = timeText.split(':');
		const date = new Date();
		date.setHours(parseInt(h), parseInt(m), 0, 0);
		return date;
	}

	return now;
}

/**
 * Vanilla reserves UserID 0 for the "Unknown" author (account deleted/purged),
 * and never issues non-positive ids otherwise. Remap any such id onto our
 * GHOST_USER_ID sentinel so it never collides with the seeded admin (id 0) or
 * any real user.
 */
export function normalizeVanillaUserId(raw: string | number): number {
	const id = Number(raw);
	return id > 0 ? id : GHOST_USER_ID;
}

// Helper to get safe error message from unknown errors
export function getErrorMessage(e: unknown): string {
	if (e instanceof Error) {
		return e.message;
	}
	return String(e);
}

/**
 * Verify the libwebp CLI tools are on PATH; fail fast with a clear message if
 * not (they are required to convert crawled images to webp).
 */
export function ensureWebpTools(): void {
	for (const tool of ['cwebp', 'gif2webp']) {
		try {
			execFileSync('which', [tool], { stdio: 'ignore' });
		} catch {
			console.error(
				`Missing required tool: ${tool}. Install libwebp (e.g. "nix-env -iA nixos.libwebp", ` +
					` "brew install webp", or "apt install webp").`
			);
			process.exit(1);
		}
	}
}

/** Read the first `n` bytes of a file (for magic-byte format detection). */
export function readHead(srcPath: string, n: number): Buffer {
	const fd = openSync(srcPath, 'r');
	const head = Buffer.alloc(n);
	readSync(fd, head, 0, n, 0);
	closeSync(fd);
	return head;
}

/**
 * Convert a source image file to webp bytes. Format is detected from magic
 * bytes (not the label): GIFs go through gif2webp (preserving animation);
 * png/jpeg/webp/bmp through cwebp. Non-images throw (caller treats as dead).
 */
export function convertToWebp(srcPath: string): Uint8Array {
	const format = detectImageFormat(readHead(srcPath, 12));
	if (format === 'other') {
		throw new Error(`not a supported image format: ${srcPath}`);
	}
	const out = join(tmpdir(), `janbao-${randomUUID()}.webp`);
	try {
		if (format === 'gif') {
			execFileSync('gif2webp', [srcPath, '-o', out], { stdio: 'ignore' });
		} else {
			execFileSync('cwebp', [srcPath, '-o', out, '-quiet', '-q', '82'], { stdio: 'ignore' });
		}
		return new Uint8Array(readFileSync(out));
	} finally {
		try {
			unlinkSync(out);
		} catch {
			// temp cleanup is best-effort
		}
	}
}

// Run an async fn over items in fixed-size concurrent batches (waits for each
// batch before starting the next). Used to parallelize pCloud uploads.
export type PoolTask<T> = (item: T) => Promise<void>;

export async function mapPool<T>(items: T[], concurrency: number, fn: PoolTask<T>): Promise<void> {
	for (let i = 0; i < items.length; i += concurrency) {
		await Promise.all(items.slice(i, i + concurrency).map((item) => fn(item).catch(() => {})));
	}
}
