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
import { eq, sql } from 'drizzle-orm';
import { GHOST_USER_ID, SYSTEM_USER_ID } from '../src/lib/server/constants';
import { resolvePcloudConfig, pcloudUploadBytes, pcloudListFolder } from '../src/lib/server/pcloud';
import { detectImageFormat } from '../src/lib/server/image';
import { ensureAndBackfillAll } from '../src/lib/server/search/backfill';
import { appendJoinedMember } from '../src/lib/server/db/joined-activity';

// Named interfaces to avoid inline object type literal lint errors
interface ParsedProfile {
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

interface DiscussionMeta {
	title: string;
	authorId: number;
	createdAt: Date;
}

// Fields §4.5 corrects on a discussion row from its crawled page-1 HTML.
interface DiscussionCorrection {
	createdAt: Date;
	slug?: string;
	title?: string;
}

interface ConflictRecord {
	type: string;
	[key: string]: unknown;
}

interface ParsedActivity {
	id: string;
	contentHtml: string;
	createdAt: Date;
	// Bumped time used for feed ordering: for a top-level activity this is the
	// later of its own post time and its latest sub-comment (Vanilla surfaces an
	// activity by last-updated); for a sub-comment it equals createdAt.
	updatedAt: Date;
	// null for top-level activities (attributed to the profile owner); set for the
	// nested ActivityComment rows that reply to a top-level activity.
	parentActivityId: number | null;
	authorId: number | null;
	authorUsername: string | null;
	// For a top-level WallPost activity (Title "author → recipient"), the user the
	// message was directed at. null for status updates and sub-comments.
	recipientId: number | null;
	// A system "who joined" activity. Members listed in joinMemberIds are folded
	// into that calendar day's isJoined activity at write time (see
	// appendJoinedMember); contentHtml carries only the excerpt (e.g. "欢迎加入!").
	isJoined: boolean;
	joinMemberIds: number[];
}

interface AvatarEntry {
	userId: string;
	file: string;
	contentType: string | null;
}

// HTML Entity decoder
function decodeHtmlEntities(str: string): string {
	return (
		str
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&nbsp;/g, ' ')
			// Numeric entities — Vanilla emits apostrophes as &#039; (with a leading
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
	mentionMap: Map<string, number>;
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

	// Leading/trailing whitespace from the crawled Message wrapper would otherwise
	// become a whitespace-only first/last paragraph.
	const source = html.trim();

	function pushParagraph(forceEmpty = false): void {
		if (inline.length > 0) {
			// Skip paragraphs that are only whitespace (stray newlines/spaces
			// between block elements), but keep paragraphs that contain real
			// inline content (text, mentions, links, etc.).
			const onlyWs = inline.every((n) => n.type === 'text' && n.text.trim() === '');
			if (!onlyWs) {
				blocks.push(buildParagraphNode(inline));
			}
			inline = [];
		} else if (forceEmpty) {
			blocks.push(buildParagraphNode([]));
		}
	}

	async function flushText(): Promise<void> {
		if (!textBuf) return;

		const lines = textBuf.replace(/\r\n/g, '\n').split('\n');
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			let idx = 0;
			let lastPushedIdx = 0;
			while (idx < line.length) {
				const atIdx = line.indexOf('@', idx);
				if (atIdx === -1) {
					break;
				}

				// Validate character before @ (must be whitespace or start of string)
				const charBefore = atIdx > 0 ? line.charAt(atIdx - 1) : '';
				const isValidBefore = atIdx === 0 || /\s/.test(charBefore);

				let matchedUsername = '';
				const remainingText = line.slice(atIdx + 1);
				const maxCheckLen = Math.min(30, remainingText.length);

				if (isValidBefore) {
					for (let len = maxCheckLen; len >= 1; len--) {
						const candidate = remainingText.slice(0, len);
						if (ctx.mentionMap.has(candidate)) {
							let isValidMatch = true;
							if (/^[a-zA-Z0-9_-]+$/.test(candidate)) {
								const nextChar = remainingText.charAt(len);
								if (nextChar && /[a-zA-Z0-9_-]/.test(nextChar)) {
									isValidMatch = false;
								}
							}
							// Check if candidate is followed by a dot that is part of a domain/email (e.g. .com)
							const rest = remainingText.slice(len);
							if (/^\.[a-zA-Z0-9]/.test(rest)) {
								isValidMatch = false;
							}

							if (isValidMatch) {
								matchedUsername = candidate;
								break;
							}
						}
					}
				}

				if (matchedUsername) {
					if (atIdx > lastPushedIdx) {
						inline.push(buildTextNode(line.slice(lastPushedIdx, atIdx)));
					}
					const res = await ctx.resolveMention(matchedUsername);
					if (res.resolved) {
						inline.push(buildMentionNode(matchedUsername, matchedUsername));
					} else {
						inline.push(buildTextNode('@' + matchedUsername));
					}
					idx = atIdx + 1 + matchedUsername.length;
					lastPushedIdx = idx;
				} else {
					idx = atIdx + 1;
				}
			}

			if (lastPushedIdx < line.length) {
				inline.push(buildTextNode(line.slice(lastPushedIdx)));
			}

			if (i < lines.length - 1) {
				pushParagraph(true);
			}
		}

		textBuf = '';
	}

