import {
	readdirSync,
	existsSync,
	readFileSync,
	createReadStream,
	writeFileSync,
	unlinkSync,
	openSync,
	readSync,
	closeSync
} from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { getLocalDb } from '../src/lib/server/db';
import * as schema from '../src/lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { GHOST_USER_ID } from '../src/lib/server/constants';
import { resolvePcloudConfig, pcloudUploadBytes, pcloudListFolder } from '../src/lib/server/pcloud';
import { detectImageFormat } from '../src/lib/server/image';

// Named interfaces to avoid inline object type literal lint errors
interface ParsedProfile {
	username: string | null;
	displayName: string | null;
	email: string | null;
	signupTime: Date | null;
	lastActiveTime: Date | null;
	viewCount: number | null;
}

interface DiscussionMeta {
	title: string;
	authorId: number;
	createdAt: Date;
}

interface ConflictRecord {
	type: string;
	[key: string]: unknown;
}

interface ParsedActivity {
	id: string;
	contentHtml: string;
	createdAt: Date;
}

interface ProfileAvatarRecord {
	file?: unknown;
	contentType?: unknown;
}

interface ProfileAvatarsJson {
	byUserId?: Record<string, ProfileAvatarRecord>;
}

interface AvatarEntry {
	userId: string;
	file: string;
	contentType: string | null;
}

// HTML Entity decoder
function decodeHtmlEntities(str: string): string {
	return str
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ');
}

// ===== Lexical node shapes produced by the converter =====

interface LexicalTextNode {
	detail: number;
	format: number;
	mode: string;
	style: string;
	text: string;
	type: 'text';
	version: number;
}

interface LexicalMentionNode {
	type: 'mention';
	username: string;
	displayName: string;
	version: number;
}

interface LexicalLinkNode {
	type: 'link';
	url: string;
	rel: null;
	target: null;
	title: null;
	direction: string;
	format: string;
	indent: number;
	version: number;
	children: LexicalInlineNode[];
}

interface LexicalImageNode {
	type: 'image';
	src: string;
	altText: string;
	maxWidth: number;
	showCaption: boolean;
	caption: EmptyCaption;
	height: 'inherit';
	width: 'inherit';
	version: number;
}

interface LexicalDeadImageNode {
	type: 'dead-image';
	version: number;
}

interface LexicalParagraphNode {
	type: 'paragraph';
	direction: string;
	format: string;
	indent: number;
	version: number;
	children: LexicalInlineNode[];
}

type LexicalInlineNode = LexicalTextNode | LexicalMentionNode | LexicalLinkNode;
type LexicalBlockNode = LexicalParagraphNode | LexicalImageNode | LexicalDeadImageNode;

// Empty SerializedEditor for the svelte-lexical ImageNode caption field
// (importJSON requires the full shape even though the caption is unused).
interface EmptyCaptionRoot {
	type: 'root';
	direction: string;
	format: string;
	indent: number;
	version: number;
	children: {
		type: 'paragraph';
		direction: string;
		format: string;
		indent: number;
		version: number;
		children: never[];
	}[];
}

interface EmptyCaption {
	root: EmptyCaptionRoot;
}

const EMPTY_CAPTION: EmptyCaption = {
	root: {
		type: 'root',
		direction: 'ltr',
		format: '',
		indent: 0,
		version: 1,
		children: [
			{
				type: 'paragraph',
				direction: 'ltr',
				format: '',
				indent: 0,
				version: 1,
				children: []
			}
		]
	}
};

// ===== Converter context (mention + image resolution) =====

interface MentionResolved {
	resolved: true;
	userId: number;
}

interface MentionUnresolved {
	resolved: false;
}

type MentionResolution = MentionResolved | MentionUnresolved;

interface ImageLive {
	kind: 'live';
	fileId: string;
}

interface ImageDead {
	kind: 'dead';
}

interface ImageDrop {
	kind: 'drop';
}

type ImageResolution = ImageLive | ImageDead | ImageDrop;

type MentionResolver = (username: string) => Promise<MentionResolution>;
type ImageResolver = (src: string) => Promise<ImageResolution>;

interface ConverterContext {
	resolveMention: MentionResolver;
	resolveImage: ImageResolver;
}

// Block-level tags whose open/close flush the current paragraph.
const BLOCK_TAGS = new Set([
	'p',
	'div',
	'li',
	'ul',
	'ol',
	'blockquote',
	'pre',
	'table',
	'tr',
	'td',
	'th',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr',
	'br'
]);

function buildTextNode(text: string): LexicalTextNode {
	return { detail: 0, format: 0, mode: 'normal', style: '', text, type: 'text', version: 1 };
}

function buildMentionNode(username: string, displayName: string): LexicalMentionNode {
	return { type: 'mention', username, displayName, version: 1 };
}

function buildLinkNode(url: string, text: string): LexicalLinkNode {
	return {
		type: 'link',
		url,
		rel: null,
		target: null,
		title: null,
		direction: 'ltr',
		format: '',
		indent: 0,
		version: 1,
		children: text ? [buildTextNode(text)] : []
	};
}

function buildImageNode(src: string, altText: string): LexicalImageNode {
	return {
		type: 'image',
		src,
		altText,
		maxWidth: 800,
		showCaption: false,
		caption: EMPTY_CAPTION,
		height: 'inherit',
		width: 'inherit',
		version: 1
	};
}

function buildDeadImageNode(): LexicalDeadImageNode {
	return { type: 'dead-image', version: 1 };
}

function buildParagraphNode(children: LexicalInlineNode[]): LexicalParagraphNode {
	return { type: 'paragraph', direction: 'ltr', format: '', indent: 0, version: 1, children };
}

// Extract a named attribute value from a raw attribute string (double-quoted).
function getAttr(attrs: string, name: string): string | null {
	const re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*"([^"]*)"', 'i');
	const m = attrs.match(re);
	return m ? m[1] : null;
}

