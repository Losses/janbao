import { readdirSync, existsSync, readFileSync, createReadStream, writeFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { getLocalDb } from '../src/lib/server/db';
import * as schema from '../src/lib/server/db/schema';
import { eq } from 'drizzle-orm';

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
	authorId: string;
}

interface ConflictRecord {
	type: string;
	[key: string]: unknown;
}

interface ParsedActivity {
	id: string;
	content: string;
	createdAt: Date;
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

// Convert HTML content into Lexical JSON Node Tree structure
function convertHtmlToLexicalJson(html: string): string {
	// Translate line breaks and paragraph ends to newlines
	const plainText = decodeHtmlEntities(
		html
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n')
			.replace(/<[^>]+>/g, '')
	).trim();

	// Split text by newlines and build standard Lexical paragraphs
	const paragraphs = plainText.split('\n');
	const children = paragraphs.map((p) => ({
		children: [
			{
				detail: 0,
				format: 0,
				mode: 'normal',
				style: '',
				text: p,
				type: 'text',
				version: 1
			}
		],
		direction: 'ltr',
		format: '',
		indent: 0,
		type: 'paragraph',
		version: 1
	}));

	return JSON.stringify({
		root: {
			children: children,
			direction: 'ltr',
			format: '',
			indent: 0,
			type: 'root',
			version: 1
		}
	});
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
	content: string;
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
		let content = '';
		if (messageMatch) {
			content = convertHtmlToLexicalJson(messageMatch[1]);
		}

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

		comments.push({ id, content, discussionTitle, timeText });
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
		let content = '';
		if (excerptMatch) {
			content = convertHtmlToLexicalJson(excerptMatch[1]);
		}

		const dateMatch = part.match(/<span\s+class="MItem\s+DateCreated">([\s\S]+?)<\/span>/);
		let createdAt = new Date();
		if (dateMatch) {
			const dateText = dateMatch[1].replace(/<[^>]+>/g, '').trim();
			createdAt = parseCommentTime(dateText);
		}

		activities.push({
			id,
			content,
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

// Helper to get safe error message from unknown errors
function getErrorMessage(e: unknown): string {
	if (e instanceof Error) {
		return e.message;
	}
	return String(e);
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

	// 2. Preload DB records in memory to detect conflicts and avoid repeated DB lookups
	console.log('Preloading DB indexes for duplicate detection...');
	const existingUserIds = new Set<string>();
	const existingCategorySlugs = new Set<string>();
	const existingDiscussionIds = new Set<string>();
	const existingReplyIds = new Set<string>();
	const existingActivityIds = new Set<string>();

	const existingDiscussionsMap = new Map<string, DiscussionMeta>();
	const discussionTitleToIdMap = new Map<string, string>();

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
			authorId: schema.discussions.authorId
		})
		.from(schema.discussions);
	for (const d of discInDb) {
		existingDiscussionIds.add(d.id);
		existingDiscussionsMap.set(d.id, { title: d.title, authorId: d.authorId });
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
	async function ensureUser(userId: string, username: string, avatarUrl?: string) {
		if (existingUserIds.has(userId)) return;
		try {
			await db.insert(schema.users).values({
				id: userId,
				username: username || `user_${userId}`,
				displayName: username || `User ${userId}`,
				email: `${userId}@placeholder.janbao.net`,
				passwordHash: 'NO_PASSWORD',
				groupSlug: 'member',
				avatarFileId: avatarUrl || null
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

					const discussionId = parsedUrl.id;
					const discussionSlug = parsedUrl.slug;
					const categorySlug = extractCategorySlug(post.pageUrl);

					// Ensure dependencies exist
					await ensureUser(post.userId, post.username, post.avatarUrl);
					await ensureCategory(categorySlug);

					if (existingDiscussionIds.has(discussionId)) {
						const existing = existingDiscussionsMap.get(discussionId);
						if (existing) {
							if (existing.title !== post.title || existing.authorId !== post.userId) {
								conflicts.push({
									type: 'discussion_conflict',
									id: discussionId,
									reason: 'Discussion ID exists with different title/author in posts data',
									existing: { title: existing.title, authorId: existing.authorId },
									incoming: { title: post.title, authorId: post.userId }
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
							authorId: post.userId,
							viewCount: post.viewCount || 0,
							commentCount: post.commentCount || 0,
							createdAt: createdAt,
							updatedAt: createdAt
						});
						existingDiscussionIds.add(discussionId);
						existingDiscussionsMap.set(discussionId, { title: post.title, authorId: post.userId });
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
			const userId = subdir;
			// Ensure it is a valid numeric userId directory
			if (!/^\d+$/.test(userId)) continue;

			const userDir = join(profilesDir, userId);
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
						if (existingActivityIds.has(act.id)) continue;
						try {
							await db.insert(schema.activities).values({
								id: act.id,
								authorId: userId,
								contentJson: act.content,
								createdAt: act.createdAt
							});
							existingActivityIds.add(act.id);
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
						await ensureCategory(d.categorySlug);

						if (existingDiscussionIds.has(d.id)) {
							const existing = existingDiscussionsMap.get(d.id);
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
								id: d.id,
								title: d.title,
								slug: `discussion-${d.id}`,
								categorySlug: d.categorySlug,
								authorId: userId,
								viewCount: d.viewCount,
								commentCount: d.commentCount,
								createdAt: d.lastActiveTime,
								updatedAt: d.lastActiveTime
							});
							existingDiscussionIds.add(d.id);
							existingDiscussionsMap.set(d.id, { title: d.title, authorId: userId });
							discussionTitleToIdMap.set(d.title, d.id);
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

						if (existingReplyIds.has(comment.id)) {
							continue;
						}

						try {
							const createdAt = parseCommentTime(comment.timeText);
							await db.insert(schema.replies).values({
								id: comment.id,
								discussionId: discussionId,
								authorId: userId,
								contentJson: comment.content,
								createdAt: createdAt,
								updatedAt: createdAt
							});
							existingReplyIds.add(comment.id);
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