	async function flushParagraph(forceEmpty = false): Promise<void> {
		await flushText();
		pushParagraph(forceEmpty);
	}

	const tagRe = /<(\w+)((?:[^>"]|"[^"]*")*)>|<\/(\w+)>/g;
	let lastIndex = 0;
	let m: RegExpExecArray | null;

	while ((m = tagRe.exec(source)) !== null) {
		if (m.index > lastIndex) {
			textBuf += decodeHtmlEntities(source.slice(lastIndex, m.index));
		}

		const openName = m[1];
		const attrs = m[2] ?? '';
		const closeName = m[3];

		if (openName) {
			const tag = openName.toLowerCase();

			if (tag === 'br') {
				// <br> is a paragraph separator, not a paragraph of its own: flush
				// whatever inline text has accumulated, but never emit an empty
				// paragraph (so consecutive <br>s or a trailing <br> don't create
				// blank paragraph nodes).
				await flushParagraph(false);
			} else if (tag === 'img') {
				const cls = getAttr(attrs, 'class') ?? '';
				const src = getAttr(attrs, 'src') ?? '';
				const alt = getAttr(attrs, 'alt') ?? '';
				if (/\bemoji\b/.test(cls)) {
					// Emoji were never crawled  - drop silently.
				} else {
					const res = await ctx.resolveImage(src);
					if (res.kind === 'live') {
						await flushParagraph(false);
						blocks.push(buildImageNode('/attachment/' + res.fileId, alt));
					} else if (res.kind === 'dead') {
						await flushParagraph(false);
						blocks.push(buildDeadImageNode());
					}
					// kind === 'drop' → skip
				}
			} else if (tag === 'a') {
				const href = getAttr(attrs, 'href') ?? '';
				const closeIdx = source.indexOf('</a>', tagRe.lastIndex);
				const innerEnd = closeIdx === -1 ? source.length : closeIdx;
				const innerRaw = source.slice(tagRe.lastIndex, innerEnd);
				const innerText = decodeHtmlEntities(innerRaw.replace(/<[^>]+>/g, '')).trim();
				const afterClose = closeIdx === -1 ? source.length : closeIdx + 4;

				const mentionMatch = href.match(/^\/profile\/(.+)$/);
				if (mentionMatch) {
					const username = decodeURIComponent(mentionMatch[1]).trim();
					const display = innerText.replace(/^@/, '').trim() || username;
					if (textBuf.endsWith('@')) textBuf = textBuf.slice(0, -1);
					await flushText();
					const res = await ctx.resolveMention(username);
					if (res.resolved) {
						inline.push(buildMentionNode(username, display));
					} else {
						inline.push(buildTextNode('@' + display));
					}
				} else {
					await flushText();
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
				await flushParagraph(false);
			}
		} else if (closeName && BLOCK_TAGS.has(closeName.toLowerCase())) {
			await flushParagraph(false);
		}

		lastIndex = tagRe.lastIndex;
	}

	if (lastIndex < source.length) {
		textBuf += decodeHtmlEntities(source.slice(lastIndex));
	}
	await flushParagraph(false);

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

// One comment parsed from a discussion page. The OP is the comment whose
// Vanilla item position is lowest (name="Item_1" on the new template, or the
// single post inside the Discussion_NNN wrapper on the old template).
interface ParsedDiscussionComment {
	id: string;
	authorId: number | null;
	authorUsername: string | null;
	contentHtml: string;
	createdAt: Date;
	itemPosition: number;
	// From the comment's <span class="DateUpdated" title="Edited <cn-dt> by <name>.">;
	// null when the comment was never edited.
	editedAt: Date | null;
	editedByName: string | null;
}

// Parsed edit marker: when + who last edited a comment. Both null means the
// comment was never edited on the source site.
interface ParsedEditMarker {
	editedAt: Date | null;
	editedByName: string | null;
}

// Extract the edit timestamp + editor username from a comment's
// <span class="DateUpdated" title="Edited 2014年09月07日 星期日 09时57分19秒 by 海鮮販子.">.
// The title carries both the precise edit time (Chinese-locale datetime, parsed
// in local time like parseCommentTime) and the editor's username. Returns nulls
// when the comment was never edited.
function parseEditMarker(html: string): ParsedEditMarker {
	const m = html.match(
		/title="Edited\s+(\d{4})年(\d{2})月(\d{2})日\s+\S+\s+(\d{2})时(\d{2})分(\d{2})秒\s+by\s+(.+?)\."/
	);
	if (!m) return { editedAt: null, editedByName: null };
	const [, y, mo, d, h, mi, s, name] = m;
	return {
		editedAt: new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)),
		editedByName: name.trim()
	};
}

// Resolve an editor username (from a source edit marker) to a user id via the
// mention map built from users.json. Returns null when the name isn't known
// (rare — usually a since-purged account); the caller then leaves editedBy null.
function lookupEditorId(name: string | null, mentionMap: Map<string, number>): number | null {
	if (!name) return null;
	const uid = mentionMap.get(name);
	return uid === undefined ? null : uid;
}

/**
 * Parse every comment <li> out of a discussion page, each with its author
 * (profile link), precise <time datetime>, Message body, and Vanilla item
 * position. This is the authoritative source for replies: unlike the per-user
 * comment feeds it binds each comment to this discussion by location (no
 * title-based matching) and carries the full ISO datetime (not date-only).
 *
 * The OP is identified as the comment with the lowest item position. On the old
 * template the OP lives in a <div id="Discussion_NNN"> wrapper (not a Comment_
 * <li>); on the new template the wrapper is gone and the OP is the first
 * ItemComment. We detect the wrapper and synthesize an OP entry at position 0
 * so it always sorts first, working uniformly across both templates.
 */
function parseDiscussionComments(html: string, discussionId: number): ParsedDiscussionComment[] {
	const out: ParsedDiscussionComment[] = [];

	// Old template: the OP is the first <div class="Message"> inside the
	// Discussion_NNN wrapper, before the comment list begins.
	const wrapMarker = `id="Discussion_${discussionId}"`;
	const wrapIdx = html.indexOf(wrapMarker);
	if (wrapIdx !== -1) {
		const rest = html.slice(wrapIdx);
		const endMarkers = [
			'class="Item ItemComment"',
			'class="CommentsWrap"',
			'<div class="Comments"'
		];
		let endIdx = rest.length;
		for (const marker of endMarkers) {
			const i = rest.indexOf(marker);
			if (i !== -1 && i < endIdx) endIdx = i;
		}
		const opSlice = rest.slice(0, endIdx);
		const opMsg = opSlice.match(/<div\s+class="Message">([\s\S]+?)<\/div>/);
		const opAuthor = extractProfileUser(opSlice);
		const opTimeMatch = opSlice.match(/<time[^>]*datetime="([^"]+)"/);
		let opCreatedAt = new Date();
		if (opTimeMatch) {
			const d = new Date(opTimeMatch[1]);
			if (!isNaN(d.getTime())) opCreatedAt = d;
		}
		if (opMsg) {
			const opEdit = parseEditMarker(opSlice);
			out.push({
				// 'op' is a synthetic id; the caller writes it under -discussionId.
				id: 'op',
				authorId: opAuthor.userId,
				authorUsername: opAuthor.username,
				contentHtml: opMsg[1],
				createdAt: opCreatedAt,
				itemPosition: 0,
				editedAt: opEdit.editedAt,
				editedByName: opEdit.editedByName
			});
		}
	}

	// <li>s render class before id (<li class="..." id="Comment_N">), so split on
	// the id attribute itself.
	const parts = html.split(/id="Comment_/);
	for (let i = 1; i < parts.length; i++) {
		const part = parts[i];
		const idMatch = part.match(/^(\d+)/);
		if (!idMatch) continue;

		const author = extractProfileUser(part);

		const timeMatch = part.match(/<time[^>]*datetime="([^"]+)"/);
		let createdAt = new Date();
		if (timeMatch) {
			const d = new Date(timeMatch[1]);
			if (!isNaN(d.getTime())) createdAt = d;
		}

		const msgMatch = part.match(
			/<div\s+class="Message">([\s\S]+?)<\/div>\s*<div\s+class="Reactions"/
		);
		const contentHtml = msgMatch ? msgMatch[1] : '';

		const itemMatch = part.match(/name="Item_(\d+)"/);
		const itemPosition = itemMatch ? parseInt(itemMatch[1], 10) : Number.MAX_SAFE_INTEGER;

		const edit = parseEditMarker(part);
		out.push({
			id: idMatch[1],
			authorId: author.userId,
			authorUsername: author.username,
			contentHtml,
			createdAt,
			itemPosition,
			editedAt: edit.editedAt,
			editedByName: edit.editedByName
		});
	}
	return out;
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

	// Inviter: <dt class="Invited">邀请</dt><dd class="Invited"><a href="/profile/ID/slug">…</a></dd>
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
		let categorySlug = catMatch ? catMatch[1] : 'general';
		if (categorySlug === 'bt') {
			categorySlug = 'general';
		}

		const catTitleMatch = part.match(/Category-[^"\s>]+"[^>]*><a[^>]*>([\s\S]+?)<\/a>/);
		let categoryTitle = catTitleMatch
			? decodeHtmlEntities(catTitleMatch[1].replace(/<[^>]+>/g, '')).trim()
			: 'General';
		if (categorySlug === 'general') {
			categoryTitle = 'General';
		}

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

interface ProfileUserRef {
	userId: number | null;
	username: string | null;
}

/** URL-decode a profile slug, falling back to the raw value on malformed input. */
function decodeProfileSlug(slug: string): string {
	try {
		return decodeURIComponent(slug).trim();
	} catch {
		return slug;
	}
}

/** Extract {userId, username} from the first /profile/<id>/<slug> href in an HTML slice. */
function extractProfileUser(html: string): ProfileUserRef {
	const m = html.match(/\/profile\/(\d+)\/([^"'/?#]+)/);
	if (!m) return { userId: null, username: null };
	return { userId: Number(m[1]), username: decodeProfileSlug(m[2]) || null };
}

// Parse discussions-activities in user's profile.html. Captures both top-level
// activities and the nested ActivityComment rows that reply to them (Vanilla
// stores both in the same list, comments nested under their parent <li>).
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
		const parentId = idMatch[1];

		// Top-level activity: its Title + Excerpt + MItem DateCreated appear before
		// the nested ActivityComments block, so the non-greedy matches pick the right
		// ones. The Title distinguishes a status update (one <a class="Name"> = the
		// author) from a directed WallPost (two names around a &rarr; arrow: author
		// then recipient). The Author Photo also carries the author.
		const titleMatch = part.match(/<div\s+class="Title">([\s\S]+?)<\/div>/);
		const titleHtml = titleMatch ? titleMatch[1] : '';
		const nameHrefs = [...titleHtml.matchAll(/href="\/profile\/(\d+)\/([^"'/?#]*)"/g)];
		const isWallPost = /&rarr;|→/.test(titleHtml);
		const isRegistration = /Activity-Registration\b/.test(part) || /joined/i.test(titleHtml);

		const excerptMatch = part.match(/<div\s+class="Excerpt">([\s\S]+?)<\/div>/);
		const excerptHtml = excerptMatch ? excerptMatch[1] : '';

		// Registration ("X and Y joined") is a system "who joined" activity. Its
		// named users become members of that calendar day's isJoined activity
		// (folded in at write time via appendJoinedMember); the excerpt (e.g.
		// "欢迎加入!") is kept as content for the joined render pipeline.
		let topLevelAuthor: ProfileUserRef;
		let recipientRef: ProfileUserRef | null;
		let contentHtml: string;
		let isJoined = false;
		let joinMemberIds: number[] = [];
		if (isRegistration) {
			isJoined = true;
			topLevelAuthor = { userId: SYSTEM_USER_ID, username: null };
			recipientRef = null;
			contentHtml = excerptHtml;
			joinMemberIds = nameHrefs
				.map((m) => extractProfileUser('href="' + m[0]).userId)
				.filter((u): u is number => u !== null);
		} else {
			const authorRef = nameHrefs[0] ? extractProfileUser('href="' + nameHrefs[0][0]) : null;
			recipientRef =
				isWallPost && nameHrefs[1] ? extractProfileUser('href="' + nameHrefs[1][0]) : null;
			// Prefer the Title's explicit author; fall back to the Author Photo link.
			topLevelAuthor =
				authorRef ?? extractProfileUser(part.slice(0, part.indexOf('class="Excerpt"')));
			contentHtml = excerptHtml;
		}

		const dateMatch = part.match(/<span\s+class="MItem\s+DateCreated">([\s\S]+?)<\/span>/);
		let createdAt = new Date();
		if (dateMatch) {
			const dateText = dateMatch[1].replace(/<[^>]+>/g, '').trim();
			createdAt = parseCommentTime(dateText);
		}

		// Nested activity comments. Split on ActivityComment_ (distinct from the
		// Activity_ split key) so each sub-comment stays within its parent's part
		// and inherits this activity's id as its parentActivityId. Parse them first
		// so the parent's updatedAt can be bumped to the latest comment time.
		let latestCommentMs = 0;
		const commentParts = part.split(/<li\s+id="ActivityComment_/);
		for (let j = 1; j < commentParts.length; j++) {
			const cpart = commentParts[j];
			const cidMatch = cpart.match(/^(\d+)/);
			if (!cidMatch) continue;

			const cExcerptMatch = cpart.match(/<div\s+class="Excerpt">([\s\S]+?)<\/div>/);
			const cContentHtml = cExcerptMatch ? cExcerptMatch[1] : '';
			const author = extractProfileUser(cpart);

			// Sub-comments carry a precise <time datetime> (unlike top-level
			// activities, whose DateCreated is date-only text); fall back to the
			// visible date if the datetime attribute is absent.
			const cTimeMatch = cpart.match(/<time[^>]*datetime="([^"]+)"/);
			let cCreatedAt = new Date();
			if (cTimeMatch) {
				const d = new Date(cTimeMatch[1]);
				if (!isNaN(d.getTime())) cCreatedAt = d;
			} else {
				const cDateSpan = cpart.match(/<span\s+class="DateCreated">([\s\S]+?)<\/span>/);
				if (cDateSpan) {
					cCreatedAt = parseCommentTime(cDateSpan[1].replace(/<[^>]+>/g, '').trim());
				}
			}
			if (cCreatedAt.getTime() > latestCommentMs) latestCommentMs = cCreatedAt.getTime();

			activities.push({
				id: cidMatch[1],
				contentHtml: cContentHtml,
				createdAt: cCreatedAt,
				updatedAt: cCreatedAt,
				parentActivityId: Number(parentId),
				authorId: author.userId,
				authorUsername: author.username,
				recipientId: null,
				isJoined: false,
				joinMemberIds: []
			});
		}

		// Vanilla surfaces an activity by last-updated, so bump the parent's
		// updatedAt to its latest sub-comment time when there is one.
		const updatedAt = latestCommentMs > createdAt.getTime() ? new Date(latestCommentMs) : createdAt;
		activities.push({
			id: parentId,
			contentHtml,
			createdAt,
			updatedAt,
			parentActivityId: null,
			authorId: topLevelAuthor.userId,
			authorUsername: topLevelAuthor.username,
			recipientId: recipientRef?.userId ?? null,
			isJoined,
			joinMemberIds
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
	const slug = match ? match[1] : 'general';
	return slug === 'bt' ? 'general' : slug;
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
	const { seedBaseline } = await import('../src/lib/server/db/seed-baseline');
	await seedBaseline(db);

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

	const existingDiscussionsMap = new Map<number, DiscussionMeta>();

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
	 * live file id (pre-conversion sha256) without uploading  - uploads happen in
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
		},
		mentionMap
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
								bio: profile.bio ?? dbUser.bio,
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
							bio: profile.bio,
							email: emailToSet,
							passwordHash: 'NO_PASSWORD',
							groupSlug: 'member',
							signupTime: profile.signupTime || new Date(),
							lastActiveTime: profile.lastActiveTime || new Date(),
							viewCount: profile.viewCount || 0
						});
						existingUserIds.add(userId);
					}

					// Synthesize the inviter relationship. Vanilla exposes it as
					// <dd class="Invited"><a href="/profile/inviterId/…">…</a></dd>. The app
					// resolves "invited by" via getInviter, which joins invitations on
					// usedById → creatorId, so record one synthetic invitation per user.
					if (profile.inviterId !== null && profile.inviterId !== userId) {
						await ensureUser(profile.inviterId, '');
						const invitedAt = profile.signupTime ?? new Date();
						try {
							await db
								.insert(schema.invitations)
								.values({
									code: `legacy-${userId}-${profile.inviterId}`,
									creatorId: profile.inviterId,
									usedById: userId,
									createdAt: invitedAt,
									expiresAt: invitedAt
								})
								.onConflictDoNothing({ target: schema.invitations.code });
						} catch (e: unknown) {
							conflicts.push({
								type: 'invitation_insert_error',
								userId,
								inviterId: profile.inviterId,
								error: getErrorMessage(e)
							});
						}
					}

					// Import dynamic activity data from user's profile.html. Top-level
					// activities are inserted first so each parent exists before its
					// sub-comments reference it.
					const activities = parseActivitiesHtml(html);
					const insertActivity = async (act: ParsedActivity) => {
						const actId = Number(act.id);
						// For a status update with no resolvable author, attribute to the
						// profile owner (the wall it appeared on).
						const authorId = act.authorId ?? userId;
						try {
							if (act.authorId !== null) {
								await ensureUser(act.authorId, act.authorUsername ?? '');
							}
							if (act.recipientId !== null) {
								await ensureUser(act.recipientId, '');
							}
							// isJoined activities are folded into that calendar day's
							// join activity (one row per day), with each named user
							// appended as a member. They are not inserted as standalone
							// rows keyed by their Vanilla id.
							if (act.isJoined) {
								for (const memberId of act.joinMemberIds) {
									await ensureUser(memberId, '');
									await appendJoinedMember(db, memberId, act.createdAt, undefined);
								}
								return;
							}
							const contentJson = await convertHtmlToLexical(act.contentHtml, converterCtx);
							await db.insert(schema.activities).values({
								id: actId,
								authorId,
								recipientId: act.recipientId,
								parentActivityId: act.parentActivityId,
								contentJson,
								createdAt: act.createdAt,
								updatedAt: act.updatedAt
							});
						} catch (e: unknown) {
							conflicts.push({
								type: 'activity_insert_error',
								id: act.id,
								userId,
								error: getErrorMessage(e)
							});
						}
					};
					for (const act of activities) {
						if (act.parentActivityId === null) await insertActivity(act);
					}
					for (const act of activities) {
						if (act.parentActivityId !== null) await insertActivity(act);
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

			// C. Replies are imported from the discussion pages in §4.5 (authoritative:
			// bound by location, precise timestamps, correct authors). The per-user
			// comments-page feeds are not used for replies  - they only carry a title
			// (collision-prone) and a date-only timestamp.
		}
	} else {
		console.log('Warning: data/profiles directory not found.');
	}

	// 4.5 Import the OP + every reply from the discussion pages.
	//
	// The discussions table has no content column  - the OP is the chronologically
	// earliest reply (see the discussion loader's orderBy(createdAt).limit(1)).
	//
	// The discussion pages are the authoritative source: each <li id="Comment_N">
	// carries its author (profile link), full ISO datetime, body, and is bound to
	// this discussion by location. This avoids two failure modes of the per-user
	// comment feeds  - title-based discussion matching (collisions across the 85
	// duplicated titles) and date-only timestamps (truncated to midnight, which
	// let same-day replies sort before the OP). The OP is the comment with the
	// lowest Vanilla item position (Item_1); the new template dropped the
	// Discussion_NNN wrapper, so position is the only reliable OP marker.
	const discussionsDir = join(dataDir, 'discussions');
	if (existsSync(discussionsDir)) {
		console.log('Importing discussion OP + replies from discussion pages...');
		let opMissing = 0;
		for (const [discussionId, meta] of existingDiscussionsMap) {
			// Negative id keeps OP replies clear of the positive Vanilla comment ids.
			const opReplyId = -discussionId;

			const discDir = join(discussionsDir, String(discussionId));
			const pageFiles = existsSync(discDir)
				? readdirSync(discDir)
						.filter((f) => /^page-\d+\.html$/.test(f))
						.sort()
				: [];

			// Collect every comment across all pages, dedup by id (a page can list
			// the same comment id more than once). First occurrence wins.
			const byId = new Map<string, ParsedDiscussionComment>();
			let page1Html: string | null = null;
			for (const pf of pageFiles) {
				let pageHtml: string;
				try {
					pageHtml = readFileSync(join(discDir, pf), 'utf-8');
				} catch (e: unknown) {
					conflicts.push({
						type: 'discussion_page_read_error',
						discussionId,
						file: pf,
						error: getErrorMessage(e)
					});
					continue;
				}
				for (const c of parseDiscussionComments(pageHtml, discussionId)) {
					if (!byId.has(c.id)) byId.set(c.id, c);
				}
				// Capture the canonical slug + title from page 1. Some discussions
				// entered the DB from a profile discussions-page feed (which carries
				// only a title, no slug) and got a placeholder slug "discussion-{id}";
				// this lets us correct both with the page's real values.
				if (pf === 'page-000001.html') {
					page1Html = pageHtml;
				}
			}

			if (byId.size === 0) {
				opMissing++;
				conflicts.push({ type: 'op_body_missing', discussionId });
				continue;
			}

			// OP = lowest item position. Ties (e.g. an old-template Discussion_NNN
			// post plus comments) resolve to whichever sorts first by position.
			const sorted = [...byId.values()].sort(
				(a, b) => a.itemPosition - b.itemPosition || a.createdAt.getTime() - b.createdAt.getTime()
			);
			const opComment = sorted[0];

			// Write the OP as a negative-id reply, and stamp the discussion's
			// createdAt with the OP's real time so list views order correctly.
			// Even when the OP body is empty (some posts were blanked out on the
			// original site), we still insert an OP reply attributed to the OP
			// author — otherwise the discussion loader would mistake the first
			// reply for the OP.
			try {
				const opAuthorId = opComment.authorId ?? meta.authorId;
				if (opComment.authorId !== null) {
					await ensureUser(opComment.authorId, opComment.authorUsername ?? '');
				}
				const opContentHtml = opComment.contentHtml.trim() ? opComment.contentHtml : '';
				const opContentJson = await convertHtmlToLexical(opContentHtml, converterCtx);
				if (!opComment.contentHtml.trim()) {
					conflicts.push({ type: 'op_body_empty', discussionId });
				}
				const opEditedById = lookupEditorId(opComment.editedByName, mentionMap);
				if (opEditedById !== null && opComment.editedByName) {
					await ensureUser(opEditedById, opComment.editedByName);
				}
				await db.insert(schema.replies).values({
					id: opReplyId,
					discussionId,
					authorId: opAuthorId,
					contentJson: opContentJson,
					createdAt: opComment.createdAt,
					updatedAt: opComment.createdAt,
					editedAt: opComment.editedAt,
					editedBy: opEditedById
				});
				// Correct the discussion's slug/title/createdAt from page 1.
				// The real slug comes from the page's pager/bookmark URLs
				// (/discussion/{id}/{slug}/pN); the title from the <h1>.
				const discUpdate: DiscussionCorrection = {
					createdAt: opComment.createdAt
				};
				if (page1Html) {
					const slugMatch = page1Html.match(
						new RegExp(`/discussion/${discussionId}/([^"?#\\s/]+)(?:/p\\d+)?["?#]`)
					);
					if (slugMatch) {
						const realSlug = decodeHtmlEntities(slugMatch[1]);
						if (realSlug && realSlug !== 'bookmark' && realSlug !== 'comment') {
							discUpdate.slug = realSlug;
						}
					}
					const titleMatch = page1Html.match(/<h1>([\s\S]+?)<\/h1>/);
					if (titleMatch) {
						const realTitle = decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, '')).trim();
						if (realTitle) discUpdate.title = realTitle;
					}
				}
				await db
					.update(schema.discussions)
					.set(discUpdate)
					.where(eq(schema.discussions.id, discussionId));
				meta.createdAt = opComment.createdAt;
				if (discUpdate.title) meta.title = discUpdate.title;
			} catch (e: unknown) {
				conflicts.push({
					type: 'op_body_insert_error',
					discussionId,
					error: getErrorMessage(e)
				});
			}

			// Insert every non-OP comment as a reply bound to this discussion by id.
			for (const c of sorted) {
				if (c.id === opComment.id) continue;
				const replyId = Number(c.id);
				const authorId = c.authorId ?? GHOST_USER_ID;
				if (c.authorId !== null) {
					await ensureUser(c.authorId, c.authorUsername ?? '');
				}
				const contentHtml = c.contentHtml;
				if (!contentHtml || !contentHtml.trim()) continue;
				try {
					const contentJson = await convertHtmlToLexical(contentHtml, converterCtx);
					const editedById = lookupEditorId(c.editedByName, mentionMap);
					if (editedById !== null && c.editedByName) {
						await ensureUser(editedById, c.editedByName);
					}
					await db.insert(schema.replies).values({
						id: replyId,
						discussionId,
						authorId,
						contentJson,
						createdAt: c.createdAt,
						updatedAt: c.createdAt,
						editedAt: c.editedAt,
						editedBy: editedById
					});
				} catch (e: unknown) {
					conflicts.push({
						type: 'reply_insert_error',
						commentId: c.id,
						discussionId,
						error: getErrorMessage(e)
					});
				}
			}
		}
		if (opMissing > 0) {
			console.log(`  ${opMissing} discussions had no crawlable pages (OP missing).`);
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
	//
	// Avatar source: the `profile-avatars/` directory itself — each file is named
	// `<userId>-<hash>.<ext>`, so readdir + parse the filename gives every crawled
	// user's avatar directly (one file per user). No JSON index needed.
	const avatarEntries: AvatarEntry[] = [];
	const profileAvatarsDir = join(dataDir, 'profile-avatars');
	if (existsSync(profileAvatarsDir)) {
		for (const fname of readdirSync(profileAvatarsDir)) {
			const m = fname.match(/^(\d+)-/);
			if (!m) continue;
			avatarEntries.push({ userId: m[1], file: `profile-avatars/${fname}`, contentType: null });
		}
	}
	console.log(`Uploading avatars (32-way parallel): ${avatarEntries.length}...`);
	if (avatarEntries.length > 0) {
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
	}

	// 5. Generate log and output report
	console.log('\n====== IMPORT COMPLETED ======');
	const [repliesCount] = await db.select({ n: sql<number>`COUNT(*)` }).from(schema.replies);
	const [activitiesCount] = await db.select({ n: sql<number>`COUNT(*)` }).from(schema.activities);
	console.log(`Discussions in database: ${existingDiscussionIds.size}`);
	console.log(`Replies in database: ${repliesCount.n}`);
	console.log(`Activities in database: ${activitiesCount.n}`);
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

	// Build the FTS5 search index for all imported content (idempotent).
	const ftsCounts = await ensureAndBackfillAll(db);
	console.log('FTS search index rebuilt:');
	for (const [table, count] of Object.entries(ftsCounts)) {
		console.log(`  ${table}: ${count} rows indexed`);
	}

	process.exit(0);
}

main().catch((err) => {
	console.error('Error in main execution:', err);
	process.exit(1);
});
