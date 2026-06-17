import type { RequestHandler } from './$types';
import { categories, discussions, users } from '$lib/server/db/schema';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { formatTitle } from '$lib/utils/title';
import { XMLBuilder } from 'fast-xml-parser';
import { resolvePermissions, getSiteUrl } from '$lib/server/constants';

// Custom namespace for forum-specific metadata exposed on each item (e.g. the
// last-reply / edit times). These are descriptive only - the feed is ordered by
// post time (createdAt) so a reader's timeline tracks when threads were posted.
const FORUM_NS = 'urn:janbao:rss:forum';
const RSS_LIMIT = 100;

export const GET: RequestHandler = async (event) => {
	const { categorySlug } = event.params;
	const token = event.url.searchParams.get('token');
	const t = event.locals.t;

	if (!token) {
		return new Response(t.rss.unauthorized, { status: 401 });
	}

	const db = event.locals.db;

	// 1. Resolve user matching rssToken (select only needed fields)
	const userRecords = await db
		.select({ groupSlug: users.groupSlug })
		.from(users)
		.where(eq(users.rssToken, token))
		.limit(1);
	if (userRecords.length === 0) {
		return new Response(t.rss.unauthorized, { status: 401 });
	}
	const user = userRecords[0];

	// 2. Fetch category
	const categoryRecords = await db
		.select()
		.from(categories)
		.where(and(eq(categories.slug, categorySlug), isNull(categories.disabledAt)))
		.limit(1);
	if (categoryRecords.length === 0) {
		return new Response(t.category.notFound, { status: 404 });
	}
	const category = categoryRecords[0];

	// Check if user's group can read this category
	const perms = await resolvePermissions(db, categorySlug, user);
	if (!perms.canRead) {
		return new Response(t.common.forbidden, { status: 403 });
	}

	// 3. RSS is ordered strictly by post time (createdAt, newest first) - NOT by
	// lastReplyAt/updatedAt, which only drive the on-site list. A feed reader's
	// timeline must reflect when threads were actually posted, not when they were
	// bumped by a reply or touched by an edit.
	const recentDiscussions = await db
		.select({
			id: discussions.id,
			title: discussions.title,
			slug: discussions.slug,
			createdAt: discussions.createdAt,
			lastReplyAt: discussions.lastReplyAt,
			updatedAt: discussions.updatedAt
		})
		.from(discussions)
		.where(and(eq(discussions.categorySlug, categorySlug), isNull(discussions.deletedAt)))
		.orderBy(desc(discussions.createdAt))
		.limit(RSS_LIMIT);

	// Prefer a configured SITE_URL so a client-controlled Host header can't
	// poison the feed's link/guid URLs.
	const siteUrl = getSiteUrl(event.platform?.env, event.url);

	// 4. Build structured feed object - all text is auto-escaped by XMLBuilder.
	// pubDate is the post time (createdAt) so readers order the feed by it; the
	// forum:* fields only describe last-reply/edit activity and never affect order.
	const items: Record<string, unknown>[] = recentDiscussions.map((d) => {
		const link = `${siteUrl}/discussion/${d.id}/${d.slug}`;
		return {
			title: d.title,
			link,
			guid: { '@_isPermaLink': 'true', '#text': link },
			pubDate: new Date(d.createdAt).toUTCString(),
			'forum:lastReplyDate': new Date(d.lastReplyAt ?? d.createdAt).toUTCString(),
			'forum:updatedDate': new Date(d.updatedAt).toUTCString(),
			description: d.title
		};
	});

	const feed = {
		rss: {
			'@_version': '2.0',
			'@_xmlns:atom': 'http://www.w3.org/2005/Atom',
			'@_xmlns:forum': FORUM_NS,
			channel: {
				title: formatTitle(category.title),
				link: `${siteUrl}/category/${categorySlug}`,
				description: category.description,
				'atom:link': {
					'@_href': `${siteUrl}/category/${categorySlug}/rss`,
					'@_rel': 'self',
					'@_type': 'application/rss+xml'
				},
				item: items.length === 1 ? items[0] : items
			}
		}
	};

	const builder = new XMLBuilder({
		attributeNamePrefix: '@_',
		textNodeName: '#text',
		ignoreAttributes: false,
		suppressBooleanAttributes: false,
		format: true
	});

	const xml = `<?xml version="1.0" encoding="UTF-8" ?>\n${builder.build(feed)}`;

	return new Response(xml, {
		headers: {
			'Content-Type': 'application/xml; charset=utf-8',
			'X-Content-Type-Options': 'nosniff',
			// Per-user-secret feed (rssToken in the query string): never cache
			// where another consumer of the same client/proxy could receive it.
			'Cache-Control': 'private, no-store'
		}
	});
};