/**
 * Convert a Message-body HTML slice into a serialized Lexical state.
 *
 * Handles paragraphs (split on <br>/block boundaries), plain text, @username
 * mention chips, http(s) links, content images (live or dead), and silently
 * drops emoji <img class="emoji">. Rich formatting (bold/italic/lists/quote) is
 * intentionally stripped to text in this pass.
 *
 * Mentions resolve via ctx.resolveMention (username → userId); images resolve
 * via ctx.resolveImage (src → live file id | dead | drop). Both may perform DB
 * / filesystem side effects, so the converter is async.
 */
async function convertHtmlToLexical(html: string, ctx: ConverterContext): Promise<string> {
	const blocks: LexicalBlockNode[] = [];
	let inline: LexicalInlineNode[] = [];
	let textBuf = '';

	function flushText(): void {
		if (textBuf) {
			inline.push(buildTextNode(textBuf));
			textBuf = '';
		}
	}

	function flushParagraph(): void {
		flushText();
		if (inline.length > 0) {
			blocks.push(buildParagraphNode(inline));
			inline = [];
		}
	}

	const tagRe = /<(\w+)((?:[^>"]|"[^"]*")*)>|<\/(\w+)>/g;
	let lastIndex = 0;
	let m: RegExpExecArray | null;

	while ((m = tagRe.exec(html)) !== null) {
		if (m.index > lastIndex) {
			textBuf += decodeHtmlEntities(html.slice(lastIndex, m.index));
		}

		const openName = m[1];
		const attrs = m[2] ?? '';
		const closeName = m[3];

		if (openName) {
			const tag = openName.toLowerCase();

			if (tag === 'br') {
				flushParagraph();
			} else if (tag === 'img') {
				const cls = getAttr(attrs, 'class') ?? '';
				const src = getAttr(attrs, 'src') ?? '';
				const alt = getAttr(attrs, 'alt') ?? '';
				if (/\bemoji\b/.test(cls)) {
					// Emoji were never crawled — drop silently.
				} else {
					const res = await ctx.resolveImage(src);
					if (res.kind === 'live') {
						flushParagraph();
						blocks.push(buildImageNode('/attachment/' + res.fileId, alt));
					} else if (res.kind === 'dead') {
						flushParagraph();
						blocks.push(buildDeadImageNode());
					}
					// kind === 'drop' → skip
				}
			} else if (tag === 'a') {
				const href = getAttr(attrs, 'href') ?? '';
				const closeIdx = html.indexOf('</a>', tagRe.lastIndex);
				const innerEnd = closeIdx === -1 ? html.length : closeIdx;
				const innerRaw = html.slice(tagRe.lastIndex, innerEnd);
				const innerText = decodeHtmlEntities(innerRaw.replace(/<[^>]+>/g, '')).trim();
				const afterClose = closeIdx === -1 ? html.length : closeIdx + 4;

				const mentionMatch = href.match(/^\/profile\/(.+)$/);
				if (mentionMatch) {
					const username = decodeURIComponent(mentionMatch[1]).trim();
					const display = innerText.replace(/^@/, '').trim() || username;
					if (textBuf.endsWith('@')) textBuf = textBuf.slice(0, -1);
					flushText();
					const res = await ctx.resolveMention(username);
					if (res.resolved) {
						inline.push(buildMentionNode(username, display));
					} else {
						inline.push(buildTextNode('@' + display));
					}
				} else {
					flushText();
					if (/^https?:\/\//i.test(href)) {
						inline.push(buildLinkNode(href, innerText));
					} else if (innerText) {
						inline.push(buildTextNode(innerText));
					}
				}

				tagRe.lastIndex = afterClose;
				lastIndex = afterClose;
				continue;
			} else if (BLOCK_TAGS.has(tag)) {
				flushParagraph();
			}
		} else if (closeName && BLOCK_TAGS.has(closeName.toLowerCase())) {
			flushParagraph();
		}

		lastIndex = tagRe.lastIndex;
	}

	if (lastIndex < html.length) {
		textBuf += decodeHtmlEntities(html.slice(lastIndex));
	}
	flushParagraph();

	return JSON.stringify({
		root: {
			type: 'root',
			direction: 'ltr',
			format: '',
			indent: 0,
			version: 1,
			children: blocks
		}
	});
}

/**
 * Extract the OP (first post) body from a discussion page: the first
 * <div class="Message"> inside <div id="Discussion_<id>">, terminated before the
 * comment list begins. Returns null if the Discussion wrapper or Message is
 * absent.
 */
function extractOpBody(html: string, discussionId: number): string | null {
	const startMarker = `id="Discussion_${discussionId}"`;
	const startIdx = html.indexOf(startMarker);
	if (startIdx === -1) return null;

	const rest = html.slice(startIdx);
	const endMarkers = ['class="Item ItemComment"', 'class="CommentsWrap"', '<div class="Comments"'];
	let endIdx = rest.length;
	for (const marker of endMarkers) {
		const i = rest.indexOf(marker);
		if (i !== -1 && i < endIdx) endIdx = i;
	}

	const slice = rest.slice(0, endIdx);
	const msgMatch = slice.match(/<div\s+class="Message">([\s\S]+?)<\/div>/);
	return msgMatch ? msgMatch[1] : null;
}

// Robust Email obfuscation decoder
function parseEmail(html: string): string | null {
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
function parseProfileHtml(html: string): ParsedProfile {
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

	return {
		username,
		displayName,
		email,
		signupTime,
		lastActiveTime,
		viewCount
	};
}

// Parse comments from HTML string in comments-page-*.json
interface ParsedComment {
	id: string;
	contentHtml: string;
	discussionTitle: string;
	timeText: string;
}

function parseCommentsHtml(html: string): ParsedComment[] {
	const comments: ParsedComment[] = [];
	const parts = html.split(/<li\s+id="Comment_/);
	for (let i = 1; i < parts.length; i++) {
		const part = parts[i];
		const idMatch = part.match(/^(\d+)/);
		if (!idMatch) continue;
		const id = idMatch[1];

		const messageMatch = part.match(/<div\s+class="Message">([\s\S]+?)<\/div>/);
		const contentHtml = messageMatch ? messageMatch[1] : '';

		const titleMatch = part.match(/in\s*<b><a[^>]*>([\s\S]+?)<\/a><\/b>/);
		let discussionTitle = '';
		if (titleMatch) {
			discussionTitle = decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, '')).trim();
		}

		const metaMatch = part.match(/<div\s+class="Meta">([\s\S]+?)<\/div>/);
		let timeText = '';
		if (metaMatch) {
			const spanRegex = /<span\s+class="MItem">([\s\S]+?)<\/span>/g;
			let m;
			const spans: string[] = [];
			while ((m = spanRegex.exec(metaMatch[1])) !== null) {
				spans.push(m[1]);
			}
			for (const span of spans) {
				const aMatch = span.match(/<a[^>]*>([\s\S]+?)<\/a>/);
				const text = aMatch ? aMatch[1] : span;
				const cleanText = text.replace(/<[^>]+>/g, '').trim();
				if (
					/[\d\u4e00-\u9fa5]+/.test(cleanText) &&
					(cleanText.includes('月') ||
						cleanText.includes('年') ||
						cleanText.includes(':') ||
						cleanText.includes('前') ||
						cleanText.includes('ago'))
				) {
					timeText = cleanText;
				}
			}
		}

		comments.push({ id, contentHtml, discussionTitle, timeText });
	}
	return comments;
}

// Convert parsed comment date strings to Date object
function parseCommentTime(timeText: string): Date {
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

// Parse discussions from HTML string in discussions-page-*.json
interface ParsedDiscussion {
	id: string;
	title: string;
	categorySlug: string;
	categoryTitle: string;
	lastActiveTime: Date;
	viewCount: number;
	commentCount: number;
}

function parseDiscussionsHtml(html: string): ParsedDiscussion[] {
	const discussions: ParsedDiscussion[] = [];
	const parts = html.split(/<li\s+id="Discussion_/);
	for (let i = 1; i < parts.length; i++) {
		const part = parts[i];
		const idMatch = part.match(/^(\d+)/);
		if (!idMatch) continue;
		const id = idMatch[1];

		const titleMatch = part.match(/<div\s+class="Title">[\s\S]*?<a[^>]*>([\s\S]+?)<\/a>/);
		if (!titleMatch) continue;
		const title = decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, '')).trim();

		const catMatch = part.match(/Category-([^"\s>]+)/);
		const categorySlug = catMatch ? catMatch[1] : 'general';

		const catTitleMatch = part.match(/Category-[^"\s>]+"[^>]*><a[^>]*>([\s\S]+?)<\/a>/);
		const categoryTitle = catTitleMatch
			? decodeHtmlEntities(catTitleMatch[1].replace(/<[^>]+>/g, '')).trim()
			: 'General';

		const timeMatch = part.match(/<time[^>]*datetime="([^"]+)"/);
		const lastActiveTime = timeMatch ? new Date(timeMatch[1]) : new Date();

		const viewsMatch =
			part.match(/ViewCount"[^>]*><span[^>]*>([\d,]+)<\/span>/) ||
			part.match(/ViewCount"[^>]*>([\d,]+)\s*浏览/);
		const viewCount = viewsMatch ? parseInt(viewsMatch[1].replace(/,/g, '')) : 0;

		const commentsMatch =
			part.match(/CommentCount"[^>]*><span[^>]*>([\d,]+)<\/span>/) ||
			part.match(/CommentCount"[^>]*>([\d,]+)\s*评论/);
		const commentCount = commentsMatch ? parseInt(commentsMatch[1].replace(/,/g, '')) : 0;

		discussions.push({
			id,
			title,
			categorySlug,
			categoryTitle,
			lastActiveTime,
			viewCount,
			commentCount
		});
	}
	return discussions;
}

// Parse discussions-activities in user's profile.html
function parseActivitiesHtml(html: string): ParsedActivity[] {
	const activities: ParsedActivity[] = [];
	const activitiesBlockMatch = html.match(
		/<ul\s+class="DataList\s+Activities">([\s\S]+?)<\/ul>\s*<\/div>/
	);
	if (!activitiesBlockMatch) return [];

	const block = activitiesBlockMatch[1];
	const parts = block.split(/<li\s+id="Activity_/);
	for (let i = 1; i < parts.length; i++) {
		const part = parts[i];
		const idMatch = part.match(/^(\d+)/);
		if (!idMatch) continue;
		const id = idMatch[1];

		const excerptMatch = part.match(/<div\s+class="Excerpt">([\s\S]+?)<\/div>/);
		const contentHtml = excerptMatch ? excerptMatch[1] : '';

		const dateMatch = part.match(/<span\s+class="MItem\s+DateCreated">([\s\S]+?)<\/span>/);
		let createdAt = new Date();
		if (dateMatch) {
			const dateText = dateMatch[1].replace(/<[^>]+>/g, '').trim();
			createdAt = parseCommentTime(dateText);
		}

		activities.push({
			id,
			contentHtml,
			createdAt
		});
	}
	return activities;
}

// Parse discussion ID and slug from post URL
function parsePostUrl(postUrl: string): { id: string; slug: string } | null {
	const match = postUrl.match(/\/discussion\/(\d+)\/([^/#?]+)/);
	if (match) {
		return { id: match[1], slug: match[2] };
	}
	const matchIdOnly = postUrl.match(/\/discussion\/(\d+)/);
	if (matchIdOnly) {
		return { id: matchIdOnly[1], slug: `discussion-${matchIdOnly[1]}` };
	}
	return null;
}

// Extract category slug from page URL
function extractCategorySlug(pageUrl: string | undefined): string {
	if (!pageUrl) return 'general';
	const match = pageUrl.match(/categories\/([^/]+)/);
	return match ? match[1] : 'general';
}

/**
 * Vanilla reserves UserID 0 for the "Unknown" author (account deleted/purged),
 * and never issues non-positive ids otherwise. Remap any such id onto our
 * GHOST_USER_ID sentinel so it never collides with the seeded admin (id 0) or
 * any real user.
 */
function normalizeVanillaUserId(raw: string | number): number {
	const id = Number(raw);
	return id > 0 ? id : GHOST_USER_ID;
}

// Helper to get safe error message from unknown errors
function getErrorMessage(e: unknown): string {
	if (e instanceof Error) {
		return e.message;
	}
	return String(e);
}

// ===== Mention + image resolution maps =====

interface ImageEntry {
	sha256: string;
	file: string;
	contentType: string | null;
}

interface ImageMaps {
	byUrl: Map<string, ImageEntry>;
	deadUrls: Set<string>;
}

/**
 * Build username → userId from users.json. Mention hrefs use the Vanilla Name
 * field, which equals our `username`, so this resolves mentions directly.
 * First write wins on username collision.
 */
function buildMentionMap(dataDir: string): Map<string, number> {
	const usersPath = join(dataDir, 'users.json');
	if (!existsSync(usersPath)) return new Map();
	const raw: unknown = JSON.parse(readFileSync(usersPath, 'utf-8'));
	const arr: unknown[] = Array.isArray(raw)
		? raw
		: Array.isArray((raw as { users?: unknown[] }).users)
			? (raw as { users: unknown[] }).users
			: Object.values(raw as Record<string, unknown>);

	const map = new Map<string, number>();
	for (const u of arr) {
		const rec = u as { username?: unknown; userId?: unknown };
		const username = typeof rec.username === 'string' ? rec.username.trim() : '';
		const userId = Number(rec.userId);
		if (username && Number.isFinite(userId) && !map.has(username)) {
			map.set(username, userId);
		}
	}
	return map;
}

/**
 * Build image resolution maps: images.json byUrl (only entries with both
 * sha256 + file are "live") and image-deadlinks.jsonl (dead URLs).
 */
function buildImageMaps(dataDir: string): ImageMaps {
	const byUrl = new Map<string, ImageEntry>();
	const deadUrls = new Set<string>();

	const imagesPath = join(dataDir, 'images.json');
	if (existsSync(imagesPath)) {
		const raw = JSON.parse(readFileSync(imagesPath, 'utf-8')) as {
			byUrl?: Record<string, unknown>;
		};
		const entries = raw.byUrl ?? {};
		for (const [url, val] of Object.entries(entries)) {
			const rec = val as { sha256?: unknown; file?: unknown; contentType?: unknown };
			if (typeof rec.sha256 === 'string' && typeof rec.file === 'string') {
				byUrl.set(url, {
					sha256: rec.sha256,
					file: rec.file,
					contentType: typeof rec.contentType === 'string' ? rec.contentType : null
				});
			} else {
				deadUrls.add(url);
			}
		}
	}

	const deadPath = join(dataDir, 'image-deadlinks.jsonl');
	if (existsSync(deadPath)) {
		for (const line of readFileSync(deadPath, 'utf-8').split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const rec = JSON.parse(trimmed) as { url?: unknown };
				if (typeof rec.url === 'string') deadUrls.add(rec.url);
			} catch {
				// skip malformed line
			}
		}
	}

	return { byUrl, deadUrls };
}

/**
 * Verify the libwebp CLI tools are on PATH; fail fast with a clear message if
 * not (they are required to convert crawled images to webp).
 */
function ensureWebpTools(): void {
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

/**
 * Convert a source image file to webp bytes. Animated GIFs go through
 * gif2webp (preserving animation); everything else through cwebp. APNG is
 * best-effort (cwebp takes the first frame). Returns the webp bytes.
 */
/** Read the first `n` bytes of a file (for magic-byte format detection). */
function readHead(srcPath: string, n: number): Buffer {
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
function convertToWebp(srcPath: string): Uint8Array {
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

/**
 * Run an async fn over items in fixed-size concurrent batches (waits for each
 * batch before starting the next). Used to parallelize pCloud uploads.
 */
type PoolTask<T> = (item: T) => Promise<void>;

async function mapPool<T>(items: T[], concurrency: number, fn: PoolTask<T>): Promise<void> {
	for (let i = 0; i < items.length; i += concurrency) {
		await Promise.all(items.slice(i, i + concurrency).map((item) => fn(item).catch(() => {})));
	}
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length < 1) {
		console.error('Usage: bun run scripts/import-data.ts <path-to-data-directory>');
		process.exit(1);
	}

	const dataDir = args[0];
	if (!existsSync(dataDir)) {
		console.error(`Error: Data directory "${dataDir}" does not exist.`);
		process.exit(1);
	}

	console.log(`Starting data import from: ${dataDir}`);

	ensureWebpTools();

	const db = await getLocalDb();

	// 1. Seed base user groups and default category
	console.log('Seeding baseline groups and categories...');
	const groupsToSeed = [
		{ slug: 'system', title: 'System', description: 'System account', permissionsJson: '{}' },
		{ slug: 'admin', title: 'Administrator', description: 'Admin account', permissionsJson: '{}' },
		{
			slug: 'moderator',
			title: 'Moderator',
			description: 'Moderator account',
			permissionsJson: '{}'
		},
		{ slug: 'member', title: 'Member', description: 'Member account', permissionsJson: '{}' },
		{ slug: 'guest', title: 'Guest', description: 'Guest account', permissionsJson: '{}' }
	];

	for (const g of groupsToSeed) {
		await db.insert(schema.userGroups).values(g).onConflictDoNothing();
	}

	await db
		.insert(schema.categories)
		.values({
			slug: 'general',
			title: 'General',
			description: 'General discussion board',
			priority: 1,
			displayOrder: 1
		})
		.onConflictDoNothing();

	// Ghost user: absorbs Vanilla's UserID 0 ("Unknown" / deleted authors) so
	// those posts attribute to a single stealth sentinel instead of occupying
	// id 0 (which the seeded admin needs). Pre-seeded here so ensureUser skips it.
	await db
		.insert(schema.users)
		.values({
			id: GHOST_USER_ID,
			username: 'unknown',
			displayName: 'Unknown',
			email: 'unknown@janbao.local',
			passwordHash: 'GHOST_NO_PASSWORD',
			groupSlug: 'system',
			isStealth: true
		})
		.onConflictDoNothing({ target: schema.users.id });

	// 2. Preload DB records in memory to detect conflicts and avoid repeated DB lookups
	console.log('Preloading DB indexes for duplicate detection...');
	const existingUserIds = new Set<number>();
	const existingCategorySlugs = new Set<string>();
	const existingDiscussionIds = new Set<number>();
	const existingReplyIds = new Set<number>();
	const existingActivityIds = new Set<number>();

	const existingDiscussionsMap = new Map<number, DiscussionMeta>();
	const discussionTitleToIdMap = new Map<string, number>();

	const usersInDb = await db.select({ id: schema.users.id }).from(schema.users);
	for (const u of usersInDb) {
		existingUserIds.add(u.id);
	}

	const catsInDb = await db.select({ slug: schema.categories.slug }).from(schema.categories);
	for (const c of catsInDb) {
		existingCategorySlugs.add(c.slug);
	}

	const discInDb = await db
		.select({
			id: schema.discussions.id,
			title: schema.discussions.title,
			authorId: schema.discussions.authorId,
			createdAt: schema.discussions.createdAt
		})
		.from(schema.discussions);
	for (const d of discInDb) {
		existingDiscussionIds.add(d.id);
		existingDiscussionsMap.set(d.id, {
			title: d.title,
			authorId: d.authorId,
			createdAt: d.createdAt
		});
		discussionTitleToIdMap.set(d.title, d.id);
	}

	const repliesInDb = await db.select({ id: schema.replies.id }).from(schema.replies);
	for (const r of repliesInDb) {
		existingReplyIds.add(r.id);
	}

	const actsInDb = await db.select({ id: schema.activities.id }).from(schema.activities);
	for (const a of actsInDb) {
		existingActivityIds.add(a.id);
	}

	const conflicts: ConflictRecord[] = [];

	// Helper function to insert user if not exist
	async function ensureUser(userId: number, username: string) {
		if (existingUserIds.has(userId)) return;
		try {
			await db.insert(schema.users).values({
				id: userId,
				username: username || `user_${userId}`,
				displayName: username || `User ${userId}`,
				email: `${userId}@placeholder.janbao.net`,
				passwordHash: 'NO_PASSWORD',
				groupSlug: 'member',
				avatarFileId: null
			});
			existingUserIds.add(userId);
		} catch (e: unknown) {
			conflicts.push({
				type: 'user_insert_error',
				userId,
				username,
				error: getErrorMessage(e)
			});
		}
	}

	// Helper function to insert category if not exist
	async function ensureCategory(categorySlug: string) {
		if (existingCategorySlugs.has(categorySlug)) return;
		try {
			const title = categorySlug.charAt(0).toUpperCase() + categorySlug.slice(1);
			await db.insert(schema.categories).values({
				slug: categorySlug,
				title: title,
				description: `${title} category`
			});
			existingCategorySlugs.add(categorySlug);
		} catch (e: unknown) {
			conflicts.push({
				type: 'category_insert_error',
				categorySlug,
				error: getErrorMessage(e)
			});
		}
	}

	// 2.5 Build mention + image resolution maps (used by the lexical converter)
	console.log('Building mention + image resolution maps...');
	const mentionMap = buildMentionMap(dataDir);
	const imageMaps = buildImageMaps(dataDir);

	// pCloud config (WebDAV). Avatars + attachments are stored under
	// cfg.basePath (e.g. /Janbao) and served by the /avatar and /attachment
	// reverse-proxy routes.
	const pcloudCfg = resolvePcloudConfig(process.env as Record<string, string>);
	if (!pcloudCfg.username || !pcloudCfg.password) {
		console.error(
			'pCloud credentials not configured. Run: bun scripts/setup-pcloud.ts (writes PCLOUD_* to .env).'
		);
		process.exit(1);
	}
	console.log(`pCloud: ${pcloudCfg.host}${pcloudCfg.basePath}`);

	// "ls before migration": the sets already on pCloud, so a re-run skips
	// re-converting/re-uploading them. Refreshed as we upload.
	const attachmentsOnCloud = await pcloudListFolder(pcloudCfg, '/attachments');
	const avatarsOnCloud = await pcloudListFolder(pcloudCfg, '/avatars');

	// Image src URLs referenced by imported content. The converter records them
	// without uploading; a bulk parallel upload phase runs after all content is
	// processed so uploads don't block conversion.
	const referencedImageUrls = new Set<string>();

	/** Shared converter context. resolveImage records the src and returns the
	 * live file id (pre-conversion sha256) without uploading — uploads happen in
	 * the bulk phase. */
	const converterCtx: ConverterContext = {
		resolveMention: async (username: string): Promise<MentionResolution> => {
			const userId = mentionMap.get(username);
			if (userId === undefined) return { resolved: false };
			await ensureUser(userId, username);
			return { resolved: true, userId };
		},
		resolveImage: async (src: string): Promise<ImageResolution> => {
			referencedImageUrls.add(src);
			const entry = imageMaps.byUrl.get(src);
			return entry ? { kind: 'live', fileId: entry.sha256 } : { kind: 'dead' };
		}
	};

	// 3. Import data/posts
	const postsDir = join(dataDir, 'posts');
	if (existsSync(postsDir)) {
		console.log('Scanning data/posts...');
		const postFiles = readdirSync(postsDir)
			.filter((f) => f.startsWith('posts-') && f.endsWith('.jsonl'))
			.sort();

		for (const file of postFiles) {
			const filePath = join(postsDir, file);
			console.log(`Processing file: ${file}`);
			const fileStream = createReadStream(filePath);
			const rl = createInterface({
				input: fileStream,
				crlfDelay: Infinity
			});

			for await (const line of rl) {
				if (!line.trim()) continue;
				try {
					const post = JSON.parse(line);
					const parsedUrl = parsePostUrl(post.postUrl);
					if (!parsedUrl) {
						conflicts.push({
							type: 'invalid_post_url',
							postUrl: post.postUrl,
							title: post.title
						});
						continue;
					}

					const discussionId = Number(parsedUrl.id);
					const discussionSlug = parsedUrl.slug;
					const categorySlug = extractCategorySlug(post.pageUrl);
					const authorId = normalizeVanillaUserId(post.userId);

					// Ensure dependencies exist
					await ensureUser(authorId, post.username);
					await ensureCategory(categorySlug);

					if (existingDiscussionIds.has(discussionId)) {
						const existing = existingDiscussionsMap.get(discussionId);
						if (existing) {
							if (existing.title !== post.title || existing.authorId !== authorId) {
								conflicts.push({
									type: 'discussion_conflict',
									id: discussionId,
									reason: 'Discussion ID exists with different title/author in posts data',
									existing: { title: existing.title, authorId: existing.authorId },
									incoming: { title: post.title, authorId }
								});
							}
						}
						continue;
					}

					try {
						const createdAt = post.postedAt ? new Date(post.postedAt) : new Date();
						await db.insert(schema.discussions).values({
							id: discussionId,
							title: post.title,
							slug: discussionSlug,
							categorySlug: categorySlug,
							authorId,
							viewCount: post.viewCount || 0,
							commentCount: post.commentCount || 0,
							createdAt: createdAt,
							updatedAt: createdAt
						});
						existingDiscussionIds.add(discussionId);
						existingDiscussionsMap.set(discussionId, {
							title: post.title,
							authorId,
							createdAt: createdAt
						});
						discussionTitleToIdMap.set(post.title, discussionId);
					} catch (e: unknown) {
						conflicts.push({
							type: 'discussion_insert_error',
							id: discussionId,
							title: post.title,
							error: getErrorMessage(e)
						});
					}
				} catch (e: unknown) {
					conflicts.push({
						type: 'post_line_parse_error',
						file,
						error: getErrorMessage(e)
					});
				}
			}
		}
	} else {
		console.log('Warning: data/posts directory not found.');
	}

	// 4. Import data/profiles
	const profilesDir = join(dataDir, 'profiles');
	if (existsSync(profilesDir)) {
		console.log('Scanning data/profiles...');
		const subdirs = readdirSync(profilesDir);

		for (const subdir of subdirs) {
			// Ensure it is a valid numeric userId directory
			if (!/^\d+$/.test(subdir)) continue;
			const userId = normalizeVanillaUserId(subdir);

			const userDir = join(profilesDir, subdir);
			const profileHtmlPath = join(userDir, 'profile.html');

			console.log(`Processing profile for User ID: ${userId}`);

			// A. Parse profile.html to populate/update user data
			if (existsSync(profileHtmlPath)) {
				try {
					const html = readFileSync(profileHtmlPath, 'utf-8');
					const profile = parseProfileHtml(html);

					if (existingUserIds.has(userId)) {
						// Update existing user with richer data from HTML
						const [dbUser] = await db
							.select()
							.from(schema.users)
							.where(eq(schema.users.id, userId))
							.limit(1);

						let emailToSet = profile.email || dbUser.email;
						if (profile.email && profile.email !== dbUser.email) {
							// Verify email uniqueness
							const [otherUser] = await db
								.select()
								.from(schema.users)
								.where(eq(schema.users.email, profile.email))
								.limit(1);
							if (otherUser && otherUser.id !== userId) {
								conflicts.push({
									type: 'user_email_unique_conflict',
									userId,
									email: profile.email,
									reason: `Obtained email "${profile.email}" belongs to user ${otherUser.id}. Setting placeholder.`
								});
								emailToSet = dbUser.email; // Keep existing email
							}
						}

						await db
							.update(schema.users)
							.set({
								username: profile.username || dbUser.username,
								displayName: profile.displayName || profile.username || dbUser.displayName,
								email: emailToSet,
								signupTime: profile.signupTime || dbUser.signupTime,
								lastActiveTime: profile.lastActiveTime || dbUser.lastActiveTime,
								viewCount: profile.viewCount || dbUser.viewCount
							})
							.where(eq(schema.users.id, userId));
					} else {
						// Create new user
						let emailToSet = profile.email || `${userId}@placeholder.janbao.net`;
						if (profile.email) {
							const [otherUser] = await db
								.select()
								.from(schema.users)
								.where(eq(schema.users.email, profile.email))
								.limit(1);
							if (otherUser) {
								conflicts.push({
									type: 'user_email_unique_conflict',
									userId,
									email: profile.email,
									reason: `Obtained email "${profile.email}" belongs to user ${otherUser.id}. Setting placeholder.`
								});
								emailToSet = `${userId}@placeholder.janbao.net`;
							}
						}

						await db.insert(schema.users).values({
							id: userId,
							username: profile.username || `user_${userId}`,
							displayName: profile.displayName || profile.username || `User ${userId}`,
							email: emailToSet,
							passwordHash: 'NO_PASSWORD',
							groupSlug: 'member',
							signupTime: profile.signupTime || new Date(),
							lastActiveTime: profile.lastActiveTime || new Date(),
							viewCount: profile.viewCount || 0
						});
						existingUserIds.add(userId);
					}

					// Import dynamic activity data from user's profile.html
					const activities = parseActivitiesHtml(html);
					for (const act of activities) {
						const actId = Number(act.id);
						if (existingActivityIds.has(actId)) continue;
						try {
							const contentJson = await convertHtmlToLexical(act.contentHtml, converterCtx);
							await db.insert(schema.activities).values({
								id: actId,
								authorId: userId,
								contentJson,
								createdAt: act.createdAt
							});
							existingActivityIds.add(actId);
						} catch (e: unknown) {
							conflicts.push({
								type: 'activity_insert_error',
								id: act.id,
								userId,
								error: getErrorMessage(e)
							});
						}
					}
				} catch (e: unknown) {
					conflicts.push({
						type: 'profile_html_parse_error',
						userId,
						error: getErrorMessage(e)
					});
				}
			}

			const files = readdirSync(userDir);

			// B. Parse discussions-page-*.json for additional discussions
			const discFiles = files.filter(
				(f) => f.startsWith('discussions-page-') && f.endsWith('.json')
			);
			for (const file of discFiles) {
				const filePath = join(userDir, file);
				try {
					const jsonContent = JSON.parse(readFileSync(filePath, 'utf-8'));
					if (!jsonContent.Data) continue;

					const decodedHtml = Buffer.from(jsonContent.Data, 'base64').toString('utf-8');
					const parsedDiscussions = parseDiscussionsHtml(decodedHtml);

					for (const d of parsedDiscussions) {
						const discId = Number(d.id);
						await ensureCategory(d.categorySlug);

						if (existingDiscussionIds.has(discId)) {
							const existing = existingDiscussionsMap.get(discId);
							if (existing && existing.title !== d.title) {
								conflicts.push({
									type: 'discussion_conflict',
									id: d.id,
									reason: 'Discussion ID exists with different title/author in profile discussions',
									existing: { title: existing.title, authorId: existing.authorId },
									incoming: { title: d.title, authorId: userId }
								});
							}
							continue;
						}

						try {
							await db.insert(schema.discussions).values({
								id: discId,
								title: d.title,
								slug: `discussion-${d.id}`,
								categorySlug: d.categorySlug,
								authorId: userId,
								viewCount: d.viewCount,
								commentCount: d.commentCount,
								createdAt: d.lastActiveTime,
								updatedAt: d.lastActiveTime
							});
							existingDiscussionIds.add(discId);
							existingDiscussionsMap.set(discId, {
								title: d.title,
								authorId: userId,
								createdAt: d.lastActiveTime
							});
							discussionTitleToIdMap.set(d.title, discId);
						} catch (e: unknown) {
							conflicts.push({
								type: 'discussion_insert_error',
								id: d.id,
								title: d.title,
								error: getErrorMessage(e)
							});
						}
					}
				} catch (e: unknown) {
					conflicts.push({
						type: 'discussion_file_parse_error',
						filePath,
						error: getErrorMessage(e)
					});
				}
			}

			// C. Parse comments-page-*.json to import replies
			const commentFiles = files.filter(
				(f) => f.startsWith('comments-page-') && f.endsWith('.json')
			);
			for (const file of commentFiles) {
				const filePath = join(userDir, file);
				try {
					const jsonContent = JSON.parse(readFileSync(filePath, 'utf-8'));
					if (!jsonContent.Data) continue;

					const decodedHtml = Buffer.from(jsonContent.Data, 'base64').toString('utf-8');
					const comments = parseCommentsHtml(decodedHtml);

					for (const comment of comments) {
						// Resolve parent discussion by title
						const discussionId = discussionTitleToIdMap.get(comment.discussionTitle);

						if (!discussionId) {
							conflicts.push({
								type: 'reply_discussion_missing',
								commentId: comment.id,
								discussionTitle: comment.discussionTitle,
								userId: userId,
								reason: `Parent discussion "${comment.discussionTitle}" not found in database. Skipping reply.`
							});
							continue;
						}

						const commentId = Number(comment.id);
						if (existingReplyIds.has(commentId)) {
							continue;
						}

						try {
							const createdAt = parseCommentTime(comment.timeText);
							const contentJson = await convertHtmlToLexical(comment.contentHtml, converterCtx);
							await db.insert(schema.replies).values({
								id: commentId,
								discussionId: discussionId,
								authorId: userId,
								contentJson,
								createdAt: createdAt,
								updatedAt: createdAt
							});
							existingReplyIds.add(commentId);
						} catch (e: unknown) {
							conflicts.push({
								type: 'reply_insert_error',
								commentId: comment.id,
								error: getErrorMessage(e)
							});
						}
					}
				} catch (e: unknown) {
					conflicts.push({
						type: 'comment_file_parse_error',
						filePath,
						error: getErrorMessage(e)
					});
				}
			}
		}
	} else {
		console.log('Warning: data/profiles directory not found.');
	}

	// 4.5 Import discussion OP bodies (first post) as the earliest reply.
	// The discussions table has no content column — the OP is the chronologically
	// earliest reply (see the discussion loader's orderBy(createdAt).limit(1)).
	const discussionsDir = join(dataDir, 'discussions');
	if (existsSync(discussionsDir)) {
		console.log('Importing discussion bodies (OP)...');
		for (const [discussionId, meta] of existingDiscussionsMap) {
			// Negative id keeps OP replies deterministic, idempotent, and clear of
			// the positive Vanilla comment ids.
			const opReplyId = -discussionId;
			if (existingReplyIds.has(opReplyId)) continue;

			const htmlPath = join(discussionsDir, String(discussionId), 'page-000001.html');
			if (!existsSync(htmlPath)) {
				conflicts.push({ type: 'op_body_missing', discussionId });
				continue;
			}

			let body: string | null;
			try {
				const opHtml = readFileSync(htmlPath, 'utf-8');
				body = extractOpBody(opHtml, discussionId);
			} catch (e: unknown) {
				conflicts.push({
					type: 'op_body_read_error',
					discussionId,
					error: getErrorMessage(e)
				});
				continue;
			}

			if (!body || !body.trim()) {
				conflicts.push({ type: 'op_body_empty', discussionId });
				continue;
			}

			const authorId = meta.authorId;
			try {
				const contentJson = await convertHtmlToLexical(body, converterCtx);
				await db.insert(schema.replies).values({
					id: opReplyId,
					discussionId,
					authorId,
					contentJson,
					createdAt: meta.createdAt,
					updatedAt: meta.createdAt
				});
				existingReplyIds.add(opReplyId);
			} catch (e: unknown) {
				conflicts.push({
					type: 'op_body_insert_error',
					discussionId,
					error: getErrorMessage(e)
				});
			}
		}
	} else {
		console.log('Warning: data/discussions directory not found; skipping OP bodies.');
	}

	// 4.6 Bulk-upload referenced attachments in parallel (32-way). The converter
	// only recorded which image URLs are used; this converts + uploads them and
	// records the metadata row so /attachment can stream with the right type.
	const referencedList = [...referencedImageUrls]
		.map((src) => imageMaps.byUrl.get(src))
		.filter((e): e is ImageEntry => !!e);
	console.log(`Uploading ${referencedList.length} attachments (32-way parallel)...`);
	let attachmentDone = 0;
	await mapPool(referencedList, 32, async (entry) => {
		if (!attachmentsOnCloud.has(entry.sha256)) {
			try {
				const rel = entry.file.startsWith('data/') ? entry.file.slice(5) : entry.file;
				const webp = convertToWebp(join(dataDir, rel));
				await pcloudUploadBytes(pcloudCfg, '/attachments', entry.sha256, webp);
				attachmentsOnCloud.add(entry.sha256);
			} catch (e: unknown) {
				conflicts.push({
					type: 'attachment_materialize_error',
					sha256: entry.sha256,
					error: getErrorMessage(e)
				});
				return;
			}
		}
		try {
			await db
				.insert(schema.attachments)
				.values({ fileId: entry.sha256, contentType: 'image/webp', uploaderId: GHOST_USER_ID })
				.onConflictDoNothing();
		} catch (e: unknown) {
			conflicts.push({
				type: 'attachment_meta_error',
				sha256: entry.sha256,
				error: getErrorMessage(e)
			});
		}
		attachmentDone++;
		if (attachmentDone % 200 === 0)
			console.log(`  attachments: ${attachmentDone}/${referencedList.length}`);
	});

	// 4.7 Upload avatars in parallel (32-way). Filename = userId; sets the
	// avatarFileId flag + avatarContentType. Already-on-cloud avatars still get
	// their DB flag set (covers re-runs after a schema change).
	const profileAvatarsPath = join(dataDir, 'profile-avatars.json');
	if (existsSync(profileAvatarsPath)) {
		console.log('Uploading avatars (32-way parallel)...');
		const avatarsRaw = JSON.parse(readFileSync(profileAvatarsPath, 'utf-8')) as ProfileAvatarsJson;
		const avatarEntries: AvatarEntry[] = [];
		for (const [userId, rec] of Object.entries(avatarsRaw.byUserId ?? {})) {
			if (typeof rec.file === 'string') {
				avatarEntries.push({
					userId,
					file: rec.file,
					contentType: typeof rec.contentType === 'string' ? rec.contentType : null
				});
			}
		}
		let avatarDone = 0;
		await mapPool(avatarEntries, 32, async (rec) => {
			if (!avatarsOnCloud.has(rec.userId)) {
				try {
					const rel = rec.file.startsWith('data/') ? rec.file.slice(5) : rec.file;
					const webp = convertToWebp(join(dataDir, rel));
					await pcloudUploadBytes(pcloudCfg, '/avatars', rec.userId, webp);
					avatarsOnCloud.add(rec.userId);
				} catch (e: unknown) {
					conflicts.push({
						type: 'avatar_upload_error',
						userId: rec.userId,
						error: getErrorMessage(e)
					});
					avatarDone++;
					return;
				}
			}
			const avatarUserId = Number(rec.userId);
			if (Number.isFinite(avatarUserId) && existingUserIds.has(avatarUserId)) {
				try {
					await db
						.update(schema.users)
						.set({ avatarFileId: '1', avatarContentType: 'image/webp' })
						.where(eq(schema.users.id, avatarUserId));
				} catch (e: unknown) {
					conflicts.push({
						type: 'avatar_meta_error',
						userId: rec.userId,
						error: getErrorMessage(e)
					});
				}
			}
			avatarDone++;
			if (avatarDone % 200 === 0) console.log(`  avatars: ${avatarDone}/${avatarEntries.length}`);
		});
	} else {
		console.log('Warning: profile-avatars.json not found; skipping avatars.');
	}

	// 5. Generate log and output report
	console.log('\n====== IMPORT COMPLETED ======');
	console.log(`Discussions in database: ${existingDiscussionIds.size}`);
	console.log(`Replies in database: ${existingReplyIds.size}`);
	console.log(`Activities in database: ${existingActivityIds.size}`);
	console.log(`Users in database: ${existingUserIds.size}`);
	console.log(`Total conflicts recorded: ${conflicts.length}`);

	const conflictSummary: Record<string, number> = {};
	for (const c of conflicts) {
		conflictSummary[c.type] = (conflictSummary[c.type] || 0) + 1;
	}
	console.log('Conflict Summary:');
	for (const [type, count] of Object.entries(conflictSummary)) {
		console.log(` - ${type}: ${count}`);
	}

	writeFileSync('import-conflicts.json', JSON.stringify(conflicts, null, 2), 'utf-8');
	console.log('Detailed conflict log saved to import-conflicts.json');

	process.exit(0);
}

main().catch((err) => {
	console.error('Error in main execution:', err);
	process.exit(1);
});
